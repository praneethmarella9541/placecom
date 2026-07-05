import { NextResponse } from "next/server";

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { assertUserWithinTokenLimit } from "@/lib/openai-token-limit";
import { openaiCostUsd } from "@/lib/openai-pricing";
import { resolveModelId } from "@/lib/mail-assistant/models";
import {
  MAIL_ASSISTANT_TOOLS,
  executeMailTool,
  extractSourcesFromToolResult,
  type MailSource,
} from "@/lib/mail-assistant/tools";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Hard cap on tool round-trips so a confused model can't loop forever. */
const MAX_STEPS = 6;

type ChatTurn = { role: "user" | "assistant"; content: string };

type Body = {
  /** The user's new question. */
  message?: string;
  /** Prior turns for multi-turn chat (optional). */
  history?: ChatTurn[];
  /** Model id from the picker; validated server-side. */
  model?: string;
  /** When true (default), streams NDJSON events; otherwise returns one JSON. */
  stream?: boolean;
};

const SYSTEM_PROMPT = [
  "You are a mail assistant embedded in a CRM. You answer questions about the",
  "signed-in user's Gmail mailbox using the provided tools.",
  "",
  "Finding & answering:",
  "- Use search_emails (Gmail query syntax) to find candidates, then get_email",
  "  to read them.",
  "- search_emails returns only a TRUNCATED body_preview. NEVER answer a question",
  "  about amounts, fees, dates, numbers, or any specific detail from the preview.",
  "  If the answer requires content inside an email, you MUST call get_email on",
  "  every relevant candidate (in parallel) and read the full body first.",
  "- Be PROACTIVE, like a capable assistant: when the user asks for details,",
  "  just open the relevant emails and give the complete answer in one go. Do NOT",
  "  stop at previews and ask 'which one should I open first?' — open them all",
  "  (up to ~6) and answer. Only ask the user when the request is genuinely",
  "  ambiguous, not to avoid reading.",
  "- For sender questions, search with from:<address-or-name>. For time ranges",
  "  use after:/before:/newer_than:. Today's date is available to you implicitly.",
  "- Never invent emails, senders, dates, or contents. If, after reading the full",
  "  bodies, the detail truly isn't there, say so plainly.",
  "- Be concise. When summarizing multiple emails, group by sender or thread and",
  "  cite subjects/dates so the user can verify.",
  "",
  "Capabilities — IMPORTANT:",
  "- You can ONLY search the mailbox and read message contents. You CANNOT",
  "  download or attach files, generate or compile PDFs, send mail, or draft",
  "  replies. Never offer to do any of those — do not end answers with offers",
  "  like 'shall I download the PDF / compile a PDF / draft a reply'. Only offer",
  "  follow-ups you can actually perform (find more emails, or read/summarize a",
  "  specific one in more detail).",
  "",
  "Citations:",
  "- Cite your sources inline. Immediately after any fact taken from an email,",
  "  add a marker of the exact form [[msg:<id>]], using the message id from the",
  "  tool results (the 'id' field). Example: 'You were charged ₹690 [[msg:18f3a]].'",
  "- Only cite ids you actually read. You may cite multiple, e.g. [[msg:a]][[msg:b]].",
  "  Do not write a separate 'Sources' section — just the inline markers.",
  "",
  "Answer style — write like a sharp human assistant, not a form:",
  "- Lead with a single natural sentence that directly answers the question,",
  "  e.g. 'Anand Kumar emailed you about an Accenture hiring webinar in Indore.'",
  "- Then give ONLY the details that matter to the user, as a short bold-labelled",
  "  list (Date, Time, Amount, Deadline, etc.). Extract substance — never recite",
  "  the email's structure.",
  "- DROP all boilerplate: greetings ('Hi X'), sign-offs ('Regards, Team Y'),",
  "  signatures, legal disclaimers, unsubscribe footers, and marketing filler",
  "  like 'spots are filling fast'. Do NOT label things 'Greeting:' / 'Closing:'.",
  "- Do NOT print a raw From/Date/Subject header block unless the user explicitly",
  "  asks to see the email's metadata. The citation already links the source.",
  "- When summarizing a thread, never paste quoted '>'/'>>>>' chains — condense",
  "  each earlier message to a line.",
  "- End with a brief, genuinely useful follow-up offer ONLY if one fits (e.g.",
  "  'Want me to find related emails?'). Never offer actions you cannot do.",
  "",
  "Formatting:",
  "- Reply in clean Markdown: short paragraphs, **bold** for labels, and '-'",
  "  bullet lists. Keep it tight — no walls of text.",
].join("\n");

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  const timeoutMs = parseInt(process.env.OPENAI_TIMEOUT_MS || "240000", 10);
  return new OpenAI({ apiKey: key, timeout: timeoutMs });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = body.message?.trim();
  if (!question) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Auth + Gmail access (accepts both web cookie and mobile Bearer sessions).
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  // Reuse the existing per-user OpenAI spend guardrail.
  const within = await assertUserWithinTokenLimit(auth.userId);
  if (!within.ok) {
    return NextResponse.json({ error: within.message }, { status: 429 });
  }

  // Capture into consts so the narrowed type survives inside the async closures below.
  const accessToken = auth.accessToken;
  const model = resolveModelId(body.model);
  const wantStream = body.stream !== false;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(body.history ?? [])
      .filter((t) => t && typeof t.content === "string" && t.content.trim())
      .map<ChatCompletionMessageParam>((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];

  const encoder = new TextEncoder();

  // Runs the tool-calling agent loop. `emit` streams progress events; for the
  // non-streaming path it's a no-op and we return the final answer as JSON.
  async function runAgent(
    emit: (event: Record<string, unknown>) => void
  ): Promise<{
    answer: string;
    inputTokens: number;
    outputTokens: number;
    sources: MailSource[];
  }> {
    const client = getClient();
    let inputTokens = 0;
    let outputTokens = 0;
    // Dedupe citable emails by message id, preserving first-seen order.
    const sourcesById = new Map<string, MailSource>();

    for (let step = 0; step < MAX_STEPS; step++) {
      const completion = await client.chat.completions.create({
        model,
        messages,
        tools: MAIL_ASSISTANT_TOOLS,
        tool_choice: "auto",
      });

      inputTokens += completion.usage?.prompt_tokens ?? 0;
      outputTokens += completion.usage?.completion_tokens ?? 0;

      const choice = completion.choices[0]?.message;
      if (!choice) throw new Error("Empty response from model.");

      // Push the assistant turn (may include tool calls) back into history.
      messages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return {
          answer: choice.content ?? "",
          inputTokens,
          outputTokens,
          sources: Array.from(sourcesById.values()),
        };
      }

      // Execute each requested tool and feed results back to the model.
      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        emit({
          type: "tool_call",
          name: call.function.name,
          args: call.function.arguments,
        });
        const result = await executeMailTool(accessToken, call);
        for (const src of extractSourcesFromToolResult(result)) {
          if (!sourcesById.has(src.id)) sourcesById.set(src.id, src);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    // Ran out of steps — ask for a final answer without more tools.
    const finalCompletion = await getClient().chat.completions.create({
      model,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Stop using tools and answer now with what you've gathered so far.",
        },
      ],
    });
    inputTokens += finalCompletion.usage?.prompt_tokens ?? 0;
    outputTokens += finalCompletion.usage?.completion_tokens ?? 0;
    return {
      answer: finalCompletion.choices[0]?.message?.content ?? "",
      inputTokens,
      outputTokens,
      sources: Array.from(sourcesById.values()),
    };
  }

  // ---- Non-streaming: single JSON response ----
  if (!wantStream) {
    try {
      const { answer, inputTokens, outputTokens, sources } = await runAgent(() => {});
      return NextResponse.json({
        answer,
        model,
        sources,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: openaiCostUsd(model, inputTokens, outputTokens),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Mail assistant failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ---- Streaming: NDJSON events (tool_call, answer, done, error) ----
  const out = new ReadableStream({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        emit({ type: "start", model });
        const { answer, inputTokens, outputTokens, sources } = await runAgent(emit);
        emit({ type: "sources", sources });
        emit({ type: "answer", content: answer });
        emit({
          type: "done",
          usage: {
            inputTokens,
            outputTokens,
            costUsd: openaiCostUsd(model, inputTokens, outputTokens),
          },
        });
      } catch (e) {
        emit({
          type: "error",
          error: e instanceof Error ? e.message : "Mail assistant failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
