'use client';

import { useMemo } from 'react';
import { renderMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';

type MarkdownViewerProps = {
  content: string;
  className?: string;
};

export function MarkdownViewer({ content, className = '' }: MarkdownViewerProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className={`prose prose-zinc dark:prose-invert max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
