"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google-config";
import { createClient } from "@/lib/supabase";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Skeleton } from "@/components/Skeleton";
import { ProductPreviews } from "@/components/landing/ProductPreviews";
import { titleCase } from "@/lib/title-case";
import {
  IconMail,
  IconInbox,
  IconDashboard,
  IconUsers,
  IconCalendar,
  IconPhone,
  IconSend,
} from "@/components/Icons";

export default function HomePage() {
  const supabase = createClient();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authErrorBanner, setAuthErrorBanner] = useState<string | null>(null);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffMsg, setStaffMsg] = useState<string | null>(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffPwdBusy, setStaffPwdBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      const raw = params.get("msg");
      let text = "Sign-in failed. Check Google sign-in settings with your administrator.";
      if (raw) {
        try { text = decodeURIComponent(raw); } catch { text = raw; }
      }
      if (/pkce|code verifier/i.test(text)) {
        text +=
          " Tip: request the link again and open it in the same browser where you clicked “Email me a link” (or copy the link from email into that browser). Do not mix localhost with 127.0.0.1.";
      }
      setAuthErrorBanner(text);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(!!session);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  async function signInWithGoogle() {
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback`,
        scopes: GOOGLE_OAUTH_SCOPES,
        queryParams: {
          access_type: "offline",
          include_granted_scopes: "true",
          prompt: "select_account",
        },
      },
    });
    if (error) { console.error(error); alert(error.message); }
  }

  async function signInStaffEmail() {
    const email = staffEmail.trim().toLowerCase();
    if (!email) {
      setStaffMsg("Enter your work email.");
      return;
    }
    setStaffMsg(null);
    setStaffBusy(true);
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    setStaffBusy(false);
    if (error) {
      setStaffMsg(error.message);
      return;
    }
    setStaffMsg(
      `${titleCase("Check your email for the sign-in link.")} Open it in this same browser, or copy the link from the email and paste it into this browser. Each new request sends a new link; old links can expire.`
    );
  }

  async function signInStaffPassword() {
    const email = staffEmail.trim().toLowerCase();
    const password = staffPassword;
    if (!email) {
      setStaffMsg("Enter your work email.");
      return;
    }
    if (!password) {
      setStaffMsg("Enter your password.");
      return;
    }
    setStaffMsg(null);
    setStaffPwdBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setStaffPwdBusy(false);
    if (error) {
      setStaffMsg(error.message);
      return;
    }
    window.location.href = "/dashboard";
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <Skeleton className="h-14 w-72 rounded-2xl" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-12 w-56 rounded-xl" />
      </div>
    );
  }

  if (signedIn) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden px-4">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_20%,rgba(16,185,129,0.12),transparent)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_15%,rgba(52,211,153,0.08),transparent)]" />
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="motion-safe:animate-fade-in-up flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100 shadow-lg shadow-emerald-600/10 ring-2 ring-white/50 dark:bg-emerald-950/60 dark:ring-emerald-500/20">
          <IconMail className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="motion-safe:animate-fade-in-up motion-safe:delay-150 max-w-md text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {titleCase("Welcome back")}
          </h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            {titleCase(
              "Mailbox is ready. Open mail or extraction from the navigation when you are set up."
            )}
          </p>
        </div>
        <div className="motion-safe:animate-fade-in-up motion-safe:delay-300 flex flex-wrap justify-center gap-3">
          <Link href="/inbox" className="btn-secondary">
            <IconMail className="h-4 w-4" /> {titleCase("Open mail")}
          </Link>
          <Link href="/dashboard" className="btn-primary">
            {titleCase("Go to extraction")}
          </Link>
        </div>
      </div>
    );
  }

  const features = [
    {
      icon: IconInbox,
      title: "Live Gmail",
      desc: "Inbox and sent in the app: open threads, compose, reply, and handle attachments while mail stays with Google.",
    },
    {
      icon: IconDashboard,
      title: "Contact Extraction",
      desc: "Run jobs over your mailbox to pull names, phone numbers, and emails into a searchable table with CSV export.",
    },
    {
      icon: IconUsers,
      title: "Recruiter CRM",
      desc: "Pipeline stages for new and regular leads, plus a timeline of calls, emails, meetings, and notes per company.",
    },
    {
      icon: IconCalendar,
      title: "Calendar",
      desc: "See your Google Calendar and book meetings with recruiters you have already surfaced from mail or extraction.",
    },
    {
      icon: IconPhone,
      title: "Outbound Calls",
      desc: "Place calls from the app when your workspace is set up for voice; review logs, recordings, and transcripts.",
    },
    {
      icon: IconSend,
      title: "Meetings & Recaps",
      desc: "Synced transcripts and summaries in one list; refresh to pull the latest and send recap emails when you need them.",
    },
  ];

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="absolute right-4 top-4 z-50">
        <ThemeToggle />
      </div>

      <section className="relative flex flex-1 flex-col px-4 pb-20 pt-24 lg:pb-28 lg:pt-28">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(24_24_27/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(24_24_27/0.05)_1px,transparent_1px)] bg-[length:40px_40px] dark:bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)]" />
          <div className="absolute -top-48 left-1/2 h-[min(520px,80vw)] w-[min(900px,120vw)] -translate-x-1/2 rounded-full bg-gradient-to-b from-emerald-400/30 via-teal-400/12 to-transparent blur-3xl dark:from-emerald-500/18 dark:via-teal-500/8" />
          <div className="absolute -bottom-24 right-[-10%] h-72 w-72 rounded-full bg-teal-400/20 blur-3xl motion-safe:animate-pulse-soft dark:bg-teal-600/12" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl">
          <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-12">
            <div className="relative z-20 text-center lg:text-left">
              {authErrorBanner ? (
                <div
                  className="relative mb-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-left text-sm text-red-950 motion-safe:animate-fade-in-up dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-50"
                  role="alert"
                >
                  <p className="font-semibold">{titleCase("Sign-in failed")}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words opacity-90">{authErrorBanner}</p>
                  <p className="mt-3 text-xs opacity-80">
                    {titleCase(
                  "If this keeps happening, ask your administrator to verify Google sign-in for this app."
                )}
                  </p>
                </div>
              ) : null}

              <h1 className="text-4xl font-bold tracking-tight text-zinc-900 motion-safe:animate-fade-in-up sm:text-5xl sm:leading-[1.1] dark:text-zinc-50">
                <span className="bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-600 bg-clip-text text-transparent dark:from-emerald-400 dark:via-teal-300 dark:to-emerald-400">
                  Placecom
                </span>
              </h1>
            <p className="mx-auto mt-5 max-w-lg text-balance text-[15px] leading-relaxed text-zinc-600 motion-safe:animate-fade-in-up motion-safe:delay-150 lg:mx-0 dark:text-zinc-400">
              {titleCase(
                "Mail, extraction, CRM, calendar, calls, and meeting notes in one workspace. Admins connect Google once; staff sign in with email and password (or optional magic link) and see the shared mailbox after an admin links them."
              )}
            </p>

              <div className="mt-10 flex w-full max-w-md flex-col items-stretch gap-4 motion-safe:animate-fade-in-up motion-safe:delay-300 lg:max-w-none lg:items-start">
                <button
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  className="btn-primary min-h-[52px] min-w-[220px] gap-2.5 self-center rounded-2xl px-7 text-[15px] shadow-lg shadow-emerald-600/25 transition-transform duration-200 hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-600/30 active:scale-[0.98] motion-reduce:hover:scale-100 lg:self-start"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  {titleCase("Admin: continue with Google")}
                </button>

                <div className="rounded-2xl border border-zinc-200/80 bg-white/60 p-4 dark:border-zinc-700/80 dark:bg-zinc-900/40">
                  <p className="text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 lg:text-left">
                    {titleCase("Staff: sign in (no Google required for login)")}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      type="email"
                      autoComplete="email"
                      value={staffEmail}
                      onChange={(e) => setStaffEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="input-field min-h-[44px] w-full text-sm"
                    />
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={staffPassword}
                      onChange={(e) => setStaffPassword(e.target.value)}
                      placeholder={titleCase("Password from your administrator")}
                      className="input-field min-h-[44px] w-full text-sm"
                    />
                    <button
                      type="button"
                      disabled={staffPwdBusy}
                      onClick={() => void signInStaffPassword()}
                      className="btn-primary min-h-[44px] w-full text-sm"
                    >
                      {staffPwdBusy ? titleCase("Signing in…") : titleCase("Sign in with password")}
                    </button>
                  </div>
                  <p className="mt-3 text-center text-[11px] text-zinc-500 dark:text-zinc-500 lg:text-left">
                    {titleCase(
                      "Your admin creates this account in Supabase and sets a password (or sends you a temporary one to change after first login)."
                    )}
                  </p>
                  <div className="mt-4 border-t border-zinc-200/80 pt-3 dark:border-zinc-700/80">
                    <p className="text-center text-[11px] font-medium text-zinc-500 dark:text-zinc-400 lg:text-left">
                      {titleCase("Optional: magic link instead")}
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        disabled={staffBusy}
                        onClick={() => void signInStaffEmail()}
                        className="btn-secondary min-h-[44px] shrink-0 px-4 text-sm"
                      >
                        {staffBusy ? titleCase("Sending…") : titleCase("Email me a link")}
                      </button>
                    </div>
                  </div>
                  {staffMsg ? (
                    <p className="mt-2 text-center text-xs text-zinc-600 dark:text-zinc-400 lg:text-left">
                      {staffMsg}
                    </p>
                  ) : null}
                  <p className="mt-2 text-center text-[11px] leading-snug text-zinc-500 dark:text-zinc-500 lg:text-left">
                    {titleCase(
                      "Use http://localhost:3000 consistently (not 127.0.0.1). Add both URLs in Supabase Authentication → URL configuration if needed."
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="relative z-0 min-h-0 w-full max-w-full overflow-x-clip lg:pl-2">
              <ProductPreviews />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-200/80 bg-gradient-to-b from-zinc-50/90 to-zinc-50 px-4 py-20 dark:border-zinc-800/80 dark:from-zinc-950 dark:to-zinc-950/80">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-xs font-semibold tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            {titleCase("What you get")}
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="card group relative overflow-hidden p-5 transition-all duration-500 ease-out hover:-translate-y-1 hover:border-emerald-200/80 hover:shadow-lg hover:shadow-emerald-900/5 motion-safe:animate-fade-in-up motion-reduce:animate-none dark:hover:border-emerald-800/50"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-emerald-500/5 blur-2xl transition-opacity group-hover:opacity-100 dark:bg-emerald-400/10" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100/80 text-emerald-700 transition-all duration-300 group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white group-hover:shadow-md group-hover:shadow-emerald-600/25 dark:bg-emerald-950/50 dark:text-emerald-400 dark:group-hover:bg-emerald-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {titleCase(f.title)}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {titleCase(f.desc)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200/60 px-4 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800/60 dark:text-zinc-600">
        {titleCase("Built with Next.js and Tailwind")}
      </footer>
    </div>
  );
}
