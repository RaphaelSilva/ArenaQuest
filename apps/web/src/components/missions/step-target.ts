import type { MissionStepView } from '@web/lib/missions-api';

/**
 * How a step's target renders, read straight from the server's view (RFC 0022 §8):
 * a link when the student can open it, `restricted` when the server redacted it
 * (no link, no title), `none` for a `manual_check` step.
 */
export type StepTargetView =
  | { kind: 'link'; href: string; title: string | null }
  | { kind: 'text'; title: string }
  | { kind: 'restricted' }
  | { kind: 'none' };

export function stepTargetView(step: Pick<MissionStepView, 'kind' | 'target'>): StepTargetView {
  const { target } = step;
  if (!target) return { kind: 'none' };

  if (target.type === 'topic') {
    if (!target.accessible) return { kind: 'restricted' };
    if (!target.topicId) return target.title ? { kind: 'text', title: target.title } : { kind: 'restricted' };
    const base = `/catalog/${encodeURIComponent(target.topicId)}`;
    const href = step.kind === 'submissions_on_topic' ? `${base}/submissions` : base;
    return { kind: 'link', href, title: target.title };
  }

  if (!target.slug) return { kind: 'restricted' };
  return { kind: 'link', href: `/events/${encodeURIComponent(target.slug)}`, title: target.title };
}
