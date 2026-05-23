import { NextResponse } from "next/server";
import {
  canUseMeetOrganizerToken,
  getMeetOrganizerCalendarId,
} from "@/lib/google-meet-organizer";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";

/** Check whether Meet organizer Google credentials are stored (no secrets returned). */
export async function GET() {
  const organizerEmail = getMeetOrganizerCalendarId();
  const envToken = Boolean(process.env.GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN?.trim());
  let dbRefresh = false;
  let dbAccess = false;

  try {
    const svc = createServiceSupabase();
    const { data } = await svc
      .from("google_mailbox_credentials")
      .select("refresh_token, access_token")
      .ilike("gmail_address", organizerEmail)
      .maybeSingle();
    dbRefresh = Boolean(data?.refresh_token);
    dbAccess = Boolean(data?.access_token);
  } catch {
    /* service role not configured */
  }

  const ready = envToken || dbRefresh || dbAccess;
  const canScheduleWithOrganizer = await canUseMeetOrganizerToken();

  return NextResponse.json({
    organizerEmail,
    ready: canScheduleWithOrganizer,
    sources: {
      envRefreshToken: envToken,
      databaseRefreshToken: dbRefresh,
      databaseAccessToken: dbAccess,
    },
    nextStep: ready
      ? "Schedule a meeting from Calendar to test."
      : `Sign in at http://localhost:3000 with Google as ${organizerEmail}, open any page, then check this URL again.`,
  });
}
