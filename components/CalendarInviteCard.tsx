"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Video } from "lucide-react";
import {
  extractCalendarEventId,
  hasCalendarInviteCardData,
  isGoogleWorkspaceShareNotification,
  parseCalendarInviteHtml,
  type CalendarInviteParsed,
} from "@/lib/calendar-invite-email";
import { EmailHtmlBody } from "@/components/EmailHtmlBody";
import type { InlineImageAttachment } from "@/lib/email-html-inline-images";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type CalendarInviteCardProps = {
  subject: string;
  bodyHtml?: string;
  className?: string;
};

/** Calendar invite card, or fall back to normal HTML body if parsing fails. */
export function CalendarInviteOrHtml({
  subject,
  bodyHtml,
  plain,
  className,
  messageId,
  attachments,
}: CalendarInviteCardProps & {
  plain?: string;
  messageId?: string;
  attachments?: InlineImageAttachment[];
}) {
  const isWorkspaceShare = useMemo(
    () => isGoogleWorkspaceShareNotification({ subject, bodyHtml }),
    [subject, bodyHtml]
  );
  const parsed = useMemo(
    () => (bodyHtml ? parseCalendarInviteHtml(bodyHtml, subject) : null),
    [bodyHtml, subject]
  );
  const htmlProps = { html: bodyHtml, plain, messageId, attachments };
  if (isWorkspaceShare) {
    return <EmailHtmlBody {...htmlProps} />;
  }
  if (parsed && hasCalendarInviteCardData(parsed)) {
    return <CalendarInviteCard subject={subject} bodyHtml={bodyHtml} className={className} />;
  }
  return <EmailHtmlBody {...htmlProps} />;
}

/** Gmail-style structured calendar invitation (When / Organizer / RSVP / Meet). */
export function CalendarInviteCard({ subject, bodyHtml, className }: CalendarInviteCardProps) {
  const router = useRouter();
  const parsed = useMemo(
    () => (bodyHtml ? parseCalendarInviteHtml(bodyHtml, subject) : null),
    [bodyHtml, subject]
  );

  if (!parsed || !hasCalendarInviteCardData(parsed)) return null;

  const eventId = extractCalendarEventId(bodyHtml);

  return (
    <div className={cn("mt-3", className)}>
      <div className="overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-sm">
        <div className="flex flex-col md:flex-row">
          <div className="min-w-0 flex-1 p-5 md:p-6">
            <h3 className="text-[22px] font-normal leading-tight text-[#202124]">{parsed.title}</h3>

            {parsed.when && (
              <InviteSection label={titleCase("When")}>
                <p className="text-[14px] leading-snug text-[#3c4043]">{parsed.when}</p>
              </InviteSection>
            )}

            {(parsed.organizer || parsed.organizerEmail) && (
              <InviteSection label={titleCase("Organizer")}>
                {parsed.organizer && (
                  <p className="text-[14px] text-[#3c4043]">{parsed.organizer}</p>
                )}
                {parsed.organizerEmail && (
                  <p className="text-[14px] text-[#5f6368]">{parsed.organizerEmail}</p>
                )}
              </InviteSection>
            )}

            {parsed.guests.length > 0 && (
              <InviteSection label={titleCase("Guests")}>
                <ul className="space-y-0.5 text-[14px] text-[#3c4043]">
                  {parsed.guests.slice(0, 8).map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
                {parsed.viewEventLink && (
                  <a
                    href={parsed.viewEventLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-[13px] text-[#1a73e8] hover:underline"
                  >
                    {titleCase("View all guest info")}
                  </a>
                )}
              </InviteSection>
            )}

            {(parsed.rsvp.yes || parsed.rsvp.no || parsed.rsvp.maybe) && (
              <div className="mt-5 border-t border-[#e8eaed] pt-4">
                {parsed.replyForEmail && (
                  <p className="mb-2 text-[13px] text-[#5f6368]">
                    {titleCase("Reply")} for {parsed.replyForEmail}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <RsvpButton href={parsed.rsvp.yes} label={titleCase("Yes")} />
                  <RsvpButton href={parsed.rsvp.no} label={titleCase("No")} />
                  <RsvpButton href={parsed.rsvp.maybe} label={titleCase("Maybe")} />
                  {parsed.rsvp.moreOptions && (
                    <a
                      href={parsed.rsvp.moreOptions}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-[#dadce0] bg-white px-4 py-1.5 text-[13px] font-medium text-[#3c4043] hover:bg-[#f8f9fa]"
                    >
                      {titleCase("More options")}
                    </a>
                  )}
                </div>
              </div>
            )}

            {eventId && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-[#e8eaed] pt-4">
                <button
                  type="button"
                  onClick={() => {
                    const qs = new URLSearchParams({ eventId, action: "edit" });
                    router.push(`/calendar?${qs.toString()}`);
                  }}
                  className="rounded px-2 py-1 text-[13px] font-medium text-[#1a73e8] hover:bg-[#e8f0fe]"
                >
                  {titleCase("Edit in Calendar")}
                </button>
              </div>
            )}
          </div>

          {parsed.meetLink && (
            <div className="flex shrink-0 flex-col items-stretch border-t border-[#e8eaed] bg-[#f8f9fa] p-5 md:w-[220px] md:border-l md:border-t-0">
              <a
                href={parsed.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded bg-[#1a73e8] px-4 py-2.5 text-[14px] font-medium text-white shadow-sm hover:bg-[#1765cc]"
              >
                <Video className="h-4 w-4" strokeWidth={2} />
                {titleCase("Join with Google Meet")}
              </a>
              <div className="mt-4">
                <p className="text-[12px] font-medium text-[#5f6368]">{titleCase("Meeting link")}</p>
                <a
                  href={parsed.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 break-all text-[13px] text-[#1a73e8] hover:underline"
                >
                  {parsed.meetLink.replace(/^https:\/\//, "")}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-[12px] text-[#5f6368]">
        {titleCase("Invitation from")}{" "}
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1a73e8] hover:underline"
        >
          Google Calendar
        </a>
      </p>
    </div>
  );
}

function InviteSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-[12px] font-medium text-[#5f6368]">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function RsvpButton({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-full border border-[#dadce0] bg-white px-5 py-1.5 text-[13px] font-medium text-[#3c4043] hover:bg-[#f8f9fa]"
    >
      {label}
    </a>
  );
}

export type { CalendarInviteParsed };
