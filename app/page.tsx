"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google-config";
import { createClient } from "@/lib/supabase";
import { Skeleton } from "@/components/Skeleton";
import { PasswordInput } from "@/components/PasswordInput";
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
  const [staffMsgIsError, setStaffMsgIsError] = useState(false);
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
      setStaffMsgIsError(true);
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
      setStaffMsgIsError(true);
      return;
    }
    setStaffMsgIsError(false);
    setStaffMsg(
      `${titleCase("Check your email for the sign-in link.")} Open it in this same browser, or copy the link from the email and paste it into this browser. Each new request sends a new link; old links can expire.`
    );
  }

  async function signInStaffPassword() {
    const email = staffEmail.trim().toLowerCase();
    const password = staffPassword;
    if (!email) {
      setStaffMsg("Enter your work email.");
      setStaffMsgIsError(true);
      return;
    }
    if (!password) {
      setStaffMsg("Enter your password.");
      setStaffMsgIsError(true);
      return;
    }
    setStaffMsg(null);
    setStaffPwdBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setStaffPwdBusy(false);
    if (error) {
      setStaffMsg(error.message);
      setStaffMsgIsError(true);
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
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Left hero — deep editorial dark */}
        <div
          className="relative flex flex-col overflow-hidden px-8 pb-10 pt-16 text-white md:min-h-screen md:w-1/2 md:justify-between md:p-12"
          style={{
            backgroundColor: "#0C0B11",
            backgroundImage: [
              "radial-gradient(ellipse at 15% 20%, rgba(37,99,235,0.18) 0%, transparent 50%)",
              "radial-gradient(ellipse at 85% 80%, rgba(217,119,6,0.10) 0%, transparent 50%)",
              "radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)",
            ].join(", "),
            backgroundSize: "100% 100%, 100% 100%, 32px 32px",
          }}
        >
          {/* Decorative accent line */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-[1px] w-full opacity-60"
            style={{ background: "linear-gradient(90deg, transparent, rgba(37,99,235,0.6) 40%, rgba(217,119,6,0.4) 70%, transparent)" }}
          />
          {/* Large background numeral — editorial accent */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 bottom-16 select-none text-[220px] font-extrabold leading-none text-white/[0.025] md:text-[280px]"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.05em" }}
          >
            01
          </div>

          <div className="relative z-10">
            <div className="animate-fade-up" style={{ animationDelay: "0ms" }}>
              <PlacecomLogo inverted />
            </div>
            <h2
              className="font-display mt-14 max-w-xl text-[40px] font-extrabold leading-[1.08] tracking-tight md:text-[50px] animate-fade-up"
              style={{ animationDelay: "80ms" }}
            >
              Your placement team&apos;s{" "}
              <span
                className="animate-gradient-x bg-clip-text text-transparent"
                style={{ backgroundImage: "linear-gradient(135deg, #93C5FD, #FFFFFF 45%, #FCD34D)", backgroundSize: "200% 100%" }}
              >
                command center.
              </span>
            </h2>
            <p
              className="mt-5 max-w-[400px] text-[15px] leading-relaxed text-white/60 animate-fade-up"
              style={{ animationDelay: "160ms" }}
            >
              Mail, extraction, CRM, calendar, and meeting notes — every tool the team needs, in one workspace.
            </p>
            <ul className="mt-10 flex flex-col gap-3 text-[14px]">
              {checklist.map((line, i) => (
                <li
                  key={line}
                  className="flex items-start gap-3 text-white/80 animate-fade-up"
                  style={{ animationDelay: `${240 + i * 55}ms` }}
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.07]">
                    <CheckCircle2 className="h-3 w-3 text-blue-300" strokeWidth={2.5} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right auth */}
        <div className="flex flex-1 flex-col items-center justify-center bg-[var(--color-bg)] px-4 py-12 md:py-16">
          <div className="w-full max-w-[400px] animate-slide-in-right rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-lg)] md:p-10" style={{ animationDelay: "120ms" }}>
            <h1 className="font-display text-center text-[22px] font-bold tracking-tight text-[var(--color-text)]">
              Sign in
            </h1>
            <p className="mt-1.5 text-center text-[13px] text-[var(--color-text-muted)]">
              Access your workspace.
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
              <PasswordInput
                autoComplete="current-password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                placeholder={titleCase("Password from your admin")}
                wrapperClassName="mt-3"
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
                staffMsgIsError ? (
                  <div className="mt-4 rounded-[var(--radius-md)] border border-[rgba(228,0,20,0.3)] bg-[var(--color-danger-light)] px-3 py-2.5 text-center text-sm font-medium text-[var(--color-danger)]">
                    {staffMsg}
                  </div>
                ) : (
                  <p className="mt-4 text-center text-xs text-[var(--color-text-muted)]">{staffMsg}</p>
                )
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
      {/* Left nav sidebar */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] md:flex">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Skeleton className="skeleton-shimmer h-7 w-7 rounded-lg" />
          <Skeleton className="skeleton-shimmer h-4 w-24 rounded" />
        </div>
        {/* Primary nav links */}
        <div className="flex flex-col gap-0.5 px-2 pt-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <Skeleton className="skeleton-shimmer h-[17px] w-[17px] rounded" />
              <Skeleton
                className="skeleton-shimmer h-3 rounded"
                style={{ width: `${[55, 65, 40, 60, 55][i]}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mx-4 my-3 h-px bg-[var(--sidebar-border)]" />
        {/* Secondary nav links */}
        <div className="flex flex-col gap-0.5 px-2">
          {Array.from({ length: 4 }).map((_, i) => (
             <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2">
              <Skeleton className="skeleton-shimmer h-[16px] w-[16px] rounded" />
              <Skeleton
                className="skeleton-shimmer h-3 rounded"
                style={{ width: `${[45, 38, 70, 42][i]}%` }}
              />
            </div>
          ))}
        </div>
        {/* User profile footer */}
        <div className="mt-auto border-t border-[var(--sidebar-border)] px-2 py-2">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <Skeleton className="skeleton-shimmer h-8 w-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="skeleton-shimmer h-3 w-20 rounded" />
              <Skeleton className="skeleton-shimmer h-2.5 w-28 rounded" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main area — inbox layout (no top header on desktop) */}
      <main className="flex flex-1 flex-col">
        {/* Inbox: thread list (300px) + reader pane — fills full height */}
        <div className="flex flex-1 flex-col lg:flex-row">
          {/* Thread list column */}
          <div className="flex w-full shrink-0 flex-col gap-3 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:w-[300px]">
            <Skeleton className="skeleton-shimmer h-[34px] w-28 rounded-[var(--radius-md)]" />
            <div className="flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-offset)] p-0.5">
              <Skeleton className="skeleton-shimmer h-7 flex-1 rounded" />
              <Skeleton className="skeleton-shimmer h-7 flex-1 rounded" />
              <Skeleton className="skeleton-shimmer h-7 flex-1 rounded" />
            </div>
            <Skeleton className="skeleton-shimmer h-9 w-full rounded-[var(--radius-md)]" />
            <div className="flex flex-col gap-3 pt-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="skeleton-shimmer h-3 rounded" style={{ width: `${[55, 70, 45, 65, 60, 80, 50][i]}%` }} />
                      <Skeleton className="skeleton-shimmer h-3 w-10 rounded" />
                    </div>
                    <Skeleton className="skeleton-shimmer h-3 rounded" style={{ width: `${[85, 70, 90, 60, 80, 75, 95][i]}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Reader pane */}
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
