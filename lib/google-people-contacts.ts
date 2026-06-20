import "server-only";

import { normalizeGooglePhotoUrl } from "@/lib/google-photo-url";

type PersonLike = {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[];
  phoneNumbers?: { value?: string; canonicalForm?: string; metadata?: { primary?: boolean } }[];
  photos?: { url?: string; default?: boolean; metadata?: { primary?: boolean } }[];
};

type ContactEntry = {
  displayName: string;
  photoUrl?: string;
};

const PEOPLE_API = "https://people.googleapis.com/v1";
const MAX_PAGES = 25;

function extractPhotoUrl(p: PersonLike): string | undefined {
  const photos = p.photos ?? [];
  if (!photos.length) return undefined;
  const primary =
    photos.find((ph) => ph.metadata?.primary && ph.url && !ph.default) ??
    photos.find((ph) => ph.url && !ph.default) ??
    photos.find((ph) => ph.url);
  const raw = primary?.url?.trim();
  return raw ? normalizeGooglePhotoUrl(raw) : undefined;
}

function mergePerson(map: Map<string, ContactEntry>, p: PersonLike) {
  const name = p.names?.[0]?.displayName?.trim();
  const photoUrl = extractPhotoUrl(p);
  const emails = p.emailAddresses ?? [];
  const sorted = [...emails].sort((a, b) => {
    if (a.metadata?.primary) return -1;
    if (b.metadata?.primary) return 1;
    return 0;
  });
  const list = sorted.length ? sorted : emails;
  for (const ea of list) {
    const raw = ea.value?.trim().toLowerCase();
    if (!raw?.includes("@")) continue;
    const label = name || raw;
    const existing = map.get(raw);
    map.set(raw, {
      displayName: label,
      photoUrl: photoUrl ?? existing?.photoUrl,
    });
  }
}

async function collectConnections(accessToken: string, map: Map<string, ContactEntry>, warnings: string[]): Promise<void> {
  let pageToken: string | undefined;
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const url = new URL(`${PEOPLE_API}/people/me/connections`);
    url.searchParams.set("personFields", "names,emailAddresses,photos");
    url.searchParams.set("pageSize", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 403) {
      warnings.push(
        "Saved Google Contacts were skipped (missing permission). Sign out and sign in with Google again, then accept Contacts access.",
      );
      return;
    }
    if (!res.ok) {
      warnings.push(`Google Contacts list failed (${res.status}).`);
      return;
    }

    const data = (await res.json()) as {
      connections?: PersonLike[];
      nextPageToken?: string;
    };

    for (const p of data.connections ?? []) {
      mergePerson(map, p);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
}

async function collectOtherContacts(accessToken: string, map: Map<string, ContactEntry>, warnings: string[]): Promise<void> {
  let pageToken: string | undefined;
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const url = new URL(`${PEOPLE_API}/otherContacts`);
    url.searchParams.set("readMask", "emailAddresses,names,photos");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 403) {
      warnings.push(
        "Other contacts (from Gmail interactions) were skipped (missing permission). Sign out and sign in with Google again.",
      );
      return;
    }
    if (!res.ok) {
      warnings.push(`Google other contacts failed (${res.status}).`);
      return;
    }

    const data = (await res.json()) as {
      otherContacts?: PersonLike[];
      nextPageToken?: string;
    };

    for (const p of data.otherContacts ?? []) {
      mergePerson(map, p);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
}

async function fetchMePhotoUrl(accessToken: string): Promise<string | undefined> {
  const url = new URL(`${PEOPLE_API}/people/me`);
  url.searchParams.set("personFields", "photos");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;

  const data = (await res.json()) as PersonLike;
  return extractPhotoUrl(data);
}

export type GoogleComposeContact = {
  email: string;
  displayName?: string;
  photoUrl?: string;
};

export type GoogleComposeContactsResult = {
  contacts: GoogleComposeContact[];
  photoByEmail: Record<string, string>;
  mePhotoUrl?: string;
  hint?: string;
};

/**
 * People API prefix search — same backend Gmail uses for contact suggestions.
 * https://developers.google.com/people/api/rest/v1/people/searchContacts
 */
export async function searchContactsByQuery(
  accessToken: string,
  query: string,
): Promise<GoogleComposeContact[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  const url = new URL(`${PEOPLE_API}/people:searchContacts`);
  url.searchParams.set("query", q);
  url.searchParams.set("readMask", "emailAddresses,names,photos");
  url.searchParams.set("pageSize", "15");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: { person?: PersonLike }[] };
  const out: GoogleComposeContact[] = [];
  const seen = new Set<string>();

  for (const row of data.results ?? []) {
    const person = row.person;
    const name = person?.names?.[0]?.displayName?.trim();
    const photoUrl = person ? extractPhotoUrl(person) : undefined;
    for (const ea of person?.emailAddresses ?? []) {
      const email = ea.value?.trim().toLowerCase();
      if (!email?.includes("@") || seen.has(email)) continue;
      seen.add(email);
      out.push({
        email,
        displayName: name && name.toLowerCase() !== email ? name : undefined,
        photoUrl,
      });
    }
  }
  return out;
}

