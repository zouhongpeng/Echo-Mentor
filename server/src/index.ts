import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import dayjs from "dayjs";
import fsSync from "fs";
import path from "path";

import { getSupabaseClient } from "./storage/database/supabase-client";
import { memoryDb } from "./storage/database/memory-db";
import { runAnalysis, prepareAnonymized, summerizeRecords, shouldModerate, extractProfileFacts, extractTiming, MODERATION_REPLY, type GrowthMode } from "./ai/analysis";
import { recognizeImage, chat, extractJson } from "./ai/deepseek";
import { buildReportDocx, buildAnalysisDocx } from "./docx";
import { generateWeeklyReport } from "./ai/report";
import { sha256, anonymize } from "./ai/anonymize";

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// 数据库：优先 Supabase（扣子环境注入凭据）；不可用时降级为内存存储（演示模式，重启即清空）
let db: any;
try {
  db = getSupabaseClient();
  console.log("[db] Supabase 已连接");
} catch (e: any) {
  db = memoryDb;
  console.log(`[db] Supabase 未配置（${e?.message ?? e}），降级为内存存储（演示模式，重启即清空）`);
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ============ 工具 ============
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ code: 0, data });
const fail = (res: Response, msg: string, status = 400, code = 1) =>
  res.status(status).json({ code, msg });

// PIN 状态（内存简单会话）
let sessionPinHash: string | null = null;
let pinInitialized: boolean | null = null;

async function loadPinState() {
  const { data, error } = await db.from("settings").select("pin_hash, growth_mode, id").limit(1);
  if (error) throw error;
  // 仅当「设置了 PIN」才算已初始化；未设置 PIN 时视为无需锁（单用户自用默认无锁）
  const row = data && data.length > 0 ? data[0] : undefined;
  pinInitialized = !!row && !!row.pin_hash;
  sessionPinHash = (row?.pin_hash as string) || null;
}

/** 校验 4 位 PIN 签名（简单鉴权） */
function checkPin(req: Request): boolean {
  const token = req.headers["x-pin-token"] as string | undefined;
  return !!token && !!sessionPinHash && token === sessionPinHash;
}

const requirePin: express.RequestHandler = (req, res, next) => {
  if (!pinInitialized) return next(); // 未设置 PIN：单用户自用，直通
  if (!checkPin(req)) return fail(res, "请先解锁", 401, 401);
  next();
};

