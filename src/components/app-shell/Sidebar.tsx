'use client';

/**
 * The sidebar: lockup, the product's navigation, the organisation chip. 256 px and full height
 * on a desktop, a drawer on a phone. It only ever leads to pages of the product itself.
 */
import type { JSX } from 'react';
import Link from 'next/link';
import { Lockup } from './Lockup';
import type { ShellMessages } from './messages';
import type { NavGroup, ShellOrganisation, ShellProduct } from './types';
import { initials } from './util';

export interface SidebarProps {
  id: string;
  product: ShellProduct;
  /** `null` renders the frame without navigation (the no-access page). */
  navGroups: readonly NavGroup[] | null;
  activeId: string | null;
  organisation: ShellOrganisation | null;
  open: boolean;
  onNavigate?: () => void;
  messages: ShellMessages;
}

export function Sidebar({
  id,
  product,
  navGroups,
  activeId,
  organisation,
  open,
  onNavigate,
  messages: t,
}: SidebarProps): JSX.Element {
  return (
    <div className="by-app-side" id={id} data-open={open ? 'true' : 'false'}>
      <Lockup product={product} labTag={t.labTag} />
      {navGroups ? (
        <nav className="by-app-nav" aria-label={t.navigation}>
          {navGroups.map((group, groupIndex) => {
            const labelId = `${id}-group-${groupIndex}`;
            return (
              <div className="by-app-nav-group" key={`group-${groupIndex}`}>
                {group.label ? (
                  <div className="by-app-nav-label" id={labelId}>
                    {group.label}
                  </div>
                ) : null}
                <ul className="by-app-nav-list" aria-labelledby={group.label ? labelId : undefined}>
                  {group.items.map((item) => {
                    const active = item.id === activeId;
                    return (
                      <li className="by-app-nav-item" key={item.id}>
                        <Link
                          href={item.href}
                          className="by-app-nav-link"
                          aria-current={active ? 'page' : undefined}
                          onClick={onNavigate}
                        >
                          {item.icon ? (
                            <span className="by-app-nav-icon" aria-hidden="true">
                              {item.icon}
                            </span>
                          ) : null}
                          <span className="by-app-nav-text">{item.label}</span>
                          {item.tag === 'staff' ? <span className="by-app-nav-tag">{t.staffTag}</span> : null}
                          {item.badge !== undefined && item.badge !== null && item.badge !== '' ? (
                            <span className="by-app-nav-badge">{item.badge}</span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      ) : (
        <div className="by-app-nav-space" />
      )}
      {organisation ? (
        <div className="by-app-org">
          <span className="by-app-org-chip" aria-hidden="true">
            {initials(organisation.name)}
          </span>
          <span className="by-app-org-text">
            <span className="by-app-org-name">{organisation.name}</span>
            <span className="by-app-org-kind">{t.organisation}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
