/**
 * The slim footer for public pages that open OUTSIDE the AppShell frame (a signing page, a booking
 * page, an objection page opened by someone who is not logged in): Imprint, Privacy and
 * "Powered by Beyondles <product>". Links open in a new tab.
 *
 * Works without the `.by-app` wrapper: `.by-app-public-foot` declares the variables it needs itself.
 * Light only.
 *
 * No hooks and no directive.
 */
import type { JSX } from 'react';
import { legalLinks } from './Footer';
import { shellMessages } from './messages';
import type { ShellLocale } from './types';

export interface PublicFooterProps {
  locale: ShellLocale;
  /** Product name after "Powered by Beyondles", for example "Beyondles HorAIzon". Optional. */
  productName?: string;
  /** Origin of the legal pages. Default https://beyondles.ai. */
  legalBaseUrl?: string;
}

/** "Beyondles" plus the product name, without saying Beyondles twice. */
export function poweredByName(productName?: string): string {
  const name = (productName ?? '').trim();
  if (name === '') return 'Beyondles';
  return /^beyondles\b/i.test(name) ? name : `Beyondles ${name}`;
}

export function PublicFooter({ locale, productName, legalBaseUrl }: PublicFooterProps): JSX.Element {
  const t = shellMessages(locale);
  const links = legalLinks(legalBaseUrl);
  return (
    <footer className="by-app-public-foot">
      <a className="by-app-public-foot-link" href={links.imprint} target="_blank" rel="noopener">
        {t.imprint}
        <span className="by-app-sr"> {t.opensInNewTab}</span>
      </a>
      <a className="by-app-public-foot-link" href={links.privacy} target="_blank" rel="noopener">
        {t.privacy}
        <span className="by-app-sr"> {t.opensInNewTab}</span>
      </a>
      <span className="by-app-public-foot-powered">
        {t.poweredBy} {poweredByName(productName)}
      </span>
    </footer>
  );
}
