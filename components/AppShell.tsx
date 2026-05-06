import { redirect } from "next/navigation";
import { getCachedAuthUser } from "@/lib/auth-user";
import { AppHeader } from "@/components/AppHeader";
import { MailboxSessionSync } from "@/components/MailboxSessionSync";

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
    <div className="min-h-screen bg-background dark:bg-black">
      <MailboxSessionSync />
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
