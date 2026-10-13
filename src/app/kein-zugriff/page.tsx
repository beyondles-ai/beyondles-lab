import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AppShell, IconAlert, IconCheck, NoAccess, PageState } from "@/components/app-shell";
import { LAB_PRODUCT, frameContext } from "@/lib/frame";
import { requireOrg } from "@/lib/rbac";
import { hasProductAccess } from "@/lib/platform/access";
import { SUPPORT_MAILTO } from "@/lib/suite-url";

/**
 * Notice page for people without access. Lives OUTSIDE the `(app)` group:
 * its layout calls `requireAccess()` and would redirect here, a loop.
 *
 * The reason is determined fresh from gate and platform context, never from
 * the address bar:
 *  - `not-assigned` (level 2: the organisation has not given this person the
 *    Lab, or the platform could not be asked) and `blocked` (level 1: not
 *    released in the Suite): the shared no-access page (`NoAccess`) with
 *    "Back to Suite" and, for the wrong account, "Switch account".
 *  - `unreachable` (the Suite could not be asked) and `not-configured` (the
 *    door state is `unconfigured` or `off`: the platform door is missing in
 *    this environment, an operator problem, not the person's): the frame with
 *    the error state, because "ask your admin" would be the wrong advice.
 *  - `allowed`: the person has access; the page only says so.
 */
export default async function NoAccessPage() {
  const { session, access, gate, denied, doorState } = await requireOrg();
  const t = await getTranslations("noAccess");
  const frame = await frameContext(access?.orgRole);

  // Policy P1: with the door unconfigured or off nobody gets in; that is the
  // operator's problem, not the person's.
  const doorMissing = denied === "unavailable" && (doorState === "unconfigured" || doorState === "off");

  const reason = !gate.allowed
    ? gate.reason === "unreachable"
      ? "unreachable"
      : "blocked"
    : !access
      ? doorMissing
        ? "not-configured"
        : "not-assigned"
      : hasProductAccess(access)
        ? "allowed"
        : "not-assigned";

  // From the session only: this page must render even when the database is
  // the reason something failed (the mirror row carries the slug as its name).
  const organisation = { name: session.organisationSlug };

  if (reason === "not-assigned" || reason === "blocked") {
    return (
      <NoAccess
        locale={frame.locale}
        product={LAB_PRODUCT}
        variant="access"
        organisation={organisation}
        links={{ suite: frame.links.suite, switchAccount: frame.links.switchAccount }}
        sessionHint={frame.sessionHint}
      />
    );
  }

  const content =
    reason === "allowed" ? (
      <PageState
        variant="empty"
        icon={<IconCheck size={28} />}
        title={t("titleAllowed")}
        description={t("bodyAllowed")}
        action={
          <Link className="by-app-btn by-app-btn-primary" href="/">
            {t("toApp")}
          </Link>
        }
      />
    ) : (
      <PageState
        variant="error"
        icon={<IconAlert size={28} />}
        title={reason === "unreachable" ? t("titleUnreachable") : t("titleNotConfigured")}
        description={reason === "unreachable" ? t("bodyUnreachable") : t("bodyNotConfigured")}
        action={
          <a className="by-app-btn by-app-btn-primary" href="/kein-zugriff">
            {t("tryAgain")}
          </a>
        }
        supportHref={SUPPORT_MAILTO}
      />
    );

  return (
    <AppShell
      locale={frame.locale}
      product={LAB_PRODUCT}
      navGroups={[]}
      user={{ name: session.name || session.email, email: session.email }}
      organisation={organisation}
      links={frame.links}
      sessionHint={frame.sessionHint}
    >
      {content}
    </AppShell>
  );
}