app.get("/api/v1/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ============ PIN 相关 ============
// 查询是否需要初始化 PIN
app.get("/api/v1/pin/status", async (req, res) => {
  try {
    await loadPinState();
    ok(res, { initialized: !!pinInitialized });
  } catch (e) {
    fail(res, "读取设置失败", 500, 500);
  }
});

// 设置 / 修改 PIN（4位）；未设置 PIN 时也允许补设
app.post("/api/v1/pin/setup", async (req, res) => {
  try {
    const schema = z.object({ pin: z.string().regex(/^\d{4}$/) });
    const { pin } = schema.parse(req.body);
    const hash = sha256(pin);
    // 若已设置 PIN，仅允许在解锁状态下修改（防覆盖）
    if (pinInitialized) {
      const token = req.headers["x-pin-token"] as string | undefined;
      if (token !== sessionPinHash) return fail(res, "已初始化过 PIN", 403, 403);
      const { error } = await db.from("settings").update({ pin_hash: hash }).eq("id", 1);
      if (error) throw error;
      sessionPinHash = hash;
      return ok(res, { success: true, token: hash, growth_mode: (await getGrowthMode()) });
    }
    // 从未设置，或关闭 PIN 后重新补设：更新既有行（若存在），否则新建
    const { data: existing } = await db.from("settings").select("id").limit(1);
    if (existing && existing.length > 0) {
      const { error } = await db.from("settings").update({ pin_hash: hash }).eq("id", existing[0].id);
      if (error) throw error;
    } else {
      const { data, error } = await db.from("settings").insert({ pin_hash: hash, growth_mode: "canned" }).select("id").single();
      if (error) throw error;
    }
    pinInitialized = true;
    sessionPinHash = hash;
    ok(res, { success: true, token: hash, growth_mode: "canned" });
  } catch (e: any) {
    fail(res, e?.message || "设置 PIN 失败", 400);
  }
});

// 关闭 PIN 锁（清除密码；需已解锁）
app.post("/api/v1/pin/disable", requirePin, async (req, res) => {
  try {
    const { data: existing } = await db.from("settings").select("id").limit(1);
    if (existing && existing.length > 0) {
      const { error } = await db.from("settings").update({ pin_hash: null }).eq("id", existing[0].id);
      if (error) throw error;
    }
    sessionPinHash = null;
    pinInitialized = false;
    ok(res, { success: true, initialized: false });
  } catch (e: any) {
    fail(res, e?.message || "关闭 PIN 失败", 400);
  }
});

// 校验 PIN 解锁
app.post("/api/v1/pin/unlock", async (req, res) => {
  try {
    await loadPinState();
    const schema = z.object({ pin: z.string() });
    const { pin } = schema.parse(req.body);
    const hash = sha256(pin);
    if (hash === sessionPinHash) {
      ok(res, { token: hash, growth_mode: (await getGrowthMode()) });
    } else {
      fail(res, "PIN 不正确", 401, 401);
    }
  } catch (e: any) {
    fail(res, e?.message || "解锁失败", 400);
  }
});

async function getGrowthMode(): Promise<GrowthMode> {
  const { data } = await db.from("settings").select("growth_mode").limit(1);
  return (data?.[0]?.growth_mode as GrowthMode) ?? "canned";
}

/** 节制机制开关（默认关闭） */
async function getModeration(): Promise<boolean> {
  const { data } = await db.from("settings").select("moderation").limit(1);
  return data?.[0]?.moderation === true;
}

// ============ 人物档案 ============
app.get("/api/v1/people", requirePin, async (req, res) => {
  try {
    const { data, error } = await db
      .from("people")
      .select("id, name, relationship, background, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    // 计算最近互动时间 = 最近一次分析时间
    const withRecent = await Promise.all(data!.map(async (p: any) => {
      const { data: ana, error: e2 } = await db
        .from("analysis_records")
        .select("created_at")
        .eq("person_id", p.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (e2) throw e2;
      return { ...p, last_interaction_at: ana?.[0]?.created_at ?? null };
    }));
    ok(res, withRecent);
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

app.get("/api/v1/people/:id", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: person, error } = await db.from("people").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!person) return fail(res, "档案不存在", 404, 404);
    const { data: dates } = await db.from("important_dates").select("*").eq("person_id", id).order("month_day", { ascending: true });
    ok(res, { ...person, dates: dates ?? [] });
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

app.post("/api/v1/people", requirePin, async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      relationship: z.string().optional().default(""),
      background: z.string().optional().default(""),
      avatar_color: z.string().optional().default(""),
      dates: z.array(z.object({ name: z.string(), month_day: z.string() })).optional().default([]),
    });
    const body = schema.parse(req.body);
    const { data, error } = await db.from("people").insert({
      name: body.name,
      relationship: body.relationship,
      background: body.background,
      avatar_color: body.avatar_color || "",
      updated_at: dayjs().toISOString(),
    }).select("id").single();
    if (error) throw error;
    const personId = data.id as string;
    await insertDates(personId, body.dates);
    ok(res, { id: personId }, 201);
  } catch (e: any) {
    fail(res, e?.message || "创建失败", 400);
  }
});

app.put("/api/v1/people/:id", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      name: z.string().min(1).optional(),
      relationship: z.string().optional(),
      background: z.string().optional(),
      avatar_color: z.string().optional(),
      dates: z.array(z.object({ name: z.string(), month_day: z.string() })).optional(),
    });
    const body = schema.parse(req.body);
    const patch: any = { updated_at: dayjs().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.relationship !== undefined) patch.relationship = body.relationship;
    if (body.background !== undefined) patch.background = body.background;
    if (body.avatar_color !== undefined) patch.avatar_color = body.avatar_color;
    const { error } = await db.from("people").update(patch).eq("id", id);
    if (error) throw error;
    if (body.dates) {
      const { error: e2 } = await db.from("important_dates").delete().eq("person_id", id);
      if (e2) throw e2;
      await insertDates(id as string, body.dates);
    }
    ok(res, { success: true });
  } catch (e: any) {
    fail(res, e?.message || "更新失败", 400);
  }
});

app.delete("/api/v1/people/:id", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await db.from("people").delete().eq("id", id);
    if (error) throw error;
    ok(res, { success: true });
  } catch (e: any) {
    fail(res, e?.message || "删除失败", 500, 500);
  }
});

async function insertDates(personId: string, dates: { name: string; month_day: string }[]) {
  for (const d of dates) {
    const { error } = await db.from("important_dates").insert({ person_id: personId, name: d.name, month_day: d.month_day });
    if (error) throw error;
  }
}

