import "server-only";

type PersonLike = {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[];
};

const PEOPLE_API = "https://people.googleapis.com/v1";
const MAX_PAGES = 25;

function mergePerson(map: Map<string, string>, p: PersonLike) {
  const name = p.names?.[0]?.displayName?.trim();
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
    if (!map.has(raw)) map.set(raw, label);
  }
}

async function collectConnections(accessToken: string, map: Map<string, string>, warnings: string[]): Promise<void> {
  let pageToken: string | undefined;
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const url = new URL(`${PEOPLE_API}/people/me/connections`);
    url.searchParams.set("personFields", "names,emailAddresses");
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

async function collectOtherContacts(accessToken: string, map: Map<string, string>, warnings: string[]): Promise<void> {
  let pageToken: string | undefined;
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const url = new URL(`${PEOPLE_API}/otherContacts`);
    url.searchParams.set("readMask", "emailAddresses,names");
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

export type GoogleComposeContactsResult = {
  contacts: Array<{ email: string; displayName?: string }>;
  hint?: string;
};

/**
 * People API prefix search — same backend Gmail uses for contact suggestions.
 * https://developers.google.com/people/api/rest/v1/people/searchContacts
 */
export async function searchContactsByQuery(
  accessToken: string,
  query: string,
): Promise<Array<{ email: string; displayName?: string }>> {
  const q = query.trim();
  if (q.length < 1) return [];

  const url = new URL(`${PEOPLE_API}/people:searchContacts`);
  url.searchParams.set("query", q);
  url.searchParams.set("readMask", "emailAddresses,names");
  url.searchParams.set("pageSize", "8");

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
  const out: Array<{ email: string; displayName?: string }> = [];
  const seen = new Set<string>();

  for (const row of data.results ?? []) {
    const name = row.person?.names?.[0]?.displayName?.trim();
    for (const ea of row.person?.emailAddresses ?? []) {
      const email = ea.value?.trim().toLowerCase();
      if (!email?.includes("@") || seen.has(email)) continue;
      seen.add(email);
      out.push({
        email,
        displayName: name && name.toLowerCase() !== email ? name : undefined,
      });
    }
  }
  return out;
}

export async function fetchGoogleContactsForCompose(accessToken: string): Promise<GoogleComposeContactsResult> {
  const map = new Map<string, string>();
  const warnings: string[] = [];

  await collectConnections(accessToken, map, warnings);
  await collectOtherContacts(accessToken, map, warnings);

  const contacts = Array.from(map.entries()).map(([email, label]) => ({
    email,
    displayName: label !== email ? label : undefined,
  }));

  return {
    contacts,
    hint: warnings.length ? warnings.join(" ") : undefined,
  };
}
