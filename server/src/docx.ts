import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
} from "docx";

/** Apple 风格 .docx 生成：周报 / 沟通分析报告 */

const FONT = "PingFang SC";

function h1(text: string) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, size: 40, font: FONT })] });
}
function h2(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: "E4572E", space: 8 } },
    children: [new TextRun({ text, bold: true, size: 28, color: "3F3A36", font: FONT })],
  });
}
function p(text: string, opts: { bold?: boolean; color?: string; size?: number; italic?: boolean } = {}) {
  return new Paragraph({
    spacing: { after: 100, line: 320 },
    children: [new TextRun({ text: text || "", bold: opts.bold, italics: opts.italic, size: opts.size ?? 24, color: opts.color ?? "3F3A36", font: FONT })],
  });
}
function bullet(text: string) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line: 320 }, children: [new TextRun({ text, size: 24, color: "3F3A36", font: FONT })] });
}
function meta(text: string) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text, size: 18, color: "86868B", font: FONT })] });
}

/** 周报 .docx */
export async function buildReportDocx(report: {
  created_at?: string;
  content?: { summary?: string; key_events?: string[]; habits?: string[]; otherTrend?: string; improvements?: string[]; progress?: string[] };
}): Buffer {
  const c = report.content || {};
  const children: Paragraph[] = [
    h1("沟通周报"),
    meta(`由 Echo Mentor 生成 · ${report.created_at ? new Date(report.created_at).toLocaleDateString("zh-CN") : ""}`),
  ];
  if (c.summary) { children.push(h2("本周概况")); children.push(p(c.summary)); }
  if (c.key_events?.length) {
    children.push(h2("本周关键事件"));
    c.key_events.forEach((x) => children.push(bullet(x)));
  }
  if (c.habits?.length) {
    children.push(h2("聊天习惯模式"));
    c.habits.forEach((x) => children.push(bullet(x)));
  }
  if (c.otherTrend) { children.push(h2("对方回应趋势")); children.push(p(c.otherTrend)); }
  if (c.improvements?.length) {
    children.push(h2("改进建议"));
    c.improvements.forEach((x) => children.push(bullet(x)));
  }
  if (c.progress?.length) {
    children.push(h2("进步点"));
    c.progress.forEach((x) => children.push(bullet(x)));
  }
  return (await Packer.toBuffer(new Document({ sections: [{ children }] }))) as unknown as Buffer;
}

/** 沟通分析报告 .docx */
export async function buildAnalysisDocx(input: {
  personName: string;
  created_at?: string;
  chat_input?: string;
  thought_input?: string;
  result?: {
    scene?: string;
    thoughts?: { point: string; evidence?: string }[];
    suggestions?: { style?: string; text: string; reason?: string; theory_tag?: string }[];
    notes?: string[];
    temperature?: { label: string; reason?: string };
    checklist?: { item: string; status: string; note?: string }[];
    outcome?: { effect?: string; reason?: string; lesson?: string };
  };
}): Buffer {
  const r = input.result || {};
  const children: Paragraph[] = [
    h1(`沟通分析报告 · ${input.personName}`),
    meta(`由 Echo Mentor 生成 · ${input.created_at ? new Date(input.created_at).toLocaleString("zh-CN") : ""}`),
  ];
  children.push(h2("关系温度"));
  children.push(p(`温度：${r.temperature?.label || "—"}${r.temperature?.reason ? `（${r.temperature.reason}）` : ""}`));
  if (r.scene) children.push(p(`识别场景：${r.scene}`));

  if (input.chat_input) {
    children.push(h2("聊天记录"));
    input.chat_input.split("\n").filter((l) => l.trim()).forEach((l) => children.push(p(l, { size: 21, color: "5A5A5A" })));
  }
  if (input.thought_input) {
    children.push(h2("我的想法"));
    children.push(p(input.thought_input));
  }
  if (r.thoughts?.length) {
    children.push(h2("对面在想什么"));
    r.thoughts.forEach((t) => {
      children.push(p(t.point, { bold: true }));
      if (t.evidence) children.push(p(t.evidence, { size: 21, color: "86868B" }));
    });
  }
  if (r.suggestions?.length) {
    children.push(h2("建议回复"));
    r.suggestions.forEach((sg, i) => {
      children.push(p(`【${sg.style || "建议"}${i + 1}】${sg.text}`, { bold: true }));
      if (sg.reason) children.push(p(`理由：${sg.reason}`, { size: 21, color: "86868B" }));
      if (sg.theory_tag) children.push(p(`依据：${sg.theory_tag}`, { size: 21, color: "E4572E" }));
    });
  }
  if (r.notes?.length) {
    children.push(h2("注意事项"));
    r.notes.forEach((n) => children.push(bullet(n)));
  }
  if (r.checklist?.length) {
    children.push(h2("评审检查清单"));
    r.checklist.forEach((c) => {
      const mark = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "!";
      children.push(p(`[${mark}] ${c.item} —— ${c.note || ""}`, { color: c.status === "fail" ? "E4572E" : "3F3A36", size: 22 }));
    });
  }
  if (r.outcome?.effect) {
    children.push(h2("回复效果复盘"));
    children.push(p(`效果：${r.outcome.effect}${r.outcome.reason ? `（${r.outcome.reason}）` : ""}`));
    if (r.outcome.lesson) children.push(p(`改进：${r.outcome.lesson}`));
  }
  return (await Packer.toBuffer(new Document({ sections: [{ children }] }))) as unknown as Buffer;
}
