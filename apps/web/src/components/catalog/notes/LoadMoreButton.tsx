'use client';

type LoadMoreButtonProps = {
  label: string;
  loadingLabel: string;
  errorLabel: string;
  loading: boolean;
  failed: boolean;
  onClick: () => void;
};

/** The *load more* button under a notes list, with its failure line. */
export function LoadMoreButton({ label, loadingLabel, errorLabel, loading, failed, onClick }: LoadMoreButtonProps) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      {failed && (
        <p role="alert" className="text-[12px] font-semibold" style={{ color: 'var(--aq-error)' }}>
          {errorLabel}
        </p>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-busy={loading}
        className="cursor-pointer rounded-[8px] border px-4 py-2 text-[13px] font-bold transition-colors duration-150 hover:border-[var(--aq-border3)] disabled:cursor-wait disabled:opacity-60"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' }}
      >
        {loading ? loadingLabel : label}
      </button>
    </div>
  );
}
