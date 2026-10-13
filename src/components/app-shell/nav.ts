/**
 * Which navigation entry is the current page.
 *
 * Pure module: no React, no Next. A route test or a server layout can import it directly.
 */
import type { NavGroup, NavItem } from './types';

/** The path of an href: no origin, no query, no fragment, no trailing slash (except "/"). */
export function normalisePath(href: string): string {
  let path = href.trim();
  const origin = path.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i);
  if (origin) path = path.slice(origin[0].length);
  path = path.split('#')[0].split('?')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path;
}

/**
 * True when `item` is the page at `pathname`.
 * - `exact`: only the same path.
 * - `prefix` (default): the same path or any path below it. The start page "/" is never a
 *   prefix of everything; it is active on "/" only.
 */
export function isNavActive(pathname: string | null | undefined, item: Pick<NavItem, 'href' | 'match'>): boolean {
  if (typeof pathname !== 'string' || pathname === '') return false;
  const current = normalisePath(pathname);
  const target = normalisePath(item.href);
  if (current === target) return true;
  if (item.match === 'exact' || target === '/') return false;
  return current.startsWith(`${target}/`);
}

/**
 * The entry the page belongs to. When several match (a "Settings" entry and a "Settings /
 * Members" entry), the one with the longest path wins.
 */
export function findActiveNavItem(pathname: string | null | undefined, groups: readonly NavGroup[]): NavItem | null {
  let best: NavItem | null = null;
  let bestLength = -1;
  for (const group of groups) {
    for (const item of group.items) {
      if (!isNavActive(pathname, item)) continue;
      const length = normalisePath(item.href).length;
      if (length > bestLength) {
        best = item;
        bestLength = length;
      }
    }
  }
  return best;
}
