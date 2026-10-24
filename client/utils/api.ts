/**
 * 后端 API 封装（前端零密钥）
 * 所有请求统一带 x-pin-token header
 */
// Web 构建默认走同源相对路径（后端托管静态页时无需配置）；原生端默认本机 9091
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

const BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_BASE_URL ??
  (typeof window !== "undefined" ? "" : "http://localhost:9091");

let pinToken: string | null = null;

/** 按扩展名推断 MIME（分享面板用） */
function mimeOf(filename: string): string {
  if (filename.endsWith(".pdf")) return "application/pdf";
  if (filename.endsWith(".html")) return "text/html";
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

/** 下载 .docx / .pdf / .json 等：Web 触发浏览器下载；原生端下载到缓存后调系统分享（可存文件、发微信、用 WPS 打开） */
export async function downloadDocx(path: string, filename: string): Promise<void> {
  if (Platform.OS === "web") {
    const res = await fetch(`${BASE_URL}${path}`, { headers: pinToken ? { "x-pin-token": pinToken } : {} });
    if (!res.ok) throw new Error(`导出失败(${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  // 原生端：带 PIN 头下载到缓存目录 → 系统分享
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  const dl = await FileSystem.downloadAsync(`${BASE_URL}${path}`, fileUri, {
    headers: pinToken ? { "x-pin-token": pinToken } : {},
  });
  if (dl.status >= 400) throw new Error(`导出失败(${dl.status})`);
  if (!(await Sharing.isAvailableAsync())) throw new Error("当前设备不支持系统分享，请升级系统后重试");
  await Sharing.shareAsync(dl.uri, { mimeType: mimeOf(filename), dialogTitle: "保存或分享文件", UTI: "public.data" });
}

/** 原生端通用：把本地文本内容写成文件并调起系统分享 */
export async function shareTextFile(content: string, filename: string): Promise<void> {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("当前设备不支持系统分享");
  await Sharing.shareAsync(fileUri, { mimeType: mimeOf(filename), dialogTitle: "保存或分享文件", UTI: "public.data" });
}

export function setPinToken(t?: string | null) {
  pinToken = t ?? null;
}
export function getPinToken() {
  return pinToken;
}

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {};
  const url = `${BASE_URL}${path}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (pinToken) headers["x-pin-token"] = pinToken;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ code: res.status, msg: "服务器响应异常" }));
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(json.msg || `请求失败(${res.status})`);
  }
  return json.data as T;
}

