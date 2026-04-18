
# **Specification Document and Project Plan**

## **Engagement Portal and Knowledge Management**

**Date:** April 2026

**Status:** Phase 1 - Planning

**Objective:** Develop a gamified and modular platform for hierarchical topic management, interconnected learning paths, and user progress tracking, built on a 100% Cloud-Agnostic architecture.

## **1. Functional Specification**

The platform is divided into 4 main functional pillars:

### **1.1. Topic and Content Management (Hierarchical)**

* **Tree Structure (Nodes):** The system does not technically distinguish between a "Topic" and a "Subtopic". It is a tree structure where a parent node can have multiple child nodes, inheriting or extending characteristics.
* **Attached Media:** Each topic/subtopic can contain rich media (MP4 videos, PDF documents, Markdown texts).
* **Metadata:** Tags, authors, estimated consumption time, and prerequisites.

### **1.2. Engagement Engine (Tasks and Stages)**

* **Interdisciplinary Tasks:** Ability to create tasks/challenges that require knowledge or interaction with multiple topics/subtopics simultaneously.
* **Completion Stages (Milestones):** Tasks are not just "Open/Closed". They have validation steps (e.g., 1. Reading, 2. Practice, 3. Peer Review, 4. Completion).
* **Rewards (Future):** Basis for a badge or points system based on stage completion.

### **1.3. Participant/Student Area**

* **Progress Dashboard:** Visual overview (progress bars, radial charts) showing progress in different topics and active tasks.
* **Content Consumption:** Clean and focused interface for reading Markdown, viewing PDFs, and embedded video player.
* **Interaction:** Check-ins on task stages.

### **1.4. Administrative Area (Backoffice)**

* **Access Management (RBAC):** Permission control (Admin, Content Creator, Tutor, Student).
* **Member Allocation:** Ability to enroll students in specific topics or release entire paths.
* **Monitoring:** Management view of overall engagement and learning bottlenecks.

## **2. Technical Architecture and Stack (Cloud-Agnostic Strategy)**

To ensure portability between providers (AWS, Google, Cloudflare, etc.), the back-end will use the **Adapter Pattern**. No provider-specific cloud libraries (e.g., aws-sdk) will leak into the business logic layer.

### **2.1. Front-End (Presentation)**

* **Technology:** React or Vue.js (frameworks like Next.js or Nuxt.js configured for static export/SSG or Edge Rendering).
* **Target Hosting:** Cloudflare Pages, Vercel, Netlify, or Firebase Hosting.

### **2.2. Back-End (Logic and APIs)**

* **Technology:** Node.js (TypeScript) focused on lightweight functions (Serverless).
* **Target Deployment:** Cloudflare Workers (preferred for latency/edge), AWS Lambda, Google Cloud Functions, or Digital Ocean Functions.

### **2.3. Database (Flexible Persistence)**

* **Approach:** NoSQL or Relational with robust JSON support (to facilitate hierarchical structure and flexible task schemas).
* **Options Supported via Interface:**
  * *Document:* MongoDB Atlas, Cloud Firestore, Amazon DynamoDB.
  * *Relational JSON:* PostgreSQL (via Supabase, RDS, or Neon) using JSONB columns.

### **2.4. Media Storage (Object Storage)**

* **Approach:** S3 protocol compatibility. The system will use Presigned URLs for direct client-to-bucket uploads, reducing traffic on serverless functions.
* **Supported Options:** Cloudflare R2 (zero egress cost), AWS S3, Backblaze B2, Wasabi, DigitalOcean Spaces, GCS.

## **3. Initial Data Modeling (Conceptual)**

* **User**: Profile data, role, and settings.
* **TopicNode**: ID, ParentID (null if root), Title, Content (Markdown), Array of MediaURLs, Order.
* **Task**: ID, Title, Description, Array of LinkedTopicIDs (multi-technical link), Array of Stages (completion stages).
* **UserProgress**: Complex relationship. Tracking TopicNodeID vs Status, and TaskID vs CurrentStage.

## **4. Execution Plan (Phased Roadmap)**

### **Phase 1: Foundation and Infrastructure (Milestone 1)**

* [x] Definition of the exact stack for the MVP (Suggestion: Next.js + Cloudflare Workers + [https://neon.com/](https://neon.com/) or Supabase + Cloudflare R2).
* [x] Repository creation (Monorepo or separate Front/Back).
* [x] Agnostic CI/CD configuration (e.g., GitHub Actions).
* [x] Creation of Interfaces (Contracts) for Storage and Database in the backend.

### **Phase 2: Authentication and User Management (Milestone 2)**

* [ ] Authentication system implementation (Generic JWT or independent provider like Auth0/Clerk, or custom auth in DB).
* [ ] Basic RBAC (Roles) implementation.
* [ ] Administrative Panel: User CRUD.

### **Phase 3: Content Core - Topics and Media (Milestone 3)**

* [ ] Implementation of Topic/Subtopic tree structure in the database.
* [ ] Development of the Storage Adapter (PDF, MP4 Upload/Download).
* [ ] Admin Panel: Knowledge tree creation and attachment upload.
* [ ] Front-end: Markdown viewer and media player.

### **Phase 4: Task Engine and Interconnection (Milestone 4)**

* [ ] Task CRUD in Admin.
* [ ] Linking system: Connect 1 task to N Topics/Subtopics.
* [ ] Definition of completion Stage logic.

### **Phase 5: Engagement and Student Progress (Milestone 5)**

* [ ] Student Dashboard: UX/UI for visualizing pending tasks and stages.
* [ ] Stage check-in logic.
* [ ] Progress calculation (Completion percentage of the tree and tasks).
* [ ] Access management: Admin releasing topics for specific students.

### **Phase 6: Portability Testing and Launch (Milestone 6)**

* [ ] Load and security testing.
* [ ] **Agnosticism Proof:** Deploy a staging environment using different providers from the initial stack (e.g., swap MongoDB for Postgres+JSON, and R2 for AWS S3) in less than 1 hour by changing only variables and injecting the correct adapter.
* [ ] Go-Live.