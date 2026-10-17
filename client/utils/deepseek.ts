/**
 * App 端「自带钥匙」DeepSeek 直连模式。
 * - 用户可在设置页填写自己的 DeepSeek API Key（存手机本地，禁止硬编码）。
 * - 有 key 时：App 直连 api.deepseek.com 完成分析（原生端无浏览器跨域限制，不依赖后端可达性）。
 * - 无 key 时：回退到后端模式（由服务端调用 DeepSeek）。
 * - 超时 30s + 重试 1 次，失败返回具体原因。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { METHOD_CARDS, SCENES, buildPhraseSection } from "@/constants/methodologies";
import { api } from "@/utils/api";

export const DS_KEY_STORE = "ds_api_key";

const API_URL = "https://api.deepseek.com/v1/chat/completions";
const TIMEOUT_MS = 30000;
const MAX_RETRY = 1;

export type GrowthMode = "canned" | "hint" | "critique";

/** 读取本机保存的 DeepSeek key（已在用户输入或正常初始化后清洗过） */
export async function getDsKey(): Promise<string> {
  try {
    return ((await AsyncStorage.getItem(DS_KEY_STORE)) || "").trim();
  } catch {
    return "";
  }
}

export async function setDsKey(key: string): Promise<void> {
  await AsyncStorage.setItem(DS_KEY_STORE, key.trim());
}

/** 是否已配置「自带钥匙」 */
export async function hasDsKey(): Promise<boolean> {
  return !!(await getDsKey());
}

/* ---------- 匿名化（与后端 anonymize 保持一致，直接调用服务端口径） ---------- */
function maskPersonName(text: string, personName: string): string {
  if (!personName) return text;
  const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "g"), "对方");
}
function maskNumbers(text: string): string {
  return text
    .replace(/\b\d{17}[\dXx]\b/g, "***************")
    .replace(/\b1[3-9]\d{9}\b/g, "***********")
    .replace(/\b\d{5,11}\b/g, "****");
}
export function anonymizeLocal(text: string, personName: string): string {
  if (!text) return text;
  return maskNumbers(maskPersonName(text, personName));
}

/* ---------- 系统提示词（与后端一致） ---------- */
function buildMethodologySection(): string {
  return METHOD_CARDS.map((c, i) => {
    const isCore = c.title === "非暴力沟通" ? "四步" : "原则";
    return `卡${i + 1}·${c.title}（来源：${c.source}）
适用场景：${c.scene}
核心${isCore}：
${c.core.map((x) => `- ${x}`).join("\n")}
使用要点：${c.usage}
禁用提醒：${c.forbid}`;
  }).join("\n\n");
}

