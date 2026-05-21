import { proxyToMeetingBot } from "@/lib/meeting-bot-proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyToMeetingBot(request, "/schedule-meeting", { method: "POST", body });
}
