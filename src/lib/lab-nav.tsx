import { getTranslations } from "next-intl/server";

import { IconCog, IconHome, IconPen, type NavGroup } from "@/components/app-shell";

/**
 * The sidebar of this Lab: its own pages only. One place, so the signed-in
 * layout and the root "not found" page (which renders the frame for a
 * signed-in person) show the same navigation. Add the Lab's pages here.
 *
 * Never a link out of the Lab: Back to Suite, profile, organisation
 * settings, help and sign out live in the frame's topbar and person menu.
 */
export async function labNavGroups(isAdmin: boolean): Promise<NavGroup[]> {
  const t = await getTranslations("nav");
  const groups: NavGroup[] = [
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
    groups.push({
      label: t("groupLab"),
      items: [{ id: "settings", href: "/settings", label: t("settings"), icon: <IconCog /> }],
    });
  }
  return groups;
}
