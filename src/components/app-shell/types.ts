/**
 * The props of the app-shell building blocks.
 *
 * Every prop a server layout passes is plain data: strings, numbers, booleans, arrays,
 * objects and React elements (icons and slots are elements, never component references).
 * So the shell can be rendered from a server layout in Next 14 and Next 15 alike.
 *
 * Pure module: types only.
 */
import type { ReactNode } from 'react';

/** The two languages of every Beyondles surface. English is the default. */
export type ShellLocale = 'en' | 'de';

/**
 * Which product the frame belongs to. It decides tone and accent:
 * - `suite`: navy sidebar, brand gradient
 * - `horaizon`: navy sidebar, purple #9652E8 (Beyondles HorAIzon)
 * - `brain`: navy sidebar, turquoise #12B5E8 (The Brain)
 * - `lab`: white sidebar, brand gradient and the "LAB" tag (every Lab and the Lab template)
 * - `service`: the Lab look (white sidebar, brand gradient) without the "LAB" tag, for platform
 *   services that are not a Lab (Beyondles Connections)
 */
export type ProductKind = 'suite' | 'horaizon' | 'brain' | 'lab' | 'service';

/**
 * The sidebar tone a kind uses: `white` for Labs and services, `navy` for the main products
 * (Beyondles Suite, Beyondles HorAIzon, The Brain). Set as `data-by-app-tone` on the root.
 */
export type ProductTone = 'navy' | 'white';

export interface ShellProduct {
  kind: ProductKind;
  /**
   * Full product name as shown: "Beyondles Suite", "Beyondles HorAIzon", "The Brain",
   * "ContentLab", "Beyondles Connections".
   */
  name: string;
  /** The product's start page. The lockup links there, the account-change overlay reloads it. */
  homeHref: string;
}

export interface NavItem {
  /** Stable key, unique within the shell. */
  id: string;
  /** A page of this product (the sidebar never leads out of the product). */
  href: string;
  /** Already translated by the host. */
  label: string;
  /** An icon element, for example `<IconHome />` from this module. Rendered at 18 px. */
  icon?: ReactNode;
  /** `prefix` (default): active on `href` and every page below it. `exact`: only on `href`. */
  match?: 'exact' | 'prefix';
  /** `staff`: shows the "Staff" tag (pages only Beyondles staff can open). */
  tag?: 'staff';
  /** A small count or word after the label. */
  badge?: number | string;
}

export interface NavGroup {
  /** Group heading shown as a kicker. The first group usually has none. Already translated. */
  label?: string;
  items: NavItem[];
}

export interface ShellUser {
  name: string;
  email: string;
}

export interface ShellOrganisation {
  name: string;
}

export interface ShellLinks {
  /** Base URL of the Beyondles Suite, read on the server at runtime. "Back to Suite" opens it in a new tab. */
  suite: string;
  /**
   * The person's profile in the Suite. Internal (same tab) when the product is the Suite.
   * Optional: without it the person menu shows no Profile entry.
   */
  profile?: string;
  /** Only pass it for admins of the organisation; without it the entry is not shown. */
  organisationSettings?: string;
  /** Help and docs, always opened in a new tab. */
  help: string;
  /** Sign out, same tab, a plain link (never prefetched). */
  signOut: string;
  /** The Suite's account chooser. Shown only when the session hint says switching is visible. */
  switchAccount?: string;
}

export interface AppShellProps {
  locale: ShellLocale;
  product: ShellProduct;
  navGroups: NavGroup[];
  user: ShellUser;
  /** Bottom-left chip. `null` hides it. */
  organisation: ShellOrganisation | null;
  links: ShellLinks;
  /**
   * The value of the cookie `platform-session-hint` as the server saw it when it rendered
   * this page, or `null` when there was none. A non-empty string turns on the account-change
   * guard and decides whether "Switch account" is shown.
   */
  sessionHint?: string | null;
  /** Product slot in the topbar, left of "Back to Suite" (a bell, a help button). */
  headerActions?: ReactNode;
  /** Shown above the topbar, for example the staging banner. */
  banner?: ReactNode;
  /** Origin of the legal pages. Default `https://beyondles.ai`. */
  legalBaseUrl?: string;
  /** Always use the phone layout, whatever the width (previews). */
  forceMobile?: boolean;
  /** The current path. Defaults to `usePathname()`; set it only for previews and tests. */
  pathname?: string;
  children?: ReactNode;
}

export interface NoAccessLinks {
  /** Base URL of the Beyondles Suite ("Back to Suite", new tab). */
  suite: string;
  /** The Suite's account chooser, for the wrong-account case. */
  switchAccount?: string;
  /** Where "Sign in again" goes (variant `session`). Defaults to the product's home page. */
  signIn?: string;
}

export interface NoAccessProps {
  locale: ShellLocale;
  product: ShellProduct;
  /** `access` (default): no access to this product. `session`: the sign-in has expired or failed. */
  variant?: 'access' | 'session';
  /**
   * Replaces the default heading, for a product that knows WHY there is no access (for example
   * "The platform did not answer"). Already translated. Empty or missing: the default heading.
   */
  title?: string;
  /** Replaces the default sentence under the heading, like `title`. Already translated. */
  description?: string;
  /**
   * The e-mail of the Beyondles account that is signed in. Shown as a small line under the
   * sentence ("Signed in as <email>"), so a person with several Beyondles accounts sees which
   * one is active. Variant `access` only; empty or missing: no line.
   */
  signedInAs?: string;
  organisation?: ShellOrganisation | null;
  links: NoAccessLinks;
  /** Same as on AppShell: turns on the account-change guard. */
  sessionHint?: string | null;
  legalBaseUrl?: string;
  forceMobile?: boolean;
}

export interface PageHeaderProps {
  /** Small uppercase line above the title. */
  kicker?: ReactNode;
  /** First, dark part of the two-tone title. */
  title: ReactNode;
  /** Second, grey part of the title. */
  titleMuted?: ReactNode;
  /** One sentence under the title. */
  description?: ReactNode;
  /** At most one primary button (and secondary ones). */
  actions?: ReactNode;
}

export type PageStateVariant = 'empty' | 'loading' | 'error';

export interface PageStateProps {
  variant: PageStateVariant;
  /** Overrides the default title of the variant. */
  title?: ReactNode;
  /** Overrides the default sentence of the variant. */
  description?: ReactNode;
  /** Primary action, for example the first step of an empty page. */
  action?: ReactNode;
  /** Secondary action, for example "How it works ↗". */
  secondaryAction?: ReactNode;
  /** Icon in the tile (empty and error). */
  icon?: ReactNode;
  /** Defaults to the shell's locale, then English. */
  locale?: ShellLocale;
  /** Error variant without `action`: shows "Try again" and calls this. */
  onRetry?: () => void;
  /** Error variant without `secondaryAction`: shows "Contact support" linking here. */
  supportHref?: string;
  /** Loading variant: number of placeholder rows (default 5). */
  rows?: number;
}

export type StatusTone = 'ok' | 'run' | 'wait' | 'err';

export interface StatusPillProps {
  tone: StatusTone;
  children?: ReactNode;
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Short note under the value. */
  hint?: ReactNode;
  /** `positive` is green, `negative` red, `neutral` (default) grey. */
  hintTone?: 'positive' | 'neutral' | 'negative';
  icon?: ReactNode;
}

export interface PanelProps {
  title?: ReactNode;
  /** Shown as a grey pill after the title. */
  count?: ReactNode;
  /** Tabs, search field, buttons: right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
}
