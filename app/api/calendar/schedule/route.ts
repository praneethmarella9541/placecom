import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  CALENDAR_INSUFFICIENT_SCOPE,
  createPrimaryCalendarEvent,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        recruiterEmail?: string;
        companyName?: string;
        startDateTime?: string;
        endDateTime?: string;
        notes?: string;
        title?: string;
      }
    | null;

  const recruiterEmail = body?.recruiterEmail?.trim() || "";
  const companyName = body?.companyName?.trim() || "";
  const startDateTime = body?.startDateTime?.trim() || "";
  const endDateTime = body?.endDateTime?.trim() || "";

  if (!recruiterEmail || !isValidEmail(recruiterEmail)) {
    return NextResponse.json(
      { error: "Valid recruiterEmail is required." },
      { status: 400 }
    );
  }
  if (!companyName) {
    return NextResponse.json(
      { error: "companyName is required." },
      { status: 400 }
    );
  }
  if (!startDateTime || !endDateTime) {
    return NextResponse.json(
      { error: "startDateTime and endDateTime are required." },
      { status: 400 }
    );
  }

  try {
    const event = await createPrimaryCalendarEvent(auth.accessToken, {
      recruiterEmail,
      companyName,
      startDateTime,
      endDateTime,
      notes: body?.notes,
      title: body?.title,
    });

    const hangoutLink = event.hangoutLink;
    if (hangoutLink) {
      try {
        // The bot fred@fireflies.ai is now automatically invited via Google Calendar attendees array
        // so we just need to register it in our DB for tracking
        
        const { createServerSupabaseClient } = await import("@/lib/supabase-server");
        const supabase = createServerSupabaseClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          await supabase.from("meeting_recordings").insert({
            user_id: user.id,
            meeting_url: hangoutLink,
            attendee_email: recruiterEmail,
          });
        }
      } catch (err) {
        console.error("Failed to invite Fireflies bot:", err);
      }
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === CALENDAR_INSUFFICIENT_SCOPE) {
      return NextResponse.json(
        {
          error: CALENDAR_INSUFFICIENT_SCOPE,
          message:
            "Your Google sign-in is missing Calendar access. Sign out and sign in again to grant calendar scopes.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Failed to create calendar event" },
      { status: 500 }
    );
  }
}
