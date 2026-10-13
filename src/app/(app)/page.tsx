import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { IconBolt, IconPen, IconUsers, PageHeader, StatCard, StatGrid } from "@/components/app-shell";
import { uiActor } from "@/lib/actor";
import { requireAccess } from "@/lib/rbac";
import { accessDoorState } from "@/lib/platform/door";
import { countVisibleNotes } from "@/server/services/notes";

/**
 * The entry page at "/". The Suite tile points here. There is no landing
 * page in between: a signed-in person lands in the app.
 */
export default async function DashboardPage() {
  const ctx = await requireAccess();
  const { session } = ctx;
  const t = await getTranslations("dashboard");
  const count = await countVisibleNotes(uiActor(ctx));
  const state = accessDoorState();

  return (
    <>
      <PageHeader
        kicker={t("kicker")}
        title={t("title")}
        titleMuted={t("titleMuted")}
        description={t("intro")}
        actions={
          <Link className="by-app-btn by-app-btn-primary" href="/notes">
            {t("openNotes")}
          </Link>
        }
      />
      <StatGrid>
        <StatCard
          icon={<IconPen />}
          label={t("statNotes")}
          value={count}
          hint={t("notesCount", { count })}
        />
        <StatCard
          icon={<IconBolt />}
          label={t("statDoor")}
          value={t("doorValue", { state })}
          hint={t("doorHint", { state })}
          hintTone={state === "ok" ? "positive" : "neutral"}
        />
        <StatCard
          icon={<IconUsers />}
          label={t("statOrganisation")}
          value={session.organisationSlug}
          hint={t("signedInAs", { email: session.email })}
        />
      </StatGrid>
    </>
  );
}
