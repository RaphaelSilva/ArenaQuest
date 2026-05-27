'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useDict } from '@web/context/dict-context';

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 9L11.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function MobileSearchBar() {
  const dict = useDict();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const qParam = searchParams.get('q') ?? '';
  const [searchValue, setSearchValue] = useState(qParam);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchValue(qParam);
  }, [qParam]);

  const updateUrl = useCallback(
    (newQ: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newQ) params.set('q', newQ);
      else params.delete('q');
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  function handleSearch(value: string) {
    setSearchValue(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      updateUrl(value);
    }, 200);
  }

  return (
    <div
      className="sticky top-0 z-10 border-b px-4 py-3 md:hidden"
      style={{
        background: 'var(--aq-bg)',
        borderColor: 'var(--aq-border)',
      }}
    >
      <div
        className="flex items-center gap-2 rounded-[8px] px-3 py-2"
        style={{ background: 'var(--aq-bg3)', border: '1px solid var(--aq-border2)' }}
      >
        <span style={{ color: 'var(--aq-text3)' }}>
          <SearchIcon />
        </span>
        <input
          type="search"
          placeholder={dict.catalog.mobileSearch.placeholder}
          value={searchValue}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--aq-text)', caretColor: 'var(--aq-accent)' }}
          aria-label={dict.catalog.mobileSearch.ariaLabel}
        />
      </div>
    </div>
  );
}
