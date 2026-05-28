'use client';

import type { Media } from '@web/lib/admin-media-api';
import { useDict } from '@web/context/dict-context';

type Props = { files: Media[] };

function fileEmoji(type: string): string {
  if (type === 'application/pdf') return '📄';
  if (type.includes('spreadsheet') || type.includes('excel')) return '📊';
  if (type.includes('presentation') || type.includes('powerpoint')) return '📽️';
  if (type.startsWith('text/')) return '📝';
  return '📁';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function FilesGrid({ files }: Props) {
  const dict = useDict();

  if (files.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--aq-text3)' }}>
        {dict.catalog.filesGrid.noFiles}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((f) => (
        <div
          key={f.id}
          className="flex flex-col gap-3 rounded-[12px] p-4"
          style={{ background: 'var(--aq-bg2)', border: '1px solid var(--aq-border)' }}
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded-[10px] text-2xl"
            style={{ background: 'var(--aq-accent-glow)' }}
            aria-hidden
          >
            {fileEmoji(f.type)}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[13px] font-semibold"
              style={{ color: 'var(--aq-text)' }}
              title={f.originalName}
            >
              {f.originalName}
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
              {formatSize(f.sizeBytes)}
            </p>
          </div>
          <a
            href={f.url}
            download={f.originalName}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-[12px] font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)', border: '1px solid var(--aq-accent)' }}
          >
            {dict.catalog.filesGrid.download}
          </a>
        </div>
      ))}
    </div>
  );
}
