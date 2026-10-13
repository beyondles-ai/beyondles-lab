/**
 * The white content panel with a head (title, count pill, actions such as tabs and a search
 * field) and a body (a `.by-app-table`, a PageState, a form).
 *
 * No hooks and no directive.
 */
import type { JSX } from 'react';
import type { PanelProps } from './types';

export function Panel({ title, count, actions, children }: PanelProps): JSX.Element {
  const hasHead = Boolean(title) || (count !== undefined && count !== null && count !== '') || Boolean(actions);
  return (
    <section className="by-app-panel">
      {hasHead ? (
        <div className="by-app-panel-head">
          {title ? <h2 className="by-app-panel-title">{title}</h2> : null}
          {count !== undefined && count !== null && count !== '' ? <span className="by-app-panel-count">{count}</span> : null}
          {actions ? <div className="by-app-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
