import { proxyToMeetingBot } from "@/lib/meeting-bot-proxy";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await context.params;
  return proxyToMeetingBot(request, `/meetings/${encodeURIComponent(meetingId)}/cancel`, {
    method: "POST",
    body: "{}",
  });
}
