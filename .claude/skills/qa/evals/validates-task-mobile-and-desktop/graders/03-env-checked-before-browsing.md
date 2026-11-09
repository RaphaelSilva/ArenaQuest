---
type: llm
focus: trace
weight: 1
---

qa-env.mjs (or an equivalent read-only check of .envs.test and the two local servers) runs before any browser navigation, and no file under apps/ or packages/ is edited.
