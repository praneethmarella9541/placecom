import { extractEmailAddress } from "@/lib/email-parse";
import { isExtractablePhone } from "@/lib/phone";

export type GroupedContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

const NAME_EMAIL_ANGLE =
  /([^<\n]{1,100}?)\s*<\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*>/gi;

/** Same-line phone pairing — Indian mobiles, toll-free, and +E.164 only. */
const PHONE_RE =
  /\+91[\s.-]?[6-9]\d{9}\b|\+[1-9]\d{9,14}\b|\b0[6-9]\d{9}\b|\b[6-9]\d{9}\b|\b1(800|860|865)[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

function emailLineSource(): string {
  return "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}";
}

function normEmail(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

function normPhone(s: string | null | undefined): string {
  return (s || "").replace(/[\s().-]/g, "");
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function parseDisplayNameFromFromHeader(fromHeader: string): string | null {
  const t = fromHeader.trim();
  if (!t) return null;
  const m = t.match(/^(.+?)\s*<[^>]+>\s*$/);
  if (!m) return null;
  let n = stripQuotes(m[1].trim());
  n = n.replace(/^mailto:/i, "").trim();
  if (!n || n.includes("@")) return null;
  return n.length > 1 && n.length <= 120 ? n : null;
}

function contactKey(c: GroupedContact): string {
  return [
    normEmail(c.email),
    normPhone(c.phone),
    (c.name || "").toLowerCase().trim(),
  ].join("|");
}

function addContact(
  list: GroupedContact[],
  seen: Set<string>,
  c: GroupedContact
): void {
  const has =
    (c.name && c.name.trim()) ||
    (c.email && c.email.trim()) ||
    (c.phone && c.phone.trim());
  if (!has) return;
  const row: GroupedContact = {
    name: c.name?.trim() || null,
    email: c.email?.trim() || null,
    phone: c.phone?.trim() || null,
  };
  const k = contactKey(row);
  if (seen.has(k)) return;
  seen.add(k);
  list.push(row);
}

function mergeByEmail(contacts: GroupedContact[]): GroupedContact[] {
  const map = new Map<string, GroupedContact>();
  const noEmail: GroupedContact[] = [];

  for (const c of contacts) {
    const e = normEmail(c.email);
    if (e) {
      const prev = map.get(e);
      if (!prev) {
        map.set(e, { ...c });
      } else {
        prev.name = prev.name || c.name;
        prev.phone = prev.phone || c.phone;
      }
    } else {
      noEmail.push(c);
    }
  }

  const merged = [...Array.from(map.values()), ...noEmail];
  const seen = new Set<string>();
  const out: GroupedContact[] = [];
  for (const c of merged) {
    const k = contactKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * Build logically grouped contacts from flat extraction lists + message context.
 * Heuristics: From header, `Name <email>` patterns, same-line email+phone proximity.
 * Unpaired items appear as partial rows where needed.
 */
export function groupContactsFromExtraction(input: {
  subject: string;
  body: string;
  sender: string;
  names: string[];
  phones: string[];
  emails: string[];
}): GroupedContact[] {
  const { subject, body, sender, names, phones, emails } = input;
  const list: GroupedContact[] = [];
  const seen = new Set<string>();

  const text = `${subject}\n${body}`;

  if (sender?.trim()) {
    const addr = extractEmailAddress(sender).trim();
    const senderEmail = normEmail(addr);
    const senderName = parseDisplayNameFromFromHeader(sender);
    if (senderEmail && addr.includes("@")) {
      addContact(list, seen, {
        name: senderName,
        email: addr,
        phone: null,
      });
    }
  }

  NAME_EMAIL_ANGLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME_EMAIL_ANGLE.exec(text)) !== null) {
    const rawName = stripQuotes(m[1].replace(/\s+/g, " ").trim());
    const em = m[2].trim();
    if (rawName.length < 2 || rawName.includes("@")) continue;
    addContact(list, seen, { name: rawName, email: em, phone: null });
  }

  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const emMatches = Array.from(
      line.matchAll(new RegExp(emailLineSource(), "gi"))
    ).map((x) => ({ v: x[0], i: x.index ?? 0 }));
    const phMatches = Array.from(line.matchAll(new RegExp(PHONE_RE.source, "g")))
      .map((x) => ({ v: x[0].trim(), i: x.index ?? 0 }))
      .filter((x) => isExtractablePhone(x.v));
    if (emMatches.length === 0 || phMatches.length === 0) continue;

    for (const ph of phMatches) {
      let best = emMatches[0];
      let bestDist = Math.abs(ph.i - emMatches[0].i);
      for (const em of emMatches) {
        const d = Math.abs(ph.i - em.i);
        if (d < bestDist) {
          bestDist = d;
          best = em;
        }
      }
      if (bestDist <= 120) {
        addContact(list, seen, {
          name: null,
          email: best.v,
          phone: ph.v,
        });
      }
    }
  }

  const emailsAlready = new Set(
    list.map((c) => normEmail(c.email)).filter(Boolean)
  );
  const phonesAlready = new Set(
    list.map((c) => normPhone(c.phone)).filter(Boolean)
  );

  for (const em of emails) {
    const n = normEmail(em);
    if (!n || emailsAlready.has(n)) continue;
    emailsAlready.add(n);
    let pairedName: string | null = null;
    const idx = text.toLowerCase().indexOf(em.toLowerCase());
    if (idx > 0) {
      const window = text.slice(Math.max(0, idx - 80), idx);
      for (const nm of names) {
        if (!nm.trim()) continue;
        if (window.toLowerCase().includes(nm.toLowerCase())) {
          pairedName = nm.trim();
          break;
        }
      }
    }
    addContact(list, seen, { name: pairedName, email: em.trim(), phone: null });
  }

  for (const ph of phones) {
    if (!isExtractablePhone(ph)) continue;
    const p = normPhone(ph);
    if (!p || phonesAlready.has(p)) continue;
    phonesAlready.add(p);
    addContact(list, seen, { name: null, email: null, phone: ph.trim() });
  }

  const namesUsed = new Set(
    list.map((c) => (c.name || "").toLowerCase()).filter(Boolean)
  );
  const senderNameLow = sender
    ? (parseDisplayNameFromFromHeader(sender) || "").toLowerCase()
    : "";
  for (const nm of names) {
    const t = nm.trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (namesUsed.has(low)) continue;
    if (senderNameLow && low === senderNameLow) continue;
    namesUsed.add(low);
    addContact(list, seen, { name: t, email: null, phone: null });
  }

  return mergeByEmail(list);
}
