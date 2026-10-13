/**
 * Small helpers without React.
 *
 * Pure module.
 */

/** Joins class names, skipping empty ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}

/**
 * Up to two letters for an avatar or an organisation chip: the first letter of the first two
 * words ("Vista Travel GmbH" gives "VT"), or the first letter of the fallback (an e-mail).
 */
export function initials(name: string | null | undefined, fallback?: string | null): string {
  const words = (name ?? '')
    .split(/\s+/)
    // Leading ASCII punctuation does not count: "(Test) GmbH" gives "TG".
    .map((word) => word.replace(/^[!-/:-@[-`{-~]+/, ''))
    .filter((word) => word !== '');
  const letters = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
  if (letters !== '') return letters.toUpperCase();
  const first = Array.from((fallback ?? '').trim())[0];
  return first ? first.toUpperCase() : '?';
}

/** A string usable in an `id` attribute, made from React's `useId` value (which may hold colons). */
export function domId(reactId: string, suffix: string): string {
  return `by-app-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}-${suffix}`;
}

/** The year for the footer. */
export function currentYear(): number {
  return new Date().getFullYear();
}
