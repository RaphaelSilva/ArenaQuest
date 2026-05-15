-- Daily Quests
INSERT OR IGNORE INTO quest_definitions (id, kind, title, description, predicate_kind, predicate_params, xp_reward, active)
VALUES 
('daily-video', 'daily', 'Assistir 1 vídeo do módulo atual', 'Fundamentos do Movimento', 'watch_video', '{"count":1}', 50, 1),
('daily-topic', 'daily', 'Completar 1 subtópico', 'Qualquer módulo', 'complete_topic', '{"count":1}', 80, 1),
('daily-comment', 'daily', 'Deixar 1 comentário', 'Em qualquer conteúdo', 'post_comment', '{"count":1}', 30, 1),
('daily-login', 'daily', 'Fazer login no app', 'Manter sequência ativa', 'login', '{"count":1}', 10, 1);

-- Weekly Quests
INSERT OR IGNORE INTO quest_definitions (id, kind, title, description, predicate_kind, predicate_params, xp_reward, active)
VALUES 
('weekly-video', 'weekly', 'Assistir 10 vídeos na semana', 'Assista conteúdos variados', 'watch_video', '{"count":10}', 300, 1),
('weekly-topic', 'weekly', 'Concluir 2 subtópicos completos', 'Avance na sua trilha', 'complete_topic', '{"count":2}', 500, 1),
('weekly-discussion', 'weekly', 'Participar de 3 discussões', 'Comente e interaja', 'post_comment', '{"count":3}', 150, 1);
