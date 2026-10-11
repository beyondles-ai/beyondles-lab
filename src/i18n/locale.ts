import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale, type Locale } from "./config";

/**
 * Resolves the language of a request:
 *   1. cookie `NEXT_LOCALE` if it is a supported language,
 *   2. otherwise {@link DEFAULT_LOCALE} ("en").
 *
 * The Beyondles Suite owns the cookie (Settings > Profile > Language). Browser
 * language (Accept-Language) is deliberately not used.
 */
export async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  return isSupportedLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
}
