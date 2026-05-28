'use client';

import React from 'react';
import { useDict } from '@web/context/dict-context';

type Props = {
  url: string;
  originalName: string;
  fileSize: string;
  onInteraction?: () => void;
};

export default function PdfStage({ url, originalName, fileSize, onInteraction }: Props) {
  const dict = useDict();

  return (
    <div className="flex flex-col md:flex-row items-center gap-6 p-5 rounded-[12px] border border-[var(--aq-border2)] bg-[var(--aq-bg3)] w-full">
      {/* Paper preview block */}
      <div className="flex flex-shrink-0 w-24 h-32 bg-[var(--aq-bg2)] rounded-[8px] border border-[var(--aq-border)] shadow-md flex-col items-center justify-center p-3 relative overflow-hidden">
        <span className="text-[32px] text-[var(--aq-accent)] mb-1" aria-hidden>📄</span>
        <span className="text-[10px] uppercase font-bold text-[var(--aq-text3)]">PDF</span>
        {/* Subtle lines to mock paper text */}
        <div className="w-4/5 h-[2px] bg-[var(--aq-border)] mt-2 rounded" />
        <div className="w-3/5 h-[2px] bg-[var(--aq-border)] mt-1 rounded" />
        <div className="w-4/5 h-[2px] bg-[var(--aq-border)] mt-1 rounded" />
      </div>

      {/* Info & Action Column */}
      <div className="flex-1 min-w-0 text-center md:text-left">
        <h5
          className="text-[14px] font-bold truncate"
          style={{
            fontFamily: 'var(--font-space-grotesk), sans-serif',
            color: 'var(--aq-text)',
          }}
        >
          {originalName}
        </h5>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--aq-text3)' }}>
          {fileSize}
        </p>

        <div className="mt-4 flex flex-col sm:flex-row items-center justify-center md:justify-start gap-2">
          <a
            href={url}
            download={originalName}
            onClick={onInteraction}
            className="w-full sm:w-auto text-center px-4 py-2 rounded-[8px] text-[12px] font-bold bg-[var(--aq-accent)] text-[#0b0e17] transition-transform hover:scale-[1.02]"
          >
            {dict.catalog.mediaViewer.download}
          </a>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onInteraction}
            className="w-full sm:w-auto text-center px-4 py-2 rounded-[8px] text-[12px] font-bold border border-[var(--aq-border2)] bg-transparent text-[var(--aq-text2)] transition-all hover:bg-[var(--aq-bg4)] hover:text-[var(--aq-accent)]"
          >
            {dict.catalog.pdfViewer.openInNewTab}
          </a>
        </div>
      </div>
    </div>
  );
}
