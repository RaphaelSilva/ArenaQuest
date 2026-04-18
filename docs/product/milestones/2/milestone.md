# Milestone 2: Authentication & User Management

This milestone focuses on securing the platform and implementing the structural layer for user identity, roles, and administrative control. It ensures that the "ArenaQuest" platform can distinguish between different types of participants and protect administrative actions.

## 1. Objectives
The success of this phase is defined by:
* **Secured Access:** A functional authentication system that issue and validates JWT tokens.
* **Role-Based Access Control (RBAC):** A working permission system that restricts access to the Administrative Backoffice.
* **User Lifecycle Management:** The ability to Create, Read, Update, and Delete (CRUD) users via an administrative interface.
* **Provider Independence:** Authentication logic must be independent of any specific cloud provider's auth service (e.g., using a generic JWT adapter).

## 2. Functional Requirements
* **Generic JWT Implementation:** Develop a core authentication logic using the Adapter Pattern to remain cloud-agnostic.
* **Login/Logout Flow:** Implementation of the backend endpoints and frontend forms for user authentication.
* **Role Management:** Definition of roles (Admin, Content Creator, Tutor, Student) in the database and code.
* **Admin Dashboard (User CRUD):** A basic UI for administrators to manage the member list and assign roles.
* **Route Protection:** Middleware implementation for both API (Hono) and Web (Next.js) to protect internal routes.

## 3. Acceptance Criteria
* [ ] Users can sign in and receive a valid JWT token.
* [ ] Protected API routes return `401 Unauthorized` without a valid token.
* [ ] The UI displays different navigation options based on the user's role (RBAC Validation).
* [ ] An Administrator can create a new user and assign them the "Student" role.
* [ ] An "Admin Only" page is inaccessible to users with the "Student" role.
* [ ] All auth secrets are managed via environment variables and never hardcoded.

## 4. Specific Stack
* **Auth Logic:** Generic JWT (JSON Web Tokens) using `jose` or `jsonwebtoken`.
* **Database Logic:** User entity modeling (relational or document via generic repository).
* **Frontend State:** Context API or specialized auth hooks in Next.js.
- **Middleware:** Edge-compatible middleware for Cloudflare Workers/Pages.
* **Security:** Hashing of passwords (e.g., using `bcryptjs` or a provider-agnostic native `SubtleCrypto` implementation).

## 5. Task Breakdown

| # | Task File | Status |
|---|-----------|--------|
| 01 | [User Repository (Port + D1 Adapter)](./01-implement-user-repository.task.md) | ⬜ Pending |
| 02 | [Seed Roles & RBAC Constants](./02-seed-roles-and-rbac-constants.task.md) | ⬜ Pending |
| 03 | [Auth Service (Login / Logout / Refresh)](./03-implement-auth-service.task.md) | ⬜ Pending |
| 04 | [Auth HTTP Endpoints (Hono Router)](./04-expose-auth-http-endpoints.task.md) | ⬜ Pending |
| 05 | [API Auth Middleware & Role Guard](./05-api-auth-middleware.task.md) | ⬜ Pending |
| 06 | [Admin User CRUD Endpoints](./06-admin-user-crud-endpoints.task.md) | ⬜ Pending |
| 07 | [Frontend Auth Context & Hooks](./07-frontend-auth-context-and-hooks.task.md) | ⬜ Pending |
| 08 | [Frontend Login Page & Route Middleware](./08-frontend-login-page-and-middleware.task.md) | ⬜ Pending |
| 09 | [RBAC Navigation & Admin Dashboard](./09-frontend-rbac-nav-and-admin-dashboard.task.md) | ⬜ Pending |