export async function fetchGoogleContactsForCompose(accessToken: string): Promise<GoogleComposeContactsResult> {
  const map = new Map<string, ContactEntry>();
  const warnings: string[] = [];

  const mePhotoUrl = await fetchMePhotoUrl(accessToken);
  await collectConnections(accessToken, map, warnings);
  await collectOtherContacts(accessToken, map, warnings);

  const photoByEmail: Record<string, string> = {};
  const contacts = Array.from(map.entries()).map(([email, entry]) => {
    if (entry.photoUrl) photoByEmail[email] = entry.photoUrl;
    return {
      email,
      displayName: entry.displayName !== email ? entry.displayName : undefined,
      photoUrl: entry.photoUrl,
    };
  });

  return {
    contacts,
    photoByEmail,
    mePhotoUrl: mePhotoUrl ? normalizeGooglePhotoUrl(mePhotoUrl) : undefined,
    hint: warnings.length ? warnings.join(" ") : undefined,
  };
}

export type GoogleDirectoryContact = {
  name: string;
  emails: string[];
  phones: string[];
  photoUrl?: string;
};

export type GoogleDirectoryResult = {
  contacts: GoogleDirectoryContact[];
  hint?: string;
};

export async function fetchGoogleContactsDirectory(accessToken: string): Promise<GoogleDirectoryResult> {
  const contacts: GoogleDirectoryContact[] = [];
  const warnings: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages++;
    const url = new URL(`${PEOPLE_API}/people/me/connections`);
    url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers,photos");
    url.searchParams.set("pageSize", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 403) {
      warnings.push(
        "Google Contacts access was denied. Sign out and sign in with Google again, then accept Contacts access.",
      );
      break;
    }
    if (!res.ok) {
      warnings.push(`Failed to load Google Contacts (${res.status}).`);
      break;
    }

    const data = (await res.json()) as {
      connections?: PersonLike[];
      nextPageToken?: string;
    };

    for (const p of data.connections ?? []) {
      const name = p.names?.[0]?.displayName?.trim();
      if (!name) continue;

      const emails = (p.emailAddresses ?? [])
        .map((ea) => ea.value?.trim().toLowerCase())
        .filter((e): e is string => !!e && e.includes("@"));

      const phones = (p.phoneNumbers ?? [])
        .map((pn) => (pn.canonicalForm ?? pn.value)?.trim())
        .filter((ph): ph is string => !!ph);

      if (emails.length === 0 && phones.length === 0) continue;

      contacts.push({ name, emails, phones, photoUrl: extractPhotoUrl(p) });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  contacts.sort((a, b) => a.name.localeCompare(b.name));

  return {
    contacts,
    hint: warnings.length ? warnings.join(" ") : undefined,
  };
}

export type GoogleContactSyncResult =
  | { ok: true; action: "created" | "updated" }
  | { ok: false; status: number; message: string };

const CONTACTS_SCOPE_ERROR: GoogleContactSyncResult = {
  ok: false,
  status: 403,
  message:
    "Google Contacts write access isn't granted yet. The mailbox owner must sign out and sign in with Google again, then accept Contacts access.",
};

function phonesMatch(a: string, b: string): boolean {
  const x = a.replace(/\D/g, "");
  const y = b.replace(/\D/g, "");
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

/**
 * Find an existing contact whose phone matches any of `phones`, so we update in
 * place instead of duplicating. Uses people/me/connections (the authoritative,
 * immediately-consistent list) rather than people:searchContacts, which has an
 * indexing delay and misses contacts created/edited moments ago.
 */
async function findConnectionByPhones(
  accessToken: string,
  phones: string[],
): Promise<{ resourceName: string; etag: string } | null> {
  const targets = phones.map((p) => p.replace(/\D/g, "")).filter(Boolean);
  if (!targets.length) return null;

  let pageToken: string | undefined;
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const url = new URL(`${PEOPLE_API}/people/me/connections`);
    url.searchParams.set("personFields", "phoneNumbers");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    const data = (await res.json()) as {
      connections?: {
        resourceName?: string;
        etag?: string;
        phoneNumbers?: { value?: string; canonicalForm?: string }[];
      }[];
      nextPageToken?: string;
    };

    for (const p of data.connections ?? []) {
      if (!p.resourceName || !p.etag) continue;
      const match = (p.phoneNumbers ?? []).some((pn) => {
        const c = pn.canonicalForm ?? pn.value ?? "";
        return targets.some((t) => phonesMatch(c, t));
      });
      if (match) return { resourceName: p.resourceName, etag: p.etag };
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return null;
}

/**
 * Create (or update if the phone already exists) a contact in the resolved
 * Google account. Used to push in-app contacts into the shared Google address
 * book so it becomes a central hub for everyone on the mailbox.
 */
export async function syncContactToGoogle(
  accessToken: string,
  name: string,
  phoneE164: string,
  previousPhone?: string,
): Promise<GoogleContactSyncResult> {
  // Match on the old number (covers a renumber edit) or the new one, in one pass.
  const existing = await findConnectionByPhones(
    accessToken,
    previousPhone ? [previousPhone, phoneE164] : [phoneE164],
  );

  if (existing) {
    const url = new URL(`${PEOPLE_API}/${existing.resourceName}:updateContact`);
    url.searchParams.set("updatePersonFields", "names,phoneNumbers");
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          etag: existing.etag,
          names: [{ givenName: name }],
          phoneNumbers: [{ value: phoneE164 }],
        }),
      });
    } catch {
      return { ok: false, status: 502, message: "Could not reach Google to update the contact." };
    }
    if (res.status === 403) return CONTACTS_SCOPE_ERROR;
    if (!res.ok) return { ok: false, status: 502, message: `Google contact update failed (${res.status}).` };
    return { ok: true, action: "updated" };
  }

  let res: Response;
  try {
    res = await fetch(`${PEOPLE_API}/people:createContact`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ names: [{ givenName: name }], phoneNumbers: [{ value: phoneE164 }] }),
    });
  } catch {
    return { ok: false, status: 502, message: "Could not reach Google to create the contact." };
  }
  if (res.status === 403) return CONTACTS_SCOPE_ERROR;
  if (!res.ok) return { ok: false, status: 502, message: `Google contact creation failed (${res.status}).` };
  return { ok: true, action: "created" };
}