// ============ 分析 ============
app.post("/api/v1/analyze", requirePin, async (req, res) => {
  try {
    const schema = z.object({
      person_id: z.string(),
      chat_input: z.string().optional().default(""),
      thought_input: z.string().optional().default(""),
      my_reply: z.string().optional().default(""), // 点评模式下用户自己的回复
      style_examples: z.array(z.string()).optional().default([]), // 风格学习：过往采纳回复/本人想法
      tone: z.string().optional(),
    });
    const body = schema.parse(req.body);

    // 加载人物 + 最近3次分析
    const { data: person, error: pe } = await db.from("people").select("*").eq("id", body.person_id).maybeSingle();
    if (pe) throw pe;
    if (!person) return fail(res, "人物不存在", 404, 404);

    const growthMode = await getGrowthMode();

    // 24小时内分析次数（含正在生成）
    const since = dayjs().subtract(24, "hour").toISOString();
    const { data: recentAll, error: re } = await db
      .from("analysis_records")
      .select("id, created_at, status, temp_label, temp_reason, result, thought_input")
      .eq("person_id", body.person_id)
      .gte("created_at", since);
    if (re) throw re;
    const recent24 = (recentAll ?? []).filter((r: any) => r.status !== "failed");

    // 节制：第 3 次分析劝停（默认关闭，开关开启后生效）
    if ((await getModeration()) && shouldModerate(recent24.length)) {
      return ok(res, { moderated: true, message: MODERATION_REPLY });
    }

    // 组装脱敏输入
    const recent3 = [...recent24].slice(-3);
    const recent3ForContext = (recentAll ?? [])
      .sort((a: any, b: any) => (a.created_at > b.created_at ? -1 : 1))
      .slice(0, 3)
      .map((r: any) => ({ temp_label: r.temp_label, temp_reason: r.temp_reason, result: r.result }));

    const anonymized = prepareAnonymized({
      personName: person.name,
      background: person.background,
      chatRecord: body.chat_input,
      myThought: growthMode === "critique" ? (body.my_reply || body.thought_input) : body.thought_input,
    });

    // 记录占位（生成中）
    const placeholder = {
      person_id: body.person_id,
      chat_input: body.chat_input,
      thought_input: body.thought_input,
      result: {},
      temp_label: "温",
      temp_reason: "",
      status: "gen",
    };
    const { data: inserted } = await db.from("analysis_records").insert(placeholder).select("id").single();
    const recordId = inserted?.id as string;

    // 立即返回 id，前端轮询
    ok(res, { record_id: recordId, person_id: body.person_id, growth_mode: growthMode });

    // 后台异步调用 AI（不阻塞响应）；失败则标记 failed
    (async () => {
      try {
        const outcome = await runAnalysis({
          personName: person.name,
          background: anonymized.background,
          recentSummaries: summerizeRecords(recent3ForContext),
          chatRecord: anonymized.chatRecord,
          myThought: anonymized.myThought,
          growthMode,
          tone: body.tone,
          styleExamples: (body.style_examples ?? []).length
            ? body.style_examples.map((s: string) => anonymize(s, person.name)).join("\n")
            : undefined,
        });
        const { error } = await db.from("analysis_records").update({
          result: outcome as any,
          temp_label: outcome.temperature.label,
          temp_reason: outcome.temperature.reason,
          status: "done",
        }).eq("id", recordId);
        if (error) throw error;
        // 写温度趋势点
        await db.from("temperature_points").insert({
          person_id: body.person_id,
          label: outcome.temperature.label,
          reason: outcome.temperature.reason,
        });

        // 档案自动补全：提炼新信息合并进人物背景（尽力而为，失败静默）
        (async () => {
          try {
            const facts = await extractProfileFacts(anonymized.chatRecord, anonymized.myThought);
            if (!facts.length) return;
            const { data: p, error: pe } = await db.from("people").select("background").eq("id", body.person_id).maybeSingle();
            if (pe || !p) return;
            const oldBg = (p.background as string) || "";
            const fresh = facts.filter((f) => !oldBg.includes(f));
            if (!fresh.length) return;
            const merged = oldBg ? `${oldBg}\n${fresh.join("；")}` : fresh.join("；");
            await db.from("people").update({ background: merged }).eq("id", body.person_id);
            console.log(`[profile] 人物 ${body.person_id} 档案自动补全 ${fresh.length} 条`);
          } catch (e) {
            console.error("档案补全失败（静默）:", e);
          }
        })();

        // 时机提醒提炼：从对话中发现未来可跟进的时机（尽力而为）
        (async () => {
          try {
            const timing = await extractTiming(anonymized.chatRecord, anonymized.myThought);
            if (!timing.opportunities?.length) return;
            const { data: rec2, error: e2 } = await db.from("analysis_records").select("result").eq("id", recordId).maybeSingle();
            if (e2 || !rec2) return;
            const merged = { ...(rec2.result || {}), timing };
            await db.from("analysis_records").update({ result: merged }).eq("id", recordId);
            console.log(`[timing] 人物 ${body.person_id} 提炼时机 ${timing.opportunities.length} 条`);
          } catch (e) {
            console.error("时机提炼失败（静默）:", e);
          }
        })();
      } catch (err) {
        await db.from("analysis_records").update({ status: "failed" }).eq("id", recordId);
        console.error("AI 分析失败:", err);
      }
    })();
  } catch (e: any) {
    fail(res, e?.message || "分析失败", 400);
  }
});