export const api = {
  base: BASE_URL,

  // ===== PIN =====
  pinStatus: () => request<{ initialized: boolean }>("GET", "/api/v1/pin/status"),
  pinSetup: (pin: string) =>
    request<{ token: string; growth_mode: string }>("POST", "/api/v1/pin/setup", { pin }),
  pinUnlock: (pin: string) =>
    request<{ token: string; growth_mode: string }>("POST", "/api/v1/pin/unlock", { pin }),
  pinDisable: () =>
    request<{ success: boolean; initialized: boolean }>("POST", "/api/v1/pin/disable"),

  // ===== People =====
  people: () => request<any[]>("GET", "/api/v1/people"),
  person: (id: string) => request<any>("GET", `/api/v1/people/${id}`),
  createPerson: (data: any) => request<any>("POST", "/api/v1/people", data),
  updatePerson: (id: string, data: any) => request<any>("PUT", `/api/v1/people/${id}`, data),
  deletePerson: (id: string) => request<any>("DELETE", `/api/v1/people/${id}`),

  // ===== Analysis =====
  analyze: (data: any) =>
    request<any>(
      "POST",
      "/api/v1/analyze",
      data
    ),
  analysis: (id: string) => request<any>("GET", `/api/v1/analysis/${id}`),
  markSuggestion: (id: string, index: number, used: boolean) =>
    request<any>("PUT", `/api/v1/analysis/${id}/mark`, { index, used }),
  deleteAnalysis: (id: string) => request<any>("DELETE", `/api/v1/analysis/${id}`),
  moveAnalysis: (id: string, direction: "up" | "down") =>
    request<any>("PATCH", `/api/v1/analysis/${id}/move`, { direction }),
  rehearse: (body: { person_id: string; goal: string; mode: "chat" | "review"; history?: { role: string; text: string }[]; transcript?: string }) =>
    request<any>("POST", "/api/v1/rehearse", body),
  portrait: (personId: string) => request<any>("GET", `/api/v1/people/${personId}/portrait`),
  importData: (payload: unknown) => request<any>("POST", "/api/v1/import", payload),
  analysisOutcome: (id: string, theirReply: string) =>
    request<any>("POST", `/api/v1/analysis/${id}/outcome`, { their_reply: theirReply }),
  // 直连 DeepSeek 成功后，保存计算结果到后端（时间线/温度），可持久化即存
  saveComputed: (data: any) => request<any>("POST", "/api/v1/analyze/save-computed", data),

  // ===== Timeline / Temperature =====
  personAnalyses: (personId: string) =>
    request<any[]>("GET", `/api/v1/people/${personId}/analyses`),
  personTemperatures: (personId: string) =>
    request<any[]>("GET", `/api/v1/people/${personId}/temperatures`),

  // ===== Screenshot =====
  recognize: async (formData: FormData) =>
    fetch(`${api.base}/api/v1/recognize`, {
      method: "POST",
      headers: pinToken ? { "x-pin-token": pinToken } : {},
      body: formData,
      signal: AbortSignal.timeout(100000), // 100s 兜底：超时提示重试而不是永远转圈
    }).then(async (r) => {
      const json = await r.json().catch(() => ({ code: r.status, msg: "识别失败" }));
      if (!r.ok) throw new Error(json.msg || "识别失败");
      return json.data as { messages: { speaker: string; text: string }[] };
    }),

  // ===== AI 智能辅助 =====
  /** 把整段粘贴的聊天记录交给 AI 分句并标注说话人 */
  parseChat: (text: string, personName: string) =>
    request<{ messages: { speaker: string; text: string }[] }>("POST", "/api/v1/parse-chat", {
      text,
      person_name: personName,
    }),
  /** 从一段聊天里提取人物档案（称呼/关系/背景/重要日期），用于 AI 快速建档 */
  extractProfile: (text: string) =>
    request<{
      name?: string;
      relationship?: string;
      background?: string;
      dates?: { name: string; month_day: string }[];
    }>(
      "POST",
      "/api/v1/people/extract-profile",
      { text },
    ),

  // ===== 视觉模型设置（截图识别） =====
  visionSettings: () =>
    request<{ configured: boolean; source: string; base_url: string; model: string; key_masked: string }>(
      "GET",
      "/api/v1/settings/vision",
    ),
  saveVisionKey: (apiKey: string, baseUrl?: string, model?: string) =>
    request<{ saved: boolean; model: string }>("PUT", "/api/v1/settings/vision", {
      api_key: apiKey,
      base_url: baseUrl,
      model: model,
    }),

  // ===== Reports =====
  reports: () => request<any[]>("GET", "/api/v1/reports"),
  generateReport: () =>
    request<{ id: string; content: any }>("POST", "/api/v1/reports/generate"),

  // ===== Settings =====
  settings: () => request<{ growth_mode: string; moderation: boolean }>("GET", "/api/v1/settings"),
  setMode: (mode: string) =>
    request<{ growth_mode: string }>("PUT", "/api/v1/settings/mode", { mode }),
  setModeration: (on: boolean) =>
    request<{ moderation: boolean }>("PUT", "/api/v1/settings/moderation", { enabled: on }),
  updateSettings: async (data: { growth_mode?: string; pin?: string; moderation?: boolean }) => {
    // 后端分开多个接口：growth_mode 走 /settings/mode，pin 变更走 pin/setup，moderation 走 /settings/moderation
    if (data.growth_mode !== undefined) {
      return request("PUT", "/api/v1/settings/mode", { mode: data.growth_mode });
    }
    if (data.moderation !== undefined) {
      return request("PUT", "/api/v1/settings/moderation", { enabled: data.moderation });
    }
    if (data.pin !== undefined) {
      return request("POST", "/api/v1/pin/setup", { pin: data.pin });
    }
    return null;
  },

  // ===== Dates =====
  upcomingDates: () => request<any[]>("GET", "/api/v1/dates/upcoming"),
};