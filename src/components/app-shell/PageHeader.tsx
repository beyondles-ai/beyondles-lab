/**
 * The page head inside the content area: kicker, two-tone title (dark, then grey), one sentence,
 * and at most one primary button on the right.
 *
 * No hooks and no directive: renders in server components.
 */
import type { JSX } from 'react';
import type { PageHeaderProps } from './types';

export function PageHeader({ kicker, title, titleMuted, description, actions }: PageHeaderProps): JSX.Element {
  return (
    <div className="by-app-head">
      <div className="by-app-head-text">
        {kicker ? <span className="by-app-kicker">{kicker}</span> : null}
        <h1 className="by-app-title">
          {title}
          {titleMuted ? (
            <>
              {' '}
              <span className="by-app-title-muted">{titleMuted}</span>
            </>
          ) : null}
        </h1>
        {description ? <p className="by-app-desc">{description}</p> : null}
      </div>
      {actions ? <div className="by-app-head-actions">{actions}</div> : null}
    </div>
  );
}
