import AppShell from "@/components/AppShell";

/** Single shell for all authenticated app routes — persists across navigation so auth + header are not re-fetched on every tab change. */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
