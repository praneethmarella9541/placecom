"use client";

import { useEffect, useRef } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, Link as LinkIcon,
} from "lucide-react";

/**
 * Lightweight rich-text editor used by the Compose window.
 *
 * - Built on a `contentEditable` div + the standard `document.execCommand`
 *   API.  execCommand is technically deprecated but still works in every
 *   browser that matters and is the simplest dependency-free path to the
 *   B/I/U/lists/link feature set Gmail's "core" toolbar offers.
 * - Value model: HTML string.  Parent owns the state; we set the DOM
 *   `innerHTML` only when the prop changes from outside (e.g. openDraft
 *   loaded a saved HTML body) — never on every keystroke, which would
 *   reset the caret position.
 * - Empty state: `<p><br></p>` is the contentEditable convention for an
 *   empty line. The `isEmpty()` helper checks for this so callers can
 *   treat it as "nothing typed".
 */

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

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /** Optional autofocus on first mount. */
  autoFocus?: boolean;
};

export function RichTextEditor({ value, onChange, placeholder, className, autoFocus }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  // Mirror the last value we WROTE into the DOM so we know when an external
  // change has arrived and we need to re-sync. Without this guard the
  // caret would reset to the start on every keystroke.
  const lastSetValueRef = useRef<string>("");

  // Sync external value -> DOM (only when it diverges from what we last wrote)
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

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastSetValueRef.current = html;
    onChange(html);
  }

  function exec(cmd: string, arg?: string) {
    // Re-focus before issuing the command — otherwise the selection
    // is "outside the editor" and the command silently does nothing.
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  }

  function handleLink() {
    const url = window.prompt("Enter URL");
    if (!url) return;
    // Prepend a scheme if the user typed a bare domain.
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    exec("createLink", href);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Strip formatting on paste so the editor doesn't fill with foreign
    // fonts/colors/sizes from the source document.  Gmail does the same
    // by default unless the user Cmd+Shift+V's "paste with formatting".
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      e.preventDefault();
      document.execCommand("insertText", false, text);
    }
  }

  const isEmpty = richTextIsEmpty(value);

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className ?? ""}`}>
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-[#f1f3f4] bg-[#f8f9fa] px-2 py-1">
        <ToolbarBtn title="Bold (Ctrl+B)" onClick={() => exec("bold")}>
          <Bold className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarBtn title="Italic (Ctrl+I)" onClick={() => exec("italic")}>
          <Italic className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarBtn title="Underline (Ctrl+U)" onClick={() => exec("underline")}>
          <Underline className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarBtn title="Strikethrough" onClick={() => exec("strikeThrough")}>
          <Strikethrough className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarDivider />
        <ToolbarBtn title="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <List className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarBtn title="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarBtn>
        <ToolbarDivider />
        <ToolbarBtn title="Insert link" onClick={handleLink}>
          <LinkIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
        </ToolbarBtn>
      </div>

      {/* Editor surface */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {/* Placeholder — overlaid only when the editor is truly empty so it
            doesn't interfere with typing or selection. pointer-events-none
            keeps clicks landing on the editor. */}
        {isEmpty && placeholder && (
          <div className="pointer-events-none absolute left-3 top-3 select-none text-[13px] text-[#70757a]">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          onPaste={handlePaste}
          className="min-h-[220px] w-full px-3 py-3 text-[13px] leading-relaxed text-[#202124] outline-none [overflow-wrap:anywhere] [&_a]:text-[#1a73e8] [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder || "Message body"}
        />
      </div>
    </div>
  );
}

function ToolbarBtn({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      // onMouseDown prevents the editor from losing its selection before the
      // execCommand fires.  Without this, clicking Bold deselects the text
      // first and then bolds nothing.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="flex h-7 w-7 items-center justify-center rounded text-[#5f6368] hover:bg-[#e8eaed]"
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px bg-[#dadce0]" />;
}
