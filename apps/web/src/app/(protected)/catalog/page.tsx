export default function CatalogIndexPage() {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 shadow-inner dark:bg-indigo-500/10 dark:text-indigo-400">
        <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Welcome to the Catalogue
      </h2>
      <p className="mt-2 max-w-sm text-base text-zinc-500 dark:text-zinc-400">
        Select a topic from the sidebar to view its content and attached media.
      </p>
    </div>
  );
}
