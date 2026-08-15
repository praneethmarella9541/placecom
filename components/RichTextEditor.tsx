"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, Link as LinkIcon,
} from "lucide-react";
import {
  filterComposeVariables,
  wrapVariablesInHtml,
  VARIABLE_SPAN_CLASS,
  type ComposeVariable,
} from "@/lib/compose-variables";

export function richTextIsEmpty(html: string): boolean {
  const stripped = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<p[^>]*><\/p>/gi, "")
    .replace(/<div[^>]*><\/div>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return stripped.length === 0;
}

export type RichTextEditorHandle = {
  insertLink: () => void;
  /** Insert `{` at the caret and open the variable picker. */
  insertVariableTrigger: () => void;
  isFocused: () => boolean;
};

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /**
   * When non-empty, typing `{` opens a merge-variable picker. Left undefined
   * everywhere except mass-send compose, so ordinary emails containing a brace
   * (code snippets, JSON) behave exactly as before.
   */
  variables?: ComposeVariable[];
};

/** Caret context for an in-progress `{query` the user is typing. */
type VariableTrigger = {
  node: Text;
  /** Offset of the opening `{` within the text node. */
  braceOffset: number;
  /** Caret offset within the text node. */
  caretOffset: number;
  query: string;
};

/**
 * Find an unterminated `{query` immediately before the caret.
 *
 * Scoped to the caret's own text node and stops at whitespace-heavy or closing
 * characters, so `{` typed in prose without a following variable never leaves a
 * menu hanging open, and an already-closed `{name}` is not re-triggered.
 */
function findVariableTrigger(): VariableTrigger | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent ?? "";
  const caretOffset = sel.anchorOffset;
  const before = text.slice(0, caretOffset);

  const braceOffset = before.lastIndexOf("{");
  if (braceOffset === -1) return null;

  const query = before.slice(braceOffset + 1);
  // A closed placeholder or a brace used as punctuation — not an active trigger.
  if (/[}{\n]/.test(query)) return null;
  // Allow spaces so "company na" still matches, but bail once it reads as prose.
  if (query.length > 40 || /\s{2,}/.test(query)) return null;

  return { node: node as Text, braceOffset, caretOffset, query };
}

type FormatCmd =
  | "bold" | "italic" | "underline" | "strikeThrough"
  | "insertUnorderedList" | "insertOrderedList";

const TRACKED_COMMANDS: FormatCmd[] = [
  "bold", "italic", "underline", "strikeThrough",
  "insertUnorderedList", "insertOrderedList",
];

const FONTS = ["Sans Serif", "Serif", "Fixed width", "Wide", "Narrow", "Comic Sans MS", "Garamond", "Georgia", "Tahoma", "Trebuchet MS", "Verdana"];
const FONT_MAP: Record<string, string> = {
  "Sans Serif": "Arial, sans-serif",
  "Serif": "Georgia, serif",
  "Fixed width": "Courier New, monospace",
  "Wide": "Arial Black, sans-serif",
  "Narrow": "Arial Narrow, sans-serif",
};

const SIZES = [
  { label: "Small", value: "1" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "5" },
  { label: "Huge", value: "7" },
];

const COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#ffffff",
  "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff",
  "#ff00ff", "#e6b8a2", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8",
  "#ead1dc", "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4",
  "#e07e9c", "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6fa8dc",
  "#c27ba0", "#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3d85c8",
  "#a64d79", "#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc",
  "#4c1130",
];

const BG_COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#ffffff",
  "#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff",
];

