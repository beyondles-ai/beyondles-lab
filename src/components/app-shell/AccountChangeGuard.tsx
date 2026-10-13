'use client';

/**
 * Notices when the person behind this tab changed in another tab, and stops the page from
 * acting for the previous person.
 *
 * The page was rendered for the session hint the server saw (`sessionHint`). The guard
 * compares the cookie `platform-session-hint` with that value:
 * - when the tab becomes visible, gets focus or is shown from the back/forward cache,
 * - every 15 s while the tab is visible,
 * - right before every same-origin `fetch` (Next's page loads and server actions included):
 *   `window.fetch` is wrapped once per window.
 *
 * On a difference it blocks the page (the frame becomes inert, clicks, keys and form posts
 * outside the overlay are stopped in the capture phase, same-origin requests are rejected with
 * `AccountChangedError`) and shows an overlay. It never reloads by itself, so typed input stays
 * visible; nothing can be sent any more.
 *
 * Inert when `sessionHint` is null, undefined or empty (switching turned off, a local run
 * without the Suite).
 */
import type { JSX, RefObject } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { IconSignOut, IconSwitch } from './icons';
import { shellMessages } from './messages';
import { AccountChangedError, SESSION_HINT_POLL_MS, compareSessionHints, readSessionHintCookie } from './session-hint';
import type { ShellLocale } from './types';
import { domId } from './util';

export interface AccountChangeGuardProps {
  /** The hint the page was rendered with. */
  sessionHint: string | null | undefined;
  /** "Reload" and "Sign in" go here (a full page load). */
  homeHref: string;
  /** Shown as "Switch account" when the account changed. */
  switchAccountHref?: string | null;
  locale: ShellLocale;
  /** The element made inert while the overlay shows. AppShell passes its frame. */
  blockRef?: RefObject<HTMLElement | null>;
}

type GuardState = 'ok' | 'changed' | 'signed-out';

interface Watcher {
  check(): GuardState;
}

interface FetchGuard {
  readonly original: typeof fetch;
  readonly watchers: Set<Watcher>;
}

/** Where the one fetch wrapper of this window keeps its state (survives a second copy of this module). */
const FETCH_GUARD_KEY = '__beyondlesAccountChangeGuard';

const BLOCKED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'submit'];

const FOCUSABLE = 'a[href], button:not([disabled])';

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Wraps `window.fetch` the first time it is called in this window; later calls reuse the wrapper. */
function installFetchGuard(): FetchGuard | null {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return null;
  const holder = window as unknown as Record<string, FetchGuard | undefined>;
  const existing = holder[FETCH_GUARD_KEY];
  if (existing) return existing;

  const guard: FetchGuard = { original: window.fetch, watchers: new Set<Watcher>() };
  const guardedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (guard.watchers.size > 0 && isSameOrigin(input)) {
      for (const watcher of guard.watchers) {
        const state = watcher.check();
        if (state !== 'ok') return Promise.reject(new AccountChangedError(state));
      }
    }
    return guard.original.call(window, input, init);
  };
  window.fetch = guardedFetch as typeof fetch;
  holder[FETCH_GUARD_KEY] = guard;
  return guard;
}

export function AccountChangeGuard({
  sessionHint,
  homeHref,
  switchAccountHref,
  locale,
  blockRef,
}: AccountChangeGuardProps): JSX.Element | null {
  const [state, setState] = useState<GuardState>('ok');
  const dialogRef = useRef<HTMLDivElement>(null);
  const baseId = domId(useId(), 'guard');
  const baseline = typeof sessionHint === 'string' && sessionHint.trim() !== '' ? sessionHint : null;

  // Watch the cookie.
  useEffect(() => {
    if (baseline === null) return undefined;
    let current: GuardState = 'ok';
    const check = (): GuardState => {
      if (current !== 'ok') return current;
      const result = compareSessionHints(baseline, readSessionHintCookie(document.cookie));
      if (result !== 'same') {
        current = result;
        setState(result);
      }
      return current;
    };
    const watcher: Watcher = { check };
    const fetchGuard = installFetchGuard();
    fetchGuard?.watchers.add(watcher);

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') check();
    };
    const onEvent = (): void => {
      check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onEvent);
    window.addEventListener('pageshow', onEvent);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') check();
    }, SESSION_HINT_POLL_MS);
    // A change between the server render and now (hydration) counts as well.
    check();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onEvent);
      window.removeEventListener('pageshow', onEvent);
      window.clearInterval(timer);
      fetchGuard?.watchers.delete(watcher);
    };
  }, [baseline]);

  // Block the page while the overlay shows.
  useEffect(() => {
    if (state === 'ok') return undefined;
    const frame = blockRef?.current ?? null;
    frame?.setAttribute('inert', '');
    frame?.setAttribute('aria-hidden', 'true');

    const focusables = (): HTMLElement[] =>
      dialogRef.current ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    const inside = (event: Event): boolean => {
      const target = event.target as Node | null;
      return Boolean(target && dialogRef.current?.contains(target));
    };
    const block = (event: Event): void => {
      if (inside(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const index = list.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (index <= 0 ? list.length - 1 : index - 1) : (index + 1) % list.length;
        event.preventDefault();
        event.stopPropagation();
        list[next].focus();
        return;
      }
      block(event);
    };
    const onFocusIn = (event: FocusEvent): void => {
      if (!inside(event)) focusables()[0]?.focus();
    };

    for (const type of BLOCKED_EVENTS) document.addEventListener(type, block, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    focusables()[0]?.focus();

    return () => {
      for (const type of BLOCKED_EVENTS) document.removeEventListener(type, block, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      frame?.removeAttribute('inert');
      frame?.removeAttribute('aria-hidden');
    };
  }, [state, blockRef]);

  if (state === 'ok') return null;

  const t = shellMessages(locale);
  const changed = state === 'changed';
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  return (
    <div className="by-app-guard" data-state={state}>
      <div
        ref={dialogRef}
        className="by-app-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <span className="by-app-dialog-icon" aria-hidden="true">
          {changed ? <IconSwitch size={22} /> : <IconSignOut size={22} />}
        </span>
        <h2 className="by-app-dialog-title" id={titleId}>
          {changed ? t.accountChangedTitle : t.signedOutTitle}
        </h2>
        <p className="by-app-dialog-body" id={bodyId}>
          {changed ? t.accountChangedBody : t.signedOutBody}
        </p>
        <div className="by-app-dialog-actions">
          {changed && switchAccountHref ? (
            <a className="by-app-btn by-app-btn-secondary" href={switchAccountHref}>
              {t.switchAccount}
            </a>
          ) : null}
          <a className="by-app-btn by-app-btn-primary" href={homeHref}>
            {changed ? t.reload : t.signIn}
          </a>
        </div>
      </div>
    </div>
  );
}
