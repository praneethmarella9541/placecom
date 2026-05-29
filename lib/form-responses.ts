/**
 * Client-safe helpers for Google Forms response display, summary, and export.
 */

import type { EditorBlock } from "@/lib/google-forms-editor-model";

export type FormAnswer = {
  questionId: string;
  textAnswers?: { answers: { value: string }[] };
  fileUploadAnswers?: { answers: { fileId: string; fileName: string }[] };
  scaleAnswer?: { value: number };
  dateAnswer?: { year?: number; month?: number; day?: number };
  timeAnswer?: { hours?: number; minutes?: number; seconds?: number };
  rowAnswers?: { answers: { value: string }[] }[];
};

export type FormResponse = {
  responseId: string;
  createTime?: string;
  lastSubmittedTime?: string;
  respondentEmail?: string;
  totalScore?: number;
  answers?: Record<string, FormAnswer>;
};

export function buildQuestionTitleMap(blocks: EditorBlock[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of blocks) {
    if (b.questionId) {
      map.set(b.questionId, b.title?.trim() || "Question");
    }
    if (b.kind === "unsupported" && b.rawItem) {
      const group = b.rawItem.questionGroupItem as {
        questions?: { questionId?: string; rowQuestion?: { title?: string } }[];
      } | undefined;
      for (const q of group?.questions ?? []) {
        if (typeof q.questionId === "string") {
          const rowTitle = q.rowQuestion?.title;
          map.set(
            q.questionId,
            rowTitle?.trim()
              ? `${b.title?.trim() || "Grid"} — ${rowTitle.trim()}`
              : b.title?.trim() || "Grid row",
          );
        }
      }
    }
  }
  return map;
}

export function formatAnswer(ans: FormAnswer): string {
  if (ans.textAnswers?.answers?.length) {
    return ans.textAnswers.answers.map((a) => a.value).join(", ");
  }
  if (ans.scaleAnswer != null) return String(ans.scaleAnswer.value);
  if (ans.dateAnswer) {
    const { year, month, day } = ans.dateAnswer;
    const parts: string[] = [];
    if (year) parts.push(String(year));
    if (month) parts.push(String(month).padStart(2, "0"));
    if (day) parts.push(String(day).padStart(2, "0"));
    return parts.length ? parts.join("-") : "—";
  }
  if (ans.timeAnswer) {
    const { hours = 0, minutes = 0, seconds = 0 } = ans.timeAnswer;
    const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    return seconds ? `${base}:${String(seconds).padStart(2, "0")}` : base;
  }
  if (ans.fileUploadAnswers?.answers?.length) {
    return ans.fileUploadAnswers.answers.map((a) => a.fileName || a.fileId).join(", ");
  }
  if (ans.rowAnswers?.length) {
    return ans.rowAnswers
      .map((row, i) => {
        const vals = row.answers?.map((a) => a.value).filter(Boolean) ?? [];
        return vals.length ? `Row ${i + 1}: ${vals.join(", ")}` : `Row ${i + 1}: —`;
      })
      .join(" · ");
  }
  return "—";
}

export type ChoiceBucket = { label: string; count: number };

export type QuestionSummary =
  | {
      questionId: string;
      title: string;
      type: "choice";
      buckets: ChoiceBucket[];
      total: number;
    }
  | {
      questionId: string;
      title: string;
      type: "scale";
      buckets: ChoiceBucket[];
      total: number;
      average: number | null;
    }
  | {
      questionId: string;
      title: string;
      type: "text";
      samples: string[];
      total: number;
    };

function blockSummaryKind(
  block: EditorBlock | undefined,
): "choice" | "scale" | "text" | "other" {
  if (!block) return "other";
  if (
    block.kind === "multiple_choice" ||
    block.kind === "checkboxes" ||
    block.kind === "dropdown"
  ) {
    return "choice";
  }
  if (block.kind === "linear_scale") return "scale";
  if (block.kind === "short_text" || block.kind === "paragraph") return "text";
  return "other";
}

export function summarizeResponses(
  responses: FormResponse[],
  blocks: EditorBlock[],
): QuestionSummary[] {
  const blockByQ = new Map<string, EditorBlock>();
  for (const b of blocks) {
    if (b.questionId) blockByQ.set(b.questionId, b);
  }
  const titles = buildQuestionTitleMap(blocks);

  const questionIds = new Set<string>();
  for (const r of responses) {
    for (const qId of Object.keys(r.answers ?? {})) {
      questionIds.add(qId);
    }
  }

  const summaries: QuestionSummary[] = [];

  for (const questionId of Array.from(questionIds)) {
    const title = titles.get(questionId) || questionId;
    const block = blockByQ.get(questionId);
    const kind = blockSummaryKind(block);

    const answersForQ = responses
      .map((r) => r.answers?.[questionId])
      .filter((a): a is FormAnswer => Boolean(a));

    if (kind === "choice") {
      const counts = new Map<string, number>();
      for (const ans of answersForQ) {
        const vals = ans.textAnswers?.answers?.map((a) => a.value) ?? [];
        if (vals.length === 0) {
          counts.set("(blank)", (counts.get("(blank)") ?? 0) + 1);
        } else {
          for (const v of vals) {
            counts.set(v, (counts.get(v) ?? 0) + 1);
          }
        }
      }
      const buckets = Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
      summaries.push({
        questionId,
        title,
        type: "choice",
        buckets,
        total: answersForQ.length,
      });
      continue;
    }

    if (kind === "scale") {
      const counts = new Map<string, number>();
      let sum = 0;
      let n = 0;
      for (const ans of answersForQ) {
        const v = ans.scaleAnswer?.value;
        if (v == null) continue;
        const key = String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        sum += v;
        n++;
      }
      const buckets = Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => Number(a.label) - Number(b.label));
      summaries.push({
        questionId,
        title,
        type: "scale",
        buckets,
        total: answersForQ.length,
        average: n > 0 ? Math.round((sum / n) * 10) / 10 : null,
      });
      continue;
    }

    const samples: string[] = [];
    for (const ans of answersForQ) {
      const s = formatAnswer(ans);
      if (s !== "—") samples.push(s);
    }
    summaries.push({
      questionId,
      title,
      type: "text",
      samples,
      total: answersForQ.length,
    });
  }

  return summaries;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function responsesToCsv(
  responses: FormResponse[],
  blocks: EditorBlock[],
): string {
  const titles = buildQuestionTitleMap(blocks);
  const questionIds = Array.from(titles.keys());
  if (questionIds.length === 0) {
    for (const r of responses) {
      for (const qId of Object.keys(r.answers ?? {})) {
        if (!questionIds.includes(qId)) questionIds.push(qId);
      }
    }
  }

  const headers = [
    "Response ID",
    "Submitted",
    "Email",
    "Score",
    ...questionIds.map((id) => titles.get(id) || id),
  ];
  const rows = responses.map((r) => {
    const cells = [
      r.responseId,
      r.lastSubmittedTime || r.createTime || "",
      r.respondentEmail || "",
      r.totalScore != null ? String(r.totalScore) : "",
      ...questionIds.map((qId) => {
        const ans = r.answers?.[qId];
        return ans ? formatAnswer(ans) : "";
      }),
    ];
    return cells.map((c) => csvEscape(c)).join(",");
  });

  return [headers.map((h) => csvEscape(h)).join(","), ...rows].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
