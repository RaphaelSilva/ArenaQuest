# QA report — <scenario title>

- **Scenario:** <task file, wireframe, PR or sentence under test>
- **Build:** <branch> @ <short SHA>
- **Servers:** web <QA_WEB_URL> · api <QA_API_URL> (started by QA: yes/no)
- **Replica:** <untouched | reset with make db-reset-local>
- **Widths:** desktop 1280 px · Pixel 7 412 px (· iPad Mini 768 px)
- **Accounts used:** <role labels only, e.g. QA_ADMIN, QA_STUDENT>

## Acceptance criteria

| # | Criterion (quoted) | Desktop | Mobile | Note |
|---|---|---|---|---|
| 1 | … | ✅ | ✅ | |
| 2 | … | ✅ | ❌ | see SEV-2 below |
| 3 | … | ⏭ | ⏭ | QA_TUTOR_* blank in .envs.test |

## Defects

### [SEV-N] <short title>
- **Scenario:** <criterion number or reference>
- **Account:** <role label>
- **Width:** <desktop | Pixel 7 | iPad Mini>
- **Steps:**
  1. …
  2. …
- **Expected:** <quoted from the criterion or wireframe>
- **Actual:** <observed, with HTTP status if the API answered>
- **Evidence:** <screenshot path · console line · API log line · file:line>
- **Suspected area:** <path or subsystem, optional>

## Local state left behind

- <rows created or changed on the local replica, or "none">

## Hand-off

- <frontend-developer | backend-developer | write-backlog-task> for <defect(s)>
- Suggested E2E spec: <name>, if a scripted journey would have caught this

---

Severity scale: `SEV-1` blocks the flow · `SEV-2` breaks a criterion but has a
workaround · `SEV-3` cosmetic, copy or minor UX · `SEV-4` improvement suggestion.