// App 端「自带钥匙」直连 DeepSeek 成功后，保存已算好的结果（时间线/温度）以便持久化
app.post("/api/v1/analyze/save-computed", requirePin, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.person_id) return fail(res, "缺少 person_id", 400);
    const personId = body.person_id;
    const result = body.result || {};
    const label = ["热", "温", "冷"].includes(result?.temperature?.label) ? result.temperature.label : "温";
    const reason = result?.temperature?.reason || "";
    const { data: inserted } = await db
      .from("analysis_records")
      .insert({
        person_id: personId,
        chat_input: body.chat_input || "",
        thought_input: body.thought_input || "",
        result: result as any,
        temp_label: label,
        temp_reason: reason,
        status: "done",
      })
      .select("id")
      .single();
    const recordId = inserted?.id as string;
    await db.from("temperature_points").insert({
      person_id: personId,
      label,
      reason,
    });
    ok(res, { record_id: recordId });
  } catch (e: any) {
    fail(res, e?.message || "保存失败", 400);
  }
});

// 轮询某条记录
app.get("/api/v1/analysis/:id", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await db.from("analysis_records").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, "记录不存在", 404, 404);
    ok(res, data);
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

// 标记某条建议"用了/没用上"
app.put("/api/v1/analysis/:id/mark", requirePin, async (req, res) => {
  try {
    const schema = z.object({ index: z.number(), used: z.boolean() });
    const { index, used } = schema.parse(req.body);
    const { id } = req.params;
    const { data, error } = await db.from("analysis_records").select("result").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, "记录不存在", 404, 404);
    const result = data.result as any;
    const marks = result.marks ?? (result.marks = {});
    marks[String(index)] = used;
    const { error: e2 } = await db.from("analysis_records").update({ result }).eq("id", id);
    if (e2) throw e2;
    ok(res, { success: true });
  } catch (e: any) {
    fail(res, e?.message || "标记失败", 400);
  }
});

// ============ 回复效果复盘 ============
app.post("/api/v1/analysis/:id/outcome", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const theirReply = String(req.body?.their_reply ?? "").trim();
    if (!theirReply) return fail(res, "请填写对方的回应", 400);
    const { data: rec, error } = await db.from("analysis_records").select("result, chat_input").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!rec) return fail(res, "记录不存在", 404);
    const result = rec.result || {};
    const usedReplies = (result.suggestions ?? [])
      .map((sg: any, i: number) => ({ text: sg?.text, used: !!(result.marks ?? {})[String(i)] }))
      .filter((x: any) => x.used)
      .map((x: any) => x.text);
    const system = `你是沟通教练。用户此前采纳了你给的建议并发出，现在对方有了回应。请评估这条回复的实际效果。
严格输出 JSON：{"effect":"好|一般|翻车","reason":"一句话依据（引用对方回应）","lesson":"下次怎么微调（一句话，具体）"}`;
    const user = `【当时的聊天记录】\n${rec.chat_input || "（无）"}\n\n【用户发出的回复】\n${usedReplies.join("\n") || "（未记录）"}\n\n【对方的回应】\n${theirReply}`;
    const result2 = await chat(system, user, 0.4);
    const parsed = extractJson(result2.content);
    if (!parsed) return fail(res, "评估失败，请稍后再试", 500, 500);
    result.outcome = { ...parsed, their_reply: theirReply, evaluated_at: new Date().toISOString() };
    const { error: e2 } = await db.from("analysis_records").update({ result }).eq("id", id);
    if (e2) throw e2;
    ok(res, { outcome: result.outcome });
  } catch (e: any) {
    fail(res, e?.message || "评估失败", 500, 500);
  }
});

