# Mission: 8º Kyu — Programa

**Label:** budo · **Environment:** production · **Mission ID:** `7f7de854-45cd-4cb4-9019-9040676b1d34`
**State:** active — created 2026-10-12 by [`scripts/create-mission-8th-kyu.mjs`](../scripts/create-mission-8th-kyu.mjs)
**Source topic:** `8th Kyu` (`eba0de38-800b-4585-9bf2-4bc2e374427b`) under `Programa`

## Description (as shown to students)

> Complete o programa do 8º Kyu: assista a todos os vídeos de cada módulo, na ordem do Programa. Cada módulo concluído libera o próximo. Disponível para alunos do grupo 8º Kyu.

## Settings

| Setting | Value |
|---|---|
| Mode | `sequential` — steps follow the folders' current `sort_order` |
| Enrollment | `assigned` to the group **8º Kyu** (`ab26b78c-4813-418e-b34f-fea9aabe20c5`), created empty by the script |
| Start / end | 2026-11-01 00:00 BRT → 2027-10-31 23:59 BRT |
| Mission XP | 500 |
| Badge | none |

The 8º Kyu is where grades start to depend on having passed the previous one: a student finishes
the 9º Kyu mission, and the 8º Kyu mission stays locked until staff add them to the **8º Kyu** group.

## Steps

Every step is `video_watched` with `minCount` = the module's ready videos on 2026-10-12.

| # | Step (module) | Videos required | Step XP |
|---|---|---|---|
| 1 | Bofuri Gata | 2 | 50 |
| 2 | Eri Jime Kata | 39 | 390 |
| 3 | Gyaku Waza | 25 | 250 |
| 4 | Henka Geri | 22 | 220 |
| 5 | Kaihi Taisabaki | 3 | 50 |
| 6 | Kaiten | 3 | 50 |
| 7 | Kihon Happo Torite | 43 | 430 |
| 8 | Shinken Taihen Jutsu Muto Dori Gata | 20 | 200 |
| 9 | Soku Yaku Ken Keri | 11 | 110 |
| 10 | Tehodoki | 6 | 60 |
| 11 | Tobi variations | 7 | 70 |
| | **Steps subtotal** | **181** | **1,880** |
| | Mission completion bonus | | 500 |
| | **Mission total** | | **2,380** |

The required videos earn another 181 × 50 = 9,050 XP outside the mission.

## Enrollment logic

- A student is enrolled when they are in the group: by the next daily run, or immediately with
  the mission's *Reconcile* action. Removing them from the group ends the enrollment.
- Students outside the group see a locked teaser naming the group, with no steps.
- Evidence counts from the mission start, not from the day the student joined the group
  (see [README.md](README.md#known-caveat--the-group-gates-the-mission-not-the-content)).

## Notes

- The sub-folder `Kihon Happo training` (under Kihon Happo Torite, 15 videos) is not a step.
- Not-ready videos are not required: Gyaku Waza 6, Henka Geri 1, Shinken Taihen Jutsu Muto Dori Gata 2.
