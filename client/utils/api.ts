/**
 * 后端 API 封装（前端零密钥）
 * 所有请求统一带 x-pin-token header
 */
// Web 构建默认走同源相对路径（后端托管静态页时无需配置）；原生端默认本机 9091
import { Platform } from "react-native";

const BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_BASE_URL ??
  (typeof window !== "undefined" ? "" : "http://localhost:9091");

let pinToken: string | null = null;

/** 下载 .docx：带 PIN 头取回二进制并触发保存 */
export async function downloadDocx(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: pinToken ? { "x-pin-token": pinToken } : {} });
  if (!res.ok) throw new Error(`导出失败(${res.status})`);
  const blob = await res.blob();
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    throw new Error("请在网页版使用 Word 导出");
  }
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
    }).then(async (r) => {
      const json = await r.json().catch(() => ({ code: r.status, msg: "识别失败" }));
      if (!r.ok) throw new Error(json.msg || "识别失败");
      return json.data as { messages: { speaker: string; text: string }[] };
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