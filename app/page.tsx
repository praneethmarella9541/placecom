"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google-config";
import { createClient } from "@/lib/supabase";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Skeleton } from "@/components/Skeleton";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import { titleCase } from "@/lib/title-case";
import { IconMail } from "@/components/Icons";

export default function HomePage() {
  const supabase = createClient();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [authErrorBanner, setAuthErrorBanner] = useState<string | null>(null);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffMsg, setStaffMsg] = useState<string | null>(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffPwdBusy, setStaffPwdBusy] = useState(false);
  const [magicOpen, setMagicOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      const raw = params.get("msg");
      let text = "Sign-in failed. Check Google sign-in settings with your administrator.";
      if (raw) {
        try {
          text = decodeURIComponent(raw);
        } catch {
          text = raw;
        }
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
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!signedIn) {
      setRole(null);
      setRoleLoading(false);
      return;
    }
    let cancelled = false;
    setRoleLoading(true);
    void fetch("/api/me/mailbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { role?: string } | null) => {
        if (cancelled) return;
        const nextRole = j?.role ?? null;
        setRole(nextRole);
        // Once signed in, everyone (admin, staff, committee) lands on /inbox
        // by default. The old "Open mail / Go to extraction" choice screen
        // was an extra step for admins; mail is the more common destination.
        if (nextRole) {
          window.location.replace("/inbox");
        }
      })
      .catch(() => {
        if (!cancelled) setRole(null);
      })
      .finally(() => {
        if (!cancelled) setRoleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

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
          // 'consent' forces Google to re-issue a refresh_token. 'select_account'
          // skips the consent screen and Google then omits the refresh_token on
          // subsequent sign-ins — which is why long-lived sessions break.
          prompt: "consent",
        },
      },
    });
    if (error) {
      console.error(error);
      alert(error.message);
    }
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
    window.location.href = "/inbox";
  }

  if (!ready) {
    // We don't yet know if there's a session. Show the inbox-shape
    // skeleton — for the common case (returning signed-in users) this
    // is exactly what they'll land on. For first-time visitors who'll
    // see the marketing page, this flashes for ~100ms and is fine.
    return <PostSigninInboxSkeleton />;
  }

  if (signedIn) {
    // Always show the skeleton while we resolve the role and redirect to
    // /inbox. The full welcome card below is dead code now but kept as a
    // fallback in case /api/me/mailbox returns no role (e.g. profile row
    // missing) so the user still has a way forward.
    if (roleLoading || role !== null) {
      // This skeleton mirrors the workspace shell + inbox layout the user
      // is about to land on: a left nav rail, a 300px thread-list column,
      // and the main reading pane. Honest preview = no perceived jank when
      // the real layout swaps in.
      return <PostSigninInboxSkeleton />;
    }
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-[var(--color-bg)] px-4">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggle />
        </div>
        <div className="surface-card-xl flex h-20 w-20 items-center justify-center rounded-[var(--radius-xl)]">
          <IconMail className="h-10 w-10 text-[var(--color-primary)]" />
        </div>
        <div className="max-w-md text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--color-text)]">
            {titleCase("Welcome back")}
          </h1>
          <p className="mt-3 text-[15px] text-[var(--color-text-muted)]">
            {titleCase(
              "Mailbox is ready. Open mail or extraction from the navigation when you are set up."
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
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

  const checklist = [
    "Shared inbox for the whole placement team",
    "Auto-extract recruiter contacts from every email",
    "Kanban CRM with intelligent stage tracking",
    "Outbound calls with recordings & AI transcripts",
    "Calendar sync + meeting summaries that write themselves",
  ];

  return (
    <div className="relative min-h-screen bg-[var(--color-bg)]">
      <div className="absolute right-4 top-4 z-50 md:right-6 md:top-6">
        <ThemeToggle />
      </div>

      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Left hero — deep indigo with orbital glow */}
        <div
          className="relative flex flex-col overflow-hidden bg-[var(--nucleus-deep)] px-8 pb-10 pt-16 text-white md:min-h-screen md:w-1/2 md:justify-between md:p-12"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, rgba(99,102,241,0.30), transparent 55%), radial-gradient(circle at 80% 80%, rgba(14,165,233,0.18), transparent 50%)",
          }}
        >
          {/* Decorative orbital rings */}
          <svg
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 h-[520px] w-[520px] opacity-25"
            viewBox="0 0 400 400"
          >
            <circle cx="200" cy="200" r="180" stroke="white" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="3 6" fill="none" />
            <circle cx="200" cy="200" r="140" stroke="white" strokeOpacity="0.18" strokeWidth="1" fill="none" />
            <circle cx="200" cy="200" r="100" stroke="white" strokeOpacity="0.22" strokeWidth="1" fill="none" />
            <circle cx="200" cy="200" r="55" fill="url(#nucleusGlow)" opacity="0.5" />
            <defs>
              <radialGradient id="nucleusGlow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0%" stopColor="#a5b4fc" stopOpacity="1" />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
              </radialGradient>
            </defs>
          </svg>

          <div className="relative z-10">
            <PlacecomLogo inverted />
            <h2 className="font-display mt-14 max-w-xl text-[44px] font-extrabold leading-[1.05] tracking-tight md:text-[52px]">
              The placement team&apos;s{" "}
              <span className="bg-gradient-to-r from-[#c7d2fe] via-white to-[#a5b4fc] bg-clip-text text-transparent">
                command center
              </span>
              .
            </h2>
            <p className="mt-5 max-w-[420px] text-base leading-relaxed text-white/75">
              Mail, extraction, CRM, calls, calendar, and meeting notes — every tool the team needs, gathered around one nucleus.
            </p>
            <ul className="mt-10 flex flex-col gap-3.5 text-[15px]">
              {checklist.map((line) => (
                <li key={line} className="flex items-start gap-3 text-white/90">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#a5b4fc]" strokeWidth={2.5} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative z-10 mt-12 text-xs uppercase tracking-[0.15em] text-white/45 md:mt-auto">
            Powered by Next.js · Supabase · Google Workspace
          </p>
        </div>

        {/* Right auth */}
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 md:py-16">
          <div className="w-full max-w-[420px] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-md)] md:p-10">
            <h1 className="font-display text-center text-2xl font-extrabold tracking-tight text-[var(--color-text)]">
              Welcome back
            </h1>
            <p className="mt-2 text-center text-sm text-[var(--color-text-muted)]">
              Sign in to your workspace.
            </p>

            {authErrorBanner ? (
              <div
                className="mt-6 rounded-[var(--radius-lg)] border border-[rgba(228,0,20,0.3)] bg-[var(--color-danger-light)] px-4 py-3 text-left text-sm text-[var(--color-danger)]"
                role="alert"
              >
                <p className="font-semibold">{titleCase("Sign-in failed")}</p>
                <p className="mt-2 whitespace-pre-wrap break-words opacity-90">{authErrorBanner}</p>
              </div>
            ) : null}

            <div className="mt-8">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">
                For Admins
              </p>
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="flex h-[44px] w-full items-center justify-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm font-medium text-[var(--color-text)] transition-all hover:-translate-y-px hover:border-[var(--color-text-muted)] hover:shadow-sm"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </button>
            </div>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[var(--color-border)]" />
              </div>
              <div className="relative flex justify-center text-[13px]">
                <span className="bg-[var(--color-surface)] px-3 text-[var(--color-text-faint)]">or</span>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">
                For Staff & Committee
              </p>
              <input
                type="email"
                autoComplete="email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="you@company.com"
                className="input-field"
              />
              <input
                type="password"
                autoComplete="current-password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                placeholder={titleCase("Password from your admin")}
                className="input-field mt-3"
              />
              <button
                type="button"
                disabled={staffPwdBusy}
                onClick={() => void signInStaffPassword()}
                className="btn-primary mt-4 h-[42px] w-full"
              >
                {staffPwdBusy ? titleCase("Signing in…") : titleCase("Sign In")}
              </button>
              <p className="mt-3 text-center text-[13px] text-[var(--color-text-muted)]">
                Your admin creates this account for you.
              </p>

              <button
                type="button"
                onClick={() => setMagicOpen((v) => !v)}
                className="mt-4 w-full text-center text-[13px] font-medium text-[var(--color-primary)] hover:underline"
              >
                Use magic link instead
              </button>

              {magicOpen ? (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <input
                    type="email"
                    autoComplete="email"
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="input-field bg-[var(--color-surface)]"
                  />
                  <button
                    type="button"
                    disabled={staffBusy}
                    onClick={() => void signInStaffEmail()}
                    className="btn-secondary mt-3 h-[42px] w-full"
                  >
                    {staffBusy ? titleCase("Sending…") : titleCase("Send Link")}
                  </button>
                </div>
              ) : null}

              {staffMsg ? (
                <p className="mt-4 text-center text-xs text-[var(--color-text-muted)]">{staffMsg}</p>
              ) : null}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton shown while we redirect a signed-in user to /inbox.
 * Mirrors the workspace chrome (220px left nav) + inbox (thread list +
 * reader pane) so the user sees the shape they're about to land on
 * instead of a generic centered card.
 */
function PostSigninInboxSkeleton() {
  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      {/* Left nav rail (matches WorkspaceChrome aside) */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex">
        {/* Logo bar */}
        <div className="flex h-[52px] items-center gap-2 border-b border-[var(--color-border)] px-4">
          <Skeleton className="skeleton-shimmer h-7 w-7 rounded-md" />
          <Skeleton className="skeleton-shimmer h-4 w-24 rounded-md" />
        </div>
        {/* Nav links */}
        <div className="flex flex-1 flex-col gap-1 px-3 py-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <Skeleton className="skeleton-shimmer h-[18px] w-[18px] rounded" />
              <Skeleton
                className="skeleton-shimmer h-3 rounded"
                style={{ width: `${[60, 50, 80, 65, 55, 70, 90, 75, 65][i]}%` }}
              />
            </div>
          ))}
        </div>
      </aside>

      {/* Main area */}
      <main className="flex flex-1 flex-col">
        {/* Top breadcrumb / header bar (matches WorkspaceChrome) */}
        <div className="flex h-[52px] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 md:px-6">
          <Skeleton className="skeleton-shimmer h-4 w-32 rounded" />
          <Skeleton className="skeleton-shimmer h-8 w-8 rounded-full" />
        </div>

        {/* Inbox: thread list (300px) + reader pane */}
        <div className="flex flex-1 flex-col lg:flex-row">
          {/* Thread list column */}
          <div className="flex w-full shrink-0 flex-col gap-3 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:w-[300px]">
            {/* Compose button + folder tabs */}
            <Skeleton className="skeleton-shimmer h-[34px] w-28 rounded-[var(--radius-md)]" />
            <div className="flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-offset)] p-0.5">
              <Skeleton className="skeleton-shimmer h-7 flex-1 rounded" />
              <Skeleton className="skeleton-shimmer h-7 flex-1 rounded" />
              <Skeleton className="skeleton-shimmer h-7 flex-1 rounded" />
            </div>
            {/* Search */}
            <Skeleton className="skeleton-shimmer h-9 w-full rounded-[var(--radius-md)]" />

            {/* Thread rows */}
            <div className="flex flex-col gap-3 pt-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton
                        className="skeleton-shimmer h-3 rounded"
                        style={{ width: `${[55, 70, 45, 65, 60, 80, 50][i]}%` }}
                      />
                      <Skeleton className="skeleton-shimmer h-3 w-10 rounded" />
                    </div>
                    <Skeleton
                      className="skeleton-shimmer h-3 rounded"
                      style={{ width: `${[85, 70, 90, 60, 80, 75, 95][i]}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reader pane — empty state placeholder */}
          <div className="hidden flex-1 items-center justify-center bg-[var(--color-bg)] p-8 lg:flex">
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="skeleton-shimmer h-14 w-14 rounded-[var(--radius-lg)]" />
              <Skeleton className="skeleton-shimmer h-4 w-48 rounded" />
              <Skeleton className="skeleton-shimmer h-3 w-32 rounded" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
