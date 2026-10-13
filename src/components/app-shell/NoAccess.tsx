'use client';

/**
 * The full page for "no access to this product" and for a failed or expired sign-in. Used
 * OUTSIDE the product's logged-in layout (for example on /kein-zugriff): the frame without
 * navigation (lockup, organisation chip when known, footer) and the centred card.
 *
 * - `access`: "You do not have access to <product> yet", who can switch it on, when given the
 *   line "Signed in as <email>", "Back to Suite ↗" and, when given, "Switch account" for the
 *   wrong-account case.
 * - `session`: the sign-in has expired, "Sign in again".
 */
import type { JSX } from 'react';
import { useId, useRef } from 'react';
import { AccountChangeGuard } from './AccountChangeGuard';
import { ShellContext } from './context';
import { Footer } from './Footer';
import { IconLock, IconUser } from './icons';
import { fillMessage, shellMessages } from './messages';
import { parseSessionHint } from './session-hint';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import type { NoAccessProps } from './types';
import { domId, productTone } from './util';

export function NoAccess({
  locale,
  product,
  variant = 'access',
  title,
  description,
  signedInAs,
  organisation = null,
  links,
  sessionHint,
  legalBaseUrl,
  forceMobile = false,
}: NoAccessProps): JSX.Element {
  const t = shellMessages(locale);
  const frameRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = domId(baseId, 'title');
  const hint = parseSessionHint(sessionHint);
  // Same rule as the person menu: only when the session hint says switching is visible.
  const switchAccount = links.switchAccount && hint !== null && hint.switching ? links.switchAccount : null;
  const session = variant === 'session';
  // An expired sign-in has no active account to name, so the line is for `access` only.
  const email = !session && typeof signedInAs === 'string' ? signedInAs.trim() : '';
  const [whoBefore, whoAfter = ''] = t.signedInAs.split('{email}');

  return (
    <ShellContext.Provider value={{ locale, kind: product.kind }}>
      <div
        className="by-app"
        data-by-app-kind={product.kind}
        data-by-app-tone={productTone(product.kind)}
        data-by-app-layout={forceMobile ? 'mobile' : 'auto'}
        data-by-app-bare="true"
      >
        <div className="by-app-frame" ref={frameRef}>
          <Sidebar
            id={domId(baseId, 'sidebar')}
            product={product}
            navGroups={null}
            activeId={null}
            organisation={organisation}
            open={false}
            messages={t}
          />
          <div className="by-app-col">
            <Topbar
              product={product}
              pageLabel={null}
              suiteUrl={links.suite}
              drawer={null}
              user={null}
              links={null}
              switching={false}
              messages={t}
            />
            <main className="by-app-main">
              <div className="by-app-glow" aria-hidden="true" />
              <div className="by-app-content">
                <div className="by-app-noaccess">
                  <section className="by-app-card" aria-labelledby={titleId}>
                    <div className="by-app-state" data-variant={session ? 'session' : 'noaccess'}>
                      <div className="by-app-state-icon" aria-hidden="true">
                        <span className="by-app-state-glow" />
                        <span className="by-app-state-tile">{session ? <IconUser size={28} /> : <IconLock size={28} />}</span>
                      </div>
                      <h1 className="by-app-state-title" id={titleId}>
                        {title || (session ? t.sessionTitle : fillMessage(t.noAccessTitle, { product: product.name }))}
                      </h1>
                      <p className="by-app-state-desc">
                        {description ||
                          (session
                            ? t.sessionBody
                            : organisation
                              ? fillMessage(t.noAccessBody, { organisation: organisation.name })
                              : t.noAccessBodyNoOrganisation)}
                      </p>
                      {email ? (
                        <p className="by-app-state-who">
                          {whoBefore}
                          <span className="by-app-state-email">{email}</span>
                          {whoAfter}
                        </p>
                      ) : null}
                      <div className="by-app-state-actions">
                        {session ? (
                          <a className="by-app-btn by-app-btn-primary" href={links.signIn || product.homeHref}>
                            {t.signInAgain}
                          </a>
                        ) : (
                          <a className="by-app-btn by-app-btn-primary" href={links.suite} target="_blank" rel="noopener">
                            {t.backToSuite} ↗<span className="by-app-sr"> {t.opensInNewTab}</span>
                          </a>
                        )}
                      </div>
                      {!session && switchAccount ? (
                        <p className="by-app-state-note">
                          {t.wrongAccount}{' '}
                          <a className="by-app-text-link" href={switchAccount}>
                            {t.switchAccount}
                          </a>
                        </p>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            </main>
            <Footer locale={locale} legalBaseUrl={legalBaseUrl} />
          </div>
        </div>
        <AccountChangeGuard
          sessionHint={sessionHint}
          homeHref={product.homeHref}
          switchAccountHref={switchAccount}
          locale={locale}
          blockRef={frameRef}
        />
      </div>
    </ShellContext.Provider>
  );
}
