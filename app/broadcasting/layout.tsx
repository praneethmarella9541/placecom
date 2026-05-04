import AppShell from "@/components/AppShell";

export default function BroadcastingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
