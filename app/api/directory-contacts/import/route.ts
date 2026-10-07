import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import {
  MAX_IMPORT_ROWS,
  contactDisplayName,
  normalizeImportRow,
  planImport,
  type ContactImportResult,
  type DuplicateMode,
  type ExistingContact,
  type ImportedContact,
  type MappedRow,
  type RowProblem,
} from "@/lib/contact-import";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { resolveMailboxOwnerId } from "@/lib/team-scope";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Rows per insert request — one round trip for most imports, small enough that a bad chunk costs little. */
const INSERT_CHUNK = 500;
/** Parallel single-row updates; each holds a pooled connection, same reasoning as fetchAllRows' limit. */
const UPDATE_CONCURRENCY = 6;

/** Per-field caps — a pasted essay in a name cell shouldn't reach the table. */
const FIELD_LIMITS: Record<keyof Omit<MappedRow, "line">, number> = {
  name: 200,
  email: 320,
  phone: 64,
  company: 300,
  title: 300,
  linkedin_url: 500,
  location: 300,
  tags: 2000,
  notes: 10000,
};

function readRows(value: unknown): MappedRow[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item, index) => {
    const obj = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const field = (key: keyof typeof FIELD_LIMITS) =>
      typeof obj[key] === "string" ? (obj[key] as string).slice(0, FIELD_LIMITS[key]) : "";
    return {
      line: typeof obj.line === "number" && Number.isFinite(obj.line) ? obj.line : index + 1,
      name: field("name"),
      email: field("email"),
      phone: field("phone"),
      company: field("company"),
      title: field("title"),
      linkedin_url: field("linkedin_url"),
      location: field("location"),
      tags: field("tags"),
      notes: field("notes"),
    };
  });
}

function toInsertRow(c: ImportedContact) {
  return {
    name: contactDisplayName(c),
    email: c.email,
    phone: c.phone,
    company: c.company,
    title: c.title,
    linkedin_url: c.linkedin_url,
    location: c.location,
    tags: c.tags,
    notes: c.notes,
  };
}

/**
 * POST /api/directory-contacts/import — bulk-adds mapped rows from the import
 * dialog to the caller's team directory. Every row is re-validated here (the
 * dialog's preview is advisory), and duplicates are matched against the
 * directory as it stands now, not as the dialog last saw it.
 */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    rows?: unknown;
    mode?: unknown;
    batchTag?: unknown;
  } | null;
  const rows = readRows(body?.rows);
  if (!rows) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  if (rows.length === 0) return NextResponse.json({ error: "Nothing to import" }, { status: 400 });
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Import up to ${MAX_IMPORT_ROWS.toLocaleString()} contacts at a time` },
      { status: 400 }
    );
  }
  const mode: DuplicateMode = body?.mode === "update" ? "update" : "skip";
  const batchTag = typeof body?.batchTag === "string" ? body.batchTag.trim().slice(0, 100) : "";

  const mailboxOwnerId = await resolveMailboxOwnerId(supabase, user.id);
  if (!mailboxOwnerId) {
    return NextResponse.json(
      { error: "Your account is not linked to an admin mailbox yet." },
      { status: 403 }
    );
  }

  const invalid: RowProblem[] = [];
  const valid: ImportedContact[] = [];
  for (const row of rows) {
    const result = normalizeImportRow(row);
    if (result.ok) valid.push(result.contact);
    else invalid.push({ line: result.line, reason: result.reason });
  }

  // RLS scopes this to the caller's team, which is exactly the set a
  // duplicate has to be found in.
  const { data: existing, error: loadError } = await fetchAllRows<ExistingContact>((from, to) =>
    supabase
      .from("directory_contacts")
      .select("id, name, email, phone, company, title, linkedin_url, location, tags, notes")
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (loadError) return NextResponse.json({ error: loadError }, { status: 500 });

  const plan = planImport(valid, existing, mode, batchTag);
  const failed: RowProblem[] = [];

  let created = 0;
  for (let i = 0; i < plan.creates.length; i += INSERT_CHUNK) {
    const chunk = plan.creates.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from("directory_contacts").insert(
      chunk.map((c) => ({
        ...toInsertRow(c),
        created_by: user.id,
        updated_by: user.id,
        mailbox_owner_id: mailboxOwnerId,
      }))
    );
    if (error) {
      console.error("[contact-import] insert failed", error);
      for (const c of chunk) failed.push({ line: c.line, reason: `Couldn't save: ${error.message}` });
    } else {
      created += chunk.length;
    }
  }

  const now = new Date().toISOString();
  const updateResults = await runWithConcurrency(plan.updates, UPDATE_CONCURRENCY, async (u) => {
    const { error } = await supabase
      .from("directory_contacts")
      .update({ ...u.patch, updated_by: user.id, updated_at: now })
      .eq("id", u.existing.id);
    if (error) {
      for (const line of u.lines) failed.push({ line, reason: `Couldn't update ${u.existing.name}: ${error.message}` });
      return false;
    }
    return true;
  });

  const result: ContactImportResult = {
    created,
    updated: updateResults.filter(Boolean).length,
    unchanged: plan.unchanged,
    skippedExisting: plan.skippedExisting,
    mergedInFile: plan.mergedInFile,
    invalid,
    failed: failed.sort((a, b) => a.line - b.line),
  };
  return NextResponse.json(result);
}
