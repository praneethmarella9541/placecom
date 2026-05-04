"use client";

import { useState } from "react";
import { titleCase } from "@/lib/title-case";

export default function AdminTeamPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createStaff() {
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/staff-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        email?: string;
      };
      if (!res.ok) {
        setMsg(j.error || "Request failed");
        return;
      }
      setMsg(
        `Staff account created for ${j.email ?? email.trim()}. They can sign in on the home page with this email and password.`
      );
      setEmail("");
      setPassword("");
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {titleCase("Team & shared mailbox")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {titleCase(
            "Create staff accounts here. Each person gets their own login and automatically uses your connected Gmail. Tell them the password you set, or have them change it later in Supabase if you prefer."
          )}
        </p>
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {titleCase("Add staff member")}
        </h2>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Work email")}
        </label>
        <input
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@company.com"
          className="input-field w-full text-sm"
        />
        <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {titleCase("Initial password (min. 8 characters)")}
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="input-field w-full text-sm"
        />
        <button
          type="button"
          disabled={busy || !email.trim() || password.length < 8}
          onClick={() => void createStaff()}
          className="btn-primary mt-2 w-full"
        >
          {busy ? titleCase("Creating…") : titleCase("Create staff account")}
        </button>
        {msg ? (
          <p
            className={`text-sm ${msg.includes("created") ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {msg}
          </p>
        ) : null}
      </div>
    </div>
  );
}
