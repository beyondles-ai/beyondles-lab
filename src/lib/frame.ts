import "server-only";

import { cookies, headers } from "next/headers";

import { SESSION_HINT_COOKIE } from "@/components/app-shell/session-hint";
import type { ShellLinks, ShellLocale, ShellProduct } from "@/components/app-shell/types";
import { resolveLocale } from "@/i18n/locale";
import { LAB_NAME } from "@/lib/lab";
import { platformUrl } from "@/lib/platform/door";
import { appStartUrl, isOrganisationAdmin, shellLinks } from "@/lib/suite-url";

/**
 * What the frame (src/components/app-shell) needs from the server, read on
 * every request: language, session hint and the Suite links. Used by the
 * signed-in layout `src/app/(app)/layout.tsx` and by the no-access page.
 *
 * Every Suite address comes from the running environment (`platformUrl()`),
 * never from a value baked in at build time.
 */

/** This Lab inside the frame: white sidebar, "LAB" tag, its full name. */
export const LAB_PRODUCT: ShellProduct = { kind: "lab", name: LAB_NAME, homeHref: "/" };

export interface FrameContext {
  locale: ShellLocale;
  /** Value of the cookie `platform-session-hint` as this request saw it. */
  sessionHint: string | null;
  links: ShellLinks;
}

export async function frameContext(orgRole: string | null | undefined): Promise<FrameContext> {
  const jar = await cookies();
  const head = await headers();
  const locale = (await resolveLocale()) === "de" ? "de" : "en";
  const startUrl = appStartUrl(
    process.env.NEXT_PUBLIC_APP_URL,
    head.get("x-forwarded-host") ?? head.get("host"),
    head.get("x-forwarded-proto"),
  );
  return {
    locale,
    sessionHint: jar.get(SESSION_HINT_COOKIE)?.value ?? null,
    links: shellLinks({ platformUrl: platformUrl(), isOrgAdmin: isOrganisationAdmin(orgRole), startUrl }),
  };
}
