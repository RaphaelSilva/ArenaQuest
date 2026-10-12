# Level curve — the ninja's bamboo

**Status:** chosen 2026-10-12, applied with [`scripts/set-levels-bamboo.mjs`](scripts/set-levels-bamboo.mjs).
Not applied until that script runs against production.

## Why a new curve

The previous budo curve had 30 generic levels: Aspirante, Treinador Júnior, Treinador, Treinador Sênior,
Especialista, Mestre, Grão-Mestre. The top level started at 43,500 XP. That fits neither the dojo's
language nor the Programa, which yields about 112,760 XP with every grade mission complete.

Grade names (9º Kyu …) were rejected as level titles. A level comes from XP, and every student in
`Alunos Mike` can watch the whole Programa, so a level named after a grade could show a grade the
student was never awarded. The real grade lives in the groups `8º Kyu` … `Shodan`. Naruto ranks,
the five elements (Godai), dojo titles and Dragon Ball forms were discussed and set aside.

## The theme

A classic ninja training legend: the apprentice plants a bamboo shoot and jumps over it every
day. The bamboo grows a little each day, and so does the jump, until the ninja clears what nobody
else can. Bamboo also carries the spirit of taijutsu: it **bends but does not break**. It spends
years growing roots underground before it shoots up, like a student at the start of the path.

## The curve

Ten stages, one per grade studied, with two levels each (start and midpoint of the grade). The
final level is **Shodan**, reached when the whole Programa is complete. A grade's XP is its
mission total plus 50 XP per required video. The first level-up comes halfway through the 9º Kyu.

| Level | Title | Grade studied | min XP |
|---|---|---|---|
| 1 | Tane I · Semente | 9º Kyu | 0 |
| 2 | Tane II · Semente | 9º Kyu | 4,210 |
| 3 | Ne I · Raiz | 8º Kyu | 8,420 |
| 4 | Ne II · Raiz | 8º Kyu | 14,135 |
| 5 | Takenoko I · Broto | 7º Kyu | 19,850 |
| 6 | Takenoko II · Broto | 7º Kyu | 25,660 |
| 7 | Wakatake I · Bambu Jovem | 6º Kyu | 31,470 |
| 8 | Wakatake II · Bambu Jovem | 6º Kyu | 37,180 |
| 9 | Fushi I · Nó | 5º Kyu | 42,890 |
| 10 | Fushi II · Nó | 5º Kyu | 46,135 |
| 11 | Shinaru I · Flexível | 4º Kyu | 49,380 |
| 12 | Shinaru II · Flexível | 4º Kyu | 54,040 |
| 13 | Kaze I · Vento | 3º Kyu | 58,700 |
| 14 | Kaze II · Vento | 3º Kyu | 61,830 |
| 15 | Hayashi I · Bosque | 2º Kyu | 64,960 |
| 16 | Hayashi II · Bosque | 2º Kyu | 69,710 |
| 17 | Ōtake I · Grande Bambu | 1º Kyu | 74,460 |
| 18 | Ōtake II · Grande Bambu | 1º Kyu | 80,670 |
| 19 | Ten I · Céu | Shodan | 86,880 |
| 20 | Ten II · Céu | Shodan | 99,820 |
| 21 | Shodan | Programa complete | 112,760 |

| Stage | Meaning |
|---|---|
| Tane — Semente | everything starts here |
| Ne — Raiz | the base nobody sees |
| Takenoko — Broto | breaks through the ground |
| Wakatake — Bambu Jovem | grows fast, still green |
| Fushi — Nó | every node is a trial overcome |
| Shinaru — Flexível | bends without breaking |
| Kaze — Vento | the bamboo sings in the wind |
| Hayashi — Bosque | no longer alone |
| Ōtake — Grande Bambu | firm and tall |
| Ten — Céu | touches the sky |
| Shodan | the first dan |

Other XP sources (topic visits, streaks, videos beyond a step's 50-video cap) move a student
somewhat faster than this table. No user held XP when the curve was chosen, so the change
re-levels nobody. The script prints the previous curve before replacing it, so it can be
restored with the same `PUT /v1/admin/levels`.
