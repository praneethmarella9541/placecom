import AppShell from "@/components/AppShell";

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
