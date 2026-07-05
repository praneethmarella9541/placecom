import "server-only";

import type {
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";

import { fetchGmailMessage, listMessageIdsPage } from "@/lib/gmail";

/**
 * Gmail "tools" exposed to the model. The model decides when to call them;
 * Gmail's own query syntax (from:, subject:, after:, has:attachment, label:…)
 * is the retriever — no vector store needed for option 1.
 */
export const MAIL_ASSISTANT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_emails",
      description:
        "Search the signed-in user's Gmail mailbox and return matching message headers " +
        "(id, from, subject, date, snippet). Use Gmail search syntax in `query`, e.g. " +
        "`from:acme.com after:2026/06/01`, `subject:invoice`, `has:attachment newer_than:7d`. " +
        "Call get_email afterwards to read the full body of any result.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Gmail search query. Combine operators freely. Dates use YYYY/MM/DD. " +
              "Leave empty to list the most recent messages.",
          },
          max_results: {
            type: "integer",
            description: "How many messages to return (1–25).",
            minimum: 1,
            maximum: 25,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_email",
      description:
        "Fetch the full content (subject, from, date, plain-text body) of a single email " +
        "by its message id, which you get from search_emails.",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "Gmail message id returned by search_emails.",
          },
        },
        required: ["message_id"],
        additionalProperties: false,
      },
    },
  },
];

const MAX_BODY_CHARS = 6000;

/**
 * Tidy a plain-text email body before handing it to the model:
 * - strip leading "> " quote markers (keeps the text, drops the clutter)
 * - drop boilerplate legal-disclaimer lines
 * - collapse runs of blank lines
 * This stops the model from echoing ">>>>"-laced quote chains back to the user.
 */
function cleanEmailBody(raw: string): string {
  const DISCLAIMER = /(this email and any attachments are confidential|unauthorized use, disclosure, copying|views expressed are those of the sender)/i;

  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    const dequoted = line.replace(/^\s*(?:>\s?)+/, "").trimEnd();
    if (DISCLAIMER.test(dequoted)) continue;

    if (dequoted.trim() === "") {
      blankRun++;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }
    out.push(dequoted);
  }

  return out.join("\n").trim();
}

function clampBody(body: string): string {
  const cleaned = cleanEmailBody(body);
  if (cleaned.length <= MAX_BODY_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_BODY_CHARS)}\n…[truncated]`;
}

/**
 * Executes a single tool call against Gmail and returns a JSON string for the
 * model. Errors are returned as JSON (not thrown) so the agent loop can keep
 * going and let the model explain or retry.
 */
export async function executeMailTool(
  accessToken: string,
  call: ChatCompletionMessageFunctionToolCall
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return JSON.stringify({ error: "Invalid tool arguments JSON." });
  }

  try {
    if (call.function.name === "search_emails") {
      const query = typeof args.query === "string" ? args.query : "";
      const max = Math.min(
        25,
        Math.max(1, Number.isFinite(Number(args.max_results)) ? Number(args.max_results) : 10)
      );

      const { messageIds } = await listMessageIdsPage(accessToken, {
        maxResults: max,
        q: query || undefined,
      });

      // Hydrate headers (and a short preview) so the model can pick what to read.
      // NOTE: body_preview is TRUNCATED — never answer detail questions from it;
      // call get_email for the full body.
      const summaries = await Promise.all(
        messageIds.slice(0, max).map(async (id) => {
          try {
            const m = await fetchGmailMessage(accessToken, id);
            const truncated = m.body.length > 200;
            return {
              id: m.id,
              thread_id: m.threadId,
              from: m.from,
              subject: m.subject,
              date: m.date,
              body_preview: m.body.slice(0, 200),
              body_truncated: truncated,
              has_images: Boolean(m.images?.length),
            };
          } catch {
            return { id, error: "Could not load this message." };
          }
        })
      );

      return JSON.stringify({
        query,
        count: summaries.length,
        note: "body_preview is truncated. Call get_email to read full contents before answering questions about amounts, dates, or specifics.",
        results: summaries,
      });
    }

    if (call.function.name === "get_email") {
      const id = typeof args.message_id === "string" ? args.message_id : "";
      if (!id) return JSON.stringify({ error: "message_id is required." });

      const m = await fetchGmailMessage(accessToken, id);
      return JSON.stringify({
        id: m.id,
        thread_id: m.threadId,
        from: m.from,
        subject: m.subject,
        date: m.date,
        body: clampBody(m.body),
        has_images: Boolean(m.images?.length),
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${call.function.name}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tool execution failed.";
    return JSON.stringify({ error: message });
  }
}

/** A citable email, surfaced to the UI so [[msg:id]] markers become clickable. */
export type MailSource = {
  id: string;
  threadId?: string;
  subject?: string;
  from?: string;
  date?: string;
};

/**
 * Pulls citable email references out of a tool result JSON string (from either
 * search_emails or get_email) so the route can stream them to the client.
 */
export function extractSourcesFromToolResult(resultJson: string): MailSource[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return [];
  }

  const toSource = (o: Record<string, unknown>): MailSource | null => {
    const id = typeof o.id === "string" ? o.id : null;
    if (!id) return null;
    return {
      id,
      threadId: typeof o.thread_id === "string" ? o.thread_id : undefined,
      subject: typeof o.subject === "string" ? o.subject : undefined,
      from: typeof o.from === "string" ? o.from : undefined,
      date: typeof o.date === "string" ? o.date : undefined,
    };
  };

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      return obj.results
        .map((r) => toSource(r as Record<string, unknown>))
        .filter((s): s is MailSource => s !== null);
    }
    const single = toSource(obj);
    return single ? [single] : [];
  }
  return [];
}
