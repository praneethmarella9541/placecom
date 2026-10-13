import DOMPurify from "dompurify";

/**
 * Sanitize user/merge-generated HTML before it goes into dangerouslySetInnerHTML.
 * Keeps normal formatting (links, lists, bold, tables, inline styles) and strips
 * scripts, event handlers and javascript: URLs. Browser-only: on the server there
 * is no DOM, so it returns "" rather than passing HTML through unsanitized.
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}