/** Resolve profile photos for specific emails (on-demand when opening a thread). */
export async function lookupContactPhotosByEmails(
  accessToken: string,
  emails: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const pending = new Set(
    emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")),
  );
  if (!pending.size) return out;

  for (const email of Array.from(pending)) {
    const hits = await searchContactsByQuery(accessToken, email);
    const match = hits.find((h) => h.email === email);
    if (match?.photoUrl) {
      out[email] = match.photoUrl;
      pending.delete(email);
    }
  }

  if (!pending.size) return out;

  let pageToken: string | undefined;
  let pages = 0;
  while (pending.size > 0 && pages < MAX_PAGES) {
    pages++;
    const url = new URL(`${PEOPLE_API}/otherContacts`);
    url.searchParams.set("readMask", "emailAddresses,photos");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      break;
    }
    if (!res.ok) break;

    const data = (await res.json()) as {
      otherContacts?: PersonLike[];
      nextPageToken?: string;
    };

    for (const person of data.otherContacts ?? []) {
      const photoUrl = extractPhotoUrl(person);
      if (!photoUrl) continue;
      for (const ea of person.emailAddresses ?? []) {
        const email = ea.value?.trim().toLowerCase();
        if (!email || !pending.has(email)) continue;
        out[email] = photoUrl;
        pending.delete(email);
      }
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return out;
}