// ============ 时间线 ============
// 调整时间线显示顺序：与相邻记录交换 created_at（up=显示更靠前，down=更靠后）
app.patch("/api/v1/analysis/:id/move", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const direction = req.body?.direction === "up" || req.body?.direction === "down" ? req.body.direction : null;
    if (!direction) return fail(res, "direction 必须是 up 或 down", 400);
    const { data: cur, error: e1 } = await db
      .from("analysis_records")
      .select("id, person_id, created_at")
      .eq("id", id)
      .maybeSingle();
    if (e1) throw e1;
    if (!cur) return fail(res, "记录不存在", 404);
    // 接口按创建时间升序取全量，便于找相邻项
    const { data: list, error: e2 } = await db
      .from("analysis_records")
      .select("id, created_at")
      .eq("person_id", cur.person_id)
      .order("created_at", { ascending: true });
    if (e2) throw e2;
    const arr = list ?? [];
    const ascIdx = arr.findIndex((r: any) => r.id === id);
    if (ascIdx < 0) return fail(res, "记录不存在", 404);
    // 前端时间线按时间倒序展示：显示层"上移"= 时间上更新 = 升序数组中 +1
    const ascNeighbor = direction === "up" ? ascIdx + 1 : ascIdx - 1;
    if (ascNeighbor < 0 || ascNeighbor >= arr.length) {
      return ok(res, { success: true, moved: false });
    }
    const a = arr[ascIdx];
    const b = arr[ascNeighbor];
    const { error: e3 } = await db.from("analysis_records").update({ created_at: b.created_at }).eq("id", a.id);
    const { error: e4 } = await db.from("analysis_records").update({ created_at: a.created_at }).eq("id", b.id);
    if (e3 || e4) throw e3 || e4;
    ok(res, { success: true, moved: true });
  } catch (e: any) {
    fail(res, e?.message || "调整失败", 400);
  }
});

app.get("/api/v1/people/:id/analyses", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await db
      .from("analysis_records")
      .select("id, chat_input, thought_input, result, temp_label, temp_reason, status, created_at")
      .eq("person_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    ok(res, data ?? []);
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

app.delete("/api/v1/analysis/:id", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await db.from("analysis_records").delete().eq("id", id);
    if (error) throw error;
    ok(res, { success: true });
  } catch (e: any) {
    fail(res, e?.message || "删除失败", 500, 500);
  }
});

// ============ 温度趋势 ============
app.get("/api/v1/people/:id/temperatures", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await db
      .from("temperature_points")
      .select("label, reason, created_at")
      .eq("person_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    ok(res, data ?? []);
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

// ============ 截图识别 ============
app.post("/api/v1/recognize", requirePin, upload.single("image"), async (req, res) => {
  try {
    const personName = (req.body.person_name as string) ?? "";
    if (!req.file) return fail(res, "未上传图片", 400);
    const dataUri = `data:${req.file.mimetype || "image/png"};base64,${req.file.buffer.toString("base64")}`;
    const system = `你是聊天截图文字识别助手。请识别截图中的对话，并按说话人分离。对方称呼为"${personName || "对方"}"。要求输出 JSON：
{"messages":[{"speaker":"我|对方","text":"说话内容"}]}
只识别对话气泡里的文字，忽略背景、时间、红点等无关元素。不要编造内容。`;
    // 视觉输入走 DeepSeek；若模型不支持则抛错 → 前端降级手动粘贴
    const content = await recognizeImage(system, "请识别并输出 JSON。", dataUri);
    let messages: { speaker: string; text: string }[] = [];
    try {
      const parsed = JSON.parse(content.replace(/```json|```/g, ""));
      messages = parsed.messages ?? [];
    } catch {
      const fence = content.match(/"messages"\s*:\s*\[([\s\S]*?)\]/);
      if (!fence) throw new Error("识别结果无法解析");
    }
    ok(res, { messages });
  } catch (e: any) {
    fail(res, e?.message || "识别失败，请手动粘贴", 500, 500);
  }
});

// ============ 备份导入 ============
app.post("/api/v1/import", requirePin, async (req, res) => {
  try {
    const people = Array.isArray(req.body?.people) ? req.body.people : [];
    const analyses = Array.isArray(req.body?.analyses) ? req.body.analyses : [];
    const reports = Array.isArray(req.body?.reports) ? req.body.reports : [];
    let cPeople = 0, cDates = 0, cAnalyses = 0, cReports = 0;

    for (const p of people) {
      if (!p?.id || !p?.name) continue;
      const dates = Array.isArray(p.dates) ? p.dates : [];
      const { data: existing } = await db.from("people").select("id").eq("id", p.id).limit(1);
      const row = {
        id: p.id, name: p.name, relationship: p.relationship ?? "",
        background: p.background ?? "", avatar_color: p.avatar_color ?? "",
        updated_at: p.updated_at || new Date().toISOString(),
      };
      if (existing?.length) {
        await db.from("people").update(row).eq("id", p.id);
      } else {
        await db.from("people").insert(row);
      }
      cPeople++;
      if (dates.length) {
        await db.from("important_dates").delete().eq("person_id", p.id);
        for (const d of dates) {
          if (!d?.name) continue;
          await db.from("important_dates").insert({ person_id: p.id, name: d.name, month_day: d.month_day || "" });
          cDates++;
        }
      }
    }

    for (const a of analyses) {
      if (!a?.id || !a?.person_id) continue;
      const row = {
        id: a.id, person_id: a.person_id,
        chat_input: a.chat_input ?? "", thought_input: a.thought_input ?? "",
        result: a.result ?? {}, temp_label: a.temp_label ?? "温", temp_reason: a.temp_reason ?? "",
        status: a.status === "gen" ? "failed" : (a.status || "done"),
        created_at: a.created_at || new Date().toISOString(),
      };
      const { data: existing } = await db.from("analysis_records").select("id").eq("id", a.id).limit(1);
      if (existing?.length) await db.from("analysis_records").update(row).eq("id", a.id);
      else await db.from("analysis_records").insert(row);
      cAnalyses++;
    }

    for (const r of reports) {
      if (!r?.id) continue;
      const row = {
        id: r.id, week_start: r.week_start || new Date().toISOString(),
        content: r.content ?? {}, created_at: r.created_at || new Date().toISOString(),
      };
      const { data: existing } = await db.from("weekly_reports").select("id").eq("id", r.id).limit(1);
      if (existing?.length) await db.from("weekly_reports").update(row).eq("id", r.id);
      else await db.from("weekly_reports").insert(row);
      cReports++;
    }

    ok(res, { people: cPeople, dates: cDates, analyses: cAnalyses, reports: cReports });
  } catch (e: any) {
    fail(res, e?.message || "导入失败", 500, 500);
  }
});

// ============ Word 导出 ============
app.get("/api/v1/reports/:id/docx", requirePin, async (req, res) => {
  try {
    const { data: r, error } = await db.from("weekly_reports").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!r) return fail(res, "周报不存在", 404);
    const buf = await buildReportDocx(r);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent("沟通周报.docx")}`);
    res.send(Buffer.from(buf));
  } catch (e: any) {
    fail(res, e?.message || "导出失败", 500, 500);
  }
});

app.get("/api/v1/analysis/:id/docx", requirePin, async (req, res) => {
  try {
    const { data: a, error } = await db.from("analysis_records").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!a) return fail(res, "记录不存在", 404);
    const { data: p } = await db.from("people").select("name").eq("id", a.person_id).maybeSingle();
    const buf = await buildAnalysisDocx({
      personName: p?.name || "对方",
      created_at: a.created_at,
      chat_input: a.chat_input,
      thought_input: a.thought_input,
      result: a.result || {},
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`沟通分析报告.docx`)}`);
    res.send(Buffer.from(buf));
  } catch (e: any) {
    fail(res, e?.message || "导出失败", 500, 500);
  }
});

