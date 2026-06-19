"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  CopyPlus,
  Download,
  Eye,
  Inbox,
  Loader2,
  Plus,
  Settings2,
} from "lucide-react";
import {
  type EditorBlock,
  type EditorState,
  defaultChoiceBlock,
  defaultQuestionBlock,
  duplicateBlock,
  emptyEditorState,
  googleFormToEditorState,
  newSectionBlock,
  newTextBlock,
} from "@/lib/google-forms-editor-model";
import {
  buildQuestionTitleMap,
  downloadCsv,
  formatAnswer,
  type FormResponse,
  responsesToCsv,
  summarizeResponses,
} from "@/lib/form-responses";
import { titleCase } from "@/lib/title-case";

const EMAIL_OPTIONS: { value: EditorState["emailCollection"]; label: string }[] = [
  { value: "DO_NOT_COLLECT", label: "Do not collect email" },
  { value: "RESPONDER_INPUT", label: "Ask for email on form" },
  { value: "VERIFIED", label: "Collect verified email (Workspace default)" },
  { value: "EMAIL_COLLECTION_TYPE_UNSPECIFIED", label: "Use Google default" },
];

const ADD_QUESTION_OPTIONS: {
  label: string;
  action: () => EditorBlock;
}[] = [
  { label: "Short answer", action: () => defaultQuestionBlock("short_text") },
  { label: "Paragraph", action: () => defaultQuestionBlock("paragraph") },
  { label: "Multiple choice", action: () => defaultChoiceBlock("multiple_choice") },
  { label: "Checkboxes", action: () => defaultChoiceBlock("checkboxes") },
  { label: "Dropdown", action: () => defaultChoiceBlock("dropdown") },
  { label: "Linear scale", action: () => defaultQuestionBlock("linear_scale") },
  { label: "Date", action: () => defaultQuestionBlock("date") },
  { label: "Time", action: () => defaultQuestionBlock("time") },
  { label: "Section break", action: () => newSectionBlock() },
  { label: "Title & description", action: () => newTextBlock() },
];

function blockLabel(block: EditorBlock): string {
  switch (block.kind) {
    case "short_text":
      return "Short answer";
    case "paragraph":
      return "Paragraph";
    case "multiple_choice":
      return "Multiple choice";
    case "checkboxes":
      return "Checkboxes";
    case "dropdown":
      return "Dropdown";
    case "linear_scale":
      return "Linear scale";
    case "date":
      return "Date";
    case "time":
      return "Time";
    case "section":
      return "Section";
    case "text_block":
      return "Title & description";
    case "unsupported":
      return "Unsupported";
    default:
      return "Question";
  }
}

function SummaryBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-[12px]">
        <span className="min-w-0 truncate text-[var(--color-text)]">{label}</span>
        <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
        <div
          className="h-full rounded-full bg-[var(--color-primary)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ResponsesTab({
  formId,
  editorBlocks,
  linkedSheetId,
  formTitle,
  isQuiz,
}: {
  formId: string;
  editorBlocks: EditorBlock[];
  linkedSheetId: string | null;
  formTitle: string;
  isQuiz: boolean;
}) {
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"summary" | "individual" | "spreadsheet">("summary");
  const [sheetPreviewLoading, setSheetPreviewLoading] = useState(true);

  const load = useCallback(async (append = false, pageToken?: string) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ pageSize: "50" });
      if (pageToken) qs.set("pageToken", pageToken);
      const res = await fetch(`/api/forms/${encodeURIComponent(formId)}/responses?${qs}`);
      const data = (await res.json()) as {
        responses?: FormResponse[];
        nextPageToken?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || data.error || "Failed to load responses");
      setResponses((prev) =>
        append ? [...prev, ...(data.responses ?? [])] : (data.responses ?? []),
      );
      setNextPageToken(data.nextPageToken ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load responses");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [formId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  const questionTitles = buildQuestionTitleMap(editorBlocks);
  const summaries = summarizeResponses(responses, editorBlocks);
  const maxBucket = (buckets: { count: number }[]) =>
    Math.max(1, ...buckets.map((b) => b.count));

  function handleExportCsv() {
    const safeName = (formTitle.trim() || "form").replace(/[^\w\-]+/g, "_").slice(0, 40);
    downloadCsv(`${safeName}-responses.csv`, responsesToCsv(responses, editorBlocks));
  }

  if (loading && responses.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-[var(--color-text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
        <span className="text-[13px]">{titleCase("Loading responses…")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
          {(["summary", "individual", ...(linkedSheetId ? (["spreadsheet"] as const) : [])] as const).map(
            (v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setView(v);
                  if (v === "spreadsheet") setSheetPreviewLoading(true);
                }}
                className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  view === v
                    ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {titleCase(v === "summary" ? "Summary" : v === "individual" ? "Individual" : "Spreadsheet")}
              </button>
            )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {responses.length > 0 ? (
            <button
              type="button"
              onClick={handleExportCsv}
              className="btn-secondary inline-flex h-9 items-center gap-1.5 px-3 text-[12px]"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
              {titleCase("Download CSV")}
            </button>
          ) : null}
        </div>
      </div>

      {view === "spreadsheet" && linkedSheetId ? (
        <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white">
          {sheetPreviewLoading ? (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--color-bg)]"
              aria-live="polite"
            >
              <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
              <p className="text-sm font-medium text-[var(--color-text-muted)]">
                {titleCase("Opening spreadsheet")}
              </p>
            </div>
          ) : null}
          <iframe
            key={linkedSheetId}
            title={titleCase("Spreadsheet preview")}
            src={`https://drive.google.com/file/d/${encodeURIComponent(linkedSheetId)}/preview`}
            className="h-[min(720px,70vh)] w-full border-0"
            allow="autoplay"
            onLoad={() => setSheetPreviewLoading(false)}
          />
        </div>
      ) : responses.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-12 text-center text-[13px] text-[var(--color-text-muted)]">
          {titleCase("No responses yet.")}
        </p>
      ) : (
        <>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {responses.length} {responses.length === 1 ? "response" : "responses"}
            {nextPageToken ? ` · ${titleCase("load more for full export")}` : ""}
          </p>

          {view === "summary" ? (
            <div className="space-y-4">
              {summaries.length === 0 ? (
                <p className="text-[13px] text-[var(--color-text-muted)]">
                  {titleCase("No question data to summarize.")}
                </p>
              ) : (
                summaries.map((s) => (
                  <div
                    key={s.questionId}
                    className="surface-card rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 shadow-[var(--shadow-sm)]"
                  >
                    <p className="mb-3 text-[14px] font-semibold text-[var(--color-text)]">
                      {s.title}
                    </p>
                    {s.type === "choice" || s.type === "scale" ? (
                      <div className="space-y-2">
                        {s.type === "scale" && s.average != null ? (
                          <p className="text-[12px] text-[var(--color-text-muted)]">
                            {titleCase("Average")}: {s.average}
                          </p>
                        ) : null}
                        {s.buckets.map((b) => (
                          <SummaryBar
                            key={b.label}
                            label={b.label}
                            count={b.count}
                            max={maxBucket(s.buckets)}
                          />
                        ))}
                      </div>
                    ) : (
                      <ul className="max-h-48 space-y-1 overflow-y-auto text-[13px] text-[var(--color-text)]">
                        {s.samples.length === 0 ? (
                          <li className="text-[var(--color-text-muted)]">{titleCase("No text answers")}</li>
                        ) : (
                          s.samples.slice(0, 50).map((sample, i) => (
                            <li key={i} className="border-b border-[var(--color-border)]/50 py-1 last:border-0">
                              {sample}
                            </li>
                          ))
                        )}
                        {s.samples.length > 50 ? (
                          <li className="text-[11px] text-[var(--color-text-faint)]">
                            +{s.samples.length - 50} {titleCase("more")}
                          </li>
                        ) : null}
                      </ul>
                    )}
                    <p className="mt-2 text-[11px] text-[var(--color-text-faint)]">
                      {s.total} {titleCase("responses")}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {responses.map((resp, idx) => {
                const isExpanded = expanded.has(resp.responseId);
                const answerEntries = Object.entries(resp.answers ?? {});
                return (
                  <div
                    key={resp.responseId}
                    className="surface-card rounded-[var(--radius-lg)] border border-[var(--color-border)] shadow-[var(--shadow-sm)]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(resp.responseId)}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-[11px] font-bold text-[var(--color-primary)]">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-[var(--color-text)]">
                          {resp.lastSubmittedTime || resp.createTime
                            ? new Date(resp.lastSubmittedTime || resp.createTime!).toLocaleString()
                            : `Response ${idx + 1}`}
                        </span>
                        {resp.respondentEmail ? (
                          <span className="block truncate text-[11px] text-[var(--color-text-muted)]">
                            {resp.respondentEmail}
                          </span>
                        ) : null}
                        {isQuiz && resp.totalScore != null ? (
                          <span className="block text-[11px] font-medium text-[var(--color-primary)]">
                            {titleCase("Score")}: {resp.totalScore}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-faint)]">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="space-y-3 border-t border-[var(--color-border)] px-4 py-3">
                        {answerEntries.length === 0 ? (
                          <p className="text-[13px] text-[var(--color-text-muted)]">
                            {titleCase("No answers recorded.")}
                          </p>
                        ) : (
                          answerEntries.map(([qId, ans]) => (
                            <div key={qId}>
                              <p className="mb-0.5 text-[11px] font-semibold text-[var(--color-text-muted)]">
                                {questionTitles.get(qId) || qId}
                              </p>
                              <p className="text-[13px] text-[var(--color-text)]">{formatAnswer(ans)}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {nextPageToken ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void load(true, nextPageToken)}
              className="btn-secondary mx-auto flex h-9 items-center gap-2 px-4 text-[13px]"
            >
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {titleCase("Load more")}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function FormEditor({ formId }: { formId: string }) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(() => emptyEditorState());
  const [responderUri, setResponderUri] = useState<string | null>(null);
  const [linkedSheetId, setLinkedSheetId] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const [tab, setTab] = useState<"questions" | "responses" | "settings" | "preview">("questions");

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested === "responses" || requested === "settings" || requested === "preview") {
      setTab(requested);
    }
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formId)}`);
      const data = (await res.json()) as Record<string, unknown> & {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.message || data.error || "Failed to load form",
        );
      }
      setEditor(googleFormToEditorState(data));
      setResponderUri(typeof data.responderUri === "string" ? data.responderUri : null);
      setLinkedSheetId(typeof data.linkedSheetId === "string" ? data.linkedSheetId : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setEditor(emptyEditorState());
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaveBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formId)}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: editor }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        editorState?: EditorState;
        form?: Record<string, unknown>;
      };
      if (res.status === 409) {
        throw new Error(
          data.message || "Form changed elsewhere. Refresh and try again.",
        );
      }
      if (!res.ok) {
        throw new Error(data.message || data.error || "Save failed");
      }
      if (data.editorState) {
        setEditor(data.editorState);
      } else if (data.form) {
        setEditor(googleFormToEditorState(data.form));
      }
      if (data.form) {
        if (typeof data.form.responderUri === "string") setResponderUri(data.form.responderUri);
        if (typeof data.form.linkedSheetId === "string") setLinkedSheetId(data.form.linkedSheetId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }

  function updateBlock(i: number, patch: Partial<EditorBlock>) {
    setEditor((prev) => {
      const blocks = [...prev.blocks];
      const cur = blocks[i];
      if (!cur) return prev;
      blocks[i] = { ...cur, ...patch } as EditorBlock;
      return { ...prev, blocks };
    });
  }

  function moveBlock(i: number, dir: -1 | 1) {
    const j = i + dir;
    setEditor((prev) => {
      if (j < 0 || j >= prev.blocks.length) return prev;
      const blocks = [...prev.blocks];
      const [item] = blocks.splice(i, 1);
      blocks.splice(j, 0, item);
      return { ...prev, blocks };
    });
  }

  function addBlock(factory: () => EditorBlock) {
    setEditor((prev) => ({
      ...prev,
      blocks: [...prev.blocks, factory()],
    }));
  }

  async function copyResponderLink() {
    if (!responderUri) return;
    try {
      await navigator.clipboard.writeText(responderUri);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-[var(--color-text-muted)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
        <p className="text-sm">{titleCase("Loading form…")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/forms"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
            aria-label={titleCase("Back to forms")}
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          </Link>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
              {titleCase("Form builder")}
            </p>
            <h1 className="font-display text-xl font-bold text-[var(--color-text)]">
              {titleCase("Edit form")}
            </h1>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
              {titleCase(
                "Changes sync to the connected admin Google account (same as Mail). Respondents use the share link below — editing stays in Placecom.",
              )}
            </p>
          </div>
        </div>
        <button
          data-testid="form-editor-save-btn"
          type="button"
          onClick={() => void save()}
          disabled={saveBusy}
          className="btn-primary inline-flex h-10 items-center gap-2 px-5 text-[13px]"
        >
          {saveBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {titleCase("Saving…")}
            </>
          ) : (
            titleCase("Save to Google")
          )}
        </button>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <div className="surface-card space-y-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] p-5 shadow-[var(--shadow-sm)]">
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--color-text)]">
            {titleCase("Form title")}
          </label>
          <input
            data-testid="form-editor-title-input"
            className="input-field h-11 w-full text-[15px] font-semibold"
            value={editor.title}
            onChange={(e) => setEditor((s) => ({ ...s, title: e.target.value }))}
            placeholder={titleCase("Untitled form")}
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--color-text)]">
            {titleCase("Description")}
          </label>
          <textarea
            data-testid="form-editor-description-input"
            className="input-field min-h-[88px] w-full resize-y py-3 text-[14px] leading-relaxed"
            value={editor.description}
            onChange={(e) => setEditor((s) => ({ ...s, description: e.target.value }))}
            placeholder={titleCase("Shown under the title")}
          />
        </div>

        {responderUri ? (
          <div className="border-t border-[var(--color-border)] pt-4">
            <p className="mb-2 text-[12px] font-semibold text-[var(--color-text)]">
              {titleCase("Share with respondents")}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                className="input-field h-10 flex-1 font-mono text-[12px] text-[var(--color-text-muted)]"
                value={responderUri}
              />
              <button
                data-testid="form-editor-copy-link-btn"
                type="button"
                onClick={() => void copyResponderLink()}
                className="btn-secondary inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-[13px]"
              >
                <Copy className="h-4 w-4" strokeWidth={2} />
                {copyDone ? titleCase("Copied") : titleCase("Copy link")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        {(
          [
            { id: "questions" as const, label: "Questions", icon: ClipboardList },
            { id: "responses" as const, label: "Responses", icon: Inbox },
            { id: "settings" as const, label: "Settings", icon: Settings2 },
            { id: "preview" as const, label: "Preview", icon: Eye },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`form-editor-tab-${id}`}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === id
                ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {titleCase(label)}
          </button>
        ))}
      </div>

      {tab === "responses" ? (
        <ResponsesTab
          formId={formId}
          editorBlocks={editor.blocks}
          linkedSheetId={linkedSheetId}
          formTitle={editor.title}
          isQuiz={editor.isQuiz}
        />
      ) : tab === "settings" ? (
        <div className="surface-card space-y-5 rounded-[var(--radius-xl)] border border-[var(--color-border)] p-5 shadow-[var(--shadow-sm)]">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={editor.acceptingResponses}
              onChange={(e) =>
                setEditor((s) => ({ ...s, acceptingResponses: e.target.checked }))
              }
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            {titleCase("Accepting responses")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={editor.isQuiz}
              onChange={(e) => setEditor((s) => ({ ...s, isQuiz: e.target.checked }))}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            {titleCase("Make this a quiz")}
          </label>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {titleCase(
              "Quiz grading and answer keys are managed in Google Forms. Placecom syncs quiz mode on save.",
            )}
          </p>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[var(--color-text)]">
              {titleCase("Email collection")}
            </label>
            <select
              className="input-field h-10 w-full text-[13px]"
              value={editor.emailCollection}
              onChange={(e) =>
                setEditor((s) => ({
                  ...s,
                  emailCollection: e.target.value as EditorState["emailCollection"],
                }))
              }
            >
              {EMAIL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {titleCase(o.label)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : tab === "preview" ? (
        <div className="space-y-4">
          {responderUri ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyResponderLink()}
                  className="btn-secondary inline-flex h-10 items-center gap-2 px-4 text-[13px]"
                >
                  <Copy className="h-4 w-4" strokeWidth={2} />
                  {copyDone ? titleCase("Copied") : titleCase("Copy link")}
                </button>
              </div>
              <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-sm)]">
                <iframe
                  title={titleCase("Form preview")}
                  src={responderUri}
                  className="h-[min(720px,70vh)] w-full"
                />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)]">
              {titleCase("Save the form to generate a responder link for preview.")}
            </p>
          )}
        </div>
      ) : (
      <>
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-[var(--color-text)]">
          <ClipboardList className="h-4 w-4 text-[var(--color-primary)]" strokeWidth={2} />
          {titleCase("Questions & content")}
        </h2>

        {editor.blocks.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-8 text-center text-[13px] text-[var(--color-text-muted)]">
            {titleCase("No blocks yet. Add a question or section below.")}
          </p>
        ) : null}

        {editor.blocks.map((block, i) => (
          <div
            key={block.key}
            className="surface-card rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 shadow-[var(--shadow-sm)]"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-[var(--color-primary-light)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                {titleCase(blockLabel(block))}
              </span>
              <div className="flex items-center gap-1">
                <button
                  data-testid={`form-block-up-${block.key}`}
                  type="button"
                  disabled={i === 0}
                  onClick={() => moveBlock(i, -1)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] disabled:opacity-30"
                  aria-label={titleCase("Move up")}
                >
                  <ChevronUp className="h-4 w-4" strokeWidth={2} />
                </button>
                <button
                  data-testid={`form-block-down-${block.key}`}
                  type="button"
                  disabled={i === editor.blocks.length - 1}
                  onClick={() => moveBlock(i, 1)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] disabled:opacity-30"
                  aria-label={titleCase("Move down")}
                >
                  <ChevronDown className="h-4 w-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditor((prev) => {
                      const blocks = [...prev.blocks];
                      blocks.splice(i + 1, 0, duplicateBlock(block));
                      return { ...prev, blocks };
                    })
                  }
                  className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                >
                  <CopyPlus className="h-3.5 w-3.5" strokeWidth={2} />
                  {titleCase("Duplicate")}
                </button>
              </div>
            </div>

            {block.kind === "unsupported" ? (
              <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">{block.hint}</p>
            ) : null}

            {(block.kind === "section" ||
              block.kind === "text_block" ||
              block.kind === "unsupported" ||
              block.kind === "short_text" ||
              block.kind === "paragraph" ||
              block.kind === "multiple_choice" ||
              block.kind === "checkboxes" ||
              block.kind === "dropdown" ||
              block.kind === "linear_scale" ||
              block.kind === "date" ||
              block.kind === "time") && (
              <>
                <div className="mb-3">
                  <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-muted)]">
                    {titleCase("Title")}
                  </label>
                  <input
                    className="input-field h-10 w-full text-[14px]"
                    value={block.title}
                    onChange={(e) => updateBlock(i, { title: e.target.value } as Partial<EditorBlock>)}
                    placeholder={titleCase("Question title")}
                  />
                </div>
                <div className="mb-3">
                  <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-muted)]">
                    {titleCase("Help text")}
                  </label>
                  <textarea
                    className="input-field min-h-[64px] w-full resize-y py-2 text-[13px]"
                    value={block.description}
                    onChange={(e) =>
                      updateBlock(i, { description: e.target.value } as Partial<EditorBlock>)
                    }
                    placeholder={titleCase("Optional description")}
                  />
                </div>
              </>
            )}

            {(block.kind === "short_text" ||
              block.kind === "paragraph" ||
              block.kind === "multiple_choice" ||
              block.kind === "checkboxes" ||
              block.kind === "dropdown" ||
              block.kind === "linear_scale" ||
              block.kind === "date" ||
              block.kind === "time") ? (
              <label className="mb-3 flex items-center gap-2 text-[13px] text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={block.required}
                  onChange={(e) =>
                    updateBlock(i, { required: e.target.checked } as Partial<EditorBlock>)
                  }
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                {titleCase("Required")}
              </label>
            ) : null}

            {(block.kind === "multiple_choice" ||
              block.kind === "checkboxes" ||
              block.kind === "dropdown") && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-[var(--color-text-muted)]">
                  {titleCase("Options")}
                </label>
                {(block.choiceOptions || []).map((opt, j) => (
                  <div key={j} className="flex gap-2">
                    <input
                      className="input-field h-9 flex-1 text-[13px]"
                      value={opt}
                      onChange={(e) => {
                        const next = [...(block.choiceOptions || [])];
                        next[j] = e.target.value;
                        updateBlock(i, { choiceOptions: next } as Partial<EditorBlock>);
                      }}
                    />
                    <button
                      type="button"
                      className="btn-ghost h-9 px-2 text-[var(--color-danger)]"
                      onClick={() => {
                        const next = (block.choiceOptions || []).filter((_, k) => k !== j);
                        updateBlock(i, { choiceOptions: next } as Partial<EditorBlock>);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-[12px] font-medium text-[var(--color-primary)] hover:underline"
                  onClick={() =>
                    updateBlock(i, {
                      choiceOptions: [...(block.choiceOptions || []), `Option ${(block.choiceOptions?.length || 0) + 1}`],
                    } as Partial<EditorBlock>)
                  }
                >
                  + {titleCase("Add option")}
                </button>
                <label className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
                  <input
                    type="checkbox"
                    checked={Boolean(block.shuffle)}
                    onChange={(e) =>
                      updateBlock(i, { shuffle: e.target.checked } as Partial<EditorBlock>)
                    }
                  />
                  {titleCase("Shuffle option order")}
                </label>
              </div>
            )}

            {block.kind === "linear_scale" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--color-text-muted)]">
                    {titleCase("Low")}
                  </label>
                  <input
                    type="number"
                    className="input-field h-9 w-full text-[13px]"
                    value={block.scaleLow ?? 1}
                    onChange={(e) =>
                      updateBlock(i, {
                        scaleLow: parseInt(e.target.value, 10) || 0,
                      } as Partial<EditorBlock>)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--color-text-muted)]">
                    {titleCase("High")}
                  </label>
                  <input
                    type="number"
                    className="input-field h-9 w-full text-[13px]"
                    value={block.scaleHigh ?? 5}
                    onChange={(e) =>
                      updateBlock(i, {
                        scaleHigh: parseInt(e.target.value, 10) || 0,
                      } as Partial<EditorBlock>)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--color-text-muted)]">
                    {titleCase("Low label")}
                  </label>
                  <input
                    className="input-field h-9 w-full text-[13px]"
                    value={block.scaleLowLabel || ""}
                    onChange={(e) =>
                      updateBlock(i, { scaleLowLabel: e.target.value } as Partial<EditorBlock>)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--color-text-muted)]">
                    {titleCase("High label")}
                  </label>
                  <input
                    className="input-field h-9 w-full text-[13px]"
                    value={block.scaleHighLabel || ""}
                    onChange={(e) =>
                      updateBlock(i, { scaleHighLabel: e.target.value } as Partial<EditorBlock>)
                    }
                  />
                </div>
              </div>
            )}

            {block.kind === "date" && (
              <div className="flex flex-wrap gap-4 text-[13px]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={block.dateIncludeYear !== false}
                    onChange={(e) =>
                      updateBlock(i, {
                        dateIncludeYear: e.target.checked,
                      } as Partial<EditorBlock>)
                    }
                  />
                  {titleCase("Include year")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(block.dateIncludeTime)}
                    onChange={(e) =>
                      updateBlock(i, {
                        dateIncludeTime: e.target.checked,
                      } as Partial<EditorBlock>)
                    }
                  />
                  {titleCase("Include time")}
                </label>
              </div>
            )}

            {block.kind === "time" && (
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={Boolean(block.timeDuration)}
                  onChange={(e) =>
                    updateBlock(i, { timeDuration: e.target.checked } as Partial<EditorBlock>)
                  }
                />
                {titleCase("Duration (elapsed time)")}
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="surface-card rounded-[var(--radius-xl)] border border-[var(--color-border)] p-4">
        <p className="mb-3 text-[12px] font-semibold text-[var(--color-text)]">
          {titleCase("Add to form")}
        </p>
        <div className="flex flex-wrap gap-2">
          {ADD_QUESTION_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              data-testid={`form-add-block-${opt.label.toLowerCase().replace(/\s+/g, "-")}`}
              type="button"
              onClick={() => addBlock(opt.action)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-3 py-2 text-[12px] font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              {titleCase(opt.label)}
            </button>
          ))}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