function buildSystem(mode: GrowthMode): string {
  const modeRule =
    mode === "hint"
      ? "成长模式=提示：建议回复只给【思路方向】和【关键词】，绝不给可直接发送的完整原话。"
      : mode === "critique"
        ? "成长模式=点评：用户已在自己写的『我的想法』里写好回复，你只需点评（指出优点、可改进处、风险），不要代写完整新句子；如回复明显不妥可给替代思路。"
        : "成长模式=话术：给出可直接发送的完整建议句子（语气可润色，内容必须真实）。";

  const sceneRule = `【沟通方法论引擎】
以下是内置方法论卡片库（全文）：
${buildMethodologySection()}

分析前先判断这段聊天的场景类型（五选一，必须从下面选）：${SCENES.join(" / ")}。
场景判断规则：
- 冲突表达（表达不满、回应指责、提出请求、化解冲突）→ 重点依据卡1+卡2+卡7（先情绪标注，再谈内容）
- 敏感话题（怕谈崩、情绪上来了、要谈重要的/敏感的）→ 重点依据卡2+卡5
- 焦虑内耗（等回复焦虑、过度在意评价、自我怀疑）→ 重点依据卡3+卡8
- 付出错位（付出没被领情、对方感觉不到心意）→ 重点依据卡4+卡8+卡1
- 日常交流（无上述特征的普通闲聊）→ 可参考卡5/卡6，不强制引用方法论

【方法论引用规范】
1. 只能引用上方内置卡片里的内容，禁止编造书中不存在的理论。
2. 每条建议回复末尾追加"依据：XX方法"标签（XX为卡片名，如"非暴力沟通""关键对话""课题分离""表达频道""知觉检核""校准问题""情绪标注""仁慈归因"），并使用 suggestion 的 theory_tag 字段给出对应卡片名。
3. "注意事项"板块可引用卡片的使用要点与禁用提醒，帮助用户避开风险。
4. 两卡片原则冲突时，优先"先恢复安全感、再谈内容（关键对话原则）"。
5. 日常交流场景不强制给建议标注理论依据。

【回复话术参考库】
${buildPhraseSection()}`;

  return `你是一名极简、诚实、克制的人际沟通教练。你帮助用户理解一段聊天、维护关系、提升沟通能力。
你最重要的品质是：真实、有依据、不武断、节制——你不是替用户说话，而是帮用户自己想清楚。

【铁律】
1. 心态分析只基于聊天记录内容本身。所有结论必须注明依据（引用聊天记录原句，用「」括起）。证据不足时，明确写"信息有限，仅为可能"，禁止武断断言。
2. 建议必须同时结合聊天记录 + 我的想法两个输入。我的想法为空时，先如实提示"没有你的想法，分析可能不全"，再继续。
3. 当我的想法与聊天记录明显矛盾（例如对方在生气，我却想开玩笑）时，先指出这个矛盾，再给替代方案，禁止顺着错误想法给建议。
4. 保持真实：允许润色语气，但绝对禁止建议编造虚假事实（伪造行程、捏造身份、虚构经历）。如果检测到用户想编造，温和提示："长久的关系靠真实"。
5. 匿名化已由系统完成，你把聊天双方统一视作"我"和"对方"，不要在输出里编造真实姓名。
6. 克制：如果这已经是同一个问题被反复追问，你可以提醒用户"先去做实际的事"。不要无限度地二次加工同一情境。

【语言风格（硬性要求）】
1. 说人话：禁止「首先/其次/总之」「值得一提的是」「从某种意义上说」「在……方面」等书面套话，禁止排比堆砌。
2. 禁止 AI 腔：输出中不得出现「作为AI」「希望对你有帮助」「祝你顺利」「综上所述」等措辞。
3. thoughts.point 每条 ≤ 30 字，像懂行的朋友当面转述，不像报告标题；evidence 必须引用聊天记录原句。
4. suggestions.text 是用户可以直接复制发送的话：≤ 60 字、口语化、符合中文聊天软件的说话习惯，像真人随手打出来的消息，不像作文。
5. notes 只给具体动作（如「今晚别再发了，明早再回」），禁止「多沟通」「保持冷静」这类正确的废话。
6. 语气平实克制，不过度共情、不堆感叹号、不喊口号。

【输出格式】严格输出 JSON，不要任何多余文字：
{
  "scene": "冲突表达/敏感话题/焦虑内耗/付出错位/日常交流",
  "thoughts": [{"point": "要点", "evidence": "依据：引用原句或‘信息有限，仅为可能’"}],
  "suggestions": [{"style": "真诚直接/幽默轻松/放缓节奏", "text": "具体建议（末尾附‘依据：XX方法’）", "reason": "一句话理由", "theory_tag": "非暴力沟通/关键对话/课题分离/表达频道 或留空"}],
  "notes": ["注意事项（0-2条节奏提醒，可含卡片使用要点/禁用提醒）"],
  "temperature": {"label": "热/温/冷", "reason": "一句依据"}
}
- scene：五选一，判断结果标签。
- thoughts：2-4 条
- suggestions：2-3 个，每个带风格标签、具体建议、一句话理由（根据成长模式调整 text 的形态）
- notes：0-2 条
- temperature.label 只允许"热""温""冷"三种，给出作出判断的一句依据
- scene / suggestions[].theory_tag 解析失败或缺省时可留空，不影响分析主流程

${sceneRule}

${modeRule}`;
}

export interface DirectAnalysisReq {
  personName: string;
  chatRecord: string;
  myThought: string;
  myReply?: string;
  growthMode: GrowthMode;
  tone?: string;
}

export type AIFailureKind = "auth" | "network" | "timeout" | "parse" | "server" | "no_key";

export interface DirectResult {
  ok: boolean;
  json?: any;
  kind?: AIFailureKind;
  message?: string;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* ignore */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* ignore */
    }
  }
  const brace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (brace >= 0 && lastBrace > brace) {
    try {
      return JSON.parse(trimmed.slice(brace, lastBrace + 1));
    } catch {
      /* ignore */
    }
  }
  return null;
}

function normJson(raw: any): any {
  const j = raw || {};
  return {
    scene: typeof j.scene === "string" ? j.scene : undefined,
    thoughts: Array.isArray(j.thoughts) ? j.thoughts : [],
    suggestions: Array.isArray(j.suggestions)
      ? j.suggestions.map((s: any) => ({
          style: s?.style || "",
          text: s?.text || "",
          reason: s?.reason || "",
          theory_tag: s?.theory_tag || "",
        }))
      : [],
    notes: Array.isArray(j.notes) ? j.notes : [],
    temperature: j?.temperature || { label: "温", reason: "" },
  };
}

async function doRequest(system: string, user: string, key: string): Promise<DirectResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let lastKind: AIFailureKind = "server";
  let lastMsg = "";
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.8,
        stream: false,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      return { ok: false, kind: "auth", message: "DeepSeek API Key 无效，请在设置里检查" };
    }
    if (!res.ok) {
      return { ok: false, kind: "server", message: `DeepSeek 服务返回异常（${res.status}）` };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { ok: false, kind: "server", message: "DeepSeek 返回格式异常" };
    }
    const json = extractJson(content);
    if (!json) {
      return { ok: false, kind: "parse", message: "AI 返回无法解析，请稍后再试" };
    }
    return { ok: true, json: normJson(json) };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, kind: "timeout", message: "请求超时（30 秒），请稍后再试" };
    }
    return { ok: false, kind: "network", message: "网络连接失败，请检查网络后重试" };
  } finally {
    clearTimeout(timer);
    void lastKind;
    void lastMsg;
  }
}

