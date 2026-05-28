'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { useDict } from '@web/context/dict-context';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function CatalogMobileDrawer({ isOpen, onClose, children }: Props) {
  const dict = useDict();
  const pathname = usePathname();
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close drawer on navigation
  useEffect(() => {
    if (isOpen) {
      onClose();
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manage body scroll lock and focus management
  useEffect(() => {
    if (!isOpen) return;

    // Track previously focused element to restore it on close
    previouslyFocusedElementRef.current = document.activeElement as HTMLElement;

    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Trap focus inside container
    const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable && focusable.length > 0) {
      // Focus on the first element (e.g. dismiss button)
      focusable[0].focus();
    }

    // Escape key listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      // Restore focus
      previouslyFocusedElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex lg:hidden">
      {/* Scrim / Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 ease-out"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer content container */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={dict.catalog.redesign.drawerOpen}
        className="relative flex w-[280px] max-w-[85vw] flex-1 flex-col bg-[var(--aq-bg2)] shadow-2xl transition-transform duration-300 ease-out"
        style={{
          borderRight: '1px solid var(--aq-border)',
        }}
      >
        {/* Dismiss Button */}
        <div className="absolute right-3 top-3 z-20">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--aq-bg3)] text-[var(--aq-text3)] border border-[var(--aq-border2)] transition-colors hover:text-[var(--aq-accent)] hover:border-[var(--aq-accent)]"
            aria-label={dict.catalog.redesign.drawerClose}
          >
            <svg className="h-4 w-4 stroke-current" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
