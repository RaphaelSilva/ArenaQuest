# ArenaQuest — Design System Spec

> **Source:** wireframes in `docs/product/web/wire/` (`Login.html`, `Dashboard.html`, `Content.html`, `TopicDetail.html`).
> **Purpose:** canonical reference for building the Next.js frontend in `apps/web`. Every page must align with the tokens, rules, and conventions below.

---

## 1. Core Principles

1. **Gamified but grounded.** Progress (XP, streak, ranking, badges, percentages) is a first-class citizen on every learning-unit card — but it never overwhelms the content itself.
2. **Dark-first, light-equal.** Both themes are authored with the same token names (`.theme-dark` / `.theme-light`). No feature may be dark-only. The light palette is a warm off-white (`#F0EEE8`), not pure white — it preserves the "arena" mood.
3. **OKLCH for semantic hues.** All accents live in `oklch()` so the four accent slots share a consistent perceptual lightness/chroma envelope and stay legible on both themes.
4. **Layered depth via surface tokens.** Hierarchy is stacked through `--bg → --bg2 → --bg3 → --bg4 → --bg5`, not through shadows. Shadows are a hint, not structure.
5. **Low-contrast alpha borders.** Every divider uses `rgba(255,255,255,0.07)` in dark or `rgba(0,0,0,0.08)` in light. Opaque grays are banned — they read as noise.
6. **Three canonical statuses.** Every progressable unit is exactly one of `done` / `inprog` / `locked`, mapped to `accent3` / `accent` / muted `bg4`. A fourth status is a design discussion, not a free-for-all.
7. **Motion as feedback, not decoration.** Animations confirm state (progress fill, fade-in on reveal, pop-in on success). Duration range is 150–800 ms; anything longer is a loading indicator.
8. **Two fonts, two jobs.** `Space Grotesk` carries identity (headings, numbers, branded labels). `DM Sans` carries reading (body, inputs, descriptions). Never mix them inside a single text block.
9. **Portuguese (pt-BR) reference locale.** UI copy is direct, short, and sport-metaphor friendly ("Entrar na Arena", "Trilha", "Missão"). Placeholders use realistic training terms so layouts survive real content.

---

## 2. Design Tokens

### 2.1 Color — Dark Theme (`.theme-dark`)

| Token             | Value                               | Usage                                           |
|-------------------|-------------------------------------|-------------------------------------------------|
| `--bg`            | `#0B0E17`                           | App background, deepest surface                 |
| `--bg2`           | `#131825`                           | Topbar, sidebars, card surfaces                 |
| `--bg3`           | `#1C2235`                           | Inputs, secondary buttons, inset panels         |
| `--bg4`           | `#232B40`                           | Progress-bar tracks, scrollbar thumbs, chips    |
| `--bg5`           | `#2A3350`                           | Elevated inner surfaces (Dashboard only)        |
| `--border`        | `rgba(255,255,255,0.07)`            | Default 1 px divisions                          |
| `--border2`       | `rgba(255,255,255,0.12)`            | Interactive borders (inputs, buttons)           |
| `--border3`       | `rgba(255,255,255,0.22)`            | Hover / emphasized borders (auth forms)         |
| `--text`          | `#E8EAF0`                           | Primary text                                    |
| `--text2`         | `#8B92A8`                           | Secondary text, descriptions                    |
| `--text3`         | `#5C6480`                           | Tertiary text, meta, placeholders               |
| `--accent`        | `oklch(0.74 0.19 52)` — amber       | Primary brand / XP / CTAs / current state       |
| `--accent2`       | `oklch(0.65 0.16 240)` — blue       | Level progression, weekly stats                 |
| `--accent3`       | `oklch(0.68 0.17 150)` — green      | Success / "done" state                          |
| `--accent4`       | `oklch(0.68 0.17 320)` — magenta    | Streak / rare accent (Dashboard)                |
| `--accent-glow`   | `oklch(0.74 0.19 52 / 0.18)`        | Tinted backdrops behind accent content          |
| `--accent2-glow`  | `oklch(0.65 0.16 240 / 0.15)`       | Tinted backdrops for blue accent                |
| `--error`         | `oklch(0.65 0.22 15)`               | Form errors, destructive hover                  |
| `--error-bg`      | `oklch(0.65 0.22 15 / 0.12)`        | Error field halo                                |
| `--card-shadow`   | `0 4px 24px rgba(0,0,0,0.4)`        | Elevated cards                                  |
| `--shadow`        | `0 4px 24px rgba(0,0,0,0.4)`        | Generic raised container                        |
| `--shadow-sm`     | `0 2px 8px rgba(0,0,0,0.3)`         | Stat cards, section cards                       |
| `--sidebar-glow`  | `inset -1px 0 0 rgba(255,255,255,0.05)` | Sidebar right edge                          |

