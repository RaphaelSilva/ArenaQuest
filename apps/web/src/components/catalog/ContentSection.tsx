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
        className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {dict.catalog.topicPage.contentTitle}
      </h2>
      <div
        className="rounded-[14px] border px-6 py-5"
        style={{
          background: 'var(--aq-bg2)',
          borderColor: 'var(--aq-border)',
          boxShadow: 'var(--aq-card-shadow, 0 2px 12px rgba(0,0,0,0.15))',
        }}
      >
        <div
          className="prose prose-sm dark:prose-invert max-w-none
            prose-h1:text-[22px] prose-h1:font-bold prose-h1:font-[family-name:var(--font-space-grotesk)] prose-h1:mt-6 prose-h1:mb-3
            prose-h2:text-[18px] prose-h2:font-bold prose-h2:font-[family-name:var(--font-space-grotesk)] prose-h2:mt-5 prose-h2:mb-2
            prose-h3:text-[15px] prose-h3:font-semibold prose-h3:font-[family-name:var(--font-space-grotesk)] prose-h3:mt-4 prose-h3:mb-2
            prose-em:text-[var(--aq-accent)]
            prose-blockquote:border-l-4 prose-blockquote:border-l-[var(--aq-accent)] prose-blockquote:bg-[var(--aq-bg3)] prose-blockquote:py-3 prose-blockquote:px-4 prose-blockquote:rounded-[6px] prose-blockquote:text-[var(--aq-text3)] prose-blockquote:not-italic"
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
      </div>
    </section>
  );
}
