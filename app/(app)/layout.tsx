import { AppShell } from "../_components/shell/app-shell";

/**
 * Everything behind the private-preview door shares the app chrome. The sign
 * in screen sits outside this group, so it gets none of it.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Only offer a way out of the preview when there is a door to begin with.
  return <AppShell gated={Boolean(process.env.SITE_PASSPHRASE)}>{children}</AppShell>;
}
