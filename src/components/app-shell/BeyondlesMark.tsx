'use client';

/**
 * The coloured Beyondles mark in its real proportions (about 1.9 : 1), as inline SVG.
 *
 * Geometry from the official logo file (see mark-paths.ts). Colours follow the approved
 * colour mark (mark-colour.png): purple on the left, blue at the crossing, turquoise on the
 * right, the strand underneath shaded where it crosses.
 *
 * Client component only because the gradient ids come from `useId`: two marks on one page
 * (sidebar and phone topbar) must not share ids, or one of them loses its colours while the
 * other is hidden.
 */
import type { JSX } from 'react';
import { useId } from 'react';
import {
  MARK_CROSSING,
  MARK_LEFT_RING,
  MARK_RATIO,
  MARK_RIGHT_RING,
  MARK_SHADE_HIGH,
  MARK_SHADE_LOW,
  MARK_VIEW_BOX,
} from './mark-paths';
import { domId } from './util';

export interface BeyondlesMarkProps {
  /** Height in px. Default 20; the width follows from the proportions. */
  height?: number;
  className?: string;
  /** An accessible name. Without it the mark is decorative (the product name stands next to it). */
  title?: string;
}

export function BeyondlesMark({ height = 20, className, title }: BeyondlesMarkProps): JSX.Element {
  const base = domId(useId(), 'mark');
  const id = {
    left: `${base}-left`,
    right: `${base}-right`,
    crossing: `${base}-crossing`,
    low: `${base}-low`,
    high: `${base}-high`,
  };
  const width = Math.round(height * MARK_RATIO * 10) / 10;

  return (
    <svg
      width={width}
      height={height}
      viewBox={MARK_VIEW_BOX}
      className={className}
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={id.left} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C47CF8" />
          <stop offset="1" stopColor="#9652E8" />
        </linearGradient>
        <linearGradient id={id.right} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#1A84E2" />
          <stop offset="1" stopColor="#4CE9FE" />
        </linearGradient>
        <linearGradient id={id.crossing} gradientUnits="userSpaceOnUse" x1="337.9" y1="0" x2="1662" y2="0">
          <stop offset="0.236" stopColor="#AD66F0" stopOpacity="0" />
          <stop offset="0.3579" stopColor="#AD66F0" />
          <stop offset="0.4226" stopColor="#9877F4" />
          <stop offset="0.5103" stopColor="#758DFB" />
          <stop offset="0.5791" stopColor="#3F9DF0" />
          <stop offset="0.6201" stopColor="#2AA4EC" />
          <stop offset="0.7279" stopColor="#2AA4EC" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id.low} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#11141D" />
          <stop offset="0.19" stopColor="#2E3954" />
          <stop offset="0.31" stopColor="#4361A5" />
          <stop offset="0.53" stopColor="#3B7BD0" />
          <stop offset="0.64" stopColor="#1A84E2" />
          <stop offset="1" stopColor="#1A84E2" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id.high} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A85EEE" stopOpacity="0" />
          <stop offset="0.2" stopColor="#A85EEE" />
          <stop offset="0.36" stopColor="#7F67D6" />
          <stop offset="0.53" stopColor="#4366B0" />
          <stop offset="0.65" stopColor="#3B5282" />
          <stop offset="0.92" stopColor="#161A25" />
          <stop offset="0.94" stopColor="#11141D" />
        </linearGradient>
      </defs>
      {MARK_RIGHT_RING.map((d, index) => (
        <path key={`r${index}`} d={d} fill={`url(#${id.right})`} />
      ))}
      {MARK_LEFT_RING.map((d, index) => (
        <path key={`l${index}`} d={d} fill={`url(#${id.left})`} />
      ))}
      {MARK_CROSSING.map((d, index) => (
        <path key={`c${index}`} d={d} fill={`url(#${id.crossing})`} />
      ))}
      {MARK_SHADE_LOW.map((d, index) => (
        <path key={`sl${index}`} d={d} fill={`url(#${id.low})`} />
      ))}
      {MARK_SHADE_HIGH.map((d, index) => (
        <path key={`sh${index}`} d={d} fill={`url(#${id.high})`} />
      ))}
    </svg>
  );
}