// ============ 模拟对话演练 ============
app.post("/api/v1/rehearse", requirePin, async (req, res) => {
  try {
    const schema = z.object({
      person_id: z.string(),
      goal: z.string().min(1),
      mode: z.enum(["chat", "review"]).default("chat"),
      history: z.array(z.object({ role: z.enum(["user", "ai"]), text: z.string() })).optional(),
      transcript: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const { data: person, error } = await db.from("people").select("name, background").eq("id", body.person_id).maybeSingle();
    if (error) throw error;
    if (!person) return fail(res, "人物不存在", 404, 404);
    const name = person.name || "对方";
    const bg = (person.background as string) ? `\n人物背景：${person.background}` : "";

    if (body.mode === "chat") {
      const history = body.history ?? [];
      const transcript = history.map((m) => `${m.role === "user" ? "我" : name}：${m.text}`).join("\n");
      const system = `你正在一场「模拟对话演练」中扮演「${name}」，与用户练习一段真实对话。${bg}
用户的演练目标：${body.goal}
扮演要求：完全以 ${name} 的第一人称说话，不出戏、不给建议；语气口语化、贴合真实聊天，每次回复 ≤ 60 字；适度设置障碍（追问、不满、犹豫），用户真诚切中要害时适当缓和。只输出 ${name} 说的话。`;
      const user = transcript ? `以下是目前为止的对话，请以「${name}」的身份回复最后一句我所说的话：\n${transcript}` : `对话刚开始，请以「${name}」的身份先说一句开场白（针对目标场景）。`;
      const result = await chat(system, user, 0.9);
      return ok(res, { reply: result.content.trim() });
    }

    // review 模式
    const system = `你是沟通教练。用户刚与「${name}」完成一场模拟对话演练（你扮演了对方）。请复盘用户的表达，严格输出 JSON：
{"score":0-100,"highlights":["做得好的1-3条"],"risks":["风险/欠佳处1-3条"],"tips":["下次可尝试的具体说法1-3条"]}
要求：具体、引用原句片段、说人话无套话；score 综合清晰度/语气/目标接近程度。`;
    const user = `【演练目标】\n${body.goal}\n\n【对话实录】\n${body.transcript ?? ""}`;
    const result = await chat(system, user, 0.5);
    const parsed = extractJson(result.content);
    if (!parsed) return fail(res, "复盘结果无法解析", 500, 500);
    ok(res, { feedback: parsed });
  } catch (e: any) {
    fail(res, e?.message || "演练服务暂不可用", 500, 500);
  }
});

// ============ 关系画像 ============
app.get("/api/v1/people/:id/portrait", requirePin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: person, error: pe } = await db.from("people").select("name, relationship, background").eq("id", id).maybeSingle();
    if (pe) throw pe;
    if (!person) return fail(res, "人物不存在", 404, 404);
    const { data: recs, error: re } = await db
      .from("analysis_records")
      .select("temp_label, result, created_at")
      .eq("person_id", id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(10);
    if (re) throw re;
    const digest = (recs ?? [])
      .map((r: any, i: number) => {
        const pts = (r.result?.thoughts ?? []).slice(0, 2).map((t: any) => t.point).join("；");
        return `${i + 1}) [${r.temp_label}] ${pts || "（无要点）"}`;
      })
      .join("\n");
    const system = `你是关系洞察分析师。基于某位用户与「${person.name}」的历次沟通分析记录，输出一张「关系画像」。严格输出 JSON：
{"style":"TA 的沟通风格（40字内）","landmines":["TA 的雷区/忌讳，1-3条"],"likes":["TA 吃哪套/在意什么，1-3条"],"pattern":"你们关系的整体模式（60字内）","advice":["给用户的具体建议，1-3条"]}
要求：全部基于给定记录提炼，不编造；说人话，每条 ≤ 40 字。`;
    const user = `【人物档案】\n关系：${person.relationship || "未知"}；背景：${person.background || "（无）"}\n\n【最近分析记录（新→旧）】\n${digest || "（暂无记录）"}`;
    const result = await chat(system, user, 0.5);
    const parsed = extractJson(result.content);
    if (!parsed) return fail(res, "画像生成失败，请稍后再试", 500, 500);
    ok(res, parsed);
  } catch (e: any) {
    fail(res, e?.message || "画像生成失败", 500, 500);
  }
});

