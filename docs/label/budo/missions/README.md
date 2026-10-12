# Budo missions — Programa

One mission per grade, created 2026-10-12 in budo production through `POST /v1/admin/missions`
(RFC 0022 requirements missions). State below as read from production on 2026-10-12.

| Mission | Mission id | Enrollment | Group (id) | Steps | Step XP | Mission XP | Total | Active |
|---|---|---|---|---|---|---|---|---|
| 9º Kyu — Programa | `764235b3-7d0b-4d75-a86a-3c961658d481` | `auto` | — | 11 | 1,370 | 500 | 1,870 | yes |
| 8º Kyu — Programa | `7f7de854-45cd-4cb4-9019-9040676b1d34` | `assigned` | 8º Kyu (`ab26b78c-4813-418e-b34f-fea9aabe20c5`) | 11 | 1,880 | 500 | 2,380 | yes |
| 7º Kyu — Programa | `28cc19f8-9ecb-416f-af9a-1a2af96e43f1` | `assigned` | 7º Kyu (`d82d4e45-d417-46f1-b5dd-9cb29668443c`) | 10 | 1,870 | 500 | 2,370 | no |
| 6º Kyu — Programa | `8339cd64-e040-4421-95db-fa56836b1440` | `assigned` | 6º Kyu (`cd011b27-7bbb-454d-ab27-bf0265ce62c0`) | 4 | 1,820 | 500 | 2,320 | no |
| 5º Kyu — Programa | `b437ef4f-8ad7-4319-ba9b-7b340e6ed0a0` | `assigned` | 5º Kyu (`835f890f-f74f-4d0f-8d9e-173905506ec0`) | 3 | 1,040 | 500 | 1,540 | no |
| 4º Kyu — Programa | `259d43c0-47d3-4dfe-8daf-5712907267e6` | `assigned` | 4º Kyu (`abc80002-6971-4b0b-b612-78daba43fdd6`) | 3 | 1,470 | 500 | 1,970 | no |
| 3º Kyu — Programa | `87cc3b00-cf07-4f14-93ab-f35cd633bbc3` | `assigned` | 3º Kyu (`42f70eee-277c-4e52-b16b-54d81e305754`) | 5 | 960 | 500 | 1,460 | no |
| 2º Kyu — Programa | `847b4fd9-e258-42e0-9bcc-510e62a1482f` | `assigned` | 2º Kyu (`44e1fe4e-1460-4dc5-99b4-2ca4ec0fb702`) | 3 | 1,500 | 500 | 2,000 | no |
| 1º Kyu — Programa | `9676fa68-0d64-41f8-99be-7f1183022ffa` | `assigned` | 1º Kyu (`7e5f2e81-c014-4acc-9b76-3f2745a41697`) | 6 | 2,020 | 500 | 2,520 | no |
| Shodan — Programa | `1089797e-b30c-4232-a460-de99d1049437` | `assigned` | Shodan (`18bc82b4-620c-4b0a-990c-b66e55d1ed38`) | 20 | 4,280 | 500 | 4,780 | no |
| **Total** | | | | **76** | **18,210** | **5,000** | **23,210** | |

Every watched video also earns the regular 50 XP (`packages/shared/domain/gamification/xp-config.ts`),
independent of the missions.

## Design rules

- **One mission per grade.** Steps follow the grade's modules in their current `sort_order`, so the
  mission order matches the folder order.
- **Sequential mode.** Step N opens when step N−1 completes; step 1 opens at the mission start.
- **Window.** Every mission runs 2026-11-01 00:00 BRT → 2027-10-31 23:59 BRT. Rules freeze at the start,
  so steps, mode, enrollment and XP are editable in the backoffice until 2026-11-01.
- **Step kind.** `video_watched` on the module topic, with `minCount = min(ready videos, 50)`. 50 is the API
  maximum (`REQUIREMENT_MIN_COUNT_MAX`), so a module with more than 50 videos requires 50 of them.
- **Sub-folders.** From the 7º Kyu on, a sub-folder holding videos becomes its own step right after its
  module, titled `Module — Sub-folder`, because a module step only counts videos placed directly on the
  module. Empty sub-folders are skipped. The 9º and 8º Kyu missions predate this rule and leave out
  `recuperando arma` and `Kihon Happo training`.
- **No video.** A module with no video and no sub-folder becomes a `topic_visited` step
  (`Koto Ryu Kurai Kamae`, 5º Kyu).
- **Step XP.** 10 XP per required video, minimum 50. **Mission XP:** 500.
- **Enrollment.** 9º Kyu is `auto`: every non-staff user who can see its topics. From the 8º Kyu on it is
  `assigned` to the grade's group: a student is enrolled once a staff member adds them to the group
  (by the next daily run, or immediately with the mission's *Reconcile* action). Students outside
  the group see a locked teaser.
- **Draft.** The API has no draft state at creation; the scripts create the mission and then set
  `active = false`. Publishing is turning the *active* switch on in the backoffice.

## Known caveat — the group gates the mission, not the content

`Alunos Mike` grants the whole `Programa`, so any student can watch higher-grade videos. An
`assigned` enrollment counts evidence from the mission start, not from the day the student joined
the group: videos watched before the promotion are credited once the student is added. To make
the group the real gate, the grade's topics would have to be granted to the grade group instead
of `Alunos Mike`.
