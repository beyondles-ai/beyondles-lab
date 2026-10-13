/**
 * app-shell: the shared frame of every Beyondles page behind the login.
 *
 * The stylesheet app-shell.css is imported once in the logged-in layout (HOST-CONTRACT.md).
 * What a product must do is in HOST-CONTRACT.md.
 *
 * This barrel is safe in a Next server component (the client blocks arrive as references).
 * Plain Node code (a route test, a script) imports the pure modules directly instead:
 * `./session-hint`, `./nav`, `./messages`.
 */
export { AppShell } from './AppShell';
export { NoAccess } from './NoAccess';
export { PageHeader } from './PageHeader';
export { PageState } from './PageState';
export { StatusPill } from './StatusPill';
export { StatCard, StatGrid } from './StatCard';
export { Panel } from './Panel';
export { AccountChangeGuard } from './AccountChangeGuard';
export type { AccountChangeGuardProps } from './AccountChangeGuard';
export { BeyondlesMark } from './BeyondlesMark';
export type { BeyondlesMarkProps } from './BeyondlesMark';
export {
  IconAlert,
  IconBolt,
  IconBook,
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconClose,
  IconCog,
  IconExternal,
  IconGraph,
  IconGrid,
  IconHome,
  IconLink,
  IconList,
  IconLock,
  IconMenu,
  IconPen,
  IconPlus,
  IconSearch,
  IconSignOut,
  IconSwitch,
  IconTerminal,
  IconUser,
  IconUsers,
} from './icons';
export type { IconProps } from './icons';
export { findActiveNavItem, isNavActive, normalisePath } from './nav';
export {
  AccountChangedError,
  SESSION_HINT_COOKIE,
  SESSION_HINT_POLL_MS,
  compareSessionHints,
  parseSessionHint,
  readSessionHintCookie,
} from './session-hint';
export type { SessionHint, SessionHintComparison } from './session-hint';
export { SHELL_MESSAGES, fillMessage, shellMessages } from './messages';
export type { ShellMessages } from './messages';
export type {
  AppShellProps,
  NavGroup,
  NavItem,
  NoAccessLinks,
  NoAccessProps,
  PageHeaderProps,
  PageStateProps,
  PageStateVariant,
  PanelProps,
  ProductKind,
  ProductTone,
  ShellLinks,
  ShellLocale,
  ShellOrganisation,
  ShellProduct,
  ShellUser,
  StatCardProps,
  StatusPillProps,
  StatusTone,
} from './types';
