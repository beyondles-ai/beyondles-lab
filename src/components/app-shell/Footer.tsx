/**
 * The slim footer: © year Beyondles, the three legal links (new tab) and the AI notice.
 * No status link: there is no status page (decided 2026-10-13).
 *
 * No hooks and no directive.
 */
import type { JSX } from 'react';
import { shellMessages } from './messages';
import type { ShellLocale } from './types';
import { currentYear } from './util';

export const DEFAULT_LEGAL_BASE_URL = 'https://beyondles.ai';

export interface FooterProps {
  locale: ShellLocale;
  /** Origin of the legal pages. Default https://beyondles.ai. */
  legalBaseUrl?: string;
}

/** The three legal pages, below the given origin. */
export function legalLinks(legalBaseUrl?: string): { imprint: string; privacy: string; terms: string } {
  const base = (legalBaseUrl && legalBaseUrl.trim() !== '' ? legalBaseUrl.trim() : DEFAULT_LEGAL_BASE_URL).replace(/\/+$/, '');
  return { imprint: `${base}/impressum`, privacy: `${base}/datenschutz`, terms: `${base}/agb` };
}

export function Footer({ locale, legalBaseUrl }: FooterProps): JSX.Element {
  const t = shellMessages(locale);
  const links = legalLinks(legalBaseUrl);
  return (
    <footer className="by-app-foot">
      <span className="by-app-foot-copy" suppressHydrationWarning>
        © {currentYear()} Beyondles
      </span>
      <a className="by-app-foot-link" href={links.imprint} target="_blank" rel="noopener">
        {t.imprint}
        <span className="by-app-sr"> {t.opensInNewTab}</span>
      </a>
      <a className="by-app-foot-link" href={links.privacy} target="_blank" rel="noopener">
        {t.privacy}
        <span className="by-app-sr"> {t.opensInNewTab}</span>
      </a>
      <a className="by-app-foot-link" href={links.terms} target="_blank" rel="noopener">
        {t.terms}
        <span className="by-app-sr"> {t.opensInNewTab}</span>
      </a>
      <span className="by-app-foot-ai">{t.aiNotice}</span>
    </footer>
  );
}
