import type { SuiteUsage } from "@/lib/suite-usage";

/**
 * What the start-page tile "Package usage" shows for one Suite answer
 * (docs/FRAME.md 9.1). Pure, so the wording rules are tested without React:
 *
 *  - `hidden`: no tile at all (not an owner or admin, or no limit).
 *  - `unavailable`: the tile says "Not available"; never 0 %.
 *  - `ok`: the percentage, and one sentence: used up and paused, used up,
 *    almost used up, or the billing period with its last day. Never "month":
 *    the period is the organisation's billing period, not a calendar month.
 *
 * `t` is the translator of the `dashboard` namespace.
 */

export interface PackageUsageTile {
  label: string;
  value: string;
  hint: string;
  hintTone: "neutral" | "negative";
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The LAST day of the billing period, written out in the reader's language.
 * `periodEnd` is exclusive (the first moment after the period), so the day
 * before it is shown. `null` when the Suite sent no readable end.
 */
export function lastDayOfPeriod(periodEnd: string | null, locale: string): string | null {
  if (!periodEnd) return null;
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(end)) return null;
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(end - DAY_MS));
}

export function packageUsageTile(usage: SuiteUsage, t: Translate, locale: string): PackageUsageTile | null {
  if (usage.kind === "hidden") return null;
  const label = t("usageLabel");
  if (usage.kind === "unavailable") {
    return { label, value: t("usageUnavailable"), hint: t("usageUnavailableHint"), hintTone: "neutral" };
  }
  const value = t("usagePercent", { percent: usage.percent });
  if (usage.state === "stopped") return { label, value, hint: t("usageStopped"), hintTone: "negative" };
  if (usage.percent >= 100) return { label, value, hint: t("usageFull"), hintTone: "negative" };
  if (usage.state === "warn") return { label, value, hint: t("usageWarn"), hintTone: "negative" };
  const end = lastDayOfPeriod(usage.periodEnd, locale);
  return {
    label,
    value,
    hint: end ? t("usageHint", { end }) : t("usageHintNoPeriod"),
    hintTone: "neutral",
  };
}
