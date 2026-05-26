# **Product Vision: ArenaQuest**

This document describes the target audience, product positioning, and the strategic evolution roadmap for **ArenaQuest**.

---

## **1. Introduction**

ArenaQuest is an open-source, cloud-agnostic platform designed to gamify physical activities and sports engagement. 

The portal serves as a centralized hub for knowledge management, progress tracking, and user engagement, bridging the gap between physical effort and digital rewards.

---

## **2. Target Audience**

* **Athletes & Participants:** Individuals looking to track their progress and engage in gamified sports activities or structured training paths.
* **Instructors, Coaches & Admins:** Content creators and managers who organize topics, design challenges, and monitor user evolution.
* **Developers & Contributors:** Technical contributors seeking a highly modular, cloud-agnostic, and clean Ports & Adapters architecture to build upon.

---

## **3. Core Value Proposition**

* **Engagement Engine:** Transforms standard learning or training tasks into interactive, stage-gated milestones.
* **Cloud-Agnostic Infrastructure:** Built using modern tools (Next.js, Tailwind CSS, Turborepo, Cloudflare Workers) and structured to deploy on any provider without rewrite.
* **Modular Knowledge Management:** Advanced hierarchical organization of content to ensure a smooth, customizable training curve.

---

## **4. Key Features**

* **Hierarchical Content Management:** Advanced organization of topics and subtopics (Nodes).
* **Gamification Engine:** Integration of tasks and stages with progress indicators.
* **Student/Participant Area:** Personalized, responsive dashboard for tracking activities and achievements.
* **Administrative Backoffice:** Complete control over users, permissions (RBAC), and content mappings.

---

## **5. Strategic Roadmap (Milestones)**

To track our exact progress, each phase maps to a dedicated milestone folder:

* **[Milestone 1: Foundation & Infrastructure](file:///home/my-ubuntu/projects/ArenaQuest/docs/product/milestones/1/milestone.md)**
  * Monorepo setup, Turborepo pipeline, CI/CD configuration, and core agnostic architecture interfaces.
* **[Milestone 2: Auth & Identity](file:///home/my-ubuntu/projects/ArenaQuest/docs/product/milestones/2/milestone.md)**
  * JWT-based authentication and base RBAC (Roles) implementation.
* **[Milestone 3: Content & Media Core](file:///home/my-ubuntu/projects/ArenaQuest/docs/product/milestones/3/milestone.md)**
  * Tree structure implementation and swappable Object Storage adapter integration.
* **[Milestone 4: Task Engine](file:///home/my-ubuntu/projects/ArenaQuest/docs/product/milestones/4/milestone.md)**
  * Implementation of the task and stages engagement logic.
* **[Milestone 5: Participant Experience](file:///home/my-ubuntu/projects/ArenaQuest/docs/product/milestones/5/milestone.md)**
  * Launch of the mobile-friendly student portal with progress indicators.
* **[Milestone 6: Portability & Launch](file:///home/my-ubuntu/projects/ArenaQuest/docs/product/milestones/6/milestone.md)**
  * Agnosticism proofs, provider-swap validation tests, and initial release.