### 2.2 Color — Light Theme (`.theme-light`)

| Token             | Value                               |
|-------------------|-------------------------------------|
| `--bg`            | `#F0EEE8`                           |
| `--bg2`           | `#FAFAF8`                           |
| `--bg3`           | `#F5F3EF`                           |
| `--bg4`           | `#EAE8E0`                           |
| `--bg5`           | `#E0DDD5`                           |
| `--border`        | `rgba(0,0,0,0.08)`                  |
| `--border2`       | `rgba(0,0,0,0.14)`                  |
| `--text`          | `#1A1C26`                           |
| `--text2`         | `#5C6070`                           |
| `--text3`         | `#9298A8`                           |
| `--accent`        | `oklch(0.60 0.19 52)`               |
| `--accent2`       | `oklch(0.45 0.16 240)`              |
| `--accent3`       | `oklch(0.48 0.17 150)`              |
| `--accent4`       | `oklch(0.50 0.17 320)`              |
| `--accent-glow`   | `oklch(0.60 0.19 52 / 0.12–0.15)`   |
| `--card-shadow`   | `0 2px 16px rgba(0,0,0,0.08)`       |
| `--shadow-sm`     | `0 1px 4px rgba(0,0,0,0.06)`        |
| `--sidebar-glow`  | `inset -1px 0 0 rgba(0,0,0,0.06)`   |

### 2.3 Radius Scale

| Token (proposed) | Value   | Where                                                |
|------------------|---------|------------------------------------------------------|
| `radius-xs`      | 3–4 px  | Progress-mini bars, scrollbar thumbs, day pips       |
| `radius-sm`      | 6 px    | Logo mark, small dots, tiny icons                    |
| `radius-md`      | 7–10 px | Inputs, nav links, buttons, role options, chips      |
| `radius-lg`      | 12 px   | Section cards, tabs wrappers, task items, badge cards|
| `radius-xl`      | 14–16 px| Stat cards, subtopic cards, mission cards, roadmap   |
| `radius-pill`    | 20 px   | Role pill, XP pill, badge chips, tag pills           |
| `radius-full`    | 50 %    | Avatars, status dots, progress thumbs                |

### 2.4 Shadow Tokens

| Token              | Value                                                                   | Where                         |
|--------------------|-------------------------------------------------------------------------|-------------------------------|
| `shadow-sm`        | dark `0 2px 8px rgba(0,0,0,0.3)` · light `0 1px 4px rgba(0,0,0,0.06)` | Stat cards, section cards     |
| `shadow`           | dark `0 4px 24px rgba(0,0,0,0.4)` · light `0 2px 16px rgba(0,0,0,0.08)` | Subtopic, mission, dialog   |
| `shadow-xl`        | `0 8px 40px rgba(0,0,0,0.4)`                                            | Floating panels (Tweaks)      |
| `shadow-cta`       | `0 4px 20px oklch(0.74 0.19 52 / 0.35)`                                 | Primary buttons resting state |
| `shadow-cta-hover` | `0 6px 28px oklch(0.74 0.19 52 / 0.45)`                                 | Primary buttons on hover      |
| Focus ring         | `0 0 0 3px oklch(0.74 0.19 52 / 0.12)`                                  | Focused inputs                |
| Halo (roadmap)     | `0 0 0 6–12px oklch(... / 0.08–0.15)`                                   | Roadmap nodes, play buttons   |

### 2.5 Motion

| Duration / Curve                             | Where                                                      |
|----------------------------------------------|------------------------------------------------------------|
| 150 ms `ease`                                | Hover background swaps on rows (`topic-row`, `task-item`)  |
| 200 ms                                       | Default button/hover transitions                           |
| 220 ms                                       | Primary buttons, card border-color changes                 |
| 300 ms                                       | Theme switch (`background`, `color`)                       |
| 400–800 ms `ease`                            | Progress fills, XP bar, weekly bar                         |
| 350–400 ms                                   | `fadeUp` / `fadeSlideIn` content reveal                    |
| 500 ms `cubic-bezier(0.34, 1.56, 0.64, 1)`   | `popIn` success icon                                       |
| 1000 ms+                                     | Roadmap connector fill, shimmer on loading buttons         |

