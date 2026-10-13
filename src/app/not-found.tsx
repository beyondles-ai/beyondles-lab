import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import "@/components/app-shell/app-shell.css";
import { AppShell, IconSearch, PageState } from "@/components/app-shell";
import { getSession, organisationDisplayName } from "@/lib/auth";
import { LAB_PRODUCT, frameContext } from "@/lib/frame";
import { labNavGroups } from "@/lib/lab-nav";
import { hasProductAccess, isProductAdmin } from "@/lib/platform/access";
import { requireOrg } from "@/lib/rbac";

/**
 * An address that matches no page of this Lab (for example `/foo`). Without
 * this file Next shows its own unstyled 404 page, outside the frame and in
 * English only. `(app)/not-found.tsx` only covers `notFound()` inside the
 * signed-in area.
 *
 * Signed in: the same state inside the frame (sidebar only for people with
 * access to this Lab, so nobody sees pages they cannot open). Not signed in,
 * or the frame cannot be built: the state alone, with the frame's styling.
 * This page never redirects and never writes anything; access is still
 * checked by every page the person goes to next.
 */
export default async function RootNotFound() {
  const t = await getTranslations("states");
  const content = (
    <PageState
      variant="empty"
      icon={<IconSearch size={28} />}
      title={t("notFoundTitle")}
      description={t("notFoundBody")}
      action={
        <Link className="by-app-btn by-app-btn-primary" href="/">
          {t("notFoundAction")}
        </Link>
      }
    />
  );

  const framed = await inFrame(content);
  if (framed) return framed;

  return (
    <div className="by-app" data-by-app-kind="lab">
      <main className="by-app-content">{content}</main>
    </div>
  );
}

/** The state inside the frame for a signed-in person, or `null`. */
async function inFrame(content: React.ReactNode): Promise<React.ReactNode | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    const { access, gate } = await requireOrg();
    const granted = gate.allowed && access !== null && hasProductAccess(access);
    const frame = await frameContext(access?.orgRole);
    const navGroups = granted ? await labNavGroups(isProductAdmin(access)) : [];
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
        {content}
      </AppShell>
    );
  } catch (error) {
    // Next's own signals (redirect, dynamic rendering) are thrown on purpose.
    unstable_rethrow(error);
    console.error("[not-found] frame unavailable", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}
