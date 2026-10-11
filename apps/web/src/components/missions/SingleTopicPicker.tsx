'use client';

import type { TopicNode } from '@web/lib/admin-topics-api';
import { TopicTreePicker } from './TopicTreePicker';

type Props = {
  topics: TopicNode[];
  /** The picked topic id, or `''`. */
  value: string;
  onChange: (topicId: string) => void;
  disabled?: boolean;
};

/**
 * One topic out of the published, non-archived ones, picked from the topic
 * hierarchy (`TopicTreePicker`) so a lesson is seen under its module.
 * Read-only, it shows the picked topic's path and nothing to click.
 */
export function SingleTopicPicker(props: Props) {
  return <TopicTreePicker {...props} />;
}
