# Budo label — operational notes

Content and gamification work done directly against the **budo production** tenant
(`config/labels/budo.jsonc`, D1 `budo-db`, API `api-budo.spaziord.com.br`).

| Document | What it holds |
|---|---|
| [programa.md](programa.md) | The `Programa` topic tree: grades, modules, sub-folders, video counts |
| [programa-charts.html](programa-charts.html) | The same distribution as bar charts (open in a browser) |
| [missions/README.md](missions/README.md) | Mission design rules and the state of every mission in production |
| [missions/9th-kyu.md](missions/9th-kyu.md) | 9º Kyu mission (auto enrollment) |
| [missions/8th-kyu.md](missions/8th-kyu.md) | 8º Kyu mission (group-gated) |
| [missions/7th-kyu-to-shodan.md](missions/7th-kyu-to-shodan.md) | 7º Kyu → Shodan missions (group-gated) |
| [levels.md](levels.md) | The level curve: "the ninja's bamboo", 21 levels ending at Shodan |
| [scripts/](scripts/) | The scripts that created the missions |

## Running the scripts

All scripts write to production through the public API, as an `admin` account read
from `AQ_ADMIN_EMAIL` / `AQ_ADMIN_PASSWORD`. Each one aborts before any write when the
account is not `admin`, and skips (or aborts on) a mission whose title already exists.
Always dry-run first:

```bash
node "docs/label/budo/scripts/create-missions-7th-to-shodan.mjs" --dry-run
node "docs/label/budo/scripts/create-missions-7th-to-shodan.mjs" --only "7º Kyu"
```

Topic ids and video counts are frozen in the scripts as of **2026-10-12**; re-check them
against production before reusing a script for a new mission.
