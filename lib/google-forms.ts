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
