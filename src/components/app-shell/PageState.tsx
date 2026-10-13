'use client';

/**
 * The states of a content area:
 * - `empty`: icon tile in the soft product colour, "Nothing here yet", one sentence, the first step
 * - `loading`: grey placeholder rows with a soft shimmer (static with reduced motion); never a
 *   spinner over the whole page
 * - `error`: red tile, "This could not be loaded", a calm sentence, "Try again" and
 *   "Contact support"; never a raw technical message
 *
 * Client component because it reads the language from the surrounding AppShell. Pass `locale`
 * when it is rendered outside of one.
 */
import type { JSX } from 'react';
import { useShellContext } from './context';
import { IconAlert, IconGrid } from './icons';
import { shellMessages } from './messages';
import type { PageStateProps } from './types';

const SKELETON_COLUMNS = 4;

export function PageState({
  variant,
  title,
  description,
  action,
  secondaryAction,
  icon,
  locale,
  onRetry,
  supportHref,
  rows = 5,
}: PageStateProps): JSX.Element {
  const shell = useShellContext();
  const t = shellMessages(locale ?? shell?.locale ?? 'en');

  if (variant === 'loading') {
    const count = Math.max(1, Math.min(20, Math.floor(rows)));
    return (
      <div className="by-app-skeleton" role="status" aria-busy="true" aria-live="polite">
        <span className="by-app-sr">{t.loading}</span>
        {Array.from({ length: count }, (_, row) => (
          <div className="by-app-skel-row" key={row} aria-hidden="true">
            {Array.from({ length: SKELETON_COLUMNS }, (__, column) => (
              <span className="by-app-skel" key={column} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const error = variant === 'error';
  const primary =
    action ??
    (error && onRetry ? (
      <button type="button" className="by-app-btn by-app-btn-primary" onClick={onRetry}>
        {t.tryAgain}
      </button>
    ) : null);
  const secondary =
    secondaryAction ??
    (error && supportHref ? (
      <a className="by-app-btn by-app-btn-secondary" href={supportHref}>
        {t.contactSupport}
      </a>
    ) : null);

  return (
    <div className="by-app-state" data-variant={variant} role={error ? 'alert' : undefined}>
      <div className="by-app-state-icon" aria-hidden="true">
        <span className="by-app-state-glow" />
        <span className="by-app-state-tile">{icon ?? (error ? <IconAlert size={28} /> : <IconGrid size={28} />)}</span>
      </div>
      <h3 className="by-app-state-title">{title ?? (error ? t.errorTitle : t.emptyTitle)}</h3>
      <p className="by-app-state-desc">{description ?? (error ? t.errorDescription : t.emptyDescription)}</p>
      {primary || secondary ? (
        <div className="by-app-state-actions">
          {primary}
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