Stagger rule: sequential cards use `animation-delay: ${index * 60}ms`.

### 2.6 Iconography

- Inline SVG, `stroke="currentColor"`, `stroke-width: 1.1–1.5`.
- Two size bands: **10–12 px** (inside chips / meta rows) and **14–18 px** (buttons, topbar, form inputs).
- `stroke-linecap: round; stroke-linejoin: round` by default.
- Category emojis (🏋️ ⚡ 🫀 🎯 🧠 🏆 🔥 ❤️‍) are part of the design, not decoration — they encode topic identity.

---

## 3. Naming Conventions

### 3.1 CSS custom properties

- **Surfaces** — `--bg`, `--bg2`, `--bg3`, `--bg4`, `--bg5` (ascending number = more elevated / lighter in dark).
- **Borders** — `--border`, `--border2`, `--border3` (ascending = more emphasis).
- **Text** — `--text`, `--text2`, `--text3` (ascending = less emphasis).
- **Accents** — `--accent`, `--accent2`, `--accent3`, `--accent4`, plus `--{name}-glow` for tinted backdrops.
- **Semantic** — `--error`, `--error-bg`. Reserve `--success-bg`, `--warning`, `--warning-bg` for future additions; do not repurpose `--accent3`.

### 3.2 Component class names

Pattern: `kebab-case` domain blocks with short modifiers.

- **Block** — `topic-row`, `subtopic-card`, `stat-card`, `section-card`, `mission-card`, `task-item`.
- **Element** — `{block}-{element}` — `topic-header-icon`, `sc-header`, `sc-number`, `rs-sub-item`.
- **Modifier** — appended as a separate class: `.topic-row.active`, `.subtopic-card.done`, `.task-item.completed`, `.rt-node.locked`.
- **Canonical status modifiers** — `.done`, `.inprog`, `.locked` (progress), `.active` / `.current` (selection), `.earned` / `.locked` (badges), `.checked` (checkboxes).

Short prefixes in use — keep them when porting to React:

| Prefix | Meaning                                   |
|--------|-------------------------------------------|
| `sc-`  | stat-card / section-card / subtopic-card  |
| `rs-`  | right-sidebar (TopicDetail)               |
| `rt-`  | roadmap-topic (Dashboard)                 |
| `vi-`  | video-item                                |
| `wt-`  | weekly-task                               |
| `tp-`  | topic-progress                            |
| `gp-`  | global-progress                           |
| `bc-`  | breadcrumb                                |
| `bg-`  | background geometry (Login)               |
| `tw-`  | tweaks panel (Content dev-mode)           |

### 3.3 Theme activation

- Themes are activated by adding `.theme-dark` / `.theme-light` on the root app container — never on `:root` (Login is the lone exception because it ships dark-only).
- In Next.js, place the class on `<html>` or the top-level layout component.

### 3.4 State persistence

User preferences persist to `localStorage` with the `aq_` prefix:

- `aq_theme` — `'dark' | 'light'`
- `aq_role` — `'participant' | 'instructor'`
- `aq_topic` — selected topic id
- `aq_open` — JSON array of open topic ids

Keep the prefix to avoid collisions with other apps on the same origin.

---

## 4. Spacing & Layout

### 4.1 Spacing scale

