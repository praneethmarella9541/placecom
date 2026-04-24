import AppShell from "@/components/AppShell";

export default function CallsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
