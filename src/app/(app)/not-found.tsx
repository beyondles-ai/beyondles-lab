import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { IconSearch, PageState } from "@/components/app-shell";

/** A page or object of this Lab that does not exist (or is not visible to the person). */
export default async function NotFound() {
  const t = await getTranslations("states");
  return (
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
}
