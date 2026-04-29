'use client';

type PdfViewerProps = {
  url: string;
  title: string;
};

export function PdfViewer({ url, title }: PdfViewerProps) {
  return (
    <div className="flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{title}</h3>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Open in new tab
        </a>
      </div>
      <div className="relative aspect-[1/1.4] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
        <object data={url} type="application/pdf" className="h-full w-full">
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-zinc-500">
            <svg className="mb-4 h-12 w-12 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="mb-2 text-sm">Your browser doesn&apos;t support inline PDFs.</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-600 hover:underline">
              Download the PDF instead
            </a>
          </div>
        </object>
      </div>
    </div>
  );
}
