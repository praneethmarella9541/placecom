import AppShell from "@/components/AppShell";

export default function AdminTeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
