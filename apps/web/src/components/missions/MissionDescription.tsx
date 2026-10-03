'use client';

import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';

/** The mission description, rendered as sanitised Markdown through the catalog's viewer. */
export function MissionDescription({ description }: { description: string | null | undefined }) {
  if (!description || !description.trim()) return null;
  return (
    <div data-testid="mission-description" className="text-sm" style={{ color: 'var(--aq-text2)' }}>
      <MarkdownViewer content={description} />
    </div>
  );
}
