"use client";

import { ProfileSettings } from "@/components/ProfileSettings";
import { titleCase } from "@/lib/title-case";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("My profile")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {titleCase("Update your portal profile and password.")}
        </p>
      </div>
      <ProfileSettings />
    </div>
  );
}
