INSERT OR IGNORE INTO badges (id, slug, name, icon_emoji, description, xp_reward, rule_kind, rule_params) VALUES
  ('badge-alicerce-solido', 'alicerce-solido', 'Alicerce Sólido', '🏆', '', 250, 'topic_completed', '{"count":1}'),
  ('badge-levantador-bronze', 'levantador-bronze', 'Levantador Bronze', '🥉', '', 300, 'total_xp', '{"min_xp":500}'),
  ('badge-semana-perfeita', 'semana-perfeita', 'Semana Perfeita', '⚡', '', 500, 'streak_days', '{"days":7}'),
  ('badge-respirador-elite', 'respirador-elite', 'Respirador Elite', '💨', '', 200, 'videos_watched_in_period', '{"count":10,"period":"week"}'),
  ('badge-levantador-prata', 'levantador-prata', 'Levantador Prata', '🥈', '', 600, 'total_xp', '{"min_xp":2000}'),
  ('badge-coracao-de-ferro', 'coracao-de-ferro', 'Coração de Ferro', '❤️‍🔥', '', 800, 'streak_days', '{"days":30}'),
  ('badge-mobilidade-pro', 'mobilidade-pro', 'Mobilidade Pro', '🦾', '', 350, 'topic_completed', '{"count":5}'),
  ('badge-tecnica-afiada', 'tecnica-afiada', 'Técnica Afiada', '🎯', '', 400, 'mission_completed', '{"count":1}');
