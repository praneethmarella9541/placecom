"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconMessageChat, IconUsers } from "@/components/Icons";

type TeamMember = {
  id: string;
  displayUsername: string | null;
  email: string | null;
  exotelVirtualNumber: string | null;
};

type Conv = {
  peer_e164: string;
  last_body: string | null;
  last_at: string;
  last_dir: string;
};

type Msg = {
  id: string;
  direction: string;
  body: string | null;
  content_type?: string | null;
  created_at: string;
};

function memberLabel(m: TeamMember): string {
  return m.displayUsername || m.email || m.id.slice(0, 8);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Read-only admin view of a team member's WhatsApp line — deliberately a
 * separate, simple component rather than reusing WhatsAppMessaging (which
 * assumes it's always rendering the signed-in user's own line: polling,
 * prefetch caching, read receipts, composer are all keyed to "me"). This
 * just lists conversations and renders one thread, both scoped by RLS
 * (0048 migration) to whatever the admin's team is actually allowed to see.
 */
export function TeamWhatsAppViewer() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [peer, setPeer] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/team-members");
        const body = (await res.json()) as { members?: TeamMember[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Failed to load team");
        const withLines = (body.members || []).filter((m) => m.exotelVirtualNumber);
        setMembers(withLines);
        if (withLines.length) setSelectedId(withLines[0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load team");
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMember = useMemo(
    () => members.find((m) => m.id === selectedId) ?? null,
    [members, selectedId]
  );

  const loadConversations = useCallback(async (line: string) => {
    setConvLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/conversations?line=${encodeURIComponent(line)}`);
      const body = (await res.json()) as { conversations?: Conv[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load conversations");
      setConversations(body.conversations || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversations");
      setConversations([]);
    } finally {
      setConvLoading(false);
    }
  }, []);

  useEffect(() => {
    setPeer(null);
    setMessages([]);
    if (selectedMember?.exotelVirtualNumber) {
      void loadConversations(selectedMember.exotelVirtualNumber);
    } else {
      setConversations([]);
    }
  }, [selectedMember, loadConversations]);

  const loadThread = useCallback(async (p: string, line: string) => {
    setMsgLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/whatsapp/messages?peer=${encodeURIComponent(p)}&line=${encodeURIComponent(line)}`
      );
      const body = (await res.json()) as { messages?: Msg[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load thread");
      setMessages(body.messages || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load thread");
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }, []);

  if (membersLoading) {
    return <div className="p-6 text-sm text-[var(--color-text-muted)]">Loading team…</div>;
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center text-sm text-[var(--color-text-muted)]">
        <IconUsers className="h-6 w-6 opacity-50" />
        No team members with a WhatsApp line assigned yet — set one under Admin → Team.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Viewing:</span>
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelectedId(m.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              m.id === selectedId
                ? "bg-[var(--color-copper)] text-[var(--color-surface)]"
                : "bg-[var(--color-surface-offset)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
            }`}
          >
            {memberLabel(m)}
          </button>
        ))}
      </div>

      {error && <div className="px-4 py-2 text-xs text-[var(--color-danger)]">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--color-border)]">
          {convLoading ? (
            <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-xs text-[var(--color-text-muted)]">No conversations yet.</div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.peer_e164}
                onClick={() => {
                  setPeer(c.peer_e164);
                  if (selectedMember?.exotelVirtualNumber) {
                    void loadThread(c.peer_e164, selectedMember.exotelVirtualNumber);
                  }
                }}
                className={`block w-full border-b border-[var(--color-border)] px-3 py-2.5 text-left text-sm hover:bg-[var(--color-surface-offset)] ${
                  peer === c.peer_e164 ? "bg-[var(--color-surface-offset)]" : ""
                }`}
              >
                <div className="font-medium">{c.peer_e164}</div>
                <div className="truncate text-xs text-[var(--color-text-muted)]">
                  {c.last_dir === "outbound" ? "You: " : ""}
                  {c.last_body || "…"}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!peer ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
              <IconMessageChat className="h-6 w-6 opacity-50" />
              Select a conversation to view
            </div>
          ) : msgLoading ? (
            <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>
          ) : (
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "bg-[var(--color-copper)] text-[var(--color-surface)]"
                        : "bg-[var(--color-surface-offset)]"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {m.body || `[${m.content_type || "media"}]`}
                    </div>
                    <div className="mt-1 text-right text-[10px] opacity-70">{formatTime(m.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
