import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { AppHeader } from "@/components/AppHeader";

export default async function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
