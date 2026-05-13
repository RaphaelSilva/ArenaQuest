-- Migration 0017: level definitions table + seed
-- Milestone 7 — Gamification Data Layer (Task 01)
-- XP curve: min_xp(level) = (level - 1)^2 * 50 + (level - 1) * 50
-- Rank titles aligned with Dashboard wireframe.

CREATE TABLE IF NOT EXISTS level_definitions (
  level      INTEGER NOT NULL PRIMARY KEY,
  rank_title TEXT    NOT NULL,
  min_xp     INTEGER NOT NULL,
  max_xp     INTEGER          -- NULL for the final level
);

INSERT OR IGNORE INTO level_definitions (level, rank_title, min_xp, max_xp) VALUES
  (1,  'Aspirante',        0,     100),
  (2,  'Aspirante',        100,   300),
  (3,  'Aspirante',        300,   600),
  (4,  'Aspirante',        600,   1000),
  (5,  'Treinador Júnior', 1000,  1500),
  (6,  'Treinador Júnior', 1500,  2100),
  (7,  'Treinador Júnior', 2100,  2800),
  (8,  'Treinador Júnior', 2800,  3600),
  (9,  'Treinador Júnior', 3600,  4500),
  (10, 'Treinador',        4500,  5500),
  (11, 'Treinador',        5500,  6600),
  (12, 'Treinador',        6600,  7800),
  (13, 'Treinador',        7800,  9100),
  (14, 'Treinador',        9100,  10500),
  (15, 'Treinador Sênior', 10500, 12000),
  (16, 'Treinador Sênior', 12000, 13600),
  (17, 'Treinador Sênior', 13600, 15300),
  (18, 'Treinador Sênior', 15300, 17100),
  (19, 'Treinador Sênior', 17100, 19000),
  (20, 'Especialista',     19000, 21000),
  (21, 'Especialista',     21000, 23100),
  (22, 'Especialista',     23100, 25300),
  (23, 'Especialista',     25300, 27600),
  (24, 'Especialista',     27600, 30000),
  (25, 'Mestre',           30000, 32500),
  (26, 'Mestre',           32500, 35100),
  (27, 'Mestre',           35100, 37800),
  (28, 'Mestre',           37800, 40600),
  (29, 'Mestre',           40600, 43500),
  (30, 'Grão-Mestre',      43500, NULL);
