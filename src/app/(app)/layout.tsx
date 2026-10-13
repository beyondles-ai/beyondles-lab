import { getTranslations } from "next-intl/server";

import "@/components/app-shell/app-shell.css";
import { AppShell, IconCog, IconHome, IconPen, type NavGroup } from "@/components/app-shell";
import { db } from "@/lib/db";
import { LAB_PRODUCT, frameContext } from "@/lib/frame";
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
 * The sidebar only leads to pages of this Lab. Back to Suite, profile,
 * organisation settings, help and sign out are in the frame's topbar and
 * person menu, built from the Suite URL of the running environment.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, organisationId, isAdmin, access } = await requireAccess();
  const t = await getTranslations("nav");
  const frame = await frameContext(access.orgRole);

  const organisation = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { name: true },
  });

  const navGroups: NavGroup[] = [
    {
      items: [
        { id: "overview", href: "/", label: t("dashboard"), icon: <IconHome />, match: "exact" },
        { id: "notes", href: "/notes", label: t("notes"), icon: <IconPen /> },
      ],
    },
  ];
  // Settings of this Lab (API keys) are for its admins only; the page checks
  // again on its own.
  if (isAdmin) {
    navGroups.push({
      label: t("groupLab"),
      items: [{ id: "settings", href: "/settings", label: t("settings"), icon: <IconCog /> }],
    });
  }

  return (
    <AppShell
      locale={frame.locale}
      product={LAB_PRODUCT}
      navGroups={navGroups}
      user={{ name: session.name || session.email, email: session.email }}
      organisation={{ name: organisation?.name ?? session.organisationSlug }}
      links={frame.links}
      sessionHint={frame.sessionHint}
    >
      {children}
    </AppShell>
  );
}
