'use client';

/**
 * The round person button and its menu: header (initials, name, e-mail), Profile (only with
 * the link), Organisation settings (admins only), Help and docs, Switch account (when the session hint
 * allows it), separator, Sign out.
 *
 * Links that leave the product open a new tab and carry ↗. In the Beyondles Suite itself,
 * Profile and Organisation settings are its own pages and open in the same tab.
 *
 * Closes on a click outside, on Escape (focus goes back to the button) and on Tab. Arrow keys,
 * Home and End move between the entries.
 */
import type { JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { IconSwitch } from './icons';
import { fillMessage, type ShellMessages } from './messages';
import type { ProductKind, ShellLinks, ShellUser } from './types';
import { domId, initials } from './util';

export interface UserMenuProps {
  user: ShellUser;
  links: ShellLinks;
  kind: ProductKind;
  /** Show "Switch account" (link given and the session hint allows it). */
  switching: boolean;
  messages: ShellMessages;
}

const ITEM_SELECTOR = '[role="menuitem"]';

export function UserMenu({ user, links, kind, switching, messages: t }: UserMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = domId(useId(), 'person-menu');
  const userInitials = initials(user.name, user.email);
  const internal = kind === 'suite';

  const items = useCallback((): HTMLElement[] => {
    const menu = menuRef.current;
    return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    items()[0]?.focus();

    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || buttonRef.current?.contains(target))) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, items]);

  const onButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % list.length;
    else if (event.key === 'ArrowUp') next = index <= 0 ? list.length - 1 : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else if (event.key === 'Tab') setOpen(false);
    if (next !== null) {
      event.preventDefault();
      list[next].focus();
    }
  };

  const close = (): void => setOpen(false);
  const newTab = <span className="by-app-sr"> {t.opensInNewTab}</span>;

  const productLink = (href: string, label: string, hint: string | null): ReactNode =>
    internal ? (
      <Link href={href} className="by-app-menu-item" role="menuitem" tabIndex={-1} onClick={close}>
        <span>{label}</span>
        {hint ? <small className="by-app-menu-hint">{hint}</small> : null}
      </Link>
    ) : (
      <a href={href} className="by-app-menu-item" role="menuitem" tabIndex={-1} target="_blank" rel="noopener" onClick={close}>
        <span>{label}</span>
        <small className="by-app-menu-hint">{hint ? `${hint} ↗` : '↗'}</small>
        {newTab}
      </a>
    );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="by-app-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={fillMessage(t.personMenu, { name: user.name || user.email })}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
      >
        <span aria-hidden="true">{userInitials}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="by-app-menu"
          role="menu"
          aria-label={fillMessage(t.personMenu, { name: user.name || user.email })}
          onKeyDown={onMenuKeyDown}
        >
          <div className="by-app-menu-who">
            <span className="by-app-menu-avatar" aria-hidden="true">
              {userInitials}
            </span>
            <span className="by-app-menu-person">
              <span className="by-app-menu-name">{user.name}</span>
              <span className="by-app-menu-email">{user.email}</span>
            </span>
          </div>
          {links.profile ? productLink(links.profile, t.profile, null) : null}
          {links.organisationSettings ? productLink(links.organisationSettings, t.organisationSettings, t.adminOnly) : null}
          <a href={links.help} className="by-app-menu-item" role="menuitem" tabIndex={-1} target="_blank" rel="noopener" onClick={close}>
            <span>{t.help}</span>
            <small className="by-app-menu-hint">↗</small>
            {newTab}
          </a>
          {switching && links.switchAccount ? (
            <a href={links.switchAccount} className="by-app-menu-item" role="menuitem" tabIndex={-1} onClick={close}>
              <span>{t.switchAccount}</span>
              <small className="by-app-menu-hint">
                <IconSwitch size={14} />
              </small>
            </a>
          ) : null}
          <div className="by-app-menu-sep" role="separator" />
          <a href={links.signOut} className="by-app-menu-item" role="menuitem" tabIndex={-1}>
            <span>{t.signOut}</span>
          </a>
        </div>
      ) : null}
    </>
  );
}
