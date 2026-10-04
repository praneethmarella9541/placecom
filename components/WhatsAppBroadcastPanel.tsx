"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { normalizePhoneList } from "@/lib/broadcast-phones";
import {
  type WhatsAppTemplateMeta,
  applyTemplatePreview,
  templateVariableDisplayLabels,
} from "@/lib/whatsapp-template-shared";
import {
  IconPlus,
  IconSend,
  IconX,
  IconUpload,
  IconChevronDown,
  IconCheck,
  IconAlertTriangle,
} from "@/components/Icons";

/* ─── Types ──────────────────────────────────────────────────── */

type BroadcastMode = "template" | "session";

type MergeRow = {
  phone: string;
  cells: string[]; // non-phone column values
};

type ParseResult = {
  rows: MergeRow[];
  headers: string[]; // non-phone column headers
  totalRows: number;
  skipped: number;
  truncated: boolean;
};

type ColumnMapping = number | null; // which CSV column (index into headers) maps to variable slot i

/* ─── Helpers ────────────────────────────────────────────────── */

function autoMapColumns(headers: string[], varLabels: string[]): ColumnMapping[] {
  return varLabels.map((label) => {
    const lbl = label.toLowerCase();
    const match = headers.findIndex((h) => {
      const hk = h.toLowerCase();
      if (lbl.includes("recipient") || lbl.includes("name")) {
        return /^(name|full.?name|recipient|contact|first.?name)$/.test(hk);
      }
      if (lbl.includes("your name") || lbl.includes("sender")) {
        return /^(sender|your.?name|from|agent|staff|employee)$/.test(hk);
      }
      return hk === lbl || hk.replace(/\s/g, "_") === lbl.replace(/\s/g, "_");
    });
    return match >= 0 ? match : null;
  });
}

function previewRow(template: WhatsAppTemplateMeta, row: MergeRow, mapping: ColumnMapping[]): string {
  const vars = mapping.map((idx) => (idx !== null ? row.cells[idx] ?? "" : ""));
  return applyTemplatePreview(template, vars);
}

/* ─── Component ──────────────────────────────────────────────── */

