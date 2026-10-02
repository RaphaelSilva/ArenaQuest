'use client';

import { useDict } from '@web/context/dict-context';
import { SUBMISSIONS_ROOT } from './storage-format';

type Crumb = { prefix: string; label: string };

/** `topics/abc/` → `['', 'topics/', 'topics/abc/']` with their display labels. */
function crumbsOf(
  prefix: string,
  rootLabel: string,
  titles: ReadonlyMap<string, string>,
  submissionsLabel: string,
): Crumb[] {
  const crumbs: Crumb[] = [{ prefix: '', label: rootLabel }];
  let acc = '';
  for (const segment of prefix.split('/').filter(Boolean)) {
    acc += `${segment}/`;
    crumbs.push({ prefix: acc, label: titles.get(acc) ?? (acc === SUBMISSIONS_ROOT ? submissionsLabel : segment) });
  }
  return crumbs;
}

/**
 * Built from the prefix alone. A segment whose folder has a known owner shows
 * the topic / event title instead of its id; every ancestor is a button that
 * navigates back up.
 */
export function StorageBreadcrumb({
  prefix,
  titles,
  onNavigate,
}: {
  prefix: string;
  /** Owner titles keyed by folder prefix, collected from the folder rows. */
  titles: ReadonlyMap<string, string>;
  onNavigate: (prefix: string) => void;
}) {
  const d = useDict().adminStorage;
  const crumbs = crumbsOf(prefix, d.root, titles, d.folder.submissionsRoot);

  return (
    <nav aria-label={d.breadcrumbLabel} className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.prefix} className="flex items-center gap-1">
              {index > 0 && (
                <span aria-hidden="true" className="text-zinc-400">
                  /
                </span>
              )}
              {isLast ? (
                <span aria-current="page" className="break-all font-semibold text-zinc-900 dark:text-zinc-50">
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(crumb.prefix)}
                  className="break-all rounded px-1 text-indigo-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
                >
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
