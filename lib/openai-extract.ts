import "server-only";

import OpenAI from "openai";

import { groupContactsFromExtraction } from "@/lib/contact-grouping";
import { openaiCostUsd } from "@/lib/openai-pricing";

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_BODY_CHARS = 12_000;
const SUB_BATCH = 5;

export type ExtractEmailIn = {
  id: string;
  subject: string;
  body: string;
  from?: string;
};

export type ExtractedContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

export type OpenAIExtractResult = {
  id: string;
  names: string[];
  phones: string[];
  emails: string[];
  contacts: ExtractedContact[];
};

const RESULT_SCHEMA = {
  type: "object" as const,
  properties: {
    results: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          names: { type: "array" as const, items: { type: "string" as const } },
          phones: { type: "array" as const, items: { type: "string" as const } },
          emails: { type: "array" as const, items: { type: "string" as const } },
          contacts: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string" as const },
                email: { type: "string" as const },
                phone: { type: "string" as const },
              },
              required: ["name", "email", "phone"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "names", "phones", "emails", "contacts"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const SYSTEM = `You extract contact information from email messages. For EACH email (identified by id), return:

1. **contacts** — an array of logical people/rows. Each row has optional name, email, phone when you can infer they belong together (same signature block, same line, "Name <email>", "email | phone", etc.). Use one row per distinct person when possible.

2. **names**, **phones**, **emails** — flat deduplicated lists of EVERY distinct person name, phone number, and email you found in that email (including those already in contacts).

Rules:
- Only extract what appears in the message; do not invent data.
- Prefer real human names over company names for **names** and **contacts[].name**.
- Exclude obvious noreply/system addresses from meaningful contacts when possible.
- You MUST return exactly one object in **results** per input email id, with the same **id** string.
- For each **contacts[]** row, use JSON empty string "" (not null) for any unknown name, email, or phone field (the schema requires strings).`;

function trimBody(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_BODY_CHARS) return t;
  return `${t.slice(0, MAX_BODY_CHARS)}\n\n[…truncated for API size…]`;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not set. Add it to your .env (see .env.example)."
      );
    }
    _client = new OpenAI({ apiKey: key });
  }
  return _client;
}

function getModel(): string {
  return (process.env.OPENAI_EXTRACTION_MODEL || DEFAULT_MODEL).trim();
}

/** GPT-5 models reject `temperature: 0` (only default 1). Omit the field to use the default. */
function extractionSamplingParams(model: string): { temperature?: number } {
  const m = model.toLowerCase();
  if (m.includes("gpt-5")) return {};
  return { temperature: 0 };
}

function dedupeStrings(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim();
    if (!k) continue;
    const low = k.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(k);
  }
  return out;
}

function normalizeContacts(raw: unknown): ExtractedContact[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedContact[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : null;
    const email =
      typeof o.email === "string" && o.email.trim() ? o.email.trim().toLowerCase() : null;
    const phone =
      typeof o.phone === "string" && o.phone.trim() ? o.phone.trim() : null;
    if (!name && !email && !phone) continue;
    out.push({ name, email, phone });
  }
  return out;
}

async function callOpenAIOnce(emails: ExtractEmailIn[]): Promise<{
  results: OpenAIExtractResult[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}> {
  const model = getModel();
  const userBlock = emails
    .map(
      (e, i) =>
        `--- EMAIL ${i + 1} ---\nid: ${e.id}\nfrom_header: ${(e.from || "").slice(0, 500)}\nsubject: ${e.subject}\nbody:\n${trimBody(e.body)}`
    )
    .join("\n\n");

  const client = getClient();
  const response = await client.chat.completions.create({
    model,
    ...extractionSamplingParams(model),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "email_extraction_batch",
        strict: true,
        schema: RESULT_SCHEMA,
      },
    },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userBlock },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  const usage = response.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  if (!raw) {
    return {
      results: emails.map((e) => ({
        id: e.id,
        names: [],
        phones: [],
        emails: [],
        contacts: [],
      })),
      usage,
    };
  }

  let parsed: { results: OpenAIExtractResult[] };
  try {
    parsed = JSON.parse(raw) as { results: OpenAIExtractResult[] };
  } catch {
    console.error("OpenAI JSON parse failed:", raw.slice(0, 500));
    return {
      results: emails.map((e) => ({
        id: e.id,
        names: [],
        phones: [],
        emails: [],
        contacts: [],
      })),
      usage,
    };
  }

  const byId = new Map<string, OpenAIExtractResult>();
  for (const r of parsed.results || []) {
    byId.set(r.id, {
      id: r.id,
      names: dedupeStrings(Array.isArray(r.names) ? r.names : []),
      phones: dedupeStrings(Array.isArray(r.phones) ? r.phones : []),
      emails: dedupeStrings(Array.isArray(r.emails) ? r.emails : []),
      contacts: normalizeContacts(r.contacts),
    });
  }

  const results = emails.map((e) => {
    const r = byId.get(e.id);
    if (r) return r;
    return {
      id: e.id,
      names: [],
      phones: [],
      emails: [],
      contacts: [],
    };
  });

  for (const r of results) {
    const src = emails.find((x) => x.id === r.id);
    if (!src) continue;
    if (!r.contacts.length) {
      r.contacts = groupContactsFromExtraction({
        subject: src.subject || "",
        body: src.body || "",
        sender: src.from || "",
        names: r.names,
        phones: r.phones,
        emails: r.emails,
      });
    }
  }

  return { results, usage };
}

export async function extractEmailsWithOpenAI(
  emails: ExtractEmailIn[]
): Promise<{
  results: OpenAIExtractResult[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  costUsd: number;
}> {
  if (emails.length === 0) {
    return {
      results: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      costUsd: 0,
    };
  }

  const model = getModel();
  let prompt = 0;
  let completion = 0;
  const all: OpenAIExtractResult[] = [];

  for (let i = 0; i < emails.length; i += SUB_BATCH) {
    const slice = emails.slice(i, i + SUB_BATCH);
    const { results, usage } = await callOpenAIOnce(slice);
    all.push(...results);
    prompt += usage.prompt_tokens ?? 0;
    completion += usage.completion_tokens ?? 0;
  }

  const usage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
  const costUsd = openaiCostUsd(model, prompt, completion);
  return { results: all, usage, costUsd };
}
