# Task 11: E2E Scaffolding (Playwright Smoke Test)

## Metadata
- **Status:** ⏩ Deferred (Moved to Test Debt)
- **Complexity:** Medium
- **Milestone:** Backlog — Test Debt
- **Dependencies:** Task 08, Task 09, Task 10
- **Deferred Date:** 2026-04-29
- **Reason:** Postponed until after UX review to avoid test rework during design iterations.

---

## Summary

Establish an end-to-end testing framework using Playwright to ensure the core user journeys are protected across the entire stack. This task includes setting up the tooling, CI integration, and a primary "smoke test" covering the content authoring and consumption lifecycle.

---

## Architectural Context

- **Tooling:** Playwright for multi-browser E2E testing.
- **Location:** `e2e/` (Root-level workspace spanning API and Web).
- **Environment:** Orchestrated via `make e2e` targets, booting both the API and Web services.
- **CI/CD:** Integrated into GitHub Actions to run on every PR.

---

## Requirements

### 1. E2E Framework Setup

- **Workspace:** Initialize a dedicated workspace for E2E tests with standard configuration for TypeScript and Playwright.
- **Fixtures & Helpers:** Create reusable helpers for common actions like:
    - User authentication (Admin and Student).
    - API-based content seeding (creating topics, uploading media).
    - Page object navigation.

### 2. Core Smoke Test

- **Authoring-to-Consumption Journey:** Implement a reliable test that:
    1. Logs in as an Admin.
    2. Creates and publishes a topic with attached media (via the UI or API helpers).
    3. Logs in as a Student.
    4. Navigates to the catalogue and verifies the topic and its media are correctly displayed and accessible.

### 3. CI/CD Integration

- **Automated Workflow:** Configure a GitHub Action to run the E2E suite on every pull request.
- **Failure Artifacts:** Ensure that screenshots, videos, and Playwright traces are captured and uploaded as artifacts upon test failure for easier debugging.

---

## Acceptance Criteria

- [ ] Playwright is successfully integrated into the repository as a new workspace.
- [ ] `make e2e` runs the suite locally and passes consistently.
- [ ] The core smoke test covers the full content lifecycle (Admin → Student).
- [ ] CI workflow is active and correctly reports test status on PRs.
- [ ] Failure diagnostics (screenshots/traces) are automatically collected in CI.
- [ ] Documentation is updated to guide developers on running and adding E2E tests.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- Run the full suite locally: `make e2e`.
- Run the suite in a "headed" mode to visually verify the test steps.

### Manual Verification
- Deliberately break a UI element (e.g., a button ID or role) and confirm that:
    1. The E2E test fails as expected.
    2. A Playwright trace is generated with clear visual evidence of the failure.
- Verify the CI run on a test branch to ensure environment parity.
