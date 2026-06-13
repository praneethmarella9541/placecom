import { describeUpstreamFetchError } from "@/lib/fetch-errors";

const FORMS_API = "https://forms.googleapis.com/v1";

export type GoogleFormCreateResult = {
  formId: string;
  responderUri?: string;
};

/**
 * Creates an empty Google Form (title only). Further edits use batchUpdate or the Forms UI.
 * Requires OAuth scope `https://www.googleapis.com/auth/forms.body` (or full Drive scope).
 */
export async function createGoogleForm(
  accessToken: string,
  options: { title: string }
): Promise<GoogleFormCreateResult> {
  const title = options.title.trim();
  if (!title) {
    throw new Error("Form title is required");
  }

  let res: Response;
  try {
    res = await fetch(`${FORMS_API}/forms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        info: { title },
      }),
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Forms API (create) — check network and Forms API enablement")
    );
  }

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Google Forms create failed (${res.status}): ${text}`) as Error & {
      status?: number;
      body?: string;
      code?: string;
    };
    err.status = res.status;
    err.body = text;
    if (res.status === 401) err.code = "UNAUTHORIZED";
    throw err;
  }

  let data: { formId?: string; responderUri?: string };
  try {
    data = JSON.parse(text) as { formId?: string; responderUri?: string };
  } catch {
    throw new Error("Google Forms create returned invalid JSON");
  }

  const formId = data.formId?.trim();
  if (!formId) {
    throw new Error("Google Forms create did not return formId");
  }

  return {
    formId,
    responderUri: data.responderUri,
  };
}

export async function getGoogleForm(
  accessToken: string,
  formId: string
): Promise<Record<string, unknown>> {
  const url = `${FORMS_API}/forms/${encodeURIComponent(formId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Forms API (get form)")
    );
  }

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Google Forms get failed (${res.status}): ${text}`) as Error & {
      status?: number;
      body?: string;
      code?: string;
    };
    err.status = res.status;
    err.body = text;
    if (res.status === 401) err.code = "UNAUTHORIZED";
    throw err;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Google Forms get returned invalid JSON");
  }
}

/**
 * Publishes a Google Form (makes it accessible via responderUri).
 * Forms created via the API are unpublished by default; without this call,
 * opening the responderUri shows "Sorry, unable to open the file at present."
 */
export async function publishGoogleForm(
  accessToken: string,
  formId: string,
  opts: { isPublished?: boolean; isAcceptingResponses?: boolean } = {}
): Promise<void> {
  const isPublished = opts.isPublished ?? true;
  const isAcceptingResponses = opts.isAcceptingResponses ?? true;
  const url = `${FORMS_API}/forms/${encodeURIComponent(formId)}:setPublishSettings`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        publishSettings: {
          publishState: { isPublished, isAcceptingResponses },
        },
      }),
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Forms API (publish)")
    );
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Google Forms publish failed (${res.status}): ${text}`) as Error & {
      status?: number;
      body?: string;
      code?: string;
    };
    err.status = res.status;
    err.body = text;
    if (res.status === 401) err.code = "UNAUTHORIZED";
    throw err;
  }
}

/**
 * Fetch `info.title` for a list of form IDs in parallel.
 * Returns a map of formId → title. Silently skips any form that errors
 * (insufficient scope, deleted, etc.) so the list still renders.
 */
/** Parse a Google Form ID from a pasted link or raw ID. */
export function parseGoogleFormIdFromInput(input: string): string | null {
  const t = input.trim();
  if (!t) return null;

  const fromUrl = t.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
  if (fromUrl?.[1]) return fromUrl[1];

  if (/^[a-zA-Z0-9_-]{10,}$/.test(t)) return t;
  return null;
}

export async function getFormTitlesBatch(
  accessToken: string,
  formIds: string[]
): Promise<Record<string, string>> {
  if (formIds.length === 0) return {};

  const results = await Promise.allSettled(
    formIds.map((id) =>
      fetch(`${FORMS_API}/forms/${encodeURIComponent(id)}?fields=info(title)`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ info?: { title?: string } }>) : null))
        .then((data) => ({ id, title: data?.info?.title ?? null }))
        .catch(() => ({ id, title: null }))
    )
  );

  const map: Record<string, string> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.title) {
      map[r.value.id] = r.value.title;
    }
  }
  return map;
}

export async function batchUpdateGoogleForm(
  accessToken: string,
  formId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = `${FORMS_API}/forms/${encodeURIComponent(formId)}:batchUpdate`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Forms API (batchUpdate)")
    );
  }

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Google Forms batchUpdate failed (${res.status}): ${text}`) as Error & {
      status?: number;
      body?: string;
      code?: string;
    };
    err.status = res.status;
    err.body = text;
    if (res.status === 401) err.code = "UNAUTHORIZED";
    throw err;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Google Forms batchUpdate returned invalid JSON");
  }
}
