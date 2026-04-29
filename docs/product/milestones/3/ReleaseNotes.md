# Release Notes — Milestone 3: Content & Media Core

## Overview

Milestone 3 establishes the core content engine for ArenaQuest. It introduces a hierarchical topic management system, a robust media handling strategy using Cloudflare R2, and the primary user interfaces for both content creation (Admin) and consumption (Student).

## New Features

### 🌳 Hierarchical Topic Engine
- **Unlimited Depth:** Create complex educational structures with parent-child relationships.
- **Dynamic Organization:** Reorder and re-parent topics using an intuitive drag-and-drop interface in the Admin Dashboard.
- **Content Lifecycle:** Manage topics through `Draft`, `Published`, and `Archived` states to control visibility.
- **Metadata Management:** Support for tags, prerequisites, and estimated completion time per topic.

### 📁 Media & Storage System
- **Direct-to-Storage Uploads:** High-performance file uploads directly to Cloudflare R2 using presigned URLs, bypassing the API Worker for efficiency.
- **Diverse Media Support:** Native handling of PDFs, MP4 videos, and images (JPEG, PNG, WebP).
- **Secure Access:** Short-lived presigned download URLs ensure that media remains private and protected.
- **Lifecycle Tracking:** Media status tracking (`Pending` → `Ready` → `Deleted`) ensures content integrity.

### 🛡️ Security & Sanitization
- **Isomorphic Sanitization:** Centralized Markdown sanitization using `DOMPurify` on both backend (write-side) and frontend (render-side) to prevent XSS.
- **RBAC Enforcement:** Strict role-based access control for all admin and content creation endpoints.
- **Visibility Logic:** Automatic filtering to ensure students only see published content and ready media.

### 💻 User Interfaces
- **Admin Topic Tree Dashboard:** A premium, interactive workspace for content creators featuring a real-time tree view, inline editing, and a dedicated media uploader with progress tracking.
- **Student Catalogue:** A clean, responsive interface for students to browse the curriculum and consume content through specialized viewers for Markdown, PDF, and Video.

## Technical Improvements
- **Ports & Adapters:** Clean separation of concerns with `ITopicNodeRepository`, `IMediaRepository`, and `IStorageAdapter`.
- **Cloud-Agnostic Storage:** Concrete `R2StorageAdapter` implementation while keeping business logic storage-provider agnostic.
- **Database Migrations:** New D1 tables for `topic_nodes`, `tags`, `topic_node_tags`, `topic_node_prerequisites`, and `media`.

## Deferred Items
- **E2E Testing:** Playwright E2E scaffolding has been deferred to the Technical Debt phase following a UX review.
