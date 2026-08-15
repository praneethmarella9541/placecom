"use client";

import { UserRound } from "lucide-react";
import { ProfileSettings } from "@/components/ProfileSettings";
import { titleCase } from "@/lib/title-case";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-copper-tint)] text-[var(--color-copper)]">
          <UserRound className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="font-display text-[17px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("My profile")}
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {titleCase("Update your portal profile and password.")}
          </p>
        </div>
      </div>
      <ProfileSettings />
    </div>
  );
}