export function WhatsAppBroadcastPanel() {
  /* shared */
  const [mode, setMode] = useState<BroadcastMode>("template");
  const [templates, setTemplates] = useState<WhatsAppTemplateMeta[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateMeta | null>(null);

  /* template + CSV merge state */
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [mappingOpen, setMappingOpen] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  /* session message state */
  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [sessionParseBusy, setSessionParseBusy] = useState(false);
  const [sessionParseError, setSessionParseError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const sessionFileRef = useRef<HTMLInputElement>(null);

  /* send state */
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<{
    sent: number;
    failed: { phone: string; error: string }[];
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  /* ── Load templates ──────────────────────────────────────────── */
  useEffect(() => {
    fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then((d: { templates?: WhatsAppTemplateMeta[] }) => {
        const tmpl = d.templates ?? [];
        setTemplates(tmpl);
        if (tmpl.length > 0) setSelectedTemplate(tmpl[0]);
      })
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, []);

  /* ── Auto-map when template or headers change ─────────────────── */
  useEffect(() => {
    if (!selectedTemplate || !parseResult) return;
    const labels = templateVariableDisplayLabels(selectedTemplate);
    const auto = autoMapColumns(parseResult.headers, labels);
    setMapping(auto);
    setPreviewIdx(0);
  }, [selectedTemplate, parseResult]);

  /* When template changes and no CSV, just reset mapping */
  useEffect(() => {
    if (!parseResult && selectedTemplate) {
      const labels = templateVariableDisplayLabels(selectedTemplate);
      setMapping(labels.map(() => null));
    }
  }, [selectedTemplate, parseResult]);

  const varLabels = useMemo(
    () => (selectedTemplate ? templateVariableDisplayLabels(selectedTemplate) : []),
    [selectedTemplate]
  );

  /* ── CSV upload (template mode) ──────────────────────────────── */
  const onPickCsv = async (list: FileList | null) => {
    if (!list?.length) return;
    setParseError(null);
    setParseBusy(true);
    const fd = new FormData();
    fd.set("file", list[0]);
    try {
      const res = await fetch("/api/broadcast/parse-wa-merge", { method: "POST", body: fd });
      const data = (await res.json()) as ParseResult & { error?: string };
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? "WhatsApp broadcasting is disabled for your account."
            : (data.error ?? "Parse failed")
        );
      }
      if (data.rows.length === 0) {
        setParseError(
          `No valid phone numbers found. Use a Phone/Mobile column with 10-digit Indian numbers or +91… format.`
        );
      } else {
        setParseResult(data);
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParseBusy(false);
      if (csvRef.current) csvRef.current.value = "";
    }
  };

  /* ── Session file import ─────────────────────────────────────── */
  const mergeRecipients = useCallback((more: string[]) => {
    setRecipients((prev) => Array.from(new Set([...prev, ...more])));
  }, []);

  const applyManual = useCallback(() => {
    const next = normalizePhoneList(manualInput);
    if (next.length) mergeRecipients(next);
    setManualInput("");
  }, [manualInput, mergeRecipients]);

  const onPickSessionFile = async (list: FileList | null) => {
    if (!list?.length) return;
    setSessionParseError(null);
    setSessionParseBusy(true);
    const fd = new FormData();
    fd.set("file", list[0]);
    try {
      const res = await fetch("/api/broadcast/parse-phones", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; phones?: string[] };
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? "WhatsApp broadcasting is disabled for your account."
            : (data.error ?? "Import failed")
        );
      }
      const phones = data.phones ?? [];
      if (phones.length === 0) {
        setSessionParseError("No phone numbers found. Use a Phone/Mobile column with 10-digit Indian numbers or +91… format.");
      } else {
        mergeRecipients(phones);
      }
    } catch (e) {
      setSessionParseError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setSessionParseBusy(false);
      if (sessionFileRef.current) sessionFileRef.current.value = "";
    }
  };

  /* ── Send ────────────────────────────────────────────────────── */
  const sendBroadcast = async () => {
    setSendError(null);
    setSendResult(null);

    if (mode === "template") {
      if (!selectedTemplate) { setSendError("Select a template first."); return; }
      if (!parseResult || parseResult.rows.length === 0) { setSendError("Upload a CSV with recipients."); return; }

      const rows = parseResult.rows.map((row) => ({
        phone: row.phone,
        variables: mapping.map((idx) => (idx !== null ? row.cells[idx] ?? "" : "")),
      }));

      setSendBusy(true);
      try {
        const res = await fetch("/api/broadcast/whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "template",
            templateName: selectedTemplate.name,
            templateLanguage: selectedTemplate.languageCode,
            rows,
          }),
        });
        const data = (await res.json()) as { error?: string; sent?: number; failed?: { phone: string; error: string }[] };
        if (!res.ok) throw new Error(data.error ?? "Send failed");
        setSendResult({ sent: data.sent ?? 0, failed: data.failed ?? [] });
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "Send failed");
      } finally {
        setSendBusy(false);
      }
      return;
    }

    /* session */
    if (recipients.length === 0) { setSendError("Add recipients."); return; }
    if (!body.trim()) { setSendError("Enter the message to send."); return; }
    setSendBusy(true);
    try {
      const res = await fetch("/api/broadcast/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, text: body.trim() }),
      });
      const data = (await res.json()) as { error?: string; sent?: number; failed?: { phone: string; error: string }[] };
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setSendResult({ sent: data.sent ?? 0, failed: data.failed ?? [] });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSendBusy(false);
    }
  };

  const canSend =
    !sendBusy &&
    (mode === "template"
      ? !!selectedTemplate && (parseResult?.rows.length ?? 0) > 0
      : recipients.length > 0 && body.trim().length > 0);

  /* ── Preview (template mode) ─────────────────────────────────── */
  const currentPreviewRow = parseResult?.rows[previewIdx];
  const currentPreviewText =
    selectedTemplate && currentPreviewRow
      ? previewRow(selectedTemplate, currentPreviewRow, mapping)
      : selectedTemplate
      ? applyTemplatePreview(selectedTemplate, varLabels.map(() => "…"))
      : "";

  /* ─── UI ──────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1">
        {(["template", "session"] as BroadcastMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setSendResult(null); setSendError(null); }}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150",
              mode === m
                ? "bg-[var(--color-surface)] text-[var(--color-copper)] shadow-[var(--shadow-sm)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            )}
          >
            {m === "template" ? "Template + CSV Merge" : "Session Message"}
          </button>
        ))}
      </div>

      {mode === "template" ? (
        <TemplateMergeSection
          templates={templates}
          templatesLoading={templatesLoading}
          selectedTemplate={selectedTemplate}
          setSelectedTemplate={setSelectedTemplate}
          parseResult={parseResult}
          setParseResult={setParseResult}
          parseBusy={parseBusy}
          parseError={parseError}
          csvRef={csvRef}
          onPickCsv={onPickCsv}
          varLabels={varLabels}
          mapping={mapping}
          setMapping={setMapping}
          mappingOpen={mappingOpen}
          setMappingOpen={setMappingOpen}
          previewIdx={previewIdx}
          setPreviewIdx={setPreviewIdx}
          currentPreviewText={currentPreviewText}
        />
      ) : (
        <SessionMessageSection
          recipients={recipients}
          setRecipients={setRecipients}
          manualInput={manualInput}
          setManualInput={setManualInput}
          applyManual={applyManual}
          sessionParseBusy={sessionParseBusy}
          sessionParseError={sessionParseError}
          sessionFileRef={sessionFileRef}
          onPickSessionFile={onPickSessionFile}
          body={body}
          setBody={setBody}
        />
      )}

      {/* Feedback */}
      {sendError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {sendError}
        </div>
      )}
      {sendResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <p className="flex items-center gap-1.5 font-medium">
            <IconCheck className="h-4 w-4 shrink-0" />
            Sent: {sendResult.sent}
            {sendResult.failed.length > 0 && (
              <span className="ml-1 text-amber-700 dark:text-amber-400">
                · Failed: {sendResult.failed.length}
              </span>
            )}
          </p>
          {sendResult.failed.length > 0 && (
            <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-xs opacity-80">
              {sendResult.failed.map((f) => (
                <li key={f.phone}>
                  <span className="font-mono">{f.phone}</span>: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Send button */}
      <div className="flex items-center justify-end border-t border-[var(--color-border)] pt-4">
        <button
          type="button"
          disabled={!canSend}
          onClick={() => void sendBroadcast()}
          className="btn-primary-copper min-w-[180px] justify-center"
        >
          {sendBusy ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Sending…
            </>
          ) : (
            <>
              <IconSend className="h-4 w-4" />
              {mode === "template"
                ? `Send to ${parseResult?.rows.length ?? 0} recipients`
                : `Send to ${recipients.length} recipients`}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ─── Template + CSV Merge Section ──────────────────────────── */

function TemplateMergeSection({
  templates,
  templatesLoading,
  selectedTemplate,
  setSelectedTemplate,
  parseResult,
  setParseResult,
  parseBusy,
  parseError,
  csvRef,
  onPickCsv,
  varLabels,
  mapping,
  setMapping,
  mappingOpen,
  setMappingOpen,
  previewIdx,
  setPreviewIdx,
  currentPreviewText,
}: {
  templates: WhatsAppTemplateMeta[];
  templatesLoading: boolean;
  selectedTemplate: WhatsAppTemplateMeta | null;
  setSelectedTemplate: (t: WhatsAppTemplateMeta) => void;
  parseResult: ParseResult | null;
  setParseResult: (r: ParseResult | null) => void;
  parseBusy: boolean;
  parseError: string | null;
  csvRef: React.RefObject<HTMLInputElement>;
  onPickCsv: (l: FileList | null) => void;
  varLabels: string[];
  mapping: ColumnMapping[];
  setMapping: React.Dispatch<React.SetStateAction<ColumnMapping[]>>;
  mappingOpen: boolean;
  setMappingOpen: (v: boolean) => void;
  previewIdx: number;
  setPreviewIdx: (i: number) => void;
  currentPreviewText: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Left: template + CSV */}
      <div className="space-y-4">
        {/* Template picker */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[var(--color-text-muted)]">
            Template
          </label>
          {templatesLoading ? (
            <div className="h-9 animate-pulse rounded-lg bg-[var(--color-bg-subtle)]" />
          ) : templates.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No templates found. Configure WhatsApp templates first.
            </p>
          ) : (
            <select
              value={selectedTemplate?.name ?? ""}
              onChange={(e) => {
                const t = templates.find((x) => x.name === e.target.value);
                if (t) setSelectedTemplate(t);
              }}
              className="input-field text-sm"
            >
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Template preview bubble */}
        {selectedTemplate && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
              Preview
            </p>
            <div className="rounded-lg bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-zinc-800 dark:bg-emerald-900/40 dark:text-zinc-100">
              {currentPreviewText}
            </div>
            {parseResult && parseResult.rows.length > 1 && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))}
                  disabled={previewIdx === 0}
                  className="rounded px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)] disabled:opacity-30"
                >
                  ‹
                </button>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Row {previewIdx + 1} of {parseResult.rows.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewIdx(Math.min(parseResult.rows.length - 1, previewIdx + 1))}
                  disabled={previewIdx >= parseResult.rows.length - 1}
                  className="rounded px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)] disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}

        {/* CSV upload */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[var(--color-text-muted)]">
            Upload CSV / Excel
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={csvRef}
              type="file"
              accept=".csv,.xlsx,.xls,.ods"
              className="hidden"
              onChange={(e) => void onPickCsv(e.target.files)}
            />
            <button
              type="button"
              disabled={parseBusy}
              onClick={() => csvRef.current?.click()}
              className="btn-secondary gap-2"
            >
              <IconUpload className="h-4 w-4" />
              {parseBusy ? "Reading…" : "Choose file"}
            </button>
            {parseResult && (
              <span className="text-xs text-[var(--color-text-muted)]">
                {parseResult.rows.length} row{parseResult.rows.length !== 1 ? "s" : ""} loaded
                {parseResult.truncated && " (truncated to 200)"}
              </span>
            )}
          </div>
          {parseError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{parseError}</p>
          )}
          {parseResult && (parseResult.skipped ?? 0) > 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {parseResult.skipped ?? 0} row{(parseResult.skipped ?? 0) !== 1 ? "s" : ""} skipped (no valid phone number).
            </p>
          )}
        </div>

        {/* CSV format hint */}
        {!parseResult && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-xs text-[var(--color-text-muted)]">
            <p className="font-medium">Expected CSV format:</p>
            <p className="mt-1 font-mono text-[11px]">Phone, Name, Sender</p>
            <p className="mt-1 font-mono text-[11px] opacity-70">+91 98765 43210, Priya, Rahul</p>
            <p className="mt-2 opacity-70">
              Columns map to <span className="font-semibold">{"{{1}}"}</span>, <span className="font-semibold">{"{{2}}"}</span>, … in the template.
              The phone column is auto-detected.
            </p>
          </div>
        )}
      </div>

      {/* Right: column mapping + recipient table */}
      <div className="space-y-4">
        {/* Column mapping */}
        {parseResult && varLabels.length > 0 && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
            <button
              type="button"
              onClick={() => setMappingOpen(!mappingOpen)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-[13px] font-medium text-[var(--color-text)]"
            >
              <span>Column mapping</span>
              <IconChevronDown
                className={cn("h-4 w-4 text-[var(--color-text-muted)] transition-transform duration-200",
                  mappingOpen ? "rotate-0" : "-rotate-90"
                )}
              />
            </button>
            {mappingOpen && (
              <div className="border-t border-[var(--color-border)] px-3 pb-3 pt-2 space-y-2">
                <p className="text-[11px] text-[var(--color-text-faint)]">
                  Map your CSV columns to each template variable.
                </p>
                {varLabels.map((label, vi) => (
                  <div key={vi} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 rounded bg-[var(--color-copper)]/10 text-center text-[11px] font-bold text-[var(--color-copper)]">
                      {vi + 1}
                    </span>
                    <span className="w-28 shrink-0 truncate text-xs text-[var(--color-text-muted)]">{label}</span>
                    <select
                      value={mapping[vi] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value === "" ? null : Number(e.target.value);
                        setMapping((prev) => {
                          const next = [...prev];
                          next[vi] = val;
                          return next;
                        });
                      }}
                      className="input-field flex-1 py-1 text-xs"
                    >
                      <option value="">— skip —</option>
                      {parseResult.headers.map((h, hi) => (
                        <option key={hi} value={hi}>{h || `Column ${hi + 1}`}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recipient preview table */}
        {parseResult && parseResult.rows.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
              Recipients ({parseResult.rows.length})
            </p>
            <div className="scrollbar-thin max-h-72 overflow-auto rounded-xl border border-[var(--color-border)]">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-[var(--color-bg-subtle)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-muted)]">Phone</th>
                    {parseResult.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left font-semibold text-[var(--color-text-muted)]">
                        {h || `Col ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {parseResult.rows.slice(0, 50).map((row, ri) => (
                    <tr
                      key={ri}
                      onClick={() => setPreviewIdx(ri)}
                      className={cn(
                        "cursor-pointer transition-colors",
                        ri === previewIdx
                          ? "bg-[var(--color-copper)]/5"
                          : "hover:bg-[var(--color-bg-subtle)]"
                      )}
                    >
                      <td className="px-3 py-1.5 font-mono text-[var(--color-text)]">{row.phone}</td>
                      {row.cells.map((c, ci) => (
                        <td key={ci} className="px-3 py-1.5 text-[var(--color-text-muted)]">{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parseResult.rows.length > 50 && (
                <p className="px-3 py-2 text-center text-xs text-[var(--color-text-faint)]">
                  Showing first 50 of {parseResult.rows.length} rows
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setParseResult(null)}
              className="btn-ghost mt-2 text-xs text-red-600 dark:text-red-400"
            >
              Clear list
            </button>
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-faint)]">
            Upload a CSV to see recipients here
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Session Message Section ────────────────────────────────── */

function SessionMessageSection({
  recipients,
  setRecipients,
  manualInput,
  setManualInput,
  applyManual,
  sessionParseBusy,
  sessionParseError,
  sessionFileRef,
  onPickSessionFile,
  body,
  setBody,
}: {
  recipients: string[];
  setRecipients: React.Dispatch<React.SetStateAction<string[]>>;
  manualInput: string;
  setManualInput: (v: string) => void;
  applyManual: () => void;
  sessionParseBusy: boolean;
  sessionParseError: string | null;
  sessionFileRef: React.RefObject<HTMLInputElement>;
  onPickSessionFile: (l: FileList | null) => void;
  body: string;
  setBody: (v: string) => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[var(--color-text-muted)]">
            Import recipients (CSV / Excel)
          </label>
          <input
            ref={sessionFileRef}
            type="file"
            accept=".csv,.xlsx,.xls,.ods"
            className="hidden"
            onChange={(e) => void onPickSessionFile(e.target.files)}
          />
          <button
            type="button"
            disabled={sessionParseBusy}
            onClick={() => sessionFileRef.current?.click()}
            className="btn-secondary gap-2 w-full justify-center sm:w-auto"
          >
            <IconUpload className="h-4 w-4" />
            {sessionParseBusy ? "Reading…" : "Choose file"}
          </button>
          {sessionParseError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{sessionParseError}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[var(--color-text-muted)]">
            Or paste numbers (comma/newline separated)
          </label>
          <textarea
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            rows={3}
            className="input-field resize-none text-sm"
            placeholder="+919876543210, +447700900123"
          />
          <button type="button" onClick={applyManual} className="btn-ghost mt-2 gap-1 text-sm">
            <IconPlus className="h-4 w-4" />
            Add to list
          </button>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">
            List ({recipients.length})
          </p>
          {recipients.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-sm text-[var(--color-text-faint)]">
              No recipients yet
            </p>
          ) : (
            <ul className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-2">
              {recipients.map((phone) => (
                <li
                  key={phone}
                  className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs dark:bg-zinc-900"
                >
                  <span className="truncate font-mono text-[var(--color-text)]">{phone}</span>
                  <button
                    type="button"
                    onClick={() => setRecipients((r) => r.filter((x) => x !== phone))}
                    className="shrink-0 rounded p-0.5 text-[var(--color-text-faint)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {recipients.length > 0 && (
            <button
              type="button"
              onClick={() => setRecipients([])}
              className="btn-ghost mt-2 text-xs text-red-600 dark:text-red-400"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-[var(--color-text-muted)]">
            Message (same text sent to all)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="input-field resize-y text-sm"
            placeholder="Session message sent individually to each recipient…"
          />
        </div>
      </div>
    </div>
  );
}
