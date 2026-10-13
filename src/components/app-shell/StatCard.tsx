/**
 * Key figure card (white, 2 px product gradient on top, icon tile in the soft product colour)
 * and the grid that holds three of them per row (one per row on a phone).
 *
 * No hooks and no directive.
 */
import type { JSX, ReactNode } from 'react';
import type { StatCardProps } from './types';

export function StatCard({ label, value, hint, hintTone = 'neutral', icon }: StatCardProps): JSX.Element {
  return (
    <div className="by-app-stat">
      {icon ? (
        <span className="by-app-stat-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="by-app-stat-text">
        <span className="by-app-stat-label">{label}</span>
        <span className="by-app-stat-value">{value}</span>
        {hint ? (
          <span className="by-app-stat-hint" data-tone={hintTone}>
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function StatGrid({ children }: { children?: ReactNode }): JSX.Element {
  return <div className="by-app-stats">{children}</div>;
}
