import { redirect } from "next/navigation";
import { getCachedAuthUser } from "@/lib/auth-user";
import { WorkspaceChrome } from "@/components/WorkspaceChrome";
import { MailboxSessionSync } from "@/components/MailboxSessionSync";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import { ContactSyncStatus } from "@/components/ContactSyncStatus";

export default async function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCachedAuthUser();

  if (!user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <MailboxSessionSync />
      <PostHogIdentify />
      <ContactSyncStatus />
      <WorkspaceChrome>{children}</WorkspaceChrome>
    </div>
  );
}
