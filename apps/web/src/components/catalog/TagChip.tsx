import Link from 'next/link';

type TagChipProps = {
  label: string;
  /** When set, the chip is a link (e.g. to `/catalog?tag=<slug>`). */
  href?: string;
  /** When set, a trailing dismiss button is rendered. */
  onDismiss?: () => void;
  /** Accessible name of the dismiss button; required with `onDismiss`. */
  dismissLabel?: string;
};

const CHIP_CLASS =
  'inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium';
const CHIP_STYLE = {
  color: 'var(--aq-text2)',
  background: 'var(--aq-bg3)',
  border: '1px solid var(--aq-border2)',
} as const;

/** Small tag pill: plain label, link, or dismissible filter chip. */
export function TagChip({ label, href, onDismiss, dismissLabel }: TagChipProps) {
  if (href && !onDismiss) {
    return (
      <Link href={href} className={`${CHIP_CLASS} hover:text-[var(--aq-accent)]`} style={CHIP_STYLE}>
        {label}
      </Link>
    );
  }

  return (
    <span className={CHIP_CLASS} style={CHIP_STYLE}>
      <span className="truncate">{label}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="flex-shrink-0 border-0 bg-transparent leading-none hover:text-[var(--aq-accent)]"
          style={{ color: 'var(--aq-text3)', cursor: 'pointer' }}
        >
          <span aria-hidden>×</span>
        </button>
      )}
    </span>
  );
}
