/**
 * 用量统计 + 模型选择（本机存储）
 * - 记录每次调用的 prompt/completion tokens，按模型累计，估算人民币花费
 * - 价格表按 DeepSeek 官方（2026-10）：flash 输入未命中 ¥1/M、命中 ¥0.02/M、输出 ¥4/M；高峰时段 ×2
 * - 用量只存本机，不上传
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ModelId = "deepseek-flash" | "deepseek-v4-pro";

export const MODELS: { id: ModelId; name: string; desc: string; input: number; output: number }[] = [
  { id: "deepseek-flash", name: "Flash（默认）", desc: "快、便宜、支持识图", input: 1, output: 4 },
  { id: "deepseek-v4-pro", name: "V4 Pro", desc: "更强推理，贵约 4 倍", input: 4.7, output: 11 },
];

const K_MODEL = "reply-assistant.ds-model";
const K_USAGE = "reply-assistant.usage";

export interface UsageTotals {
  prompt: number;
  completion: number;
  calls: number;
  costCny: number;
  byModel: Record<string, { prompt: number; completion: number; calls: number; costCny: number }>;
  updatedAt: number;
}

const EMPTY: UsageTotals = { prompt: 0, completion: 0, calls: 0, costCny: 0, byModel: {}, updatedAt: 0 };

export async function getDsModel(): Promise<ModelId> {
  try {
    const m = await AsyncStorage.getItem(K_MODEL);
    return m === "deepseek-v4-pro" ? "deepseek-v4-pro" : "deepseek-flash";
  } catch {
    return "deepseek-flash";
  }
}

export async function setDsModel(m: ModelId) {
  await AsyncStorage.setItem(K_MODEL, m);
}

/** 是否高峰时段（北京时间周一至周五 9-12、14-18，节假日除外——这里只按工作日粗略判断） */
function isPeakNow(d = new Date()): boolean {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000); // 转为北京时间
  const day = bj.getUTCDay(); // 0=周日
  if (day === 0 || day === 6) return false;
  const h = bj.getUTCHours();
  return (h >= 9 && h < 12) || (h >= 14 && h < 18);
}

function priceOf(model: string) {
  const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
  const k = isPeakNow() ? 2 : 1;
  return { input: m.input * k, output: m.output * k };
}

/** 记录一次调用的用量（tokens 单位为个） */
export async function recordUsage(
  model: string,
  promptTokens?: number,
  completionTokens?: number,
  cacheHitTokens?: number
) {
  const p = Math.max(0, Math.round(promptTokens || 0));
  const c = Math.max(0, Math.round(completionTokens || 0));
  if (!p && !c) return;
  const hit = Math.max(0, Math.min(p, Math.round(cacheHitTokens || 0)));
  const miss = Math.max(0, p - hit);
  const price = priceOf(model);
  // 缓存命中按 1/50 计价（官方：命中 ¥0.02 / 未命中 ¥1）
  const cost = (miss * price.input + hit * price.input * 0.02 + c * price.output) / 1_000_000;

  try {
    const raw = await AsyncStorage.getItem(K_USAGE);
    const cur: UsageTotals = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
    cur.prompt += p;
    cur.completion += c;
    cur.calls += 1;
    cur.costCny = +(cur.costCny + cost).toFixed(4);
    const bm = cur.byModel[model] ?? { prompt: 0, completion: 0, calls: 0, costCny: 0 };
    bm.prompt += p;
    bm.completion += c;
    bm.calls += 1;
    bm.costCny = +(bm.costCny + cost).toFixed(4);
    cur.byModel[model] = bm;
    cur.updatedAt = Date.now();
    await AsyncStorage.setItem(K_USAGE, JSON.stringify(cur));
  } catch {
    // 统计失败不影响主流程
  }
}

export async function getUsage(): Promise<UsageTotals> {
  try {
    const raw = await AsyncStorage.getItem(K_USAGE);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export async function resetUsage() {
  await AsyncStorage.removeItem(K_USAGE);
}

/** 金额格式化：小于 1 元显示 3 位小数 */
export function fmtCny(n: number): string {
  if (!n) return "0.00";
  return n < 1 ? n.toFixed(3) : n.toFixed(2);
}

/** token 数格式化：1.2k / 34.5k / 1.2M */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
