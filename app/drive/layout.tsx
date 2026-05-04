import AppShell from "@/components/AppShell";

export default function DriveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
