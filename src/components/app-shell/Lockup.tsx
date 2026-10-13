/**
 * Mark plus full product name, linked to the product's start page. In the sidebar (and the
 * phone drawer) with the "LAB" tag for Labs (not for a service); compact in the phone topbar.
 *
 * No hooks and no directive.
 */
import type { JSX } from 'react';
import Link from 'next/link';
import { BeyondlesMark } from './BeyondlesMark';
import type { ShellProduct } from './types';

export interface LockupProps {
  product: ShellProduct;
  /** Phone topbar: smaller, navy name, no tag. */
  compact?: boolean;
  labTag: string;
}

/**
 * A one-word name longer than ten characters ("SummarizeLab", "SignatureLab") cannot wrap, and
 * next to the "LAB" tag it does not fit the 256 px sidebar at 17 px; it gets a smaller size.
 */
export function isLongSingleWordName(name: string): boolean {
  return !/\s/.test(name.trim()) && name.trim().length > 10;
}

export function Lockup({ product, compact = false, labTag }: LockupProps): JSX.Element {
  const long = !compact && isLongSingleWordName(product.name);
  return (
    <Link href={product.homeHref} className={compact ? 'by-app-mlock' : 'by-app-lockup'}>
      <span className="by-app-mark">
        <BeyondlesMark height={compact ? 16 : 20} />
      </span>
      <span className="by-app-lockup-name" data-long={long ? 'true' : undefined}>
        {product.name}
      </span>
      {!compact && product.kind === 'lab' ? <span className="by-app-lab-tag">{labTag}</span> : null}
    </Link>
  );
}
