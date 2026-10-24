/**
 * DeepSeek 大模型接入服务（OpenAI 兼容接口）
 * - 文本分析：model=deepseek-chat
 * - 截图识别：走独立视觉模型通道（见 recognizeImage 说明），失败时由调用方降级手动粘贴
 * 仅后端使用，读取 DEEPSEEK_API_KEY / VISION_API_KEY，前端零密钥。
 */
import crypto from "crypto";

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
 * 因此截图识别走独立的"视觉模型"通道：
 * - VISION_API_KEY   ：视觉服务商密钥（推荐硅基流动 siliconflow.cn，可免费申请，国内直连）
 * - VISION_BASE_URL  ：默认 https://api.siliconflow.cn/v1/chat/completions
 * - VISION_MODEL     ：默认 Qwen/Qwen2.5-VL-32B-Instruct（免费额度可用）
 */
const VISION_BASE_URL =
  process.env.VISION_BASE_URL ?? "https://api.siliconflow.cn/v1/chat/completions";
const VISION_MODEL = process.env.VISION_MODEL ?? "Qwen/Qwen2.5-VL-32B-Instruct";
const VISION_TIMEOUT_MS = 60000; // 视觉模型较慢，60s 超时

export async function recognizeImage(system: string, user: string, imageDataUri: string): Promise<string> {
  const key = process.env.VISION_API_KEY;
  if (!key) {
    throw new Error(
      "未配置视觉模型：服务端缺少 VISION_API_KEY 环境变量。推荐用智谱 GLM-4.6V-Flash（免费，open.bigmodel.cn 申请），也可用硅基流动等。"
    );
  }
  const isZhipu = /bigmodel/i.test(VISION_BASE_URL) || /glm/i.test(VISION_MODEL);
  // 智谱免费模型过载时自动降级（同一个 Key 都能用）：
  // 4.6V-Flash（质量最好）→ 4V-Flash（最快）→ 4.1V-Thinking-Flash（慢但常存活）
  const candidates = isZhipu
    ? [VISION_MODEL, "glm-4v-flash", "glm-4.1v-thinking-flash"].filter(
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