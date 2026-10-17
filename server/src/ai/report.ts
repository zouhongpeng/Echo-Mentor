import { chat } from "./deepseek";
import { anonymize } from "./anonymize";

/**
 * 节制机制：同一人物 24 小时内第 3 次分析时劝停。
 * 返回 true 表示应触发劝停（不展开新分析）。
 */
export function shouldModerate(
  recentCount24h: number, // 24小时内已分析次数
): boolean {
  // 已完成 + 正在生成中的都算；第 3 次触发
  return recentCount24h >= 2;
}

export const MODERATION_REPLY = "我上次的判断不会变，先去做别的事吧";

/** 生成沟通周报 */
export async function generateWeeklyReport(context: {
  personRecords: { name: string; temp_label: string; temp_reason: string; count: number }[];
  weekSummary: string;
}): Promise<{
  summary: string;
  key_events: string[];
  habits: string[];
  otherTrend: string;
  improvements: string[];
  progress: string[];
}> {
  const system = `你是一名诚实、克制的沟通教练。基于用户本周的真实分析记录生成一份周报。
输出严格 JSON，不要多余文字：
{
  "summary": "本周整体概况（1-3 句）",
  "key_events": ["本周最重要的互动事件，各 ≤30 字（1-3 条）"],
  "habits": ["我的聊天习惯模式，如秒回倾向、话题终结点等（0-3条）"],
  "otherTrend": "对方回应趋势（1-2 句）",
  "improvements": ["1-2 条具体改进建议"],
  "progress": ["进步点（0-2 条）"]
}`;

  const userContent = [
    "【本周涉及人物及各自分析次数/温度】",
    context.personRecords
      .map((p) => `${p.name}(${p.count}次分析，温度多为${p.temp_label}：${p.temp_reason || "无"})`)
      .join("\n"),
    "",
    "【本周分析要点汇总】",
    context.weekSummary || "（暂无详细要点）",
    "",
    '注意：一律以"我/对方"指代人物，不出现真实姓名。',
  ].join("\n");

  const result = await chat(system, userContent, 0.6);
  try {
    return JSON.parse(result.content);
  } catch {
    const fence = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) return JSON.parse(fence[1]);
    throw new Error("周报解析失败");
  }
}