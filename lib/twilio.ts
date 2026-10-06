import "server-only";

import fs from "fs";
import path from "path";
import twilio from "twilio";

/** Strip spaces, BOM, zero-width chars; keep + and digits after + */
function normalizeE164(raw: string | undefined): string {
  if (!raw) return "";
  let s = String(raw).replace(/^\uFEFF/, "");
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  s = s.replace(/\s+/g, "");
  if (!s.startsWith("+")) return s;
  const digits = s.slice(1).replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

function readEnvLocalValue(key: string): string | undefined {
  try {
    const filePath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(filePath)) return undefined;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.replace(/^\uFEFF/, "").trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][\w]*)\s*=\s*(.*)$/);
      if (!match) continue;
      if (match[1] !== key) continue;
      let v = match[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
}

function envOrLocal(key: string): string {
  const fromProc = normalizeE164(process.env[key]);
  if (fromProc) return fromProc;
  return normalizeE164(readEnvLocalValue(key));
}

export function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export function getTwilioFromNumber(): string {
  return envOrLocal("TWILIO_PHONE_NUMBER");
}

export function getTwilioAgentNumber(): string {
  return envOrLocal("TWILIO_AGENT_PHONE");
}

export function isTwilioConfigured(): boolean {
  return Boolean(getTwilioClient() && getTwilioFromNumber());
}
