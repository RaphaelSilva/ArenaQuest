export type XpAction =
  | 'stage_checkin'
  | 'topic_complete'
  | 'video_watched'
  | 'comment_posted'
  | 'quest_reward'
  | 'mission_reward'
  | 'badge_award';

export const XP_POINTS: Record<XpAction, number> = {
  stage_checkin: 20,
  topic_complete: 100,
  video_watched: 50,
  comment_posted: 30,
  // Reward kinds use customPoints from the definition; 0 is a safe fallback.
  quest_reward: 0,
  mission_reward: 0,
  badge_award: 0,
};
