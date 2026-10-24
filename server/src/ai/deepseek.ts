/**
 * DeepSeek 大模型接入服务（OpenAI 兼容接口）
 * - 文本分析：model=deepseek-chat
 * - 截图识别：走独立视觉模型通道（见 recognizeImage 说明），失败时由调用方降级手动粘贴
 * 仅后端使用，读取 DEEPSEEK_API_KEY / VISION_API_KEY，前端零密钥。
 */
import crypto from "crypto";
import fsSync from "fs";
import path from "path";
import os from "os";

const BASE_URL = "https://api.deepseek.com/v1/chat/completions";
const TIMEOUT_MS = 30000; // 30s 超时
const MAX_RETRY = 1; // 超时/失败重试 1 次

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY 未配置");
  return key;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface DeepSeekResult {
  content: string;
}

async function request(messages: ChatMessage[], temperature = 0.8): Promise<DeepSeekResult> {
  const key = getApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        temperature,
        stream: false,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = (data as any)?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("DeepSeek 返回格式异常");
    return { content };
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试的调用 */
async function requestWithRetry(messages: ChatMessage[], temperature = 0.8): Promise<DeepSeekResult> {
  let lastErr: unknown;
  for (let i = 0; i <= MAX_RETRY; i++) {
    try {
      return await request(messages, temperature);
    } catch (e) {
      lastErr = e;
      if (i < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  throw lastErr;
}

/** 文本对话 */
export async function chat(
  system: string,
  user: string,
  temperature = 0.8,
): Promise<DeepSeekResult> {
  return requestWithRetry(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
  );
}

/**
 * 视觉识别（截图转文字并分离说话人）；调用方需自行捕获异常做降级。
 *
 * ⚠️ DeepSeek 的 deepseek-chat 是纯文本模型，不支持图片输入（传 image_url 必报 400），
 * 因此截图识别走独立的"视觉模型"通道，配置优先级（高→低）：
 * 1. 设置页保存的 vision.local.json（运行时手动配置）
 * 2. 环境变量 VISION_API_KEY / VISION_BASE_URL / VISION_MODEL（keys.env 或平台注入）
 * 3. 默认：智谱 GLM-4.6V-Flash（免费，open.bigmodel.cn 申请）
 */
const VISION_BASE_URL_DEFAULT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const VISION_MODEL_DEFAULT = "glm-4.6v-flash";
const VISION_TIMEOUT_MS = 60000; // 视觉模型较慢，60s 超时

export interface VisionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: string;
}

/** 运行时视觉配置：设置页文件 > 环境变量 > 默认智谱免费模型 */
/** vision.local.json 可能所在位置（生产容器程序目录常只读，回退临时目录） */
export function visionConfigPaths(): string[] {
  return [
    path.resolve(process.cwd(), "vision.local.json"),
    path.resolve(os.tmpdir(), "vision.local.json"),
  ];
}

export function getVisionConfig(): VisionConfig {
  try {
    for (const p of visionConfigPaths()) {
      if (!fsSync.existsSync(p)) continue;
      const j = JSON.parse(fsSync.readFileSync(p, "utf8"));
      if (j.api_key && String(j.api_key).length >= 10) {
        return {
          apiKey: String(j.api_key).trim(),
          baseUrl: (j.base_url || process.env.VISION_BASE_URL || VISION_BASE_URL_DEFAULT).trim(),
          model: (j.model || process.env.VISION_MODEL || VISION_MODEL_DEFAULT).trim(),
          source: "设置页",
        };
      }
      break;
    }
  } catch { /* 配置文件损坏则忽略 */ }
  if (process.env.VISION_API_KEY) {
    return {
      apiKey: process.env.VISION_API_KEY,
      baseUrl: process.env.VISION_BASE_URL || VISION_BASE_URL_DEFAULT,
      model: process.env.VISION_MODEL || VISION_MODEL_DEFAULT,
      source: "环境变量",
    };
  }
  return { apiKey: "", baseUrl: VISION_BASE_URL_DEFAULT, model: VISION_MODEL_DEFAULT, source: "未配置" };
}

export async function recognizeImage(system: string, user: string, imageDataUri: string): Promise<string> {
  const cfg = getVisionConfig();
  const key = cfg.apiKey;
  if (!key) {
    throw new Error(
      "未配置视觉模型：可在本应用「设置 → 视觉模型」填入智谱 API Key（open.bigmodel.cn 免费申请），或在服务端配置 VISION_API_KEY 环境变量。"
    );
  }
  const VISION_BASE_URL = cfg.baseUrl;
  const VISION_MODEL = cfg.model;
  const isZhipu = /bigmodel/i.test(VISION_BASE_URL) || /glm/i.test(VISION_MODEL);
  // 智谱免费模型过载时自动降级（同一个 Key 都能用）：
  // 4.6V-Flash(免费) → 4.6V-FlashX(付费，约0.002元/张，几乎不排队) → 4V-Flash(免费) → 4.1V-Thinking(免费)
  const candidates = isZhipu
    ? [VISION_MODEL, "glm-4.6v-flashx", "glm-4v-flash", "glm-4.1v-thinking-flash"].filter(
        (m, i, arr) => m && arr.indexOf(m) === i,
      )
    : [VISION_MODEL];

  let lastErr: unknown;
  for (const model of candidates) {
    // 每个模型最多尝试 2 次（429/5xx/偶发401 退避重试）
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
      try {
        const payload: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                { type: "text", text: user },
                { type: "image_url", image_url: { url: imageDataUri } },
              ],
            },
          ],
        temperature: 0.3,
        // glm-4v-flash 上下文仅 4K，max_tokens 上限 1024
        max_tokens: /glm-4v-flash/i.test(model) ? 1024 : 4096,
        stream: false,
      };
        // 智谱 GLM-4.6V 默认开深度思考，OCR 类任务关掉可大幅提速
        if (/glm-4\.6v/i.test(model)) payload.thinking = { type: "disabled" };
        const res = await fetch(VISION_BASE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          // 诊断日志：打出实际使用的模型/Key 前缀/BaseURL 与响应
          console.error(`[vision] model=${model} key=${String(key).slice(0, 10)}... url=${VISION_BASE_URL} status=${res.status} body=${text.slice(0, 120)}`);
          const err = new Error(`视觉模型 ${res.status}: ${text.slice(0, 200)}`);
          lastErr = err;
          if ((res.status === 429 || res.status === 401 || res.status >= 500) && attempt < 1) {
            clearTimeout(timer);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          break; // 该模型放弃，换下一个
        }
        const data = await res.json();
        const content = (data as any)?.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
          lastErr = new Error("视觉模型返回格式异常");
          break;
        }
        return content;
      } catch (e: any) {
        lastErr = e;
        // 超时/网络错误 → 换下一个模型（不再原地重试）
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("视觉模型多次重试后仍失败");
}

/** 从 AI 文本中安全提取 JSON（容忍 markdown 代码块围栏） */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // 尝试直接解析
  try {
    return JSON.parse(trimmed);
  } catch {
    // 忽略
  }
  // 去掉 markdown ```json ``` 围栏
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // 忽略
    }
  }
  // 提取第一个 { ... } 块
  const brace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (brace >= 0 && lastBrace > brace) {
    try {
      return JSON.parse(trimmed.slice(brace, lastBrace + 1));
    } catch {
      // 忽略
    }
  }
  return null;
}

/** 生成简单的幂等非敏感跟踪 id（内部日志用） */
export function genId(): string {
  return crypto.randomBytes(8).toString("hex");
}