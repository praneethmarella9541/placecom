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
  UNKNOWN_VARIABLE_CLASS,
  VARIABLE_SPAN_CLASS,
  type ComposeVariable,
  type UnknownPlaceholderMode,
} from "@/lib/compose-variables";

/** Marks a photo whose upload hasn't finished (see insertUploadingImage). */
const UPLOADING_IMAGE_ATTR = "data-uploading-image";
const UPLOADING_IMAGE_RE = /<img\b[^>]*\bdata-uploading-image=[^>]*>(<br>)?/gi;
/** Fits the photo to the mail's width, as Gmail does with an inserted photo. */
const INLINE_IMAGE_STYLE = "max-width:100%;height:auto";

export function richTextIsEmpty(html: string): boolean {
  // A body holding only an inserted photo has content, though no text.
  if (/<img\b/i.test(html)) return false;
  const stripped = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<p[^>]*><\/p>/gi, "")
    .replace(/<div[^>]*><\/div>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return stripped.length === 0;
}

/** Link text/href go through insertHTML, so they must not be able to break out of the markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

export type RichTextEditorHandle = {
  insertLink: () => void;
  /** Insert `{` at the caret and open the variable picker. */
  insertVariableTrigger: () => void;
  /** Insert a complete `{key}` token at the caret, picker not involved. */
  insertVariableToken: (key: string) => void;
  /**
   * Insert a photo into the body at the caret — Gmail's "Insert photo". It
   * shows at once (faded, from a local preview) while `upload` runs, then
   * switches to the URL `upload` resolves to. Rejects, removing the photo, if
   * the upload fails.
   */
  insertUploadingImage: (file: File, upload: (file: File) => Promise<string>) => Promise<void>;
  isFocused: () => boolean;
};

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /**
   * Images pasted or dropped into the body. The host inserts them the same way
   * as its "Insert photo" button (insertUploadingImage) — the caret is already
   * at the paste or drop point. Without it, pasting or dropping an image does
   * nothing special.
   */
  onImageFiles?: (files: File[]) => void;
  className?: string;
  autoFocus?: boolean;
  /**
   * When non-empty, typing `{` opens a merge-variable picker. Left undefined
   * everywhere except mass-send compose, so ordinary emails containing a brace
   * (code snippets, JSON) behave exactly as before.
   */
  variables?: ComposeVariable[];
  /**
   * How `{placeholders}` that match none of `variables` are drawn. Defaults to
   * "ignore"; see UnknownPlaceholderMode.
   */
  unknownPlaceholders?: UnknownPlaceholderMode;
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

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({ value, onChange, placeholder, className, autoFocus, variables, unknownPlaceholders = "ignore", onImageFiles }: Props, ref) {
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
  // "view" = Gmail-style compact "Go to link: url | Change | Remove" bar
  // (default when opening on an existing link); "edit" = the actual
  // text+url input form, shown for a brand-new link or after "Change".
  const [linkViewMode, setLinkViewMode] = useState<"view" | "edit">("edit");
  const [activeColor, setActiveColor] = useState("#000000");
  const [activeAlign, setActiveAlign] = useState<"left" | "center" | "right" | "justify">("left");
  const [activeFont, setActiveFont] = useState("Sans Serif");
  const [colorTab, setColorTab] = useState<"text" | "bg">("text");

  // Merge-variable picker (only armed when `variables` is supplied)
  const variablesEnabled = (variables?.length ?? 0) > 0;
  // Tinting can be wanted with nothing to pick yet — an imported-list draft
  // before its file is chosen — so it is gated separately from the picker.
  const tintEnabled = variablesEnabled || unknownPlaceholders !== "ignore";
  const [varMenu, setVarMenu] = useState<{
    matches: ComposeVariable[];
    index: number;
    top: number;
    left: number;
  } | null>(null);
  const triggerRef = useRef<VariableTrigger | null>(null);

  // Saved selection for when picker popups steal focus
  const savedRangeRef = useRef<Range | null>(null);

  // ── Inserted photos: select, resize, remove ──────────────────────────────
  /** The photo clicked in the body, with its box in the scroll container. */
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgToolsRef = useRef<HTMLDivElement>(null);

  function measureImg(img: HTMLImageElement | null) {
    if (!img || !img.isConnected) {
      setSelectedImg(null);
      setImgBox(null);
      return;
    }
    setImgBox({ left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight });
  }

  function selectImg(img: HTMLImageElement | null) {
    setSelectedImg(img);
    measureImg(img);
  }

  /**
   * Size a photo. A pixel width is written both as the `width` attribute
   * (what Outlook honours) and as CSS; max-width keeps it inside narrow
   * screens either way. `null` is "best fit": as wide as the mail allows.
   */
  function sizeImg(img: HTMLImageElement, width: number | null) {
    if (width === null) {
      img.removeAttribute("width");
      img.style.width = "";
    } else {
      const w = Math.max(40, Math.round(width));
      img.setAttribute("width", String(w));
      img.style.width = `${w}px`;
    }
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.removeAttribute("height");
  }

  /** Room for a photo: the editor's content width. */
  function bodyWidth(): number {
    const el = editorRef.current;
    if (!el) return 600;
    const cs = window.getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }

  function applyPreset(preset: "small" | "medium" | "fit" | "original") {
    const img = selectedImg;
    if (!img) return;
    const w = bodyWidth();
    if (preset === "small") sizeImg(img, Math.min(img.naturalWidth || w, w * 0.25));
    else if (preset === "medium") sizeImg(img, Math.min(img.naturalWidth || w, w * 0.5));
    else if (preset === "fit") sizeImg(img, null);
    else sizeImg(img, img.naturalWidth || w);
    emit();
    requestAnimationFrame(() => measureImg(img));
  }

  function removeSelectedImg() {
    const img = selectedImg;
    if (!img) return;
    img.remove();
    selectImg(null);
    emit();
  }

  /** Drag the corner handle: width follows the pointer, height keeps the ratio. */
  function startImgResize(e: React.MouseEvent) {
    const img = selectedImg;
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = img.offsetWidth;
    const maxW = bodyWidth();
    function onMove(mv: MouseEvent) {
      sizeImg(img!, Math.min(maxW, startW + (mv.clientX - startX)));
      measureImg(img!);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      emit();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Clicking anywhere that isn't the photo or its tools lets go of it.
  useEffect(() => {
    if (!selectedImg) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (t === selectedImg || imgToolsRef.current?.contains(t)) return;
      setSelectedImg(null);
      setImgBox(null);
    }
    function onResize() {
      measureImg(selectedImg);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measureImg only uses setters
  }, [selectedImg]);

  /** Pull the image files out of a paste or drop. */
  function imageFilesFrom(list: FileList | null | undefined): File[] {
    return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
  }

  /** A `data:` image (pasted from some apps) as a File, to upload like any photo. */
  function dataUrlToFile(dataUrl: string, index: number): File | null {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl);
    if (!m) return null;
    try {
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = m[1].split("/")[1].replace("jpeg", "jpg").replace(/\+.*/, "");
      return new File([bytes], `pasted-image-${index + 1}.${ext}`, { type: m[1] });
    } catch {
      return null;
    }
  }
  // The <a> being edited when the link popover was opened on top of an
  // existing link — lets Apply update it in place instead of nesting a new
  // <a> inside it (which is what happened before: the popover always opened
  // blank, with no memory of an existing link's href).
  const editingAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const [isEditingLink, setIsEditingLink] = useState(false);

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const range = savedRangeRef.current;
    if (!range) return;
    // A range from another field (the subject) must not steer an insert here.
    if (!editorRef.current?.contains(range.startContainer)) return;
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
    // Rebuilding innerHTML detaches every child node — including the <a>
    // the link popover is currently pointing at — so hold off while it's
    // open; the next value change after it closes will resync.
    if (linkOpen) return;
    if (value !== lastSetValueRef.current) {
      // Tint `{variable}` tokens on the way in, the way SubjectWithVariables
      // already does. Without this, any body that arrives as stored text rather
      // than as typing shows bare braces until the editor happens to be focused
      // and blurred — a saved mail template (spans are stripped before storing),
      // a reopened draft, a sequence step loaded from the database. Safe here
      // specifically: this branch only runs for an external change, and it is
      // rebuilding innerHTML regardless, so there is no caret to collapse.
      el.innerHTML = tintEnabled
        ? wrapVariablesInHtml(value, variables, unknownPlaceholders)
        : value;
      // The selected photo (if any) was just replaced along with everything else.
      setSelectedImg(null);
      setImgBox(null);
      // Records the incoming value, not the wrapped markup: the comparison above
      // is against what the parent holds. Storing the wrapped form would make
      // every later external set look like a change and rewrite the DOM on each
      // render. The wrapping stays presentation-only — it is never emitted, so
      // loading content cannot mark a pristine form dirty, and the send path
      // strips these spans anyway.
      lastSetValueRef.current = value;
    }
  }, [value, linkOpen, tintEnabled, variables, unknownPlaceholders]);

  // Re-tint when what counts as a variable changes under unchanged text —
  // importing a file, switching the audience tab. The effect above only fires
  // for a new value. Skipped while the editor has focus: rebuilding innerHTML
  // would drop the caret, and the blur pass catches up anyway.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !tintEnabled || linkOpen || document.activeElement === el) return;
    const wrapped = wrapVariablesInHtml(el.innerHTML, variables, unknownPlaceholders);
    if (wrapped !== el.innerHTML) el.innerHTML = wrapped;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- linkOpen only guards
  }, [tintEnabled, variables, unknownPlaceholders]);

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
        editingAnchorRef.current = null;
        setIsEditingLink(false);
        setLinkViewMode("edit");
        setVarMenu(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    // A photo still uploading points at a local preview no one else can load;
    // it reaches the draft only once it has its real URL (insertUploadingImage).
    const html = el.innerHTML.replace(UPLOADING_IMAGE_RE, "");
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
    if (!tintEnabled || !el) return;
    const wrapped = wrapVariablesInHtml(el.innerHTML, variables, unknownPlaceholders);
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
    if (!tintEnabled) return false;
    if (e.key !== "Backspace" && e.key !== "Delete") return false;

    const span = adjacentVariableSpan(e.key === "Backspace");
    // A flagged token is usually a typo being fixed — let it be edited a
    // character at a time instead of vanishing whole.
    if (!span || span.classList.contains(UNKNOWN_VARIABLE_CLASS)) return false;

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

  /** Opens the Gmail-style "Go to link" bar for an already-existing <a> — shared by the toolbar button and clicking directly on a link (see onClick below). */
  function openLinkViewFor(existingLink: HTMLAnchorElement) {
    // Select the whole link's contents so the saved range (and Apply) acts
    // on this exact <a>, not just wherever the cursor happened to be.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(existingLink);
    sel?.removeAllRanges();
    sel?.addRange(range);
    editingAnchorRef.current = existingLink;
    setIsEditingLink(true);
    setLinkViewMode("view");
    setLinkText(existingLink.textContent || "");
    setLinkUrl(existingLink.getAttribute("href") || "");
    saveSelection();
    setLinkOpen(true);
    setFontOpen(false);
    setSizeOpen(false);
    setColorOpen(false);
    setAlignOpen(false);
    setEmojiOpen(false);
  }

  function openLinkPopover() {
    const sel = window.getSelection();
    const anchorNode = sel?.anchorNode ?? null;
    const startEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
    const existingLink = startEl?.closest("a") ?? null;
    const editingExisting = !!existingLink && !!editorRef.current?.contains(existingLink);

    if (editingExisting && existingLink) {
      openLinkViewFor(existingLink);
      return;
    }

    editingAnchorRef.current = null;
    setIsEditingLink(false);
    setLinkViewMode("edit");
    const selectedText = sel && sel.rangeCount > 0 ? sel.toString() : "";
    setLinkText(selectedText);
    setLinkUrl("");

    saveSelection();
    setLinkOpen(true);
    setFontOpen(false);
    setSizeOpen(false);
    setColorOpen(false);
    setAlignOpen(false);
    setEmojiOpen(false);
  }

  function closeLinkPopover() {
    editingAnchorRef.current = null;
    setIsEditingLink(false);
    setLinkViewMode("edit");
    setLinkOpen(false);
    setLinkText("");
    setLinkUrl("");
  }

  function applyLink() {
    const rawUrl = linkUrl.trim();
    if (!rawUrl) { closeLinkPopover(); return; }
    const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const text = linkText.trim();

    // Only trust the stored anchor if it's still actually in the document —
    // a `value` resync rebuilds innerHTML, which would leave this pointing at
    // a detached node whose mutations silently go nowhere.
    const a = editingAnchorRef.current;
    if (a && editorRef.current?.contains(a)) {
      a.setAttribute("href", href);
      if (text && text !== a.textContent) a.textContent = text;
      emit();
      closeLinkPopover();
      return;
    }

    restoreSelection();
    const sel = window.getSelection();
    const selectedText = sel && !sel.isCollapsed ? sel.toString() : "";
    // createLink keeps whatever text was selected, so it can't honour an
    // edited Text field — insert our own anchor whenever the text differs
    // from (or there is no) selection, and only fall back to createLink when
    // the user left the selected text exactly as-is.
    if (!selectedText || (text && text !== selectedText)) {
      exec("insertHTML", `<a href="${escapeAttr(href)}">${escapeHtml(text || href)}</a>`);
    } else {
      exec("createLink", href);
    }
    closeLinkPopover();
  }

  function removeLink() {
    const a = editingAnchorRef.current;
    if (a && editorRef.current?.contains(a)) {
      const text = document.createTextNode(a.textContent || "");
      a.parentNode?.replaceChild(text, a);
      emit();
    }
    closeLinkPopover();
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
    // Used by the sequence editor's variable chips, where the key is already
    // chosen and going through the `{`-picker would just be an extra step.
    // Same markup insertVariable() produces, so a chip-inserted token is
    // tinted and deletes as one unit exactly like a picked one.
    insertVariableToken: (key: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      restoreSelection();
      document.execCommand(
        "insertHTML",
        false,
        `<span class="${VARIABLE_SPAN_CLASS}">{${key}}</span>&nbsp;`
      );
      closeVariableMenu();
      emit();
      saveSelection();
    },
    insertUploadingImage: async (file, upload) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const saved = savedRangeRef.current;
      if (saved && el.contains(saved.startContainer)) {
        restoreSelection();
      } else {
        // Never been in the body: put the photo at the end, not the start.
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }

      const key = `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(file);
      const alt = file.name.replace(/[<>"&]/g, "");
      document.execCommand(
        "insertHTML",
        false,
        `<img src="${preview}" ${UPLOADING_IMAGE_ATTR}="${key}" alt="${alt}" style="${INLINE_IMAGE_STYLE};opacity:0.5" /><br>`
      );
      saveSelection();
      const find = () =>
        editorRef.current?.querySelector<HTMLImageElement>(`img[${UPLOADING_IMAGE_ATTR}="${key}"]`);

      try {
        const url = await upload(file);
        const img = find();
        // Removed by the user while it uploaded — nothing to finish.
        if (!img) return;
        img.src = url;
        img.removeAttribute(UPLOADING_IMAGE_ATTR);
        img.setAttribute("style", INLINE_IMAGE_STYLE);
        emit();
      } catch (e) {
        find()?.remove();
        emit();
        throw e;
      } finally {
        URL.revokeObjectURL(preview);
      }
    },
    isFocused: () => !!editorRef.current && document.activeElement === editorRef.current,
  }));

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData("text/html");
    const imageFiles = onImageFiles ? imageFilesFrom(e.clipboardData.files) : [];

    // A screenshot, or an image copied on its own: the clipboard's HTML (if
    // any) is just an <img> wrapper, so the file itself is what to insert —
    // uploaded and embedded like "Insert photo".
    if (imageFiles.length > 0) {
      const htmlText = html
        ? (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").trim()
        : "";
      if (!htmlText) {
        e.preventDefault();
        saveSelection();
        onImageFiles!(imageFiles);
        return;
      }
    }

    if (html) {
      e.preventDefault();
      // Parse and strip dangerous nodes/attributes before inserting.
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script,style,iframe,object,embed,form,input,button,select,textarea,meta,link,base").forEach(el => el.remove());
      doc.body.querySelectorAll("*").forEach(el => {
        const remove: string[] = [];
        for (const attr of Array.from(el.attributes)) {
          if (
            attr.name.startsWith("on") ||
            (attr.name === "href" && /^javascript:/i.test(attr.value)) ||
            (attr.name === "src" && !/^https?:/i.test(attr.value) && !/^data:image\//i.test(attr.value))
          ) {
            remove.push(attr.name);
          }
        }
        remove.forEach(a => el.removeAttribute(a));
      });
      // Images embedded as data: in the pasted HTML would reach recipients as
      // broken images (Gmail won't show them) — take them out and upload them
      // as photos instead, after the text.
      const embedded: File[] = [];
      if (onImageFiles) {
        doc.body.querySelectorAll("img").forEach((img) => {
          const src = img.getAttribute("src") ?? "";
          if (!/^data:image\//i.test(src)) return;
          const file = dataUrlToFile(src, embedded.length);
          if (file) embedded.push(file);
          img.remove();
        });
      }
      document.execCommand("insertHTML", false, doc.body.innerHTML);
      if (embedded.length > 0) {
        emit();
        saveSelection();
        onImageFiles!(embedded);
      }
      return;
    }
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
        ref={surfaceRef}
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
            if (selectedImg) {
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                removeSelectedImg();
                return;
              }
              // Typing lets go of the photo and carries on as normal.
              selectImg(null);
            }
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
          onClick={(e) => {
            // A photo: select it for resizing (not while still uploading).
            const target = e.target as HTMLElement;
            if (target instanceof HTMLImageElement && !target.hasAttribute(UPLOADING_IMAGE_ATTR)) {
              selectImg(target);
              return;
            }
            // Gmail-style: clicking directly on a link shows its "Go to
            // link / Change / Remove" bar immediately — no need to select
            // the text and reach for the toolbar button first.
            const el = e.target as HTMLElement;
            const a = el.closest?.("a");
            if (a && editorRef.current?.contains(a)) {
              e.preventDefault();
              openLinkViewFor(a as HTMLAnchorElement);
            }
          }}
          onPaste={handlePaste}
          onDragOver={(e) => {
            if (onImageFiles && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = onImageFiles ? imageFilesFrom(e.dataTransfer.files) : [];
            if (files.length === 0) return;
            e.preventDefault();
            // Put the caret where the photo was dropped, so it lands there.
            const doc = document as Document & {
              caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
            };
            let range: Range | null = null;
            if (typeof doc.caretRangeFromPoint === "function") {
              range = doc.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (typeof doc.caretPositionFromPoint === "function") {
              const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
              if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
              }
            }
            if (range && editorRef.current?.contains(range.startContainer)) {
              range.collapse(true);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
              saveSelection();
            }
            onImageFiles!(files);
          }}
          className="min-h-[200px] w-full px-3 py-3 text-[13px] leading-relaxed text-[#202124] outline-none [overflow-wrap:anywhere] [&_.cv-var]:rounded [&_.cv-var]:bg-[#e8f0fe] [&_.cv-var]:px-1 [&_.cv-var]:py-px [&_.cv-var]:font-medium [&_.cv-var]:text-[#1967d2] [&_.cv-var.cv-var-unknown]:bg-[#fce8e6] [&_.cv-var.cv-var-unknown]:text-[#c5221f] [&_a]:text-[#1a73e8] [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-[#ccc] [&_blockquote]:pl-3 [&_blockquote]:text-[#666] [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder || "Message body"}
        />

        {/* Selected photo: outline, corner handle to drag to any size, and
            Gmail's size presets. Inside the scroll container, so it scrolls
            with the photo. */}
        {selectedImg && imgBox ? (
          <div ref={imgToolsRef}>
            <div
              className="pointer-events-none absolute z-10 outline outline-2 outline-[#1a73e8]"
              style={{ left: imgBox.left, top: imgBox.top, width: imgBox.width, height: imgBox.height }}
            >
              <span
                role="slider"
                aria-label="Resize photo"
                aria-valuenow={imgBox.width}
                title="Drag to resize"
                onMouseDown={startImgResize}
                className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border-2 border-white bg-[#1a73e8] shadow"
              />
            </div>
            <div
              className="absolute z-10 flex items-center gap-0.5 rounded-md border border-[#dadce0] bg-white p-0.5 text-[12px] text-[#3c4043] shadow-[0_2px_8px_rgba(60,64,67,0.25)]"
              style={{
                left: imgBox.left,
                // Above the photo, or inside its top edge when there's no room.
                top: imgBox.top >= 36 ? imgBox.top - 34 : imgBox.top + 6,
              }}
            >
              {(
                [
                  ["small", "Small"],
                  ["medium", "Medium"],
                  ["fit", "Best fit"],
                  ["original", "Original size"],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyPreset(preset)}
                  className="rounded px-2 py-1 hover:bg-[#f1f3f4]"
                >
                  {label}
                </button>
              ))}
              <span className="mx-0.5 h-4 w-px bg-[#dadce0]" aria-hidden />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={removeSelectedImg}
                className="rounded px-2 py-1 text-[#c5221f] hover:bg-[#fce8e6]"
              >
                Remove
              </button>
            </div>
          </div>
        ) : null}
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
          <ToolbarBtn title={isEditingLink ? "Edit link (Ctrl+K)" : "Insert link (Ctrl+K)"} onClick={openLinkPopover}>
            <LinkIcon className="h-[15px] w-[15px]" strokeWidth={2.5} />
          </ToolbarBtn>
          {linkOpen && (
            isEditingLink && linkViewMode === "view" ? (
              // Gmail-style compact bar — the default view when the popover
              // opens on top of an existing link. Editing fields only show
              // once "Change" is clicked, instead of always cramming a text
              // field + url field + Remove + Apply into one small box (which
              // is what pushed the url off-screen before).
              <div
                className="absolute bottom-full right-0 z-50 mb-1 flex max-w-[420px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-[13px] text-[#202124] shadow-xl"
                data-rte-popover
              >
                <span className="shrink-0 text-[#5f6368]">Go to link:</span>
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={linkUrl}
                  className="min-w-0 truncate text-[#1a73e8] underline"
                >
                  {linkUrl}
                </a>
                <span className="shrink-0 text-[#dadce0]">|</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLinkViewMode("edit"); }}
                  className="shrink-0 font-medium text-[#0b57d0] hover:text-[#1a73e8]"
                >
                  Change
                </button>
                <span className="shrink-0 text-[#dadce0]">|</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeLink(); }}
                  className="shrink-0 font-medium text-[#d93025] hover:text-[#b3261e]"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-72 rounded-lg border border-[#dadce0] bg-white p-3 shadow-xl" data-rte-popover>
                {isEditingLink && (
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#5f6368]">Edit link</p>
                )}
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
                {/* URL field */}
                <div className="mb-2 flex items-center rounded border border-[#dadce0] bg-white px-2 focus-within:border-[#0b57d0] focus-within:ring-1 focus-within:ring-[#0b57d0]">
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
                {/* Actions */}
                <div className="flex items-center justify-end gap-3">
                  {isEditingLink && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeLink(); }}
                      className="shrink-0 text-[13px] font-medium text-[#d93025] hover:text-[#b3261e]"
                    >
                      Remove
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); applyLink(); }}
                    className={`shrink-0 text-[13px] font-medium ${linkUrl.trim() ? "text-[#0b57d0] hover:text-[#1a73e8]" : "text-[#80868b] cursor-not-allowed"}`}
                  >
                    Apply
                  </button>
                </div>
              </div>
            )
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
