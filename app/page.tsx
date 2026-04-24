"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  GOOGLE_OAUTH_SCOPES,
  isGoogleClientConfigured,
} from "@/lib/google-config";
import { createClient } from "@/lib/supabase";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Skeleton } from "@/components/Skeleton";
import { IconMail, IconUser, IconPhone, IconAtSign, IconSearch, IconDownload } from "@/components/Icons";

export default function HomePage() {
  const supabase = createClient();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authErrorBanner, setAuthErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      const raw = params.get("msg");
      let text = "Sign-in failed. Check Google provider settings in Supabase.";
      if (raw) {
        try { text = decodeURIComponent(raw); } catch { text = raw; }
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
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) { console.error(error); alert(error.message); }
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/60">
          <IconMail className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Welcome back
          </h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Your Gmail is connected. Head to the dashboard to extract contacts or check your mail.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/inbox" className="btn-secondary">
            <IconMail className="h-4 w-4" /> Open Mail
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const features = [
    { icon: IconMail,     title: "Gmail sync",         desc: "Read your inbox and send replies — live from Google's API" },
    { icon: IconUser,     title: "Name extraction",     desc: "OpenAI GPT-4o structures names, emails, phones, and matched contacts" },
    { icon: IconPhone,    title: "Phone numbers",       desc: "Indian + international formats via regex and ML" },
    { icon: IconAtSign,   title: "Email addresses",     desc: "Pattern-match every email buried in message bodies" },
    { icon: IconSearch,   title: "Search & filter",     desc: "Find any extracted contact across all your messages" },
    { icon: IconDownload, title: "CSV export",          desc: "One-click download of every name, phone, and email" },
  ];

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="absolute right-4 top-4 z-10"><ThemeToggle /></div>

      <section className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-20">
        <div className="relative mx-auto max-w-2xl text-center">
          <div className="absolute -top-20 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-400/20 blur-3xl dark:bg-emerald-600/10" />
          {authErrorBanner ? (
            <div className="relative mb-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-left text-sm text-red-950 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-50" role="alert">
              <p className="font-semibold">Sign-in failed</p>
              <p className="mt-2 whitespace-pre-wrap break-words opacity-90">{authErrorBanner}</p>
              <p className="mt-3 text-xs opacity-80">
                Check Supabase → Authentication → Providers → Google. Re-paste <strong>Client ID</strong> and <strong>Client Secret</strong>.
              </p>
            </div>
          ) : null}

          <div className="relative">
            <span className="badge-emerald mb-5 inline-flex gap-1.5">
              <IconMail className="h-3 w-3" /> Gmail + GPT-4o
            </span>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
              Extract contacts
              <br />
              <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent dark:from-emerald-400 dark:to-teal-300">
                from your Gmail
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-balance text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              Sign in with Google. We use OpenAI GPT-4o to extract names,
              phone numbers, emails, and logically paired contacts — then let
              you search and export everything.
            </p>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="btn-primary min-h-[52px] min-w-[220px] gap-2.5 rounded-2xl px-7 text-[15px] shadow-lg shadow-emerald-600/20"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Gmail read + send access · Tokens in your session only
          </p>
          {isGoogleClientConfigured() ? (
            <p className="mt-1 text-xs text-emerald-600/80 dark:text-emerald-400/70">
              Google client ID configured
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-t border-zinc-200/80 bg-zinc-50/50 px-4 py-16 dark:border-zinc-800/80 dark:bg-zinc-950/50">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            What you get
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="card group p-5 transition-shadow hover:shadow-md">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100/80 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white dark:bg-emerald-950/50 dark:text-emerald-400 dark:group-hover:bg-emerald-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {f.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200/60 px-4 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800/60 dark:text-zinc-600">
        Built with Next.js, Supabase, Tailwind, and OpenAI
      </footer>
    </div>
  );
}
