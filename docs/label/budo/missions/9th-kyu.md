# Mission: 9º Kyu — Programa

**Label:** budo · **Environment:** production · **Mission ID:** `764235b3-7d0b-4d75-a86a-3c961658d481`
**State:** active — created 2026-10-12 as a draft by `scripts/create-mission-9th-kyu.mjs`, then activated in the backoffice
**Source topic:** `9th Kyu` (`e79974f5-5c38-4683-9475-4284707777e2`) under `Programa`

## Description (as shown to students)

> Complete o programa do 9º Kyu: assista a todos os vídeos de cada módulo, na ordem do Programa. Cada módulo concluído libera o próximo.

## Settings

| Setting | Value |
|---|---|
| Mode | `sequential` — steps follow the folders' current `sort_order` |
| Enrollment | `auto` — non-staff users who can access every target topic |
| Start | 2026-11-01 00:00 BRT (`2026-11-01T03:00:00.000Z`) |
| End | 2027-10-31 23:59 BRT (`2027-11-01T02:59:59.000Z`) |
| Mission XP | 500 |
| Badge | none |

## Steps and completion logic

Every step is `video_watched` on its module topic. `minCount` = the module's **ready** videos on 2026-10-12, so a step means "watch every video of the module". Step XP = 10 × videos, minimum 50.

| # | Step (module) | Videos required | Step XP |
|---|---|---|---|
| 1 | Ashirau Ippo Yonho | 14 | 140 |
| 2 | Dakentaijutsu | 23 | 230 |
| 3 | Gaeshi | 3 | 50 |
| 4 | Go Gyo no Kata | 5 | 50 |
| 5 | Hoken Juroppo | 28 | 280 |
| 6 | Kaiten | 24 | 240 |
| 7 | Kihon Gyokko Ryu Koshi Sampo | 9 | 90 |
| 8 | Nagare | 14 | 140 |
| 9 | Shoshin Atemi no Keiko | 5 | 50 |
| 10 | Tobi | 2 | 50 |
| 11 | Ukemi | 4 | 50 |
| | **Steps subtotal** | **131** | **1,370** |
| | Mission completion bonus | | 500 |
| | **Mission total** | | **1,870** |

Each watched video also earns the regular 50 XP (`xp-config.ts`), independent of the mission: 131 × 50 = 6,550 XP. Grand total for a student who completes the mission: **8,420 XP**.

- A step counts **distinct ready videos** of its topic, watched inside the step's window.
- Sequential: step N opens at step N−1's `completed_at`; step 1 opens at the mission start. Videos watched before a step opens do not count.
- A step completes at the instant of its last required video; its XP is written once.
- The mission completes with step 11; the 500 XP bonus is written once. Leaving takes nothing back.

## Notes

- Nagare (14 of 15) and Shoshin Atemi no Keiko (5 of 6) each have one video not `ready`; it is not required.
- Rules freeze at the start date: until 2026-11-01 everything is editable in the backoffice.
- The sub-folder `recuperando arma` (under Kaiten, 6 videos) is not a step.
