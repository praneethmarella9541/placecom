"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ATTRIBUTE_TYPES, type AttributeType } from "@/lib/data-model/types";
import type { AttributeDef } from "@/lib/data-model/types";
import { dataApi, type ObjectsResponse } from "@/lib/data-model/client";

const TYPE_LABELS: Record<AttributeType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  currency: "Currency",
  checkbox: "Checkbox",
  date: "Date",
  timestamp: "Date and time",
  rating: "Rating (1 to 5)",
  select: "Select (one option)",
  multi_select: "Select (several options)",
  email: "Email",
  phone: "Phone",
  url: "Web link",
  domain: "Domain",
  record_ref: "Link to another record",
  member: "Team member",
};

/**
 * Admin: add, rename or hide fields. Works on an object's fields (`base` = /api/data/objects/people)
 * or on a list's entry fields (`base` = /api/data/lists/<id>). For an object, `names` also lets the
 * admin rename the object itself.
 */
export function AttributesModal({
  title,
  base,
  attributes,
  objects,
  names,
  staffAccess,
  highlights,
  objectSlug,
  isSystemObject,
  onChanged,
  onClose,
}: {
  title: string;
  base: string;
  attributes: AttributeDef[];
  objects: ObjectsResponse["objects"];
  names?: { singular: string; plural: string };
  /** What staff may do with this object (admin only; objects, not lists). */
  staffAccess?: "none" | "read" | "write";
  /** Field slugs pinned to the top of every record page (objects only). */
  highlights?: string[];
  /** When set, an admin may delete this (custom, empty) object from here. */
  objectSlug?: string;
  isSystemObject?: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AttributeType>("text");
  const [multi, setMulti] = useState(false);
  const [options, setOptions] = useState("");
  const [target, setTarget] = useState(objects[0]?.slug ?? "people");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const custom = attributes.filter((a) => !a.is_system);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newRequired, setNewRequired] = useState(false);
  const [newDefault, setNewDefault] = useState("");
  const [required, setRequired] = useState(false);
  const [defaultText, setDefaultText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [singular, setSingular] = useState(names?.singular ?? "");
  const [plural, setPlural] = useState(names?.plural ?? "");
  const canMulti = !["checkbox", "rating", "long_text", "multi_select"].includes(type);

  async function add() {
    setBusy("add");
    setError(null);
    const r = await dataApi(`${base}/attributes`, {
      method: "POST",
      body: {
        name,
        type,
        isMulti: canMulti && multi,
        options: options.split(/[,\n]/).map((o) => o.trim()).filter(Boolean),
        targetObject: target,
        isRequired: required,
        defaultValue: defaultText.trim() ? (type === "checkbox" ? defaultText === "true" : defaultText.trim()) : undefined,
      },
    });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setName("");
    setOptions("");
    setRequired(false);
    setDefaultText("");
    onChanged();
  }

  async function setArchived(slug: string, archived: boolean) {
    setBusy(slug);
    setError(null);
    const r = await dataApi(`${base}/attributes/${slug}`, { method: "PATCH", body: { archived } });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onChanged();
  }

  async function rename(slug: string) {
    setBusy(slug);
    setError(null);
    const r = await dataApi(`${base}/attributes/${slug}`, { method: "PATCH", body: { name: newName, isRequired: newRequired, defaultValue: newDefault.trim() ? newDefault.trim() : null } });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setRenaming(null);
    onChanged();
  }

  async function saveHighlights(next: string[]) {
    setBusy("highlights");
    setError(null);
    const r = await dataApi(base, { method: "PATCH", body: { highlights: next } });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onChanged();
  }

  async function deleteObject() {
    setBusy("delete");
    setError(null);
    const r = await dataApi(base, { method: "DELETE" });
    setBusy(null);
    setConfirmDelete(false);
    if (!r.ok) return setError(r.error);
    onChanged();
    onClose();
  }

  async function saveAccess(value: string) {
    setBusy("access");
    setError(null);
    const r = await dataApi(base, { method: "PATCH", body: { staffAccess: value } });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onChanged();
  }

  async function saveNames() {
    setBusy("names");
    setError(null);
    const r = await dataApi(base, { method: "PATCH", body: { singularName: singular, pluralName: plural } });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onChanged();
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-label={title} className="card flex max-h-[90vh] w-full max-w-[520px] flex-col shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          {names && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveNames();
              }}
            >
              <div className="min-w-[120px] flex-1">
                <label htmlFor="obj-singular" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Called (one)</label>
                <input id="obj-singular" value={singular} onChange={(e) => setSingular(e.target.value)} maxLength={40} className="input-field h-9 text-[13px]" />
              </div>
              <div className="min-w-[120px] flex-1">
                <label htmlFor="obj-plural" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Called (many)</label>
                <input id="obj-plural" value={plural} onChange={(e) => setPlural(e.target.value)} maxLength={40} className="input-field h-9 text-[13px]" />
              </div>
              <button type="submit" disabled={busy !== null || !singular.trim() || !plural.trim() || (singular === names.singular && plural === names.plural)} className="btn-ghost h-9 px-3 text-[12.5px]">
                Rename
              </button>
            </form>
          )}
          {names && staffAccess !== undefined && (
            <div>
              <label htmlFor="obj-access" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">What staff can do</label>
              <select id="obj-access" value={staffAccess} disabled={busy !== null} onChange={(e) => void saveAccess(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
                <option value="write">View and edit</option>
                <option value="read">View only</option>
                <option value="none">No access (hidden)</option>
              </select>
              <p className="mt-1 text-[12px] text-[var(--color-text-faint)]">Admins can always do everything. Lists built on this object follow it.</p>
            </div>
          )}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <p className="text-[12.5px] text-[var(--color-text-muted)]">
              Add a field. Records you already have stay as they are, with this field empty.
            </p>
            <div>
              <label htmlFor="attr-name" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Field name</label>
              <input id="attr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Graduation year" className="input-field h-9 text-[13px]" />
            </div>
            <div>
              <label htmlFor="attr-type" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Type</label>
              <select id="attr-type" value={type} onChange={(e) => setType(e.target.value as AttributeType)} className="input-field select-chevron h-9 text-[13px]">
                {ATTRIBUTE_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            {(type === "select" || type === "multi_select") && (
              <div>
                <label htmlFor="attr-options" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Options (comma separated)</label>
                <input id="attr-options" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Hot, Warm, Cold" className="input-field h-9 text-[13px]" />
              </div>
            )}
            {type === "record_ref" && (
              <div>
                <label htmlFor="attr-target" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Points at</label>
                <select id="attr-target" value={target} onChange={(e) => setTarget(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
                  {objects.map((o) => (
                    <option key={o.slug} value={o.slug}>{o.plural_name}</option>
                  ))}
                </select>
              </div>
            )}
            {canMulti && (
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
                Allow several values
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {type !== "record_ref" && type !== "member" && (
                <div>
                  <label htmlFor="attr-default" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Default value (optional)</label>
                  {type === "checkbox" ? (
                    <select id="attr-default" value={defaultText} onChange={(e) => setDefaultText(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
                      <option value="">None</option>
                      <option value="true">Checked</option>
                      <option value="false">Not checked</option>
                    </select>
                  ) : (
                    <input id="attr-default" value={defaultText} onChange={(e) => setDefaultText(e.target.value)} className="input-field h-9 text-[13px]" />
                  )}
                </div>
              )}
              <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                Required on new records
              </label>
            </div>
            <button type="submit" disabled={busy !== null || !name.trim()} className="btn-primary-copper inline-flex items-center gap-2">
              {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}
              Add field
            </button>
          </form>

          {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}

          <div>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Your fields</h3>
            {custom.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">None yet. Built-in fields can&apos;t be removed.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                {custom.map((a) => (
                  <li key={a.slug} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    {renaming === a.slug ? (
                      <form
                        className="flex flex-1 items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void rename(a.slug);
                        }}
                      >
                        <input aria-label={`New name for ${a.name}`} autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} className="input-field h-8 min-w-[120px] flex-1 text-[13px]" />
                        {a.type !== "record_ref" && a.type !== "member" && a.type !== "checkbox" && (
                          <input aria-label={`Default for ${a.name}`} value={newDefault} onChange={(e) => setNewDefault(e.target.value)} placeholder="Default" className="input-field h-8 w-[110px] text-[13px]" />
                        )}
                        <label className="flex items-center gap-1 whitespace-nowrap text-[12px]"><input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} /> Required</label>
                        <button type="submit" disabled={busy !== null || !newName.trim()} className="btn-primary-copper h-8 px-2.5 text-[12.5px]">Save</button>
                        <button type="button" onClick={() => setRenaming(null)} className="btn-ghost h-8 px-2 text-[12.5px]">Cancel</button>
                      </form>
                    ) : (
                      <>
                        <span className={a.archived_at ? "text-[var(--color-text-faint)] line-through" : ""}>
                          {a.name} <span className="text-[var(--color-text-faint)]">· {TYPE_LABELS[a.type]}{a.is_required ? " · required" : ""}{a.config.default !== undefined ? " · has default" : ""}</span>
                        </span>
                        <span className="flex gap-3">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => {
                              setRenaming(a.slug);
                              setNewName(a.name);
                              setNewRequired(a.is_required);
                              setNewDefault(a.config.default === undefined || a.config.default === null ? "" : Array.isArray(a.config.default) ? a.config.default.join(", ") : String(a.config.default));
                            }}
                            className="text-[12.5px] font-semibold text-[var(--color-text-muted)] underline"
                          >
                            Edit
                          </button>
                          <button type="button" disabled={busy !== null} onClick={() => void setArchived(a.slug, !a.archived_at)} className="text-[12.5px] font-semibold text-[var(--color-text-muted)] underline">
                            {a.archived_at ? "Show again" : "Hide"}
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-[var(--color-text-faint)]">Hiding a field keeps what was entered; showing it again brings it back.</p>
          </div>

          {highlights !== undefined && (
            <div>
              <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Highlights</h3>
              <p className="mb-2 text-[12px] text-[var(--color-text-faint)]">Up to six fields shown at the top of every record page.</p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {attributes.filter((a) => !a.archived_at).map((a) => {
                  const on = highlights.includes(a.slug);
                  return (
                    <li key={a.slug}>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={on} disabled={busy !== null || (!on && highlights.length >= 6)} onChange={() => void saveHighlights(on ? highlights.filter((h) => h !== a.slug) : [...highlights, a.slug])} />
                        {a.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {objectSlug && isSystemObject === false && (
            <div className="border-t border-[var(--color-border)] pt-3">
              <button type="button" disabled={busy !== null} onClick={() => setConfirmDelete(true)} className="text-[12.5px] font-semibold text-[var(--color-danger)] underline">
                Delete this object
              </button>
              <p className="mt-1 text-[12px] text-[var(--color-text-faint)]">Only an empty object can be deleted: no records, no lists. Needs &ldquo;Allow delete&rdquo; in /configs.</p>
            </div>
          )}
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this object?"
          body="Its fields, saved views and rules are deleted with it. This can't be undone from the app."
          confirmLabel="Delete"
          tone="danger"
          busy={busy === "delete"}
          onConfirm={() => void deleteObject()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>,
    document.body
  );
}
