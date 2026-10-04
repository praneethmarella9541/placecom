"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, Plus, Search, Trash2 } from "lucide-react";

import { RichTextEditor } from "@/components/RichTextEditor";
import { SubjectWithVariables } from "@/components/SubjectWithVariables";
import { useMailTemplates } from "@/hooks/useMailTemplates";
import {
  MAIL_TEMPLATE_NAME_MAX,
  suggestedTemplateName,
  validateMailTemplateInput,
  type MailTemplate,
} from "@/lib/mail-template-types";
import { COMPOSE_VARIABLES, type ComposeVariable } from "@/lib/compose-variables";
import { cleanMailSnippet, cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";

/**
 * Templates button + the modal behind it, for the compose footer and the
 * sequence step editor.
 *
 * This modal is the feature's *entire* surface — browsing, writing, editing,
 * renaming and deleting all happen here. There is deliberately no /templates
 * page: a template only ever matters next to the draft it is going into, and a
 * separate page would mean leaving a half-written mail to go manage one.
 *
 * A modal rather than a footer popover because a template's body is edited with
 * the same RichTextEditor the composer uses, toolbar and all. That does not fit
 * in a dropdown, and "edit the name but not the content" is not a template
 * manager.
 *
 * Styled with workspace tokens even though it opens over the Gmail-chrome
 * compose window — same call MassSendingToggleDialog makes, and for the same
 * reason: this is a decision about your saved library, not part of the mail.
 */

export type TemplateApplyMode = "replace" | "append";

type Props = {
  /** Current draft subject — seeds "new from this draft", and the replace target. */
  subject: string;
  /** Current draft body HTML. */
  bodyHtml: string;
  /**
   * False in a reply composer, where the subject belongs to the thread. A
   * template's own subject is then neither applied nor captured.
   */
  canSetSubject?: boolean;
  /** Nothing written yet, so applying a template cannot destroy anything. */
  draftIsEmpty: boolean;
  onApply: (template: MailTemplate, mode: TemplateApplyMode) => void;
  /**
   * Vocabulary offered by the `{` picker while writing a template. Defaults to
   * the composer's set; the sequence editor passes its own wider one.
   */
  variables?: ComposeVariable[];
  disabled?: boolean;
};

/** Right-pane subject: an existing template being edited, or a new one. */
type Selection =
  | { kind: "existing"; id: string }
  | { kind: "new" }
  | null;

type Form = { name: string; subject: string; body: string };

const EMPTY_FORM: Form = { name: "", subject: "", body: "" };

/** Templates below this count read fine unsorted; above it, searching helps. */
const SEARCH_THRESHOLD = 5;

function formFromTemplate(t: MailTemplate): Form {
  return { name: t.name, subject: t.subjectTemplate, body: t.bodyHtml };
}

function sameForm(a: Form, b: Form): boolean {
  return a.name === b.name && a.subject === b.subject && a.body === b.body;
}

export function MailTemplatesButton({
  subject,
  bodyHtml,
  canSetSubject = true,
  draftIsEmpty,
  onApply,
  variables = COMPOSE_VARIABLES,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  // The list is only fetched once the modal has been opened — see useMailTemplates.
  const { templates, loading, error, configured, create, update, remove, touch } =
    useMailTemplates(open);

  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  /** The form as last loaded or saved, for dirty detection. */
  const [baseline, setBaseline] = useState<Form>(EMPTY_FORM);
  /**
   * Selection the user asked for while holding unsaved edits. Wrapped, because
   * `null` is itself a valid Selection — the bare value could not tell
   * "switch to nothing" apart from "nothing pending".
   */
  const [pendingSelection, setPendingSelection] = useState<{ next: Selection } | null>(null);
  /** Row awaiting a replace/append choice, when the draft already has content. */
  const [applying, setApplying] = useState<MailTemplate | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const dirty = !sameForm(form, baseline);

  /**
   * What gets stored as a template's subject when captured from the draft.
   * Empty in a reply composer: the subject there belongs to the thread
   * ("Re: Campus drive — final list"), so capturing it would bake one
   * conversation's subject into a template that can never apply it anyway.
   */
  const draftSubject = canSetSubject ? subject : "";

  const loadSelection = useCallback(
    (next: Selection, seed?: Form) => {
      setSelection(next);
      setConfirmDelete(false);
      setActionError(null);
      const nextForm =
        seed ??
        (next?.kind === "existing"
          ? (() => {
              const found = templates.find((x) => x.id === next.id);
              return found ? formFromTemplate(found) : EMPTY_FORM;
            })()
          : EMPTY_FORM);
      setForm(nextForm);
      setBaseline(nextForm);
    },
    [templates]
  );

  /** Guarded selection change — unsaved edits get a say first. */
  const requestSelection = useCallback(
    (next: Selection, seed?: Form) => {
      if (dirty) {
        setPendingSelection({ next });
        // The seed only matters for "new from draft", which is never the target
        // of a guarded switch — it always starts from a clean form.
        return;
      }
      loadSelection(next, seed);
    },
    [dirty, loadSelection]
  );

  const close = useCallback(() => {
    setOpen(false);
    setSelection(null);
    setForm(EMPTY_FORM);
    setBaseline(EMPTY_FORM);
    setPendingSelection(null);
    setApplying(null);
    setConfirmDelete(false);
    setActionError(null);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Stops the inbox's own Escape handler closing the open thread behind
      // this modal. Unsaved edits keep the modal open rather than vanishing.
      e.stopPropagation();
      if (dirty) {
        setPendingSelection(null);
        setActionError("Save or discard your changes first.");
        return;
      }
      close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, dirty]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.subjectTemplate.toLowerCase().includes(q)
    );
  }, [templates, query]);

  async function runAction(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const input = {
      name: form.name.trim(),
      subjectTemplate: form.subject,
      bodyHtml: form.body,
    };
    const invalid = validateMailTemplateInput(input);
    if (invalid) {
      setActionError(invalid);
      return false;
    }
    if (selection?.kind === "existing") {
      const ok = await runAction(() => update(selection.id, input));
      if (ok) setBaseline(form);
      return ok;
    }
    let createdId: string | null = null;
    const ok = await runAction(async () => {
      const created = await create(input);
      createdId = created.id;
    });
    if (ok && createdId) {
      // Stay on what was just written, now as a saved template, so a second
      // edit does not create a duplicate.
      setSelection({ kind: "existing", id: createdId });
      setBaseline(form);
    }
    return ok;
  }

  function apply(template: MailTemplate, mode: TemplateApplyMode) {
    onApply(template, mode);
    touch(template.id);
    close();
  }

  function requestApply(template: MailTemplate) {
    // An empty draft has nothing to lose, so the click is the whole gesture.
    if (draftIsEmpty) return apply(template, "replace");
    setApplying(template);
  }

  const selected =
    selection?.kind === "existing"
      ? templates.find((x) => x.id === selection.id) ?? null
      : null;

  return (
    <>
      {/* A labelled control, not a bare icon: nothing about a glyph in a row of
          glyphs says "your saved emails live here". Shaped like the footer's
          other labelled action (Review mail) rather than its icon buttons. */}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="ml-0.5 flex shrink-0 items-center gap-1.5 rounded-full border border-[#dadce0] px-3 py-[6px] text-[13px] font-medium leading-none text-[#3c4043] transition-colors hover:bg-[#e8eaed] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FileText className="h-4 w-4" strokeWidth={2} />
        Templates
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (dirty) {
                  setActionError("Save or discard your changes first.");
                  return;
                }
                close();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Mail templates"
                onMouseDown={(e) => e.stopPropagation()}
                className="card flex w-full max-w-[880px] flex-col overflow-hidden p-0 shadow-[var(--shadow-lg)]"
                style={{ height: "min(640px, calc(100vh - 64px))" }}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[var(--color-text)]">
                      {titleCase("Mail templates")}
                    </h2>
                    <p className="mt-0.5 text-[12px] text-[var(--color-text-faint)]">
                      Only you can see these. Use one in the draft you have open, or write a new
                      one here.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (dirty) {
                        setActionError("Save or discard your changes first.");
                        return;
                      }
                      close();
                    }}
                    className="btn-ghost shrink-0"
                  >
                    Close
                  </button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                  {/* ── Library ─────────────────────────────────────────── */}
                  <div className="flex min-h-0 shrink-0 flex-col border-b border-[var(--color-border)] sm:w-[260px] sm:border-b-0 sm:border-r">
                    <div className="shrink-0 space-y-2 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => requestSelection({ kind: "new" })}
                        className="flex w-full items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        {titleCase("New template")}
                      </button>
                      {/* Captures the mail already on screen, which is how most
                          templates actually come about — written once for a real
                          recipient, then wanted again. */}
                      <button
                        type="button"
                        disabled={draftIsEmpty}
                        title={
                          draftIsEmpty
                            ? "Write a subject or body in the draft first"
                            : undefined
                        }
                        onClick={() =>
                          requestSelection(
                            { kind: "new" },
                            {
                              name: suggestedTemplateName(draftSubject),
                              subject: draftSubject,
                              body: bodyHtml,
                            }
                          )
                        }
                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {titleCase("New from current draft")}
                      </button>
                    </div>

                    {templates.length > SEARCH_THRESHOLD ? (
                      <div className="flex shrink-0 items-center gap-2 border-y border-[var(--color-border)] px-3 py-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search templates"
                          className="w-full bg-transparent text-[13px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
                        />
                      </div>
                    ) : null}

                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {loading ? (
                        <p className="flex items-center gap-2 px-3 py-4 text-[12px] text-[var(--color-text-muted)]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading…
                        </p>
                      ) : !configured ? (
                        <p className="px-3 py-4 text-[12px] leading-snug text-[var(--color-text-muted)]">
                          Templates need migration 0067_mail_templates.sql to be applied.
                        </p>
                      ) : error ? (
                        <p className="px-3 py-4 text-[12px] leading-snug text-[var(--color-text-muted)]">
                          {error}
                        </p>
                      ) : filtered.length === 0 ? (
                        <p className="px-3 py-4 text-[12px] leading-snug text-[var(--color-text-muted)]">
                          {templates.length === 0
                            ? "No templates yet."
                            : "No template matches that search."}
                        </p>
                      ) : (
                        <ul className="pb-2">
                          {filtered.map((item) => {
                            const active =
                              selection?.kind === "existing" && selection.id === item.id;
                            return (
                              <li key={item.id}>
                                {/* Two actions per row, not one: opening a
                                    template to read or edit it and dropping it
                                    into the draft are different intents, and
                                    making the common one (use it) wait behind a
                                    select-then-confirm would be a step backwards
                                    from a plain picker. */}
                                <div
                                  className={cn(
                                    "group flex items-center border-l-2 transition-colors",
                                    active
                                      ? "border-[var(--color-copper)] bg-[var(--color-surface-offset)]"
                                      : "border-transparent hover:bg-[var(--color-surface-offset)]"
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      requestSelection({ kind: "existing", id: item.id })
                                    }
                                    className="min-w-0 flex-1 px-3 py-2 text-left"
                                  >
                                    <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">
                                      {item.name}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-faint)]">
                                      {(canSetSubject && item.subjectTemplate.trim()) ||
                                        cleanMailSnippet(item.bodyHtml) ||
                                        "Empty"}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    title={`Use ${item.name} in the draft`}
                                    onClick={() => {
                                      // Unsaved edits to another template are not
                                      // this template's problem, but leaving the
                                      // modal would strand them — so ask first.
                                      if (dirty) {
                                        setActionError("Save or discard your changes first.");
                                        return;
                                      }
                                      requestApply(item);
                                    }}
                                    // Always visible, not hover-revealed: there
                                    // is no hover on a touch screen, and an
                                    // invisible-but-tappable control is worse
                                    // than a quiet one.
                                    className="mr-2 shrink-0 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                                  >
                                    Use
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* ── Editor ──────────────────────────────────────────── */}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {selection === null ? (
                      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                        <FileText
                          className="h-7 w-7 text-[var(--color-text-faint)]"
                          strokeWidth={1.5}
                        />
                        <p className="mt-3 text-[13px] font-medium text-[var(--color-text)]">
                          {templates.length === 0
                            ? "Write your first template"
                            : "Pick a template to use or edit"}
                        </p>
                        <p className="mt-1 max-w-[320px] text-[12px] leading-snug text-[var(--color-text-faint)]">
                          Templates hold a subject and a body. Placeholders like{" "}
                          <code className="rounded bg-[var(--color-surface-2)] px-1">
                            {"{name}"}
                          </code>{" "}
                          are filled in per recipient when the draft merges them.
                        </p>
                      </div>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                          <label className="mb-1 block text-[11.5px] font-medium text-[var(--color-text-muted)]">
                            {titleCase("Template name")}
                          </label>
                          <input
                            value={form.name}
                            maxLength={MAIL_TEMPLATE_NAME_MAX}
                            placeholder="e.g. Recruiter intro"
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            className="h-11 w-full rounded-xl border border-transparent bg-[var(--color-surface-2)] px-4 text-[14px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]"
                          />

                          {/* Hidden where the host can't apply a subject: a field
                              that saves a value nothing will ever use is worse
                              than no field. */}
                          {canSetSubject ? (
                            <>
                              <label className="mb-1 mt-3 block text-[11.5px] font-medium text-[var(--color-text-muted)]">
                                {titleCase("Subject")}
                              </label>
                              <SubjectWithVariables
                                theme="app"
                                value={form.subject}
                                onChange={(next) => setForm((f) => ({ ...f, subject: next }))}
                                variables={variables}
                                placeholder="e.g. Quick question about {company_name}"
                              />
                            </>
                          ) : null}

                          <label className="mb-1 mt-3 block text-[11.5px] font-medium text-[var(--color-text-muted)]">
                            {titleCase("Body")}
                          </label>
                          {/* Same editor as the composer, so a template is written
                              with the formatting and `{` picker it will be used
                              with. Its variable menu portals at z-[1000] like this
                              modal and mounts after it, so it paints above. */}
                          <RichTextEditor
                            // An explicit writing area: the editor's root is a
                            // flex column with min-h-0, so in this block-flow
                            // scroll container an empty body would render as a
                            // single line under a full formatting toolbar.
                            className="min-h-[220px] rounded-xl border border-[var(--color-border)] overflow-hidden"
                            value={form.body}
                            onChange={(html) => setForm((f) => ({ ...f, body: html }))}
                            placeholder="Hi {name}, …"
                            variables={variables}
                          />
                      </div>
                    )}

                    {actionError ? (
                          <p className="shrink-0 border-t border-[var(--color-border)] px-4 py-2 text-[12px] leading-snug text-[var(--color-danger)]">
                            {actionError}
                          </p>
                        ) : null}

                        {/* Replace/append is asked here rather than on click,
                            because overwriting a written draft is the one
                            destructive thing this modal can do. */}
                        {applying ? (
                          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
                            <p className="text-[12px] leading-snug text-[var(--color-text-muted)]">
                              Your draft already has content. Replace it, or add “{applying.name}”
                              below what you have written?
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => apply(applying, "replace")}
                                className="btn-primary-copper"
                              >
                                Replace draft
                              </button>
                              <button
                                type="button"
                                onClick={() => apply(applying, "append")}
                                className="btn-ghost border border-[var(--color-border)]"
                              >
                                Add below
                              </button>
                              <button
                                type="button"
                                onClick={() => setApplying(null)}
                                className="btn-ghost"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : confirmDelete && selected ? (
                          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
                            <p className="text-[12px] text-[var(--color-text-muted)]">
                              Delete “{selected.name}”? This cannot be undone.
                            </p>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void runAction(() => remove(selected.id)).then((ok) => {
                                    if (!ok) return;
                                    setConfirmDelete(false);
                                    loadSelection(null);
                                  })
                                }
                                className="btn-ghost font-medium text-[var(--color-danger)]"
                              >
                                Delete template
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(false)}
                                className="btn-ghost"
                              >
                                Keep
                              </button>
                            </div>
                          </div>
                        ) : pendingSelection ? (
                          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
                            <p className="text-[12px] text-[var(--color-text-muted)]">
                              You have unsaved changes to this template.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void save().then((ok) => {
                                    if (!ok) return;
                                    const { next } = pendingSelection;
                                    setPendingSelection(null);
                                    loadSelection(next);
                                  })
                                }
                                className="btn-primary-copper"
                              >
                                Save and switch
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const { next } = pendingSelection;
                                  setPendingSelection(null);
                                  loadSelection(next);
                                }}
                                className="btn-ghost border border-[var(--color-border)]"
                              >
                                Discard changes
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingSelection(null)}
                                className="btn-ghost"
                              >
                                Keep editing
                              </button>
                            </div>
                          </div>
                        ) : selection !== null ? (
                          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-4 py-3">
                            <button
                              type="button"
                              disabled={busy || !dirty || !form.name.trim()}
                              onClick={() => void save()}
                              className="btn-primary-copper inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-50"
                            >
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              {selection.kind === "new" ? "Save template" : "Save changes"}
                            </button>

                            {/* Reverting shouldn't require navigating away and
                                back through the unsaved-changes prompt. */}
                            {dirty ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setForm(baseline);
                                  setActionError(null);
                                }}
                                className="btn-ghost"
                              >
                                Discard
                              </button>
                            ) : null}

                            {/* Only an already-saved template can go into the
                                draft — "use" on unsaved edits would insert
                                something the library does not contain. */}
                            {selected ? (
                              <button
                                type="button"
                                disabled={dirty}
                                title={
                                  dirty ? "Save your changes before using this template" : undefined
                                }
                                onClick={() => requestApply(selected)}
                                className="btn-ghost border border-[var(--color-border)] font-medium disabled:pointer-events-none disabled:opacity-50"
                              >
                                Use in draft
                              </button>
                            ) : null}

                            <span className="flex-1" />

                            {dirty ? (
                              <span className="text-[11.5px] text-[var(--color-text-faint)]">
                                Unsaved changes
                              </span>
                            ) : null}

                            {selected ? (
                              <button
                                type="button"
                                aria-label={`Delete ${selected.name}`}
                                title="Delete template"
                                onClick={() => setConfirmDelete(true)}
                                className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-danger)]"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={2} />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
