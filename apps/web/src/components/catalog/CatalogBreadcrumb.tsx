'use client';

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
        {items.map((item, index) => (
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
        ))}
      </nav>
    </div>
  );
}
