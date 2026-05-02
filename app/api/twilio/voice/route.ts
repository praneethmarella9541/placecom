import { NextResponse } from "next/server";
import { getTwilioAgentNumber, getTwilioFromNumber } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validPhone(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(input.replace(/\s+/g, ""));
}

function xml(content: string): NextResponse {
  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

function inboundTwiml(): string {
  const fromNumber = getTwilioFromNumber();
  const agentNumber = getTwilioAgentNumber();

  if (!validPhone(fromNumber)) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Configure TWILIO_PHONE_NUMBER: use your Twilio number with a plus sign and country code, digits only after the plus, no spaces. Then restart the app.</Say><Hangup/></Response>`;
  }
  if (!validPhone(agentNumber)) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Configure TWILIO_AGENT_PHONE: the phone that should ring on inbound calls, same format as plus country code and digits only. Then restart the app.</Say><Hangup/></Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Please wait while we connect your call.</Say><Dial callerId="${fromNumber}"><Number>${agentNumber}</Number></Dial></Response>`;
}

export async function GET() {
  return xml(inboundTwiml());
}

export async function POST() {
  return xml(inboundTwiml());
}