/** App 端直连 DeepSeek 分析（含重试 1 次） */
export async function analyzeDirect(req: DirectAnalysisReq & { apiKey: string }): Promise<DirectResult> {
  const { apiKey, personName, chatRecord, myThought, myReply, growthMode } = req;
  let last: DirectResult | null = null;
  for (let i = 0; i <= MAX_RETRY; i++) {
    const anonymizedChat = anonymizeLocal(chatRecord, personName);
    const anonymizedThought = anonymizeLocal(myThought, personName);
    const replyLine = myReply ? `\n（我自己准备的回复）${anonymizeLocal(myReply, personName)}` : "";
    const user = `【聊天记录】\n${anonymizedChat}\n\n【我的想法】\n${anonymizedThought || "（空）"}${replyLine}`;
    last = await doRequest(buildSystem(growthMode), user, apiKey);
    if (last.ok || last.kind === "auth") return last;
    last = { ...last, message: `${last.message}（已重试一次）` };
  }
  return last || { ok: false, kind: "server", message: "分析失败，请稍后再试" };
}

/* ============ 流式版本：逐字返回，实时预览 ============ */

export interface StreamDirectReq extends DirectAnalysisReq {
  apiKey: string;
  styleExamples?: string[];
}

/** 组装用户消息（流式/非流式共用） */
function buildUserContent(req: DirectAnalysisReq & { styleExamples?: string[] }): string {
  const anonymizedChat = anonymizeLocal(req.chatRecord, req.personName);
  const anonymizedThought = anonymizeLocal(req.myThought, req.personName);
  const replyLine = req.myReply ? `\n（我自己准备的回复）${anonymizeLocal(req.myReply, req.personName)}` : "";
  const toneLine = req.tone ? `\n\n【本次期望语气】${req.tone}` : "";
  const styleBlock = req.styleExamples?.length
    ? `\n\n【我的表达风格参考（学习目标）】\n以下是这位用户过往采纳的回复与本人想法，生成建议时请模仿这种用词习惯与语气（更口语、更像他本人写的），但不复制原句：\n${req.styleExamples.map((s) => `- ${s}`).join("\n")}`
    : "";
  return `【聊天记录】\n${anonymizedChat}\n\n【我的想法】\n${anonymizedThought || "（空）"}${replyLine}${toneLine}${styleBlock}`;
}

/** 流式直连：SSE 逐 token 回调；失败时抛错由调用方降级到非流式 */
export async function analyzeDirectStream(
  req: StreamDirectReq,
  onDelta: (fullText: string) => void,
): Promise<DirectResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: buildSystem(req.growthMode) },
          { role: "user", content: buildUserContent(req) },
        ],
        temperature: 0.8,
        stream: true,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      return { ok: false, kind: "auth", message: "DeepSeek API Key 无效，请在设置里检查" };
    }
    if (!res.ok) {
      return { ok: false, kind: "server", message: `DeepSeek 服务返回异常（${res.status}）` };
    }
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, kind: "server", message: "流式响应为空" };
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            full += delta;
            onDelta(full);
          }
        } catch { /* 忽略不完整分片 */ }
      }
    }
    const json = extractJson(full);
    if (!json) return { ok: false, kind: "parse", message: "AI 返回无法解析，请稍后再试" };
    return { ok: true, json: normJson(json) };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, kind: "timeout", message: "请求超时，请稍后再试" };
    }
    return { ok: false, kind: "network", message: "网络连接失败，请检查网络后重试" };
  } finally {
    clearTimeout(timer);
  }
}

/** 从流式半成品 JSON 中增量提取已完成要点（实时预览用，容忍未闭合文本） */
export function progressiveExtract(text: string): { thoughts: string[]; suggestions: string[] } {
  const grab = (key: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      try {
        const v = JSON.parse(`"${m[1]}"`);
        if (v && typeof v === "string" && v.trim() && !out.includes(v)) out.push(v);
      } catch { /* 未完结的转义，跳过 */ }
    }
    return out;
  };
  return { thoughts: grab("point").slice(0, 6), suggestions: grab("text").slice(0, 4) };
}

/** 通用多轮对话直连（演练/画像等场景用），返回纯文本 */
export async function chatDirect(
  apiKey: string,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  temperature = 0.8,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: system }, ...messages],
        temperature,
        stream: false,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DeepSeek 服务异常（${res.status}）`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("AI 返回为空");
    return content;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("请求超时，请稍后再试");
    throw e?.message ? new Error(e.message) : new Error("网络连接失败");
  } finally {
    clearTimeout(timer);
  }
}

/** 直连成功后，尝试把结果保存到后端（时间线/温度）——后端可达即持久化，不可达则仅本次显示 */
export async function saveComputedBestEffort(record: {
  person_id: string;
  chat_input: string;
  thought_input: string;
  result: any;
}): Promise<string | null> {
  try {
    const r = await (api as any).saveComputed(record);
    return r?.record_id || null;
  } catch {
    return null;
  }
}