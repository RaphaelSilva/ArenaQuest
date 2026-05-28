'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useDict } from '@web/context/dict-context';

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type Props = {
  items: BreadcrumbItem[];
  backHref?: string;
};

export function CatalogBreadcrumb({ items, backHref }: Props) {
  const dict = useDict();
  const [isExpanded, setIsExpanded] = useState(false);

  const shouldCollapse = items.length > 4;
  const displayItems = !shouldCollapse || isExpanded ? items : null;

  const renderBreadcrumbItems = () => {
    if (displayItems) {
      return displayItems.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          {index > 0 && <span>›</span>}
          {item.href ? (
            <Link
              href={item.href}
              className="transition-colors hover:text-[var(--aq-accent)]"
              style={{ color: 'var(--aq-text3)' }}
            >
              {item.label}
            </Link>
          ) : (
            <span className="font-medium" style={{ color: 'var(--aq-text2)' }}>
              {item.label}
            </span>
          )}
        </div>
      ));
    }

    const first = items[0];
    const secondToLast = items[items.length - 2];
    const last = items[items.length - 1];

    return (
      <>
        <div className="flex items-center gap-1.5">
          {first.href ? (
            <Link
              href={first.href}
              className="transition-colors hover:text-[var(--aq-accent)]"
              style={{ color: 'var(--aq-text3)' }}
            >
              {first.label}
            </Link>
          ) : (
            <span className="font-medium" style={{ color: 'var(--aq-text2)' }}>
              {first.label}
            </span>
          )}
        </div>

        <span>›</span>

        <button
          onClick={() => setIsExpanded(true)}
          className="transition-colors hover:text-[var(--aq-accent)]"
          style={{ color: 'var(--aq-text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          aria-label={dict.catalog.breadcrumb.expandEllipsis}
        >
          …
        </button>

        <span>›</span>

        <div className="flex items-center gap-1.5">
          {secondToLast.href ? (
            <Link
              href={secondToLast.href}
              className="transition-colors hover:text-[var(--aq-accent)]"
              style={{ color: 'var(--aq-text3)' }}
            >
              {secondToLast.label}
            </Link>
          ) : (
            <span className="font-medium" style={{ color: 'var(--aq-text2)' }}>
              {secondToLast.label}
            </span>
          )}
        </div>

        <span>›</span>

        <div className="flex items-center gap-1.5">
          {last.href ? (
            <Link
              href={last.href}
              className="transition-colors hover:text-[var(--aq-accent)]"
              style={{ color: 'var(--aq-text3)' }}
            >
              {last.label}
            </Link>
          ) : (
            <span className="font-medium" style={{ color: 'var(--aq-text2)' }}>
              {last.label}
            </span>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="mb-5 md:mb-6">
      {/* Back button — visible only on mobile */}
      {backHref && (
        <Link
          href={backHref}
          className="mb-3 flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:text-[var(--aq-accent)] md:hidden"
          style={{ color: 'var(--aq-text3)' }}
        >
          {dict.catalog.breadcrumb.back}
        </Link>
      )}

      {/* Breadcrumb navigation */}
      <nav className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
        {renderBreadcrumbItems()}
      </nav>
    </div>
  );
}
