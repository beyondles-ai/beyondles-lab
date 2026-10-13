import "@/components/app-shell/app-shell.css";
import { AppShell } from "@/components/app-shell";
import { organisationDisplayName } from "@/lib/auth";
import { LAB_PRODUCT, frameContext } from "@/lib/frame";
import { labNavGroups } from "@/lib/lab-nav";
import { requireAccess } from "@/lib/rbac";

/**
 * Frame of the signed-in area: the shared Beyondles frame (`AppShell` from
 * src/components/app-shell, generated from beyondles-ai/beyondles-shared)
 * with sidebar, topbar, person menu, organisation chip and footer. The pages
 * only fill the content area.
 *
 * `requireAccess()` runs here ONCE for all sub pages: Suite session, level 1
 * (gate), level 2 (product access), and the organisation mirror on the first
 * visit. Every page and action still checks again: a layout is not a security
 * boundary, server actions run without it.
 *
 * The sidebar (src/lib/lab-nav.tsx) only leads to pages of this Lab. Back to Suite, profile,
 * organisation settings, help and sign out are in the frame's topbar and
 * person menu, built from the Suite URL of the running environment.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, isAdmin, access } = await requireAccess();
  const frame = await frameContext(access.orgRole);

  const navGroups = await labNavGroups(isAdmin);

  return (
    <AppShell
      locale={frame.locale}
      product={LAB_PRODUCT}
      navGroups={navGroups}
      user={{ name: session.name || session.email, email: session.email }}
      organisation={{ name: organisationDisplayName(session) }}
      links={frame.links}
      sessionHint={frame.sessionHint}
    >
      {children}
    </AppShell>
  );
}
