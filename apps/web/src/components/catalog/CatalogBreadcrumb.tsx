import Link from 'next/link';

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type Props = {
  items: BreadcrumbItem[];
};

export function CatalogBreadcrumb({ items }: Props) {
  return (
    <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[12px] md:mb-6" style={{ color: 'var(--aq-text3)' }}>
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
  );
}
