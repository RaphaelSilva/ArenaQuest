export type XpAction =
  | 'stage_checkin'
  | 'topic_complete'
  | 'video_watched'
  | 'comment_posted';

export const XP_POINTS: Record<XpAction, number> = {
  stage_checkin: 20,
  topic_complete: 100,
  video_watched: 50,
  comment_posted: 30,
};
