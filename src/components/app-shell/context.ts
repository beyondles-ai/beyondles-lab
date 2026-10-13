'use client';

/**
 * What the frame tells the blocks inside the content area: the language and the product kind.
 * PageState reads it, so a product page does not have to pass the locale again. Works across
 * the server/client boundary: a client block rendered as a child of AppShell sees it.
 */
import { createContext, useContext } from 'react';
import type { ProductKind, ShellLocale } from './types';

export interface ShellContextValue {
  locale: ShellLocale;
  kind: ProductKind;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

/** The frame around the caller, or `null` outside of AppShell and NoAccess. */
export function useShellContext(): ShellContextValue | null {
  return useContext(ShellContext);
}
