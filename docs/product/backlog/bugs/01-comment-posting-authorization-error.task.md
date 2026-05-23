# Task 01: Fix 403 Authorization Error When Posting Comments on Subtopics

## Metadata
- **Status:** 🔴 Open
- **Complexity:** Medium
- **Milestone:** Future Enhancement
- **Dependencies:** None (but may depend on enrollment logic verification)
- **Category:** Bugs / Authorization

---

## Summary

Users receive a `403 Forbidden` error ("Failed to post comment") when attempting to post comments on topic/subtopic pages, even though they have valid access to the content. The error occurs during the POST request to `/topics/:id/comments`, indicating an enrollment authorization check is failing incorrectly.

---

## Problem Statement

When a user navigates to a subtopic detail page and attempts to post a comment, the frontend sends a POST request to the API with:
- Correct topic ID (subtopic ID)
- Valid JWT authorization token
- Comment body in the request

However, the API responds with **HTTP 403 Forbidden** and an error message "Failed to post comment (403)".

**Current behavior:**
- User sees "Failed to post comment" error message
- Comment is not posted
- Error occurs in the browser console
- Issue appears to affect all comment submission attempts

**Expected behavior:**
- Comment is successfully posted to the API
- Response returns the created comment record with HTTP 201
- Comment appears in the discussion section immediately

---

## Architectural Context

### Cloud-Agnostic Approach
- Authorization/enrollment check uses the `IEnrollmentRepository` interface (`packages/shared/ports/i-enrollment-repository.ts`)
- Method `getEffectiveAccessTopicIds(userId)` retrieves all accessible topic IDs (direct grants + all descendants of granted subtrees)
- No provider-specific auth libraries; uses JWT + role-based checks

### Current Implementation
- **Route:** `apps/api/src/routes/comments.router.ts` (lines 24-32)
- **Controller:** `apps/api/src/controllers/comments.controller.ts` (lines 43-74)
- **Check:** Controller verifies `enrolledTopicIds.includes(topicNodeId)` at line 50
- **If check fails:** Returns `{ ok: false, status: 403, error: 'Forbidden' }`

### Possible Root Causes
1. **Enrollment data inconsistency** — User is enrolled in parent topic but not in the specific subtopic/topic being commented on
2. **Recursive enrollment bug** — `getEffectiveAccessTopicIds()` may not correctly compute descendants when a parent topic is granted
3. **Parameter mismatch** — Topic ID in the request URL does not match the ID in the enrolled topics list (e.g., wrong ID format or case sensitivity)
4. **Timing issue** — Enrollment is granted after the user opens the page, but the enrollment query runs before the grant is visible
5. **Cache staleness** — Enrollment cache (if any) returns stale data

---

## Technical Constraints

- **Authorization must remain strict** — Cannot weaken the 403 check; enrollment verification is a security requirement
- **Backward compatible** — No changes to the `ICommentRepository` or comment data model
- **Cloud-agnostic** — Solution must not introduce provider-specific enrollment logic
- **Performance** — Enrollment check is already O(grants + descendants); avoid introducing N+1 queries

---

## Scope

### Files to investigate:
1. `apps/api/src/routes/comments.router.ts` — Verify path parameter extraction and enrollment query
2. `apps/api/src/controllers/comments.controller.ts` — Verify enrollment check logic
3. `packages/shared/ports/i-enrollment-repository.ts` — Verify contract definition
4. `apps/api/src/adapters/db/d1-enrollment-repository.ts` — Verify `getEffectiveAccessTopicIds()` implementation (recursive CTE, descendants computation)
5. `apps/web/src/components/catalog/Comments.tsx` — Verify API call correctness (topic ID, headers, payload)
6. `apps/api/test/routes/comments.spec.ts` — Verify test coverage for enrollment checks

### What needs to be diagnosed:
- [ ] Verify the topic ID being sent from the frontend matches the ID in the enrollment system
- [ ] Verify `getEffectiveAccessTopicIds()` returns the comment topic ID when the user is enrolled in the parent
- [ ] Check if there are edge cases (e.g., archived topics, topic status transitions) that affect enrollment
- [ ] Review test coverage for enrollment-based 403 responses

### What does NOT change:
- Comment data model or schema
- Authentication (JWT) mechanism
- Response format for success/failure
- Other 403 checks in the system (tasks, topics, etc.)

---

## Acceptance Criteria

- [ ] User successfully posts a comment when enrolled in the topic
- [ ] Comment is stored in the database and visible to other users
- [ ] 403 error no longer occurs for enrolled users
- [ ] 403 error is still correctly returned for non-enrolled users (security maintained)
- [ ] Root cause of the enrollment check failure is identified and documented
- [ ] Enrollment logic is verified to correctly include all descendants of granted parent topics
- [ ] Frontend sends the correct topic ID in the API request
- [ ] Test coverage is added or updated to prevent regression
- [ ] `make lint` passes
- [ ] `make test` passes (including new/updated comment authorization tests)

---

## Verification Plan

### Diagnostic Tests (before fix)
1. **Enrollment check test:**
   - User is granted enrollment on parent topic (e.g., "Module 1")
   - Call `getEffectiveAccessTopicIds(userId)` and verify it includes all child subtopic IDs
   - Log the returned array and compare against the topic ID in the failing comment request

2. **API request inspection:**
   - In Comments.tsx, log the topic ID being sent: `console.log('Comment topic ID:', topicId)`
   - In comments.router.ts, log the received topic ID: `console.log('Received topic ID from URL:', c.req.param('id'))`
   - Compare the two in the test output

3. **Database query verification:**
   - Run the `getEffectiveAccessTopicIds(userId)` query directly against the D1 database
   - Verify the recursive CTE correctly expands parent grants to include all descendants

### Manual Testing (after fix)
1. **Happy path (enrolled user):**
   - Create a test user
   - Enroll the user in a parent topic via admin interface
   - Navigate to a subtopic detail page
   - Post a comment
   - Verify comment appears immediately and persists after refresh

2. **Security regression:**
   - Create a second user NOT enrolled in any topic
   - Attempt to post a comment on the same subtopic
   - Verify 403 Forbidden error is returned (security check still works)

3. **Parent-child enrollment:**
   - Enroll user in parent topic only (not direct child)
   - Verify comments work on child subtopics
   - Enroll user in child topic directly
   - Verify comments still work

4. **Edge cases:**
   - User enrolled in deep nested subtopic (3+ levels)
   - Verify comment posting works
   - User enrollment revoked after page loads
   - Verify comment posting fails appropriately
   - Topic status changed (published → archived)
   - Verify enrollment check respects topic status

### Automated Tests
1. Update or add tests in `apps/api/test/routes/comments.spec.ts`:
   - Test that enrolled user can create comment (200/201)
   - Test that non-enrolled user receives 403
   - Test that parent-topic enrollment grants access to child comments
   - Test edge case: user enrolled, then enrollment revoked mid-request

2. If `getEffectiveAccessTopicIds()` implementation is changed, add tests in the enrollment repository tests to verify:
   - Direct user grants are included
   - Group grants are included
   - All descendants of granted parent are included
   - Archived or unpublished topics are handled correctly

---

## Notes

- The comment feature is already partially implemented (M7 feature); this task addresses an authorization bug in the existing implementation
- The 403 error is the correct HTTP response code; the issue is that it's being returned incorrectly
- Enrollment logic is security-critical; any changes must be carefully tested to avoid information disclosure or unauthorized access
- Consider adding logging to help diagnose similar authorization issues in the future
