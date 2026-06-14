import { NextResponse } from "next/server";
import { groupContactsFromExtraction } from "@/lib/contact-grouping";
import { sanitizeContactPhone, sanitizeExtractedPhones } from "@/lib/phone";
import { createServerSupabaseClient } from "@/lib/supabase-server";

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("email_extractions")
    .select(
      "email_id, subject, sender, body, extracted_names, extracted_phones, extracted_emails, extracted_contacts, position, created_at"
    )
    .eq("user_id", user.id)
    .order("position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const header = [
    "email_id",
    "subject",
    "sender",
    "body",
    "contacts_paired",
    "names",
    "phones",
    "emails",
    "position",
    "created_at",
  ];

  const lines = [header.join(",")];

  for (const r of rows || []) {
    const names = Array.isArray(r.extracted_names)
      ? (r.extracted_names as string[]).join("; ")
      : "";
    const rawPhones = Array.isArray(r.extracted_phones) ? (r.extracted_phones as string[]) : [];
    const phones = sanitizeExtractedPhones(rawPhones).join("; ");
    const emails = Array.isArray(r.extracted_emails)
      ? (r.extracted_emails as string[]).join("; ")
      : "";
    const stored = r.extracted_contacts as
      | { name: string | null; email: string | null; phone: string | null }[]
      | null
      | undefined;
    const contacts = (
      stored && Array.isArray(stored) && stored.length > 0
        ? stored
        : groupContactsFromExtraction({
            subject: (r.subject as string) || "",
            body: (r.body as string) || "",
            sender: (r.sender as string) || "",
            names: (r.extracted_names as string[]) || [],
            phones: rawPhones,
            emails: (r.extracted_emails as string[]) || [],
          })
    ).map(sanitizeContactPhone);
    const contactsPaired = contacts
      .map((c) =>
        [
          c.name ? `name=${c.name}` : "",
          c.email ? `email=${c.email}` : "",
          c.phone ? `phone=${c.phone}` : "",
        ]
          .filter(Boolean)
          .join(" | ")
      )
      .filter(Boolean)
      .join(" || ");

    lines.push(
      [
        escapeCsvCell(r.email_id || ""),
        escapeCsvCell(r.subject || ""),
        escapeCsvCell(r.sender || ""),
        escapeCsvCell((r.body || "").slice(0, 5000)),
        escapeCsvCell(contactsPaired),
        escapeCsvCell(names),
        escapeCsvCell(phones),
        escapeCsvCell(emails),
        escapeCsvCell(
          r.position !== null && r.position !== undefined
            ? String(r.position)
            : ""
        ),
        escapeCsvCell(r.created_at || ""),
      ].join(",")
    );
  }

  const csv = lines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gmail-extractions-${user.id.slice(0, 8)}.csv"`,
    },
  });
}
