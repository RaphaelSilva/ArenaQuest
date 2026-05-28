'use client';

import { renderMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import { useDict } from '@web/context/dict-context';

type ContentSectionProps = {
  content: string | null | undefined;
};

export function ContentSection({ content }: ContentSectionProps) {
  const dict = useDict();

  if (!content?.trim()) {
    return null;
  }

  const html = renderMarkdown(content);

  return (
    <section className="mb-8">
      <h2
        className="mb-4 text-[15px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {dict.catalog.topicPage.contentTitle}
      </h2>
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        style={{
          color: 'var(--aq-text2)',
          '--tw-prose-body': 'var(--aq-text2)',
          '--tw-prose-headings': 'var(--aq-text1)',
          '--tw-prose-links': 'var(--aq-accent)',
          '--tw-prose-code': 'var(--aq-accent)',
          '--tw-prose-hr': 'var(--aq-border)',
        } as React.CSSProperties}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </section>
  );
}
