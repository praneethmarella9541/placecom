import AppShell from "@/components/AppShell";

export default function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
