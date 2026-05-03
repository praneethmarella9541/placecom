import AppShell from "@/components/AppShell";

export default function MeetingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
