'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { useHasRole } from '@web/hooks/use-auth';
import {
  SubmissionsApiError,
  type SubmissionSummary,
  type SubmissionView,
  type uploadToPresignedUrl,
} from '@web/lib/submissions-api';
import { CatalogBreadcrumb } from '../CatalogBreadcrumb';
import { MainPaneSkeleton } from '../MainPaneSkeleton';
import { AllTab } from './AllTab';
import { ClassTab } from './ClassTab';
import { MineTab } from './MineTab';
import { QuotaLine } from './QuotaLine';
import { SubmissionViewer } from './SubmissionViewer';

export type SubmissionsTab = 'mine' | 'class' | 'all';

/** The direct-link viewer holds one item, so there is nowhere to step to. */
const stayOnLinked = () => undefined;

/** Tabs the caller gets: staff a single *All*; students *Mine*, plus *Class* while sharing is on. */
export function tabsFor(isStaff: boolean, sharingEnabled: boolean): SubmissionsTab[] {
  if (isStaff) return ['all'];
  return sharingEnabled ? ['mine', 'class'] : ['mine'];
}

type SubmissionsPageProps = {
  topicId: string;
  /**
   * The direct link (`/catalog/[id]/submissions/[sid]`): opens the viewer on
   * this submission. A submission the caller cannot see renders the same
   * not-found state as an unreadable topic, so the link reveals nothing.
   */
  submissionId?: string;
  /** The PUT; injectable for tests. */
  upload?: typeof uploadToPresignedUrl;
};

/**
 * The Demonstrations page of a topic: breadcrumb back to the topic, the tab
 * bar driven by `?tab=`, the quota line and the active tab. Staff get only
 * *All*, with no quota line and no upload.
 */
export function SubmissionsPage({ topicId, submissionId, upload }: SubmissionsPageProps) {
  const dict = useDict();
  const t = dict.submissions;
  const client = useApiClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isStaff = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const baseId = useId();

  const [topicTitle, setTopicTitle] = useState<string | null>(null);
  const [summary, setSummary] = useState<SubmissionSummary | null>(null);
  const [linked, setLinked] = useState<SubmissionView | null>(null);
  const [linkedOpen, setLinkedOpen] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  const tabRefs = useRef<Partial<Record<SubmissionsTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      client.topics.getById(topicId),
      client.submissions.summary(topicId),
      submissionId ? client.submissions.getOne(topicId, submissionId) : Promise.resolve(null),
    ]).then(([topic, s, one]) => {
      if (!active) return;
      if (topic.status === 'fulfilled' && s.status === 'fulfilled' && one.status === 'fulfilled') {
        setTopicTitle(topic.value.title);
        setSummary(s.value);
        setLinked(one.value);
        setState('ready');
        return;
      }
      // The summary shares the catalog gate: its 404 means the topic is not readable.
      // The single read answers 404 for anything the caller may not see.
      const isNotFound = (r: PromiseSettledResult<unknown>) =>
        r.status === 'rejected' && r.reason instanceof SubmissionsApiError && r.reason.code === 'NotFound';
      setState(isNotFound(s) || isNotFound(one) ? 'notFound' : 'error');
    });
    return () => {
      active = false;
    };
  }, [client, topicId, submissionId]);

  const refreshSummary = useCallback(() => {
    client.submissions.summary(topicId).then(setSummary, () => {
      // Keep the last known summary; the API re-checks every limit anyway.
    });
  }, [client, topicId]);

  const tabs = summary ? tabsFor(isStaff, summary.sharingEnabled) : [];
  const requested = searchParams.get('tab') as SubmissionsTab | null;
  // A direct link to a classmate's submission lands on *Class* behind the viewer.
  const linkedTab: SubmissionsTab | null = linked && !linked.isMine && tabs.includes('class') ? 'class' : null;
  const active: SubmissionsTab =
    requested && tabs.includes(requested) ? requested : (linkedTab ?? tabs[0] ?? 'mine');

  // Always the page's own path, so switching tabs from a direct link leaves the `[sid]` route.
  const selectTab = (tab: SubmissionsTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/catalog/${encodeURIComponent(topicId)}/submissions?${params.toString()}`, { scroll: false });
  };

  const focusTab = (tab: SubmissionsTab) => {
    selectTab(tab);
    tabRefs.current[tab]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(active);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab(tabs[(index + 1) % tabs.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab(tabs[(index - 1 + tabs.length) % tabs.length]);
    }
  };

  if (state === 'loading') {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6 lg:px-10">
        <p className="sr-only" role="status">
          {t.page.loading}
        </p>
        <MainPaneSkeleton />
      </div>
    );
  }

  if (state !== 'ready' || !summary) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p role="alert" className="text-sm" style={{ color: 'var(--aq-error)' }}>
          {state === 'notFound' ? t.page.notFound : t.page.loadError}
        </p>
      </div>
    );
  }

  const labels: Record<SubmissionsTab, string> = { mine: t.tabs.mine, class: t.tabs.class, all: t.tabs.all };
  const tabId = (tab: SubmissionsTab) => `${baseId}-tab-${tab}`;
  const panelId = (tab: SubmissionsTab) => `${baseId}-panel-${tab}`;

  return (
    <div className="mx-auto max-w-[900px] px-4 pt-8 md:px-6 md:pb-8 lg:px-10">
      <CatalogBreadcrumb
        items={[
          { label: dict.catalog.breadcrumb.catalogue, href: '/catalog' },
          { label: topicTitle ?? '', href: `/catalog/${topicId}` },
          { label: t.page.title },
        ]}
        backHref={`/catalog/${topicId}`}
      />

      <header className="mb-6">
        <h1
          className="text-[24px] font-bold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {t.page.title}
        </h1>
        <p className="mt-1 text-[14px]" style={{ color: 'var(--aq-text2)' }}>
          {t.page.subtitle}
        </p>
        {!isStaff && (
          <div className="mt-2">
            <QuotaLine summary={summary} />
          </div>
        )}
      </header>

      <div
        role="tablist"
        aria-label={t.tabs.label}
        onKeyDown={onKeyDown}
        className="mb-5 flex gap-1 border-b"
        style={{ borderColor: 'var(--aq-border)' }}
      >
        {tabs.map((tab) => {
          const selected = tab === active;
          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              id={tabId(tab)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab)}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab)}
              className="-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors duration-150"
              style={{
                borderColor: selected ? 'var(--aq-accent)' : 'transparent',
                color: selected ? 'var(--aq-accent)' : 'var(--aq-text2)',
              }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      <div id={panelId(active)} role="tabpanel" aria-labelledby={tabId(active)}>
        {active === 'mine' ? (
          <MineTab topicId={topicId} summary={summary} onUsageChanged={refreshSummary} upload={upload} />
        ) : active === 'class' ? (
          <ClassTab topicId={topicId} onGoToMine={() => selectTab('mine')} />
        ) : (
          <AllTab topicId={topicId} />
        )}
      </div>

      {linked && linkedOpen && (
        <SubmissionViewer
          items={[linked]}
          currentId={linked.id}
          onNavigate={stayOnLinked}
          onClose={() => setLinkedOpen(false)}
        />
      )}
    </div>
  );
}
