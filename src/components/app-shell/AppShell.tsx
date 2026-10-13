'use client';

/**
 * The frame of every Beyondles page behind the login: sidebar (lockup, navigation,
 * organisation), topbar (breadcrumb, Back to Suite, person menu), content area, slim footer,
 * the phone drawer and the account-change guard. The product only fills the content area.
 *
 * Rendered by the product's logged-in layout, usually a server component: every prop is plain
 * data (see types.ts). The stylesheet `app-shell.css` must be imported once in that layout.
 */
import type { JSX } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AccountChangeGuard } from './AccountChangeGuard';
import { ShellContext } from './context';
import { Footer } from './Footer';
import { shellMessages } from './messages';
import { findActiveNavItem } from './nav';
import { parseSessionHint } from './session-hint';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import type { AppShellProps } from './types';
import { domId, productTone } from './util';

export function AppShell({
  locale,
  product,
  navGroups,
  user,
  organisation,
  links,
  sessionHint,
  headerActions,
  banner,
  legalBaseUrl,
  forceMobile = false,
  pathname: pathnameOverride,
  children,
}: AppShellProps): JSX.Element {
  const t = shellMessages(locale);
  const routerPathname = usePathname();
  const pathname = pathnameOverride ?? routerPathname ?? '';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const sidebarId = domId(baseId, 'sidebar');
  const mainId = domId(baseId, 'main');

  const active = findActiveNavItem(pathname, navGroups);
  const hint = parseSessionHint(sessionHint);
  const switching = Boolean(links.switchAccount) && hint !== null && hint.switching;

  // A page change closes the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // An open drawer takes the focus (first entry); Escape closes it and gives the focus back to the burger.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    document.getElementById(sidebarId)?.querySelector<HTMLElement>('.by-app-nav-link')?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      document.querySelector<HTMLElement>(`[aria-controls="${sidebarId}"]`)?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, sidebarId]);

  const toggleDrawer = useCallback(() => setDrawerOpen((open) => !open), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <ShellContext.Provider value={{ locale, kind: product.kind }}>
      <div
        className="by-app"
        data-by-app-kind={product.kind}
        data-by-app-tone={productTone(product.kind)}
        data-by-app-layout={forceMobile ? 'mobile' : 'auto'}
      >
        <div className="by-app-frame" ref={frameRef}>
          <a className="by-app-skip" href={`#${mainId}`}>
            {t.skipToContent}
          </a>
          <Sidebar
            id={sidebarId}
            product={product}
            navGroups={navGroups}
            activeId={active ? active.id : null}
            organisation={organisation}
            open={drawerOpen}
            onNavigate={closeDrawer}
            messages={t}
          />
          <div className="by-app-col">
            {banner ? <div className="by-app-banner">{banner}</div> : null}
            <Topbar
              product={product}
              pageLabel={active ? active.label : null}
              suiteUrl={links.suite}
              drawer={{ id: sidebarId, open: drawerOpen, onToggle: toggleDrawer }}
              user={user}
              links={links}
              switching={switching}
              headerActions={headerActions}
              messages={t}
            />
            <main className="by-app-main" id={mainId} tabIndex={-1}>
              <div className="by-app-glow" aria-hidden="true" />
              <div className="by-app-content">{children}</div>
            </main>
            <Footer locale={locale} legalBaseUrl={legalBaseUrl} />
          </div>
          {drawerOpen ? (
            <button type="button" className="by-app-scrim" aria-label={t.closeMenu} tabIndex={-1} onClick={closeDrawer} />
          ) : null}
        </div>
        <AccountChangeGuard
          sessionHint={sessionHint}
          homeHref={product.homeHref}
          switchAccountHref={switching ? links.switchAccount : null}
          locale={locale}
          blockRef={frameRef}
        />
      </div>
    </ShellContext.Provider>
  );
}