Observed values form a consistent 2-px-based progression (maps cleanly to Tailwind's 4 px base):

```
2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 28 · 32 · 40 · 48 · 56 · 60 · 64
```

- **Most common gaps:** `6`, `8`, `10`, `12`, `16`, `20`, `24`.
- **Most common card paddings:** `14 16`, `16 20`, `18 22`, `20 22`, `20 24`.

### 4.2 Layout skeleton

| Region                          | Spec                                                                                                               |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------|
| **Topbar**                      | `height: 56px; padding: 0 24px; background: var(--bg2); border-bottom: 1px solid var(--border); z-index: 10;`     |
| **Left sidebar** (Content)      | `width: 280px; min-width: 280px; background: var(--bg2); box-shadow: var(--sidebar-glow);`                         |
| **Right sidebar** (TopicDetail) | `width: 272px; min-width: 272px; background: var(--bg2); border-left: 1px solid var(--border);`                    |
| **Auth right panel** (Login)    | `width: 480px; min-width: 480px; padding: 40px 48px; background: var(--bg2); border-left: 1px solid var(--border);`|
| **Auth left panel** (Login)     | `flex: 1; max-width: 520px; padding: 60px 64px;`                                                                   |
| **Main scroll column**          | `flex: 1; overflow-y: auto; padding: 28–32px 32–40px;`                                                             |
| **Dashboard body-scroll**       | `padding: 28px 32px 40px; gap: 24px; flex-direction: column;`                                                      |

### 4.3 Grids

| Grid                        | Template                                                          |
|-----------------------------|-------------------------------------------------------------------|
| Dashboard stats row         | `grid-template-columns: 1fr 1fr 1fr; gap: 16px;`                 |
| Dashboard main grid         | `grid-template-columns: 1fr 340px; gap: 20px;`                   |
| Files grid (TopicDetail)    | `repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;`               |
| Badges grid (Dashboard)     | `repeat(auto-fill, minmax(100px, 1fr)); gap: 12px;`               |
| Photos grid (TopicDetail)   | `repeat(3, 1fr); gap: 8px;` (first child spans 2, aspect 16/9)   |
| Form field row (Login)      | `grid-template-columns: 1fr 1fr; gap: 12px;`                     |
| Role select (Login)         | `grid-template-columns: 1fr 1fr; gap: 10px;`                     |

### 4.4 Scrollbars

All overflow containers use:

```css
::-webkit-scrollbar        { width: 4–5px; height: 4px; }
::-webkit-scrollbar-track  { background: transparent; }
::-webkit-scrollbar-thumb  { background: var(--bg4); border-radius: 4px; }
```

### 4.5 Z-index layers

| Layer                             | z-index                        |
|-----------------------------------|--------------------------------|
| Background geometry (Login orbs)  | 0 (with `pointer-events: none`)|
| Default content                   | 1                              |
| Topbar                            | 10                             |
| Tweaks panel / floating tools     | 1000                           |

### 4.6 Progress-bar heights (observed)

| Height | Where                                                       |
|--------|-------------------------------------------------------------|
| 3 px   | `topic-progress-mini`, `rs-sub-bar`, `mission-prog-bar`     |
| 4 px   | Daily tasks bar, weekly bar, `wt-bar`                       |
| 5 px   | Subtopic card bar (`sc-bar`), day pip, `week-bar`           |
| 6 px   | Global progress (sidebar), horizontal progress rows         |
| 8 px   | XP bar (Dashboard stat card)                                |
| 10 px  | Topic progress (Content main view)                          |

---

## 5. Typography

### 5.1 Families & weights

- `'Space Grotesk', sans-serif` — display, numbers, branded labels. Weights **300 / 400 / 500 / 600 / 700**.
- `'DM Sans', sans-serif` — body, inputs, descriptions. Weights **300 / 400 / 500 / 600**.

### 5.2 Type scale

| Role            | Size  | Weight | Family        | Where                                                        |
|-----------------|-------|--------|---------------|--------------------------------------------------------------|
| `display-hero`  | 38 px | 700    | Space Grotesk | Login hero h1 (`letter-spacing: -1px`)                       |
| `display-lg`    | 28 px | 700    | Space Grotesk | Topic header h1 (`-0.5px`)                                   |
| `display-md`    | 26 px | 700    | Space Grotesk | Subtopic detail title (`-0.5px`)                             |
| `display-sm`    | 22 px | 700    | Space Grotesk | Dashboard greeting, form heading (`-0.3px`)                  |
| `numeric-xl`    | 42 px | 700    | Space Grotesk | Streak count                                                 |
| `numeric-lg`    | 36 px | 700    | Space Grotesk | Level number, ranking position                               |
| `numeric-md`    | 22 px | 700    | Space Grotesk | Topic stat boxes (`.stat-box .num`)                          |
| `title`         | 16 px | 700    | Space Grotesk | Logo name (`-0.3px`)                                         |
| `section-title` | 13 px | 600    | Space Grotesk | `.section-title`, `.sc-name`, card titles                    |
| `eyebrow`       | 11 px | 600    | Space Grotesk | Uppercase labels (`letter-spacing: 1–1.2px`, `var(--text3)`) |
| `body`          | 13 px | 400    | DM Sans       | Default paragraph, tab labels                                |
| `body-sm`       | 12 px | 400    | DM Sans       | Meta, nav links, chips                                       |
| `caption`       | 11 px | 400    | DM Sans       | Status labels, hints                                         |
| `micro`         | 10 px | 500    | DM Sans       | Tiny counters, pip captions                                  |
| `input`         | 14 px | 400    | DM Sans       | Form inputs, submit buttons                                  |
| `button-cta`    | 15 px | 700    | Space Grotesk | Primary CTAs (Login "Entrar na Arena")                       |

### 5.3 Letter-spacing

- Display sizes ≥ 26 px → **negative tracking** `-0.3px` to `-1px`.
- Uppercase eyebrows → **positive tracking** `+0.5px` to `+1.2px`.
- Buttons / labels → default or `+0.2–0.3px`.

### 5.4 Line-height & wrapping

- Body paragraphs: `line-height: 1.5–1.6`, `text-wrap: pretty`.
- Paragraphs > 3 lines cap `max-width: 500–520px`.
- Single-line truncation: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
- Multi-line clamps are **not** present in the wireframes — introduce only with explicit `-webkit-line-clamp`.

### 5.5 Usage rules

1. **Headings** → Space Grotesk 700 with negative tracking. Never bold body text as a faux heading.
2. **Score-like numbers** (XP, level, streak, ranking, in-progress percentages) → Space Grotesk regardless of context. This is what gives the product its scoreboard feel.
3. **Eyebrows** open every section block: Space Grotesk 11 px 600, uppercase, `letter-spacing: 1–1.2px`, `color: var(--text3)`.
4. **Inputs** use `caret-color: var(--accent)`; placeholders use `var(--text3)`.
5. **Completed tasks** may use `text-decoration: line-through; color: var(--text3);`.
6. **Brand wordmark** ("Arena**Quest**") always splits with the second half in `var(--accent)`.

---

## 6. Rules

### 6.1 Color

- ✅ Use the accent triad semantically: **amber = current/primary**, **blue = progression/level**, **green = success/done**.
- ✅ Derive every UI color from tokens — no raw hex literals in product code.
- ✅ Tinted backgrounds go through `oklch(... / alpha)`, not `rgba()`.
- ✅ Primary buttons keep the `#0B0E17` text on amber combo — it's intentional and passes contrast.
- ❌ Don't use `--bg` (deepest) for card surfaces. Cards live on `--bg2`. `--bg3` / `--bg4` are for insets *inside* a card.
- ❌ Don't invent new hex values for hover/focus. Step through the `--bgN` / `--borderN` scales instead.

### 6.2 Borders & surfaces

- ✅ Default card = `background: var(--bg2); border: 1px solid var(--border); border-radius: 14–16px;`.
- ✅ On hover, escalate border to `var(--border2)` and optionally `translateX(3px)` or `translateY(-2px)`.
- ✅ One `shadow-sm` per card at rest. Use the heavier `shadow` only when an element should visually lift (hovered subtopic card, mission card, floating dialog).
- ❌ Don't stack multiple shadows on the same surface.
- ❌ Don't animate `box-shadow` on large surfaces — animate `opacity` or `transform` instead.

### 6.3 Status system

Every progressable card carries two signals:

1. **Left accent strip** — 4 px wide, `border-radius: 4px 0 0 4px`, invisible at rest, appears on hover / `active` / `done`.
2. **Right status cluster** — percentage + thin progress bar + pill.

Status pill styling:

| Status    | Background                    | Text color       |
|-----------|-------------------------------|------------------|
| `.done`   | `oklch(0.68 0.17 150 / 0.15)` | `var(--accent3)` |
| `.inprog` | `var(--accent-glow)`          | `var(--accent)`  |
| `.locked` | `var(--bg4)`                  | `var(--text3)`   |

❌ Don't add a 4th status. If you need "skipped", "pending", or "archived", map it to one of the three or open a design discussion.

### 6.4 Interaction

- ✅ Primary button: `background: var(--accent); color: #0B0E17; box-shadow: 0 4px 20px oklch(0.74 0.19 52 / 0.35);` + `transform: translateY(-1px)` on hover.
- ✅ Secondary button: `background: var(--bg3); border: 1px solid var(--border2); color: var(--text2);` — hover lifts border to `var(--accent)` and text color to `var(--accent)`.
- ✅ Icon-only actions (edit, delete, theme, notif): 28–36 px square, `border-radius: 7–8px`, `border: 1px solid var(--border2)`. Destructive hover uses `oklch(0.65 0.22 15)`.
- ✅ Row hover (`.topic-row`, `.task-item`, `.rs-sub-item`): background swap to `var(--bg3)` in 150 ms.
- ✅ Active row marker: 3 px left bar in `var(--accent)` with `border-radius: 0 2px 2px 0` + `background: var(--accent-glow)`.

### 6.5 Motion

- ✅ Animate `width` on progress fills, `transform: translateY` or `translateX` on reveals, `opacity` on fades.
- ✅ Stagger sibling cards with `animation-delay: ${index * 60}ms` using `fadeSlideIn` (0.3–0.4 s).
- ✅ Success pop-ins use `cubic-bezier(0.34, 1.56, 0.64, 1)` over 500 ms.
- ❌ Don't auto-play video or marquee text.
- ❌ Don't animate `background` or `box-shadow` on large surfaces.
- ❌ Don't exceed 800 ms except for loading shimmers and roadmap connector fills.

### 6.6 Forms

- ✅ Inputs are 40–44 px tall. With a leading icon: `padding: 11px 16px 11px 40px`, icon at `position: absolute; left: 13px; color: var(--text3);` turning `var(--accent)` on `focus-within`.
- ✅ Error state: `border-color: var(--error); box-shadow: 0 0 0 3px var(--error-bg);` plus a `field-error` row with `AlertIcon` + 11 px error text.
- ✅ Focus state: `border-color: var(--accent); box-shadow: 0 0 0 3px oklch(0.74 0.19 52 / 0.12);`.
- ✅ Checkboxes: 18 px square, `border-radius: 5px`, `background: var(--bg3)` → `var(--accent)` when checked with a white check icon.
- ✅ Step indicator: numbered 28 px circles connected by 1 px lines; completed steps switch to `var(--accent)` and replace the number with a check icon.
- ✅ Password strength meter: 4 equal bars; colors in order `var(--error)` → `accent` → `accent2` → `accent3`.
- ❌ Don't use native browser controls. Every input / checkbox / radio / select must be restyled to match the token system.

### 6.7 Gamification components

- **XP pill** — `padding: 4px 10px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 20px; color: var(--accent); font-weight: 600;` with a leading 6 px dot in `var(--accent)`.
- **Badge chip (earned)** — `background: var(--accent-glow); border-color: var(--accent); color: var(--accent);`.
- **Badge chip (locked)** — same geometry, `opacity: 0.5`, trailing 🔒.
- **Day pip** (streak) — 28 × 5 px, `border-radius: 5px`. Default `var(--bg4)`; `.done` → `var(--accent)`; today adds `box-shadow: 0 0 6px var(--accent)`.
- **Roadmap node** — 56 × 56 px, `border-radius: 16px`, 2 px border.
  - `.done` — `accent3` border + `accent3 / 0.15` bg + 6 px halo.
  - `.active` — `accent` border + `accent-glow` bg + 8 px halo.
  - `.locked` — `opacity: 0.4; filter: grayscale(0.5);`.
- **Mission card** — gradient background (`linear-gradient(135deg, #1a1a0a 0%, #2a2510 100%)` pattern), 14 × 16 padding, 4 px progress strip at the bottom, status tag pill top-right.
- **Avatar** — 32 px circle (26 px in reply context), `linear-gradient(135deg, var(--accent), var(--accent2))`, Space Grotesk 700 initials in white.

### 6.8 Content

- Language: **Portuguese (pt-BR)** is the reference locale; keep copy keys structured for future i18n but author UI in pt-BR first.
- Never ship Lorem ipsum — use realistic sport/training terms so layouts survive real content.
- Dates: abbreviated locale format ("Sábado, 19 Abr") plus week context ("Semana 16 · 2026") where temporal framing matters.
- Copy tone: direct, short, sport-metaphor friendly ("Entrar na Arena", "Desbloqueado", "Trilha", "Missão").

### 6.9 Accessibility (must-fix before launch)

The wireframes focus on visual fidelity — the production app must add:

- Visible `:focus-visible` rings on every interactive element (use the 3 px accent-glow ring).
- `aria-label` on icon-only buttons (theme toggle, notifications, edit, delete, like, reply, video item, nav arrows).
- `role="progressbar"` with `aria-valuenow/min/max` on every progress bar.
- `prefers-reduced-motion` guard that disables `fadeUp`, `fadeSlideIn`, `popIn`, and `shimmer`.
- Minimum text contrast: `text2` on `bg2` passes AA in dark theme; verify each pair in light theme before shipping.
- Keyboard navigation for sidebar tree (arrow keys expand/collapse), media tabs, and roadmap nodes.
- Semantic landmarks — `<header>`, `<nav>`, `<main>`, `<aside>` — mapped to topbar, nav, main column, sidebars.