// ============ 周报 ============
app.get("/api/v1/reports", requirePin, async (req, res) => {
  try {
    const { data, error } = await db.from("weekly_reports").select("*").order("week_start", { ascending: false });
    if (error) throw error;
    ok(res, data ?? []);
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

app.post("/api/v1/reports/generate", requirePin, async (req, res) => {
  try {
    // 本周一
    const weekStart = dayjs().startOf("week").format("YYYY-MM-DD");
    const weekEnd = dayjs().endOf("week").toISOString();
    // 取本周全部分析（含已完成的心智）
    const { data: analyses, error } = await db
      .from("analysis_records")
      .select("id, person_id, result, status, temp_label, temp_reason, created_at")
      .gte("created_at", dayjs(weekStart).toISOString())
      .lte("created_at", weekEnd)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // 人物统计
    const { data: people } = await db.from("people").select("id, name");
    const personMap = new Map<string, string>((people ?? []).map((p: any) => [String(p.id), String(p.name)]));

    const done = (analyses ?? []).filter((a: any) => a.status === "done" && a.result && a.result.thoughts);
    const personStats = new Map<string, { name: string; tempCount: Record<string, number>; lastTemp: string; lastReason: string; count: number }>();
    const weekSummary: string[] = [];
    for (const a of done) {
      const name = personMap.get(a.person_id) ?? "对方";
      const st = personStats.get(a.person_id) ?? { name, tempCount: { 热: 0, 温: 0, 冷: 0 }, lastTemp: "", lastReason: "", count: 0 };
      st.count++;
      const label = (["热", "温", "冷"].includes(a.temp_label) ? a.temp_label : "温") as "热" | "温" | "冷";
      st.tempCount[label] = (st.tempCount[label] ?? 0) + 1;
      st.lastTemp = label;
      st.lastReason = a.temp_reason || "";
      personStats.set(a.person_id, st);
      const points = (a.result.thoughts ?? []).map((t: any) => t.point).join("；");
      weekSummary.push(`【${name}】${points}`);
    }

    if (done.length === 0) {
      return ok(res, { empty: true });
    }

    const content = await generateWeeklyReport({
      personRecords: Array.from(personStats.values()).map((s) => ({
        name: s.name,
        temp_label: s.lastTemp,
        temp_reason: s.lastReason,
        count: s.count,
      })),
      weekSummary: weekSummary.join("\n"),
    });

    const { data: ins, error: ie } = await db.from("weekly_reports").insert({
      week_start: weekStart,
      content: { ...content, personCount: Array.from(personStats.values()).map((s) => ({ name: s.name, count: s.count })) },
    }).select("id").single();
    if (ie) throw ie;
    ok(res, { id: ins?.id, content }, 201);
  } catch (e: any) {
    fail(res, e?.message || "生成周报失败", 500, 500);
  }
});

// 成长模式设置
app.put("/api/v1/settings/mode", requirePin, async (req, res) => {
  try {
    const schema = z.object({ mode: z.enum(["canned", "hint", "critique"]) });
    const { mode } = schema.parse(req.body);
    const { error } = await db.from("settings").update({ growth_mode: mode }).eq("id", 1);
    if (error) throw error;
    ok(res, { growth_mode: mode });
  } catch (e: any) {
    fail(res, e?.message || "设置失败", 400);
  }
});

// 节制机制开关设置
app.put("/api/v1/settings/moderation", requirePin, async (req, res) => {
  try {
    const schema = z.object({ enabled: z.boolean() });
    const { enabled } = schema.parse(req.body);
    const { error } = await db.from("settings").update({ moderation: enabled }).eq("id", 1);
    if (error) throw error;
    ok(res, { moderation: enabled });
  } catch (e: any) {
    fail(res, e?.message || "设置失败", 400);
  }
});

app.get("/api/v1/settings", requirePin, async (req, res) => {
  try {
    const mode = await getGrowthMode();
    const moderation = await getModeration();
    ok(res, { growth_mode: mode, moderation });
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

// ============ 关键日期提醒（供前端定时查询） ============
app.get("/api/v1/dates/upcoming", requirePin, async (req, res) => {
  try {
    const { data, error } = await db.from("important_dates").select("id, person_id, name, month_day").order("month_day", { ascending: true });
    if (error) throw error;
    const { data: people } = await db.from("people").select("id, name");
    const nameMap = new Map((people ?? []).map((p: any) => [p.id, p.name]));
    const today = dayjs();
    const upcoming = (data ?? []).map((d: any) => {
      const [m, day] = d.month_day.split("-").map((x: string) => parseInt(x));
      let next = dayjs().month(m - 1).date(day).year(today.year());
      if (next.isBefore(today, "day")) next = next.add(1, "year");
      const diff = next.diff(today, "day");
      return { ...d, person_name: nameMap.get(d.person_id) ?? "对方", remind_in: diff, date: next.format("M月D日") };
    }).sort((a: any, b: any) => a.remind_in - b.remind_in);
    ok(res, upcoming);
  } catch (e: any) {
    fail(res, e?.message || "查询失败", 500, 500);
  }
});

// 可选：托管 Web 版静态页（设置 WEB_DIST_DIR 后，网页与 API 同源，前端无需另配后端地址）
const webDistDir = process.env.WEB_DIST_DIR;
if (webDistDir && fsSync.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(webDistDir, "index.html"));
  });
  console.log(`[web] 托管 Web 静态页: ${webDistDir}`);
}

app.listen(port, () => {
  loadPinState().catch((e) => console.error("加载 PIN 失败:", e));
  console.log(`Server listening at http://localhost:${port}/`);
});