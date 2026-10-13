'use client';

/**
 * The topbar: burger (phone), compact lockup (phone), breadcrumb "<product> / <page>", the
 * product's own actions, "Back to Suite ↗" (every product except the Suite) and the person
 * button with its menu.
 */
import type { JSX, ReactNode } from 'react';
import { IconChevronLeft, IconMenu } from './icons';
import { Lockup } from './Lockup';
import type { ShellMessages } from './messages';
import type { ShellLinks, ShellProduct, ShellUser } from './types';
import { UserMenu } from './UserMenu';

export interface TopbarProps {
  product: ShellProduct;
  /** Label of the current page, from the navigation. */
  pageLabel: string | null;
  suiteUrl: string;
  /** Without navigation there is no drawer and no burger (no-access page). */
  drawer: { id: string; open: boolean; onToggle: () => void } | null;
  user: ShellUser | null;
  links: ShellLinks | null;
  switching: boolean;
  headerActions?: ReactNode;
  messages: ShellMessages;
}

export function Topbar({
  product,
  pageLabel,
  suiteUrl,
  drawer,
  user,
  links,
  switching,
  headerActions,
  messages: t,
}: TopbarProps): JSX.Element {
  return (
    <header className="by-app-top">
      {drawer ? (
        <button
          type="button"
          className="by-app-burger"
          aria-label={drawer.open ? t.closeMenu : t.openMenu}
          aria-expanded={drawer.open}
          aria-controls={drawer.id}
          onClick={drawer.onToggle}
        >
          <IconMenu size={22} strokeWidth={1.6} />
        </button>
      ) : null}
      <Lockup product={product} compact labTag={t.labTag} />
      <nav className="by-app-crumb" aria-label={t.breadcrumb}>
        <span className="by-app-crumb-product">{product.name}</span>
        {pageLabel ? (
          <>
            <span className="by-app-crumb-sep" aria-hidden="true">
              /
            </span>
            <span className="by-app-crumb-current" aria-current="page">
              {pageLabel}
            </span>
          </>
        ) : null}
      </nav>
      <span className="by-app-grow" />
      {headerActions ? <div className="by-app-top-actions">{headerActions}</div> : null}
      {product.kind !== 'suite' ? (
        <a className="by-app-back" href={suiteUrl} target="_blank" rel="noopener" aria-label={t.backToSuiteLabel}>
          <IconChevronLeft size={16} strokeWidth={1.8} />
          <span className="by-app-back-text">{t.backToSuite}</span>
          <span className="by-app-ext" aria-hidden="true">
            ↗
          </span>
        </a>
      ) : null}
      {user && links ? <UserMenu user={user} links={links} kind={product.kind} switching={switching} messages={t} /> : null}
    </header>
  );
}
