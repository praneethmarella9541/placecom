"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import {
  applyTemplatePreview,
  templateVariableDisplayLabels,
  type WhatsAppTemplateMeta,
} from "@/lib/whatsapp-template-shared";
import { IconChevronDown, IconCheck } from "@/components/Icons";

type Props = {
  needsTemplate: boolean;
  templates: WhatsAppTemplateMeta[];
  selectedTemplateName: string;
  onTemplateChange: (name: string) => void;
  templateVariables: string[];
  onTemplateVariablesChange: (vars: string[]) => void;
  forceTemplate: boolean;
  onForceTemplateChange: (v: boolean) => void;
};

export function WhatsAppTemplatePanel({
  needsTemplate,
  templates,
  selectedTemplateName,
  onTemplateChange,
  templateVariables,
  onTemplateVariablesChange,
  forceTemplate,
  onForceTemplateChange,
}: Props) {
  const [open, setOpen] = useState(needsTemplate);

  useEffect(() => {
    if (needsTemplate) setOpen(true);
  }, [needsTemplate]);

  const selectedTemplate =
    templates.find((t) => t.name === selectedTemplateName) ?? templates[0];

  const varLabels = selectedTemplate
    ? templateVariableDisplayLabels(selectedTemplate)
    : ["Recipient name", "Your name"];
  const filledCount = varLabels.filter((_, i) => (templateVariables[i] ?? "").trim()).length;
  const allFilled = filledCount >= varLabels.length;

  const templatePreview =
    selectedTemplate && templateVariables.some((v) => v.trim())
      ? applyTemplatePreview(selectedTemplate, templateVariables)
      : selectedTemplate?.preview.replace(/\{\{\d+\}\}/g, "…") ?? "";

  const summaryLabel = selectedTemplate?.label ?? selectedTemplate?.name ?? "Template";

  return (
    <div
      className={cn(
        "mb-2 overflow-hidden rounded-2xl border transition-all duration-200",
        needsTemplate
          ? "border-[#c8e6d4] bg-gradient-to-br from-[#f4fbf7] via-[#f8fdf9] to-[#eef8f2] shadow-[0_2px_12px_rgba(7,94,84,0.08)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors",
          !needsTemplate && "hover:bg-[var(--color-surface-offset)]/60",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold",
            needsTemplate
              ? "bg-[#075E54] text-white shadow-[0_2px_8px_rgba(7,94,84,0.25)]"
              : "bg-[var(--color-primary-tint)] text-[var(--color-primary)]",
          )}
        >
          {needsTemplate ? "!" : "T"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--color-text)]">
              {needsTemplate ? titleCase("Approved template required") : titleCase("Template options")}
            </span>
            {needsTemplate ? (
              <span className="rounded-full bg-[#dcf8e8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#075E54]">
                {titleCase("Session closed")}
              </span>
            ) : forceTemplate ? (
              <span className="rounded-full bg-[var(--color-primary-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                {titleCase("Force template")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-faint)]">
            {open
              ? needsTemplate
                ? titleCase("Fill variables below — recipient must reply to open free chat")
                : titleCase("Optional template for outside the 24h window")
              : `${summaryLabel}${needsTemplate && !allFilled ? ` · ${filledCount}/${varLabels.length} fields` : ""}`}
          </p>
        </div>

        <IconChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--color-text-faint)] transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-[var(--color-border)]/80 px-3.5 pb-3.5 pt-3">
            {templates.length > 1 ? (
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                  {titleCase("Template")}
                </span>
                <select
                  className="input-field w-full text-sm"
                  value={selectedTemplateName}
                  onChange={(e) => onTemplateChange(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-[12px] font-medium text-[var(--color-text)]">
                {selectedTemplate?.label}
              </p>
            )}

            <div className="rounded-xl border border-[#d9f0e3] bg-white/80 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#075E54]/70">
                {titleCase("Preview")}
              </p>
              <div className="flex justify-end">
                <div className="max-w-[92%] rounded-xl rounded-tr-sm bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-[#111b21] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                  {templatePreview || "…"}
                </div>
              </div>
            </div>

            <div className={cn("grid gap-2.5", varLabels.length > 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
              {varLabels.map((label, i) => {
                const value = templateVariables[i] ?? "";
                const filled = Boolean(value.trim());
                const displayLabel = titleCase(label);
                return (
                  <label key={`${selectedTemplateName}-var-${i}`} className="block">
                    <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
                          filled
                            ? "bg-[#075E54] text-white"
                            : "bg-[var(--color-surface-offset)] text-[var(--color-text-faint)]",
                        )}
                      >
                        {filled ? <IconCheck className="h-2.5 w-2.5" /> : i + 1}
                      </span>
                      {displayLabel}
                    </span>
                    <input
                      className="input-field w-full text-sm"
                      value={value}
                      placeholder={`Enter ${label.toLowerCase()}`}
                      onChange={(e) => {
                        const next = [...templateVariables];
                        next[i] = e.target.value;
                        onTemplateVariablesChange(next);
                      }}
                    />
                  </label>
                );
              })}
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 transition-colors hover:border-[var(--color-primary)]/30">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--color-border-strong)] text-[#075E54] focus:ring-[#075E54]/30"
                checked={forceTemplate}
                onChange={(e) => onForceTemplateChange(e.target.checked)}
              />
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {needsTemplate
                  ? titleCase("Always use template (even after they reply)")
                  : titleCase("Send as template instead of free text")}
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
