/**
 * 视觉识别（截图→对话）客户端直连版
 * - 视觉 Key 存本机 AsyncStorage，识别时由手机直连智谱（open.bigmodel.cn），不经过后端
 * - 模型降级链与服务端一致：主模型 → 4.6v-flashx(付费兜底) → 4v-flash → 4.1v-thinking-flash
 * - 未配置 Key 时返回明确错误，调用方降级到服务器识别
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { getDsKey } from "./deepseek";
import { recordUsage } from "./usage";

const K_KEY = "reply-assistant.vision-key";
const K_BASE = "reply-assistant.vision-base";
const K_MODEL = "reply-assistant.vision-model";

const DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_MODEL = "glm-4.6v-flash";
const TIMEOUT_MS = 60000;

export interface LocalVisionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function getLocalVision(): Promise<LocalVisionConfig | null> {
  try {
    const key = (await AsyncStorage.getItem(K_KEY))?.trim();
    if (!key || key.length < 10) return null;
    const baseUrl = (await AsyncStorage.getItem(K_BASE))?.trim() || DEFAULT_BASE;
    const model = (await AsyncStorage.getItem(K_MODEL))?.trim() || DEFAULT_MODEL;
    return { apiKey: key, baseUrl, model };
  } catch {
    return null;
  }
}

export async function saveLocalVision(apiKey: string, baseUrl?: string, model?: string) {
  await AsyncStorage.setItem(K_KEY, apiKey.trim());
  if (baseUrl?.trim()) await AsyncStorage.setItem(K_BASE, baseUrl.trim());
  if (model?.trim()) await AsyncStorage.setItem(K_MODEL, model.trim());
}

export async function clearLocalVision() {
  await AsyncStorage.multiRemove([K_KEY, K_BASE, K_MODEL]);
}

/** 识别截图：返回 { speaker, text } 数组
 *  优先用本机已配置的 DeepSeek Key 走 deepseek-flash（V4.1 Flash 原生视觉，无需额外配置）；
 *  其次用智谱视觉 Key；都没有则抛 NO_LOCAL_KEY 由调用方降级服务器。
 */
export async function recognizeDirect(
  imageUri: string,
  personName: string
): Promise<{ speaker: string; text: string }[]> {
  const [dsKey, zp] = await Promise.all([getDsKey(), getLocalVision()]);
  if (!dsKey && !zp) throw new Error("NO_LOCAL_KEY");

  // 图片转 base64（此处图片已经过压缩，宽度 1000px 内）
  const b64 = await (FileSystem as any).readAsStringAsync(imageUri, {
    encoding: (FileSystem as any).EncodingType?.Base64 ?? "base64",
  });
  const dataUri = `data:image/jpeg;base64,${b64}`;

  const who = personName || "对方";
  const system = `你是聊天截图文字识别助手。请识别截图中的对话，并按说话人分离。对方称呼为"${who}"。要求输出 JSON：
{"messages":[{"speaker":"说话人","text":"说话内容"}]}
speaker 只允许两种取值：用户本人发的消息填"我"，${who}发的消息填"${who}"。绝不能输出其他值。
只识别对话气泡里的文字，忽略背景、时间、红点等无关元素。不要编造内容。`;

  // 候选通道：DeepSeek 优先（同一把 Key 顺带识图），再智谱降级
  const channels: { baseUrl: string; apiKey: string; models: string[] }[] = [];
  if (dsKey) {
    channels.push({
      baseUrl: "https://api.deepseek.com/v1/chat/completions",
      apiKey: dsKey,
      models: ["deepseek-flash", "deepseek-v4-flash-vision-exp"],
    });
  }
  if (zp) {
    channels.push({
      baseUrl: zp.baseUrl,
      apiKey: zp.apiKey,
      models: [zp.model, "glm-4.6v-flashx", "glm-4v-flash", "glm-4.1v-thinking-flash"].filter(
        (m, i, arr) => m && arr.indexOf(m) === i
      ),
    });
  }

  let lastErr: unknown;
  for (const ch of channels) {
    for (const model of ch.models) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const payload: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                { type: "text", text: "请识别并输出 JSON。" },
                { type: "image_url", image_url: { url: dataUri } },
              ],
            },
          ],
          temperature: 0.3,
          max_tokens: /glm-4v-flash/i.test(model) ? 1024 : 4096,
          stream: false,
        };
        if (/glm-4\.6v/i.test(model)) (payload as any).thinking = { type: "disabled" };
        const res = await fetch(ch.baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ch.apiKey}` },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          lastErr = new Error(`视觉识别 ${res.status}: ${text.slice(0, 160)}`);
          continue; // 换下一个模型/通道
        }
        const data = await res.json();
        // 记账（仅 DeepSeek 通道；智谱按 token 计费规则不同，不做估算）
        if (dsKey && /deepseek/i.test(ch.baseUrl)) {
          void recordUsage(model, data?.usage?.prompt_tokens, data?.usage?.completion_tokens, data?.usage?.prompt_cache_hit_tokens);
        }
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
          lastErr = new Error("视觉模型返回格式异常");
          continue;
        }
        const messages = parseMessages(content);
        if (!messages.length) {
          lastErr = new Error("未识别出对话");
          continue;
        }
        return messages;
      } catch (e: unknown) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("视觉识别失败");
}

function parseMessages(content: string): { speaker: string; text: string }[] {
  try {
    const cleaned = content.replace(/```json|```/g, "");
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.messages)) return normalize(parsed.messages);
  } catch {
    // 继续用正则兜底
  }
  const fence = content.match(/"messages"\s*:\s*\[([\s\S]*?)\]/);
  if (fence) {
    const items = [...fence[1].matchAll(/\{\s*"speaker"\s*:\s*"([^"]*)"\s*,\s*"text"\s*:\s*"([\s\S]*?)"\s*\}/g)];
    return normalize(items.map((m) => ({ speaker: m[1], text: m[2] })));
  }
  return [];
}

function normalize(list: any[]): { speaker: string; text: string }[] {
  return list
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ speaker: m.speaker === "我" ? "我" : String(m.speaker || "对方"), text: m.text.trim() }));
}
