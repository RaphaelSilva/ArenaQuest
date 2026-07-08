# ArenaQuest Documentation Map

This map outlines the actual directory layout and purpose of all documents within the `docs/` folder:

```markdown
ArenaQuest/
├── docs/
│   ├── architecture/               # Technical architecture blueprints and guidelines
│   │   ├── api/                    # Specific backend (Worker) architecture guidelines
│   │   └── web/                    # Specific frontend (Next.js) architecture guidelines
│   │
│   ├── product/                    # Product vision, backlog and roadmap mapping
│   │   ├── mission.md              # Mission, pillars and core design mandates
│   │   ├── vision.md               # Vision, target audience and strategic milestones
│   │   │
│   │   ├── milestones/             # Active and completed milestone checklists
│   │   │   ├── 1/                  # Milestone 1 Task folder
│   │   │   └── ...                 # Successive Milestone folders
│   │   │
│   │   ├── RFCs/                   # Technical RFC specifications (e.g., OpenAPI, i18n)
│   │   └── backlog/                # Evolving epics and user stories
│   │
│   ├── scripts/                    # Scripts for document generation
│   ├── templates/                  # Templates for documentation files
│   └── imges/                      # Image assets for documentation
```

---

## Evolving and Maintaining Docs
* **Evergreen Guidance:** Maintain the high-level project goals in `docs/product/mission.md` and `docs/product/vision.md`.
* **Technical Blueprints:** Keep active patterns documented under `docs/architecture/`.
* **Feature Iterations:** Write specific RFCs under `docs/product/RFCs/` for new systems.