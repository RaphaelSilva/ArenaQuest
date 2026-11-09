---
tags: [qa]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Write, Bash]
---

qa: check that an admin can still reset a user's password from /admin/users/<id> after yesterday's auth change. Use whatever admin account the project has, the seed one is fine.
