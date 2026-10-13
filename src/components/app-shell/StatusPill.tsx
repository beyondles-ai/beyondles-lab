/**
 * Status with a dot: `ok` (done, active), `run` (running, syncing), `wait` (waiting, scheduled,
 * not enabled), `err` (failed). Green and red exist only for status, never as decoration.
 *
 * No hooks and no directive.
 */
import type { JSX } from 'react';
import type { StatusPillProps } from './types';

export function StatusPill({ tone, children }: StatusPillProps): JSX.Element {
  return (
    <span className="by-app-pill" data-tone={tone}>
      {children}
    </span>
  );
}
