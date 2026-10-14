"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plug, RefreshCw, TriangleAlert } from "lucide-react";
import { AdminToast, type AdminToastState } from "@/components/AdminToast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PasswordInput } from "@/components/PasswordInput";
import { resetLushaConnected } from "@/hooks/useLushaConnected";
import { useMeMailbox } from "@/lib/use-me-mailbox";
import { titleCase } from "@/lib/title-case";
import type { PublicConnection } from "@/lib/integrations/connections";
import type { LushaUsageRow } from "@/app/api/integrations/lusha/usage/route";

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "email" -> "Email", "api_search" -> "Api search": Lusha's action names, made readable. */
function actionLabel(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function ConnectorsPage() {
  const { me } = useMeMailbox();
  const [connection, setConnection] = useState<PublicConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<"connect" | "refresh" | "disconnect" | null>(null);
  const [toast, setToast] = useState<AdminToastState>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Spending controls: the monthly limit per team member, and who has spent what this month.
  const [capInput, setCapInput] = useState("");
  const [savingCap, setSavingCap] = useState(false);
  const [spend, setSpend] = useState<{ totalCredits: number; rows: LushaUsageRow[] } | null>(null);

  const isAdmin = me?.role === "admin";

  const load = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/integrations/lusha${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { connection?: PublicConnection; error?: string };
      if (!res.ok) {
        setLoadError(json.error || "Could not load connectors.");
        return;
      }
      setConnection(json.connection ?? null);
      setLoadError(null);
    } catch {
      setLoadError("Could not load connectors.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cap = connection?.settings?.perUserMonthlyCap;
    setCapInput(typeof cap === "number" ? String(cap) : "");
  }, [connection?.settings?.perUserMonthlyCap]);

  const connectedOk = !!connection?.connected && connection.status === "connected";
  useEffect(() => {
    if (!connectedOk) {
      setSpend(null);
      return;
    }
    let live = true;
    void fetch("/api/integrations/lusha/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j) setSpend({ totalCredits: j.totalCredits ?? 0, rows: j.rows ?? [] });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connectedOk]);

  async function saveCap(e: React.FormEvent) {
    e.preventDefault();
    if (savingCap) return;
    setSavingCap(true);
    try {
      const res = await fetch("/api/integrations/lusha", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perUserMonthlyCap: capInput.trim() === "" ? null : Number(capInput) }),
      });
      const json = (await res.json().catch(() => ({}))) as { connection?: PublicConnection; error?: string };
      if (!res.ok) {
        setToast({ message: json.error || "Could not save the limit.", variant: "error" });
        return;
      }
      setConnection(json.connection ?? null);
      setToast({ message: capInput.trim() === "" ? "Monthly limit removed." : "Monthly limit saved.", variant: "success" });
    } catch {
      setToast({ message: "Could not save the limit.", variant: "error" });
    } finally {
      setSavingCap(false);
    }
  }

  useEffect(() => {
    if (me && me.role !== "admin") {
      setLoading(false);
      return;
    }
    if (me) void load(true);
  }, [me, load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !apiKey.trim()) return;
    setBusy("connect");
    try {
      const res = await fetch("/api/integrations/lusha", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { connection?: PublicConnection; error?: string };
      if (!res.ok) {
        setToast({ message: json.error || "Could not connect Lusha.", variant: "error" });
        return;
      }
      setConnection(json.connection ?? null);
      resetLushaConnected();
      setApiKey("");
      setReplacing(false);
      setToast({ message: "Lusha is connected.", variant: "success" });
    } catch {
      setToast({ message: "Could not connect Lusha.", variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    if (busy) return;
    setBusy("refresh");
    await load(true);
    setBusy(null);
  }

  async function disconnect() {
    if (busy) return;
    setConfirmingDisconnect(false);
    setBusy("disconnect");
    try {
      const res = await fetch("/api/integrations/lusha", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setConnection(null);
      resetLushaConnected();
      setReplacing(false);
      setToast({ message: "Lusha is disconnected.", variant: "success" });
    } catch {
      setToast({ message: "Could not disconnect Lusha.", variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const connected = !!connection?.connected;
  const usage = connection?.usage ?? null;
  const used = usage ? usage.credits.used : 0;
  const total = usage ? usage.credits.total : 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const broken = connected && connection?.status !== "connected";
  const showKeyForm = !connected || replacing || broken;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Connectors")}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          Link other services to your workspace. Each account uses its own credentials, so you stay in control of
          your own plan, credits and data.
        </p>
      </div>

      {me && !isAdmin ? (
        <div className="surface-card p-5 text-[13px] text-[var(--color-text-muted)]">
          Only admins can manage connectors.
        </div>
      ) : loading ? (
        <div className="surface-card flex items-center gap-2.5 p-5 text-[13px] text-[var(--color-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> {titleCase("Loading…")}
        </div>
      ) : loadError ? (
        <div className="surface-card p-5 text-[13px] text-[var(--color-danger)]">{loadError}</div>
      ) : (
        <div className="surface-card space-y-5 p-6" data-testid="connector-lusha">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                <Plug className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <h2 className="font-display text-[16px] font-bold text-[var(--color-text)]">Lusha</h2>
                <p className="mt-0.5 max-w-md text-[13px] text-[var(--color-text-muted)]">
                  Find work emails and phone numbers for the people in your contacts. Revealing data uses credits
                  from your own Lusha account.
                </p>
              </div>
            </div>
            {connected ? (
              broken ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-danger)]/10 px-2.5 py-1 text-[12px] font-semibold text-[var(--color-danger)]">
                  <TriangleAlert className="h-3.5 w-3.5" /> Needs attention
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                </span>
              )
            ) : null}
          </div>

          {broken ? (
            <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]">
              {connection?.lastError || "Lusha stopped accepting this key."} Paste a new key to reconnect.
            </p>
          ) : null}

          {connected && !broken ? (
            <div className="space-y-4">
              <p className="text-[13px] text-[var(--color-text-muted)]">
                Key ending <span className="font-mono">•••• {connection?.keyHint}</span> · connected{" "}
                {formatWhen(connection?.connectedAt ?? null)}
              </p>

              {usage ? (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="font-semibold text-[var(--color-text)]">
                      {usage.credits.remaining.toLocaleString()} credits left
                    </span>
                    <span className="text-[var(--color-text-muted)]">
                      {used.toLocaleString()} of {total.toLocaleString()} used
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
                    <div
                      className={`h-full rounded-full ${pct >= 90 ? "bg-[var(--color-danger)]" : "bg-[var(--color-copper)]"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[12px] text-[var(--color-text-faint)]">
                    {[usage.plan.category ? `${actionLabel(usage.plan.category)} plan` : null, usage.plan.renewalType ? actionLabel(usage.plan.renewalType) : null, usage.plan.endDate ? `renews ${formatWhen(usage.plan.endDate).split(",")[0]}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Plan details unavailable"}
                    {" · "}checked {formatWhen(connection?.lastCheckedAt ?? null)}
                  </p>
                  {Object.keys(usage.pricing).length > 0 ? (
                    <p className="text-[12px] text-[var(--color-text-faint)]">
                      Cost per reveal:{" "}
                      {Object.entries(usage.pricing)
                        .map(([k, v]) => `${actionLabel(k).toLowerCase()} ${v.credits} per ${v.perQuantity}`)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {connected && !broken ? (
            <div className="space-y-3 border-t border-[var(--color-border)] pt-4" data-testid="lusha-spending">
              <div>
                <h3 className="text-[13px] font-bold text-[var(--color-text)]">Spending limits</h3>
                <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
                  Everyone in your workspace spends from your Lusha credits. Set the most each team member can use in a month; admins are not limited. Before anything is revealed, people see the most it can cost.
                </p>
              </div>
              <form onSubmit={saveCap} className="flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-[12.5px] font-semibold text-[var(--color-text)]">
                  Credits per team member, per month
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={capInput}
                    onChange={(e) => setCapInput(e.target.value)}
                    placeholder="No limit"
                    className="input-field block w-44 text-[13px]"
                  />
                </label>
                <button type="submit" disabled={savingCap} className="btn-ghost px-3 py-2 text-[13px] font-semibold disabled:opacity-60">
                  {savingCap ? "Saving…" : "Save limit"}
                </button>
              </form>

              <div>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Used this month{spend ? ` · ${spend.totalCredits.toLocaleString()} credits` : ""}
                </p>
                {spend && spend.rows.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                    <table className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                          <th className="px-3 py-2">Team member</th>
                          <th className="px-3 py-2 text-right">Credits</th>
                          <th className="px-3 py-2 text-right">Lookups</th>
                          <th className="px-3 py-2 text-right">Searches</th>
                        </tr>
                      </thead>
                      <tbody>
                        {spend.rows.map((r) => (
                          <tr key={r.userId ?? "unknown"} className="border-b border-[var(--color-border)] last:border-0">
                            <td className="px-3 py-2 text-[var(--color-text)]">{r.name}</td>
                            <td className="px-3 py-2 text-right font-semibold">{r.credits.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-[var(--color-text-muted)]">{r.reveals}</td>
                            <td className="px-3 py-2 text-right text-[var(--color-text-muted)]">{r.searches}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[12.5px] text-[var(--color-text-faint)]">{spend ? "No credits used yet this month." : "Loading…"}</p>
                )}
              </div>
            </div>
          ) : null}

          {showKeyForm ? (
            <form onSubmit={connect} className="space-y-2">
              <label className="block text-[12.5px] font-semibold text-[var(--color-text)]" htmlFor="lusha-api-key">
                {connected ? "New Lusha API key" : "Lusha API key"}
              </label>
              <PasswordInput
                id="lusha-api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your key"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[12px] text-[var(--color-text-faint)]">
                In Lusha, open your account settings and create an API key. It is checked with Lusha when you
                connect (this costs no credits), stored encrypted, and used only on our servers — it is never shown
                again or sent to anyone&apos;s browser.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={busy !== null || !apiKey.trim()}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
                >
                  {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {connected ? "Replace key" : "Connect Lusha"}
                </button>
                {connected && !broken ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReplacing(false);
                      setApiKey("");
                    }}
                    className="btn-ghost px-3 py-2 text-[13px] font-semibold"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-4">
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy !== null}
                className="btn-ghost inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
                Refresh credits
              </button>
              <button
                type="button"
                onClick={() => setReplacing(true)}
                disabled={busy !== null}
                className="btn-ghost px-3 py-2 text-[13px] font-semibold disabled:opacity-60"
              >
                Replace key
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={busy !== null}
                className="rounded-lg px-3 py-2 text-[13px] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-60"
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          )}

          {broken ? (
            <div className="border-t border-[var(--color-border)] pt-4">
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={busy !== null}
                className="rounded-lg px-3 py-2 text-[13px] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
      )}

      {confirmingDisconnect ? (
        <ConfirmDialog
          title="Disconnect Lusha?"
          body="Your API key is deleted from this workspace, and finding emails and phone numbers stops until you connect it again. Credits and data in your Lusha account are not affected."
          confirmLabel="Disconnect"
          tone="danger"
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmingDisconnect(false)}
        />
      ) : null}

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
