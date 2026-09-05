"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneIncoming, PhoneOutgoing, PlayCircle } from "lucide-react";
import { titleCase } from "@/lib/title-case";
import { useMeMailbox } from "@/lib/use-me-mailbox";
import { useDirectoryContacts } from "@/hooks/useDirectoryContacts";
import { buildContactNameMap, canonicalPeer, formatPhone, resolveContactName } from "@/lib/wa-contacts-display";
import { SimpleDropdown, type DropdownOption } from "@/components/SimpleDropdown";

type TeamMember = {
  id: string;
  displayUsername: string | null;
  email: string | null;
};

type CallRow = {
  id: string;
  user_id: string;
  to_number: string | null;
  from_number: string | null;
  agent_number: string | null;
  status: string;
  duration_seconds: number | null;
  conversation_duration_seconds: number | null;
  started_at: string | null;
  created_at: string;
  recording_sid: string | null;
  direction: "incoming" | "outbound";
  peer_number: string | null;
};

type DirectionFilter = "all" | "incoming" | "outbound";
type SortKey = "newest" | "oldest" | "longest" | "shortest";

const SORT_OPTIONS: DropdownOption<SortKey>[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "longest", label: "Longest duration" },
  { value: "shortest", label: "Shortest duration" },
];

const DIRECTION_OPTIONS: DropdownOption<DirectionFilter>[] = [
  { value: "all", label: "All" },
  { value: "incoming", label: "Incoming" },
  { value: "outbound", label: "Outbound" },
];

function callDuration(c: CallRow): number {
  return c.conversation_duration_seconds ?? c.duration_seconds ?? 0;
}

function callTime(c: CallRow): number {
  return new Date(c.started_at || c.created_at).getTime();
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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

function statusLabel(status: string): string {
  return status
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function CallsPage() {
  const { me } = useMeMailbox();
  const isAdmin = me?.role === "admin";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<string>("all");
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const { contacts: directoryContacts } = useDirectoryContacts();
  const contactNameMap = useMemo(
    () =>
      buildContactNameMap(
        directoryContacts.filter((c) => c.phone).map((c) => ({ peer_e164: canonicalPeer(c.phone!), name: c.name }))
      ),
    [directoryContacts]
  );
  const contactName = useCallback(
    (peer: string | null) => (peer ? resolveContactName(contactNameMap, peer) : undefined),
    [contactNameMap]
  );

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/team-members");
        const body = (await res.json()) as { members?: TeamMember[] };
        if (!cancelled) setMembers(body.members || []);
      } catch {
        /* member list is a nice-to-have filter; silently skip on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const memberLabel = useCallback(
    (userId: string) => {
      const m = members.find((x) => x.id === userId);
      return m?.displayUsername || m?.email || userId.slice(0, 8);
    },
    [members]
  );

  const loadCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (isAdmin) {
        if (selectedMember === "all") params.set("scope", "team");
        else params.set("member", selectedMember);
      }
      const qs = params.toString();
      const res = await fetch(`/api/calls${qs ? `?${qs}` : ""}`);
      const body = (await res.json()) as { logs?: CallRow[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load calls");
      setCalls(body.logs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, selectedMember]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  const memberOptions: DropdownOption<string>[] = useMemo(
    () => [{ value: "all", label: "Whole Team" }, ...members.map((m) => ({ value: m.id, label: memberLabel(m.id) }))],
    [members, memberLabel]
  );

  const statusOptions: DropdownOption<string>[] = useMemo(() => {
    const distinct = Array.from(new Set(calls.map((c) => c.status)));
    return [
      { value: "all", label: "All" },
      ...distinct.map((s) => ({ value: s, label: statusLabel(s) })),
    ];
  }, [calls]);

  const visibleCalls = useMemo(() => {
    let rows = calls;
    if (direction !== "all") rows = rows.filter((c) => c.direction === direction);
    if (status !== "all") rows = rows.filter((c) => c.status === status);

    const sorted = [...rows];
    switch (sort) {
      case "oldest":
        sorted.sort((a, b) => callTime(a) - callTime(b));
        break;
      case "longest":
        sorted.sort((a, b) => callDuration(b) - callDuration(a));
        break;
      case "shortest":
        sorted.sort((a, b) => callDuration(a) - callDuration(b));
        break;
      case "newest":
      default:
        sorted.sort((a, b) => callTime(b) - callTime(a));
        break;
    }
    return sorted;
  }, [calls, direction, status, sort]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Calls")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {isAdmin ? "Your team's call history." : "Your call history."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <SimpleDropdown label="Member" value={selectedMember} options={memberOptions} onChange={setSelectedMember} />
        )}
        <SimpleDropdown label="Direction" value={direction} options={DIRECTION_OPTIONS} onChange={setDirection} />
        <SimpleDropdown label="Status" value={status} options={statusOptions} onChange={setStatus} />
        <SimpleDropdown label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} />
      </div>

      {error && <div className="text-sm text-[var(--color-danger)]">{error}</div>}

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
      ) : visibleCalls.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
          {calls.length === 0 ? "No calls yet." : "No calls match these filters."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-offset)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-2 font-medium"> </th>
                <th className="px-4 py-2 font-medium">Number</th>
                {isAdmin && selectedMember === "all" && <th className="px-4 py-2 font-medium">Team Member</th>}
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visibleCalls.map((c) => (
                <tr key={c.id} className="text-[var(--color-text)]">
                  <td className="px-4 py-2.5">
                    {c.direction === "incoming" ? (
                      <PhoneIncoming className="h-4 w-4 text-[var(--color-copper)]" />
                    ) : (
                      <PhoneOutgoing className="h-4 w-4 text-[var(--color-text-muted)]" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {c.peer_number ? (
                      contactName(c.peer_number) ? (
                        <>
                          <div className="text-[var(--color-text)]">{contactName(c.peer_number)}</div>
                          <div className="text-xs font-normal text-[var(--color-text-faint)]">
                            {formatPhone(c.peer_number)}
                          </div>
                        </>
                      ) : (
                        c.peer_number
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  {isAdmin && selectedMember === "all" && (
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{memberLabel(c.user_id)}</td>
                  )}
                  <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{statusLabel(c.status)}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                    {formatDuration(callDuration(c))}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                    {formatTime(c.started_at || c.created_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.recording_sid ? (
                      playingId === c.id ? (
                        <audio
                          controls
                          autoPlay
                          className="h-8 w-40"
                          src={`/api/calls/recording/${encodeURIComponent(c.recording_sid)}`}
                        />
                      ) : (
                        <button
                          onClick={() => setPlayingId(c.id)}
                          className="flex items-center gap-1 text-[var(--color-copper)] hover:underline"
                        >
                          <PlayCircle className="h-4 w-4" /> Play
                        </button>
                      )
                    ) : (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
