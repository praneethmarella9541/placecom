"use client";

import { useEffect, useState } from "react";
import {
  getLabelSetting,
  getMaxEmailsSetting,
  setLabelSetting,
  setMaxEmailsSetting,
  type LabelOption,
  type MaxEmailsOption,
} from "@/lib/user-settings";
import { Skeleton } from "@/components/Skeleton";

export default function SettingsPage() {
  const [maxEmails, setMax] = useState<MaxEmailsOption>("50");
  const [label, setLab] = useState<LabelOption>("inbox");
  const [ready, setReady] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMax(getMaxEmailsSetting());
    setLab(getLabelSetting());
    setReady(true);
  }, []);

  function saveLocal() {
    setMaxEmailsSetting(maxEmails);
    setLabelSetting(label);
    setMsg("Preferences saved on this device.");
    setTimeout(() => setMsg(null), 2500);
  }

  function handleMaxEmailsChange(next: MaxEmailsOption) {
    setMax(next);
    setMaxEmailsSetting(next);
    setMsg("Preferences saved on this device.");
    setTimeout(() => setMsg(null), 2500);
  }

  function handleLabelChange(next: LabelOption) {
    setLab(next);
    setLabelSetting(next);
    setMsg("Preferences saved on this device.");
    setTimeout(() => setMsg(null), 2500);
  }

  async function deleteAll() {
    if (
      !window.confirm(
        "Delete all extraction jobs and stored email rows for your account? This cannot be undone."
      )
    ) {
      return;
    }
    setDeleting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/delete-extractions", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Delete failed");
      setMsg("All extracted data removed.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  if (!ready) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Control how many messages are scanned and which Gmail folder to read.
          Preferences are stored in your browser.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Gmail fetch
        </h2>
        <div className="mt-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
              How many emails to fetch
            </label>
            <select
              value={maxEmails}
              onChange={(e) =>
                handleMaxEmailsChange(e.target.value as MaxEmailsOption)
              }
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:ring-2 focus:ring-emerald-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="500">500</option>
              <option value="all">All (up to 10,000)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Gmail label
            </label>
            <select
              value={label}
              onChange={(e) => handleLabelChange(e.target.value as LabelOption)}
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:ring-2 focus:ring-emerald-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="inbox">Inbox</option>
              <option value="sent">Sent</option>
              <option value="all">All Mail</option>
            </select>
          </div>

          <button
            type="button"
            onClick={saveLocal}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
          >
            Save preferences
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Data
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Remove every stored extraction job and row from Supabase for your
          account.
        </p>
        <button
          type="button"
          onClick={() => void deleteAll()}
          disabled={deleting}
          className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-900 transition hover:bg-red-100 disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/70"
        >
          {deleting ? "Deleting\u2026" : "Delete all extracted data"}
        </button>
      </div>

      {msg ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