// Frequently used emoji
const EMOJI_GROUPS = [
  { label: "Smileys", emojis: ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥸","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖"] },
  { label: "Gestures", emojis: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🙏","✍️","💅","🤳","💪","🦾","🦿","🦵","🦶","👂","🦻","👃","👀","👁️","👅","👄","💋","🫀","🫁","🧠","🦷","🦴"] },
  { label: "Hearts", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉️","✡️","🔯","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓"] },
  { label: "Objects", emojis: ["📎","📏","📐","✂️","🗃️","🗄️","🗑️","🔒","🔓","🔏","🔐","🔑","🗝️","🔨","🪓","⛏️","⚒️","🛠️","🗡️","⚔️","🔫","🪃","🏹","🛡️","🪚","🔧","🪛","🔩","⚙️","🗜️","⚖️","🦯","🔗","⛓️","🪝","🧲","🔮","🪄","🧿","🪬","🧸","🪅","🎭","🖼️","🎨","🧵","🪡","🧶","🪢"] },
];

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({ value, onChange, placeholder, className, autoFocus, variables }: Props, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastSetValueRef = useRef<string>("");
  const [activeCmds, setActiveCmds] = useState<Record<string, boolean>>({});

  // Dropdown open states
  const [fontOpen, setFontOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [activeColor, setActiveColor] = useState("#000000");
  const [activeAlign, setActiveAlign] = useState<"left" | "center" | "right" | "justify">("left");
  const [activeFont, setActiveFont] = useState("Sans Serif");
  const [colorTab, setColorTab] = useState<"text" | "bg">("text");

  // Merge-variable picker (only armed when `variables` is supplied)
  const variablesEnabled = (variables?.length ?? 0) > 0;
  const [varMenu, setVarMenu] = useState<{
    matches: ComposeVariable[];
    index: number;
    top: number;
    left: number;
  } | null>(null);
  const triggerRef = useRef<VariableTrigger | null>(null);

  // Saved selection for when picker popups steal focus
  const savedRangeRef = useRef<Range | null>(null);

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const range = savedRangeRef.current;
    if (!range) return;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    editorRef.current?.focus();
  }

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value !== lastSetValueRef.current) {
      el.innerHTML = value;
      lastSetValueRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function refreshActiveState() {
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (!anchor || !el.contains(anchor)) return;
      const next: Record<string, boolean> = {};
      for (const cmd of TRACKED_COMMANDS) {
        try { next[cmd] = document.queryCommandState(cmd); } catch { next[cmd] = false; }
      }
      setActiveCmds(next);
      // Detect current alignment
      try {
        if (document.queryCommandState("justifyCenter")) setActiveAlign("center");
        else if (document.queryCommandState("justifyRight")) setActiveAlign("right");
        else if (document.queryCommandState("justifyFull")) setActiveAlign("justify");
        else setActiveAlign("left");
      } catch { /* ok */ }
    }
    document.addEventListener("selectionchange", refreshActiveState);
    return () => document.removeEventListener("selectionchange", refreshActiveState);
  }, []);

  // Close all popovers on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-rte-popover]")) {
        setFontOpen(false);
        setSizeOpen(false);
        setColorOpen(false);
        setAlignOpen(false);
        setEmojiOpen(false);
        setLinkOpen(false);
        setVarMenu(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastSetValueRef.current = html;
    onChange(html);
  }

  /**
   * Tint any `{variable}` the user typed by hand.
   *
   * Blur-only: rewriting innerHTML mid-edit would collapse the caret, and
   * variables inserted from the picker are already wrapped, so this only has
   * to catch manual typing — where waiting until focus leaves costs nothing.
   */
  function highlightVariablesOnBlur() {
    const el = editorRef.current;
    if (!variablesEnabled || !el) return;
    const wrapped = wrapVariablesInHtml(el.innerHTML, variables);
    if (wrapped !== el.innerHTML) el.innerHTML = wrapped;
  }

  /** Re-evaluate whether a variable menu should be showing, and where. */
  function syncVariableMenu() {
    if (!variablesEnabled) return;

    const trigger = findVariableTrigger();
    triggerRef.current = trigger;
    if (!trigger) {
      setVarMenu(null);
      return;
    }

    const matches = filterComposeVariables(trigger.query, variables);
    if (matches.length === 0) {
      setVarMenu(null);
      return;
    }

    // Measure the `{query` span rather than the collapsed caret — a collapsed
    // range reports a zero-width rect at the wrong x in some browsers.
    const measure = document.createRange();
    measure.setStart(trigger.node, trigger.braceOffset);
    measure.setEnd(trigger.node, trigger.caretOffset);
    const rect = measure.getBoundingClientRect();

    setVarMenu((prev) => ({
      matches,
      // Keep the highlighted row while the user narrows the query, but never
      // let a stale index point past the end of a now-shorter list.
      index: prev ? Math.min(prev.index, matches.length - 1) : 0,
      top: rect.bottom + 4,
      left: rect.left,
    }));
  }

  function closeVariableMenu() {
    setVarMenu(null);
    triggerRef.current = null;
  }

  /** Replace the typed `{query` with a complete `{key}` placeholder. */
  function insertVariable(v: ComposeVariable) {
    const trigger = triggerRef.current;
    const el = editorRef.current;
    if (!trigger || !el) return;

    el.focus();
    // Select the partial text and overwrite it via execCommand so the
    // insertion joins the browser's native undo stack.
    const range = document.createRange();
    range.setStart(trigger.node, trigger.braceOffset);
    range.setEnd(trigger.node, trigger.caretOffset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Trailing &nbsp; sits outside the span so continued typing isn't
    // swallowed into the tinted token.
    document.execCommand(
      "insertHTML",
      false,
      `<span class="${VARIABLE_SPAN_CLASS}">{${v.key}}</span>&nbsp;`
    );

    closeVariableMenu();
    emit();
    saveSelection();
  }

  /**
   * The tinted `{variable}` span adjacent to a collapsed caret, if any.
   *
   * Checks three positions: inside the span, at the start of the text node
   * following it, and at an element boundary between children — the caret can
   * legitimately be in any of them after normal editing.
   */
  function adjacentVariableSpan(back: boolean): HTMLElement | null {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.isCollapsed || sel.rangeCount === 0) return null;

    const { startContainer: node, startOffset: offset } = sel.getRangeAt(0);
    if (!el.contains(node)) return null;

    // Caret sits within the token itself.
    const within = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
      ?.closest(`.${VARIABLE_SPAN_CLASS}`);
    if (within) return within as HTMLElement;

    const atEdge = back ? offset === 0 : offset === (node.textContent?.length ?? 0);
    if (node.nodeType === Node.TEXT_NODE && atEdge) {
      const sib = back ? node.previousSibling : node.nextSibling;
      if (sib instanceof HTMLElement && sib.classList.contains(VARIABLE_SPAN_CLASS)) return sib;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const kids = (node as Element).childNodes;
      const cand = back ? kids[offset - 1] : kids[offset];
      if (cand instanceof HTMLElement && cand.classList.contains(VARIABLE_SPAN_CLASS)) return cand;
    }

    return null;
  }

  /** Backspace/Delete removes a whole variable token rather than one character. */
  function handleVariableDelete(e: React.KeyboardEvent<HTMLDivElement>): boolean {
    if (!variablesEnabled) return false;
    if (e.key !== "Backspace" && e.key !== "Delete") return false;

    const span = adjacentVariableSpan(e.key === "Backspace");
    if (!span) return false;

    const range = document.createRange();
    range.selectNode(span);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // execCommand rather than span.remove() so the deletion is undoable.
    document.execCommand("delete");

    closeVariableMenu();
    emit();
    saveSelection();
    return true;
  }

  /** Arrow/Enter/Tab/Esc navigation while the picker is open. */
  function handleVariableKeyDown(e: React.KeyboardEvent<HTMLDivElement>): boolean {
    if (!varMenu) return false;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setVarMenu((m) =>
        m ? { ...m, index: (m.index + delta + m.matches.length) % m.matches.length } : m
      );
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertVariable(varMenu.matches[varMenu.index]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeVariableMenu();
      return true;
    }
    return false;
  }

  function exec(cmd: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
    const next: Record<string, boolean> = {};
    for (const c of TRACKED_COMMANDS) {
      try { next[c] = document.queryCommandState(c); } catch { next[c] = false; }
    }
    setActiveCmds(next);
  }

  function applyFont(fontLabel: string) {
    setActiveFont(fontLabel);
    setFontOpen(false);
    restoreSelection();
    const cssFont = FONT_MAP[fontLabel] || fontLabel;
    exec("fontName", cssFont);
  }

  function applySize(sizeVal: string) {
    setSizeOpen(false);
    restoreSelection();
    exec("fontSize", sizeVal);
  }

  function applyColor(color: string, target: "text" | "bg") {
    setColorOpen(false);
    restoreSelection();
    if (target === "text") {
      setActiveColor(color);
      exec("foreColor", color);
    } else {
      exec("hiliteColor", color);
    }
  }

  function applyAlign(align: "left" | "center" | "right" | "justify") {
    setAlignOpen(false);
    setActiveAlign(align);
    const cmd = {
      left: "justifyLeft",
      center: "justifyCenter",
      right: "justifyRight",
      justify: "justifyFull",
    }[align];
    exec(cmd);
  }

  function insertEmoji(emoji: string) {
    setEmojiOpen(false);
    restoreSelection();
    exec("insertText", emoji);
  }

  function openLinkPopover() {
    saveSelection();
    // Pre-fill text with selected text
    const sel = window.getSelection();
    const selectedText = sel && sel.rangeCount > 0 ? sel.toString() : "";
    setLinkText(selectedText);
    setLinkUrl("");
    setLinkOpen(true);
    setFontOpen(false);
    setSizeOpen(false);
    setColorOpen(false);
    setAlignOpen(false);
    setEmojiOpen(false);
  }

  function applyLink() {
    if (!linkUrl.trim()) { setLinkOpen(false); return; }
    const href = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    restoreSelection();
    const sel = window.getSelection();
    // If no text selected and linkText provided, insert as new text
    if (linkText.trim() && sel && sel.isCollapsed) {
      exec("insertHTML", `<a href="${href}">${linkText.trim()}</a>`);
    } else {
      exec("createLink", href);
    }
    setLinkOpen(false);
    setLinkText("");
    setLinkUrl("");
  }

  useImperativeHandle(ref, () => ({
    insertLink: openLinkPopover,
    insertVariableTrigger: () => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      // Restore the caret the toolbar click just stole, so the brace lands
      // where the user was typing rather than at the start of the body.
      restoreSelection();
      document.execCommand("insertText", false, "{");
      emit();
      syncVariableMenu();
    },
    isFocused: () => !!editorRef.current && document.activeElement === editorRef.current,
  }));

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      e.preventDefault();
      document.execCommand("insertText", false, text);
    }
  }

  const isEmpty = richTextIsEmpty(value);

  const ALIGN_ICONS: Record<string, React.ReactNode> = {
    left: <AlignLeftIcon />,
    center: <AlignCenterIcon />,
    right: <AlignRightIcon />,
    justify: <AlignJustifyIcon />,
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className ?? ""}`}>
      {/* Editor surface */}
      {/* Caret coordinates are captured once, so a scroll would leave the
          picker floating detached from its anchor — close it instead. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={varMenu ? closeVariableMenu : undefined}
      >
        {isEmpty && placeholder && (
          <div className="pointer-events-none absolute left-3 top-3 select-none text-[13px] text-[#70757a]">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => { emit(); syncVariableMenu(); }}
          onBlur={() => { highlightVariablesOnBlur(); emit(); }}
          onKeyDown={(e) => {
            if (handleVariableDelete(e)) { e.preventDefault(); return; }
            handleVariableKeyDown(e);
          }}
          onKeyUp={(e) => {
            saveSelection();
            // Caret moves that don't fire onInput still change trigger context.
            if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
              syncVariableMenu();
            }
          }}
          onMouseUp={() => { saveSelection(); syncVariableMenu(); }}
          onPaste={handlePaste}
          className="min-h-[200px] w-full px-3 py-3 text-[13px] leading-relaxed text-[#202124] outline-none [overflow-wrap:anywhere] [&_.cv-var]:rounded [&_.cv-var]:bg-[#e8f0fe] [&_.cv-var]:px-1 [&_.cv-var]:py-px [&_.cv-var]:font-medium [&_.cv-var]:text-[#1967d2] [&_a]:text-[#1a73e8] [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-[#ccc] [&_blockquote]:pl-3 [&_blockquote]:text-[#666] [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder || "Message body"}
        />
      </div>

      {/*
        Merge-variable picker — anchored to the caret in viewport coordinates.
        Portalled to <body> because the centered compose dialog carries a
        translate transform, and a transformed ancestor becomes the containing
        block for position:fixed children — which would resolve these
        coordinates against the dialog instead of the screen.
      */}
      {varMenu && typeof document !== "undefined" && createPortal(
        <div
          data-rte-popover
          className="fixed z-[1000] max-h-[260px] w-[264px] overflow-y-auto rounded-lg border border-[#dadce0] bg-white py-1 shadow-[0_4px_16px_rgba(60,64,67,0.28)]"
          style={{ top: varMenu.top, left: varMenu.left }}
          role="listbox"
          aria-label="Insert variable"
        >
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#70757a]">
            Insert variable
          </p>
          {varMenu.matches.map((v, i) => (
            <button
              key={v.key}
              type="button"
              role="option"
              aria-selected={i === varMenu.index}
              // Keep the caret/selection intact — a plain click would blur the
              // editor and drop the range insertVariable needs.
              onMouseDown={(e) => { e.preventDefault(); insertVariable(v); }}
              onMouseEnter={() => setVarMenu((m) => (m ? { ...m, index: i } : m))}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left ${
                i === varMenu.index ? "bg-[#e8f0fe]" : "hover:bg-[#f1f3f4]"
              }`}
            >
              <span className="text-[13px] font-medium text-[#202124]">{v.label}</span>
              <span className="text-[11px] text-[#5f6368]">
                {`{${v.key}}`} · {v.hint}
              </span>
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Formatting toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-t border-[#e8eaed] bg-[#f8f9fa] px-2 py-1.5">

        {/* Font picker */}
        <div className="relative" data-rte-popover>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setFontOpen(v => !v); setSizeOpen(false); setColorOpen(false); setAlignOpen(false); setEmojiOpen(false); }}
            className="flex h-7 max-w-[100px] items-center gap-0.5 rounded px-1.5 text-[12px] text-[#444746] hover:bg-[#e8eaed]"
            title="Font"
          >
            <span className="truncate">{activeFont}</span>
            <ChevronDownIcon />
          </button>
          {fontOpen && (
            <div className="absolute left-0 bottom-full z-50 mb-0.5 w-44 overflow-hidden rounded border border-[#dadce0] bg-white py-1 shadow-lg">
              {FONTS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyFont(f); }}
                  className={`flex w-full items-center px-3 py-1 text-left text-[13px] hover:bg-[#f1f3f4] ${activeFont === f ? "text-[#0b57d0] font-medium" : "text-[#202124]"}`}
                  style={{ fontFamily: FONT_MAP[f] || f }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Size picker */}
        <div className="relative" data-rte-popover>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setSizeOpen(v => !v); setFontOpen(false); setColorOpen(false); setAlignOpen(false); setEmojiOpen(false); }}
            className="flex h-7 items-center gap-0.5 rounded px-1 text-[12px] text-[#444746] hover:bg-[#e8eaed]"
            title="Text size"
          >
            <TextSizeIcon />
            <ChevronDownIcon />
          </button>
          {sizeOpen && (
            <div className="absolute left-0 bottom-full z-50 mb-0.5 w-32 overflow-hidden rounded border border-[#dadce0] bg-white py-1 shadow-lg">
              {SIZES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); applySize(s.value); }}
                  className="flex w-full items-center px-3 py-1 text-left hover:bg-[#f1f3f4]"
                >
                  <span style={{ fontSize: ["10px","11px","13px","16px","20px","24px","32px","48px"][parseInt(s.value)-1] ?? "13px" }}
                    className="text-[#202124]">
                    {s.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ToolbarDivider />

        <ToolbarBtn active={activeCmds.bold} title="Bold (Ctrl+B)" onClick={() => exec("bold")}>
          <Bold className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarBtn active={activeCmds.italic} title="Italic (Ctrl+I)" onClick={() => exec("italic")}>
          <Italic className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarBtn active={activeCmds.underline} title="Underline (Ctrl+U)" onClick={() => exec("underline")}>
          <Underline className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </ToolbarBtn>

        {/* Text/background color picker */}
        <div className="relative" data-rte-popover>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setColorOpen(v => !v); setFontOpen(false); setSizeOpen(false); setAlignOpen(false); setEmojiOpen(false); }}
            className="flex h-7 w-7 flex-col items-center justify-center rounded text-[#444746] hover:bg-[#e8eaed]"
            title="Text color"
          >
            <span className="text-[12px] font-semibold leading-none" style={{ fontFamily: "serif", color: activeColor }}>A</span>
            <span className="mt-[2px] h-[3px] w-4 rounded-sm" style={{ backgroundColor: activeColor }} />
          </button>
          {colorOpen && (
            <div className="absolute left-0 bottom-full z-50 mb-0.5 rounded border border-[#dadce0] bg-white p-2 shadow-lg" style={{ width: 212 }}>
              <div className="mb-2 flex gap-2 border-b border-[#e8eaed] pb-2">
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setColorTab("text"); }} className={`text-[12px] font-medium ${colorTab === "text" ? "text-[#0b57d0] border-b-2 border-[#0b57d0]" : "text-[#444746]"}`}>Text color</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setColorTab("bg"); }} className={`text-[12px] font-medium ${colorTab === "bg" ? "text-[#0b57d0] border-b-2 border-[#0b57d0]" : "text-[#444746]"}`}>Highlight</button>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {(colorTab === "text" ? COLORS : BG_COLORS).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyColor(c, colorTab); }}
                    className="h-5 w-5 rounded-sm border border-[#dadce0] hover:scale-110 transition-transform"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyColor(colorTab === "text" ? "#000000" : "transparent", colorTab); }}
                className="mt-2 w-full rounded border border-[#dadce0] px-2 py-1 text-[11px] text-[#444746] hover:bg-[#f1f3f4]"
              >
                {colorTab === "text" ? "Reset to default" : "Remove highlight"}
              </button>
            </div>
          )}
        </div>

        <ToolbarDivider />

        {/* Alignment picker */}
        <div className="relative" data-rte-popover>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setAlignOpen(v => !v); setFontOpen(false); setSizeOpen(false); setColorOpen(false); setEmojiOpen(false); }}
            className="flex h-7 items-center gap-0.5 rounded px-1 text-[#444746] hover:bg-[#e8eaed]"
            title="Alignment"
          >
            {ALIGN_ICONS[activeAlign]}
            <ChevronDownIcon />
          </button>
          {alignOpen && (
            <div className="absolute left-0 bottom-full z-50 mb-0.5 w-36 overflow-hidden rounded border border-[#dadce0] bg-white py-1 shadow-lg">
              {(["left", "center", "right", "justify"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyAlign(a); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-[#f1f3f4] ${activeAlign === a ? "text-[#0b57d0]" : "text-[#202124]"}`}
                >
                  {ALIGN_ICONS[a]}
                  <span className="capitalize">{a === "justify" ? "Justify" : `Align ${a}`}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ToolbarBtn active={activeCmds.insertOrderedList} title="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarBtn active={activeCmds.insertUnorderedList} title="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <List className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </ToolbarBtn>

        <ToolbarBtn title="Decrease indent" onClick={() => exec("outdent")}>
          <OutdentIcon />
        </ToolbarBtn>
        <ToolbarBtn title="Increase indent" onClick={() => exec("indent")}>
          <IndentIcon />
        </ToolbarBtn>

        <ToolbarBtn title="Quote" onClick={() => exec("formatBlock", "blockquote")}>
          <QuoteIcon />
        </ToolbarBtn>

        <ToolbarDivider />

        <ToolbarBtn active={activeCmds.strikeThrough} title="Strikethrough" onClick={() => exec("strikeThrough")}>
          <Strikethrough className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </ToolbarBtn>

        {/* Link popover */}
        <div className="relative" data-rte-popover>
          <ToolbarBtn title="Insert link (Ctrl+K)" onClick={openLinkPopover}>
            <LinkIcon className="h-[15px] w-[15px]" strokeWidth={2.5} />
          </ToolbarBtn>
          {linkOpen && (
            <div className="absolute bottom-full right-0 z-50 mb-1 w-72 rounded-lg border border-[#dadce0] bg-white p-3 shadow-xl" data-rte-popover>
              {/* Text field */}
              <div className="mb-2 flex items-center rounded border border-[#dadce0] bg-white px-2 focus-within:border-[#0b57d0] focus-within:ring-1 focus-within:ring-[#0b57d0]">
                <span className="mr-2 shrink-0 text-[#5f6368]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                </span>
                <input
                  type="text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="Text"
                  autoFocus
                  className="flex-1 py-1.5 text-[13px] text-[#202124] outline-none placeholder:text-[#80868b]"
                />
              </div>
              {/* URL field + Apply */}
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded border border-[#dadce0] bg-white px-2 focus-within:border-[#0b57d0] focus-within:ring-1 focus-within:ring-[#0b57d0]">
                  <span className="mr-2 shrink-0 text-[#5f6368]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  </span>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }}
                    placeholder="Type or paste a link"
                    className="flex-1 py-1.5 text-[13px] text-[#202124] outline-none placeholder:text-[#80868b]"
                  />
                </div>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyLink(); }}
                  className={`shrink-0 text-[13px] font-medium ${linkUrl.trim() ? "text-[#0b57d0] hover:text-[#1a73e8]" : "text-[#80868b] cursor-not-allowed"}`}
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Emoji picker */}
        <div className="relative" data-rte-popover>
          <ToolbarBtn title="Insert emoji" onClick={() => { saveSelection(); setEmojiOpen(v => !v); setFontOpen(false); setSizeOpen(false); setColorOpen(false); setAlignOpen(false); }}>
            <span className="text-[14px] leading-none">😊</span>
          </ToolbarBtn>
          {emojiOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-1 rounded border border-[#dadce0] bg-white shadow-lg" style={{ width: 280 }} data-rte-popover>
              <div className="max-h-52 overflow-y-auto p-2">
                {EMOJI_GROUPS.map((group) => (
                  <div key={group.label} className="mb-2">
                    <p className="mb-1 text-[11px] font-medium text-[#5f6368]">{group.label}</p>
                    <div className="flex flex-wrap gap-0.5">
                      {group.emojis.map((em) => (
                        <button
                          key={em}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); insertEmoji(em); }}
                          className="flex h-8 w-8 items-center justify-center rounded text-[18px] hover:bg-[#f1f3f4]"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Remove formatting */}
        <ToolbarBtn title="Remove formatting" onClick={() => exec("removeFormat")}>
          <RemoveFormatIcon />
        </ToolbarBtn>

      </div>
    </div>
  );
});

function ToolbarBtn({
  title, onClick, active, children,
}: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active ? "true" : "false"}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={
        active
          ? "flex h-7 w-7 items-center justify-center rounded bg-[#d2e3fc] text-[#1a73e8]"
          : "flex h-7 w-7 items-center justify-center rounded text-[#5f6368] hover:bg-[#e8eaed]"
      }
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px bg-[#dadce0]" />;
}

function ChevronDownIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>;
}

function TextSizeIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 20 16" fill="currentColor" aria-hidden>
      <text x="0" y="13" fontSize="14" fontWeight="700">T</text>
      <text x="11" y="10" fontSize="9">T</text>
    </svg>
  );
}

function AlignLeftIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
}
function AlignCenterIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
}
function AlignRightIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
}
function AlignJustifyIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
}
function OutdentIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/><polyline points="7 9 3 12 7 15"/></svg>;
}
function IndentIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><polyline points="9 9 13 12 9 15"/></svg>;
}
function QuoteIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>;
}
function RemoveFormatIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 4h14v2H6z"/><path d="M8 4v16M11 4l4 16M17 20H8"/><line x1="3" y1="3" x2="21" y2="21"/></svg>;
}
