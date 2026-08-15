"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  filterComposeVariables,
  VARIABLE_SPAN_CLASS,
  COMPOSE_VARIABLES,
  type ComposeVariable,
} from "@/lib/compose-variables";

export type SubjectHandle = {
  /** Insert `{` at the caret and open the picker. */
  insertVariableTrigger: () => void;
  isFocused: () => boolean;
};

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** When non-empty, `{` opens the picker and known variables are tinted. */
  variables?: ComposeVariable[];
};

/** Same trigger rule as the body editor: an unterminated `{query` before the caret. */
function findTrigger(text: string, caret: number): { braceIndex: number; query: string } | null {
  const before = text.slice(0, caret);
  const braceIndex = before.lastIndexOf("{");
  if (braceIndex === -1) return null;
  const query = before.slice(braceIndex + 1);
  if (/[}{]/.test(query)) return null;
  if (query.length > 40 || /\s{2,}/.test(query)) return null;
  return { braceIndex, query };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Plain subject text → display HTML with known `{variables}` tinted. */
function renderHtml(text: string, tint: boolean): string {
  const escaped = escapeHtml(text);
  if (!tint) return escaped;
  const keys = COMPOSE_VARIABLES.map((v) => v.key).join("|");
  if (!keys) return escaped;
  return escaped.replace(
    new RegExp(`\\{(${keys})\\}`, "g"),
    `<span class="${VARIABLE_SPAN_CLASS}">{$1}</span>`
  );
}

/**
 * Caret position as an offset into the element's plain text.
 *
 * Every edit in this component is expressed in plain-text offsets rather than
 * DOM nodes — the tinting spans mean the node structure is rebuilt on each
 * keystroke, so a node-based caret reference would be stale immediately.
 */
function getCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/** Place the caret at a plain-text offset, walking the rebuilt text nodes. */
function setCaretOffset(root: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node: Text | null = null;

  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    const len = t.textContent?.length ?? 0;
    if (remaining <= len) {
      node = t;
      break;
    }
    remaining -= len;
    node = t;
  }

  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (node) {
    range.setStart(node, Math.max(0, Math.min(remaining, node.textContent?.length ?? 0)));
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Subject line with the body editor's `{` picker and variable tinting.
 *
 * A contentEditable rather than an <input> because an input renders plain text
 * only and cannot colour a substring. The value emitted upward stays plain
 * text, so the subject header, draft autosave and window title are unaffected.
 */
export const SubjectWithVariables = forwardRef<SubjectHandle, Props>(
  function SubjectWithVariables({ value, onChange, placeholder, variables }, ref) {
    const enabled = (variables?.length ?? 0) > 0;
    const elRef = useRef<HTMLDivElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const triggerRef = useRef<{ braceIndex: number; query: string } | null>(null);

    const [menu, setMenu] = useState<{ matches: ComposeVariable[]; index: number } | null>(null);
    const [empty, setEmpty] = useState(!value);

    // Re-render only when the text genuinely differs — otherwise every parent
    // render would rebuild the DOM and drop the caret mid-typing.
    useEffect(() => {
      const el = elRef.current;
      if (!el) return;
      if ((el.textContent ?? "") !== value) {
        el.innerHTML = renderHtml(value, enabled);
      }
      setEmpty(!value);
    }, [value, enabled]);

    useEffect(() => {
      if (!menu) return;
      function onDoc(e: MouseEvent) {
        if (!wrapRef.current?.contains(e.target as Node)) setMenu(null);
      }
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, [menu]);

    useImperativeHandle(ref, () => ({
      insertVariableTrigger: () => {
        const el = elRef.current;
        if (!el) return;
        el.focus();
        document.execCommand("insertText", false, "{");
        handleInput();
      },
      isFocused: () => !!elRef.current && document.activeElement === elRef.current,
    }));

    function syncMenu(plain: string, caret: number) {
      if (!enabled) return;
      const trigger = findTrigger(plain, caret);
      triggerRef.current = trigger;
      if (!trigger) {
        setMenu(null);
        return;
      }
      const matches = filterComposeVariables(trigger.query);
      if (matches.length === 0) {
        setMenu(null);
        return;
      }
      setMenu((prev) => ({
        matches,
        index: prev ? Math.min(prev.index, matches.length - 1) : 0,
      }));
    }

    /** Re-tint and emit, preserving the caret across the DOM rebuild. */
    function handleInput() {
      const el = elRef.current;
      if (!el) return;

      const plain = el.textContent ?? "";
      setEmpty(!plain);

      // Mid-composition (IME) the text is not final — emit but never rebuild
      // the DOM, which would cancel the composition.
      if (composingRef.current) {
        onChange(plain);
        return;
      }

      const caret = getCaretOffset(el);
      const html = renderHtml(plain, enabled);
      if (el.innerHTML !== html) {
        el.innerHTML = html;
        setCaretOffset(el, caret);
      }
      onChange(plain);
      syncMenu(plain, caret);
    }

    function insert(v: ComposeVariable) {
      const el = elRef.current;
      const trigger = triggerRef.current;
      if (!el || !trigger) return;

      const plain = el.textContent ?? "";
      const caret = getCaretOffset(el);
      const token = `{${v.key}} `;
      const next = plain.slice(0, trigger.braceIndex) + token + plain.slice(caret);

      el.innerHTML = renderHtml(next, enabled);
      setCaretOffset(el, trigger.braceIndex + token.length);
      setEmpty(!next);
      onChange(next);

      setMenu(null);
      triggerRef.current = null;
    }

    /**
     * Delete a whole `{variable}` in one keystroke.
     *
     * A merge token is a single thing to the user, so chewing through it a
     * character at a time — and leaving broken fragments like `{nam` that
     * silently stop matching — is the wrong model. Returns true if it handled
     * the key.
     */
    function deleteVariableToken(back: boolean): boolean {
      const el = elRef.current;
      if (!el || !enabled) return false;

      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed) return false;

      const plain = el.textContent ?? "";
      const caret = getCaretOffset(el);
      const re = new RegExp(`\\{(${COMPOSE_VARIABLES.map((v) => v.key).join("|")})\\}`, "g");

      let m: RegExpExecArray | null;
      while ((m = re.exec(plain)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        // Backspace: caret sits inside or just after the token.
        // Delete: caret sits inside or just before it.
        const hit = back ? caret > start && caret <= end : caret >= start && caret < end;
        if (!hit) continue;

        const next = plain.slice(0, start) + plain.slice(end);
        el.innerHTML = renderHtml(next, enabled);
        setCaretOffset(el, start);
        setEmpty(!next);
        onChange(next);
        setMenu(null);
        return true;
      }
      return false;
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (e.key === "Backspace" || e.key === "Delete") {
        if (deleteVariableToken(e.key === "Backspace")) {
          e.preventDefault();
          return;
        }
      }

      // Single-line field: never let Enter insert a break.
      if (e.key === "Enter" && !menu) {
        e.preventDefault();
        return;
      }
      if (!menu) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setMenu((m) =>
          m ? { ...m, index: (m.index + delta + m.matches.length) % m.matches.length } : m
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insert(menu.matches[menu.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
      }
    }

    // Without variables there is nothing to tint or pick, so keep the plain
    // input the reply composer has always used rather than swapping in a
    // contentEditable it gains nothing from.
    if (!enabled) {
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border-0 bg-transparent text-[15px] font-normal text-[#202124] outline-none placeholder:text-[#70757a]"
        />
      );
    }

    return (
      <div ref={wrapRef} className="relative w-full">
        {empty && placeholder && (
          <span className="pointer-events-none absolute left-0 top-0 select-none text-[15px] text-[#70757a]">
            {placeholder}
          </span>
        )}
        <div
          ref={elRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={placeholder || "Subject"}
          onInput={handleInput}
          onKeyDown={onKeyDown}
          onKeyUp={() => {
            const el = elRef.current;
            if (el) syncMenu(el.textContent ?? "", getCaretOffset(el));
          }}
          onMouseUp={() => {
            const el = elRef.current;
            if (el) syncMenu(el.textContent ?? "", getCaretOffset(el));
          }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; handleInput(); }}
          onPaste={(e) => {
            // Plain text only — a pasted subject must not carry markup.
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain").replace(/[\r\n]+/g, " ");
            document.execCommand("insertText", false, text);
          }}
          className="w-full whitespace-pre-wrap break-words text-[15px] font-normal text-[#202124] outline-none [&_.cv-var]:rounded [&_.cv-var]:bg-[#e8f0fe] [&_.cv-var]:px-1 [&_.cv-var]:py-px [&_.cv-var]:font-medium [&_.cv-var]:text-[#1967d2]"
        />

        {menu && (
          <div
            className="absolute left-0 top-full z-[1000] mt-1 max-h-[260px] w-[264px] overflow-y-auto rounded-lg border border-[#dadce0] bg-white py-1 shadow-[0_4px_16px_rgba(60,64,67,0.28)]"
            role="listbox"
            aria-label="Insert variable"
          >
            <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#70757a]">
              Insert variable
            </p>
            {menu.matches.map((v, i) => (
              <button
                key={v.key}
                type="button"
                role="option"
                aria-selected={i === menu.index}
                onMouseDown={(e) => { e.preventDefault(); insert(v); }}
                onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left ${
                  i === menu.index ? "bg-[#e8f0fe]" : "hover:bg-[#f1f3f4]"
                }`}
              >
                <span className="text-[13px] font-medium text-[#202124]">{v.label}</span>
                <span className="text-[11px] text-[#5f6368]">
                  {`{${v.key}}`} · {v.hint}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);
