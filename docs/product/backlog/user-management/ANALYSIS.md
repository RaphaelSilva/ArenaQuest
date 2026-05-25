# Product Analysis: Admin Password Reset Capability

**Requestor:** System Administrator  
**Date:** 2026-05-24  
**Status:** Requirements Analysis Complete → Ready for Implementation Planning

---

## 1. Executive Summary

**Request:** "Como admin do sistema eu deveria conseguir editar novas senhas para usuários assim caso algum usuário tenha problemas eu possa realizar a manutenção."

**Translation:** "As a system admin, I should be able to edit/set new passwords for users so that I can perform maintenance when a user has access issues."

**Recommendation:** ✅ **APPROVED for Backlog**

This is a **legitimate operational maintenance requirement** that extends the existing password management system. It's orthogonal to current milestone work and can be started independently.

---

## 2. Current State Analysis

### What We Have (Completed)
From **Milestone 2 & 6**, the system supports:
- ✅ User registration (self-service)
- ✅ User password reset via email link (self-service, `POST /auth/forgot-password`)
- ✅ User password change from Settings (self-service, `POST /account/change-password`)
- ✅ Admin user CRUD (list, create, edit roles, deactivate)
- ✅ Google OAuth social login (auto-provision users)
- ✅ Session management (JWT + refresh tokens)

### What's Missing
Currently, **admins have no way to directly reset a user's password**. Options are:
1. **User self-service:** User clicks "Forgot Password" → email reset link
2. **External:** Admin manually generates a password elsewhere and shares it (insecure)
3. **Database hack:** Admin directly updates database (unaudited, breaks security model)

**Use Cases Not Covered:**
- User's email is compromised → attacker intercepts reset emails
- User never received initial account setup email
- User claims inability to access email account
- Mass user provisioning → need to set initial passwords for multiple users
- Emergency access recovery → user account needs quick restoration

---

## 3. Proposed Solution

### Feature: Admin Password Reset

**What Admin Can Do:**
1. Navigate to any user's detail page in the admin panel
2. Click "Reset Password" button
3. Optionally include a note and toggle email notification
4. Receive a **generated temporary password**
5. Share password with user (via email or manually)
6. User logs in with temp password and changes it immediately

**Key Properties:**
- **Secure:** Cryptographically random password (16+ bytes, base62-encoded)
- **Auditable:** Every reset logged with admin ID, timestamp, target user
- **Session-aware:** All user's active sessions revoked (forced logout)
- **Email-integrated:** Optional notification with password + admin note
- **Role-protected:** Only admins can initiate; admins cannot reset own password

### How It Integrates with Existing System

```
Current User Password Flows:
├── Self-Service (User)
│   ├── Forgot Password email link (POST /auth/forgot-password)
│   └── Change Password from Settings (POST /account/change-password)
│
└── [NEW] Admin-Initiated (Maintenance)
    └── Admin Reset Password (POST /admin/users/:userId/reset-password)
```

**No Breaking Changes:**
- Existing self-service flows remain unchanged
- Reuses existing password hashing (PBKDF2 adapter)
- Reuses existing email infrastructure
- Reuses existing session revocation logic
- Additive API (new endpoint only)

---

## 4. Architecture Alignment

### Cloud-Agnostic ✅
- Uses existing `IAuthAdapter` for password hashing
- Uses existing email adapter (no new provider dependency)
- No provider-specific imports outside `apps/api/src/adapters/`
- Works with any backend (Cloudflare Workers, Lambda, etc.)

### Security-First ✅
- **Role Check:** Only `admin` role authorized
- **Self-Reset Prevention:** Admin cannot reset own password via this endpoint
- **Entropy:** Temporary password generated via `crypto.getRandomValues()`
- **Audit Trail:** All resets logged with metadata
- **Session Revocation:** Atomic with password update (no race conditions)
- **No Plaintext Storage:** Temp password shown once in response, never stored

### Test Coverage ✅
- API endpoint tests (happy path, error cases, authorization)
- Frontend modal tests (interaction, error handling, accessibility)
- Integration tests (end-to-end admin → reset → user login)

---

## 5. Scope Assessment

### In Scope
- ✅ Backend API endpoint with authorization checks
- ✅ Temporary password generation + hashing
- ✅ Email notification to user
- ✅ Session invalidation (all refresh tokens revoked)
- ✅ Audit logging
- ✅ Frontend: Admin panel Reset button + modal
- ✅ Comprehensive tests
- ✅ Error handling (403, 404, 422, 500)

### Explicitly Out of Scope
- ❌ Temporary password expiry enforcement (not in Milestone 6 either)
- ❌ Batch password resets for multiple users (future tooling)
- ❌ MFA reset (separate security concern)
- ❌ Integration with external identity providers' password systems (OAuth users have different flows)

### Impact Assessment
| Component | Impact | Effort |
|-----------|--------|--------|
| Backend API | New endpoint, reuse existing logic | 1-2 sessions |
| Frontend UI | New modal component, button integration | 1 session |
| Database | No schema changes (reuse existing tables) | None |
| Email | Reuse existing infrastructure | None |
| Testing | New test suites for endpoint + UI | 1 session |
| **Total** | Additive, no breaking changes | **3-4 sessions** |

---

## 6. Deliverables Created

### 1. User Story (Product Requirements)
**File:** `01-admin-password-reset.story.md`

Documents:
- Problem statement (why this matters)
- Acceptance criteria (how to know when it's done)
- Related capabilities (how it connects to existing features)
- Out of scope (what's intentionally excluded)

### 2. Implementation Task (Technical Specification)
**File:** `02-admin-password-reset-implementation.task.md`

Detailed breakdown including:
- 👤 Backend scope (endpoint spec, error handling, audit logging)
- 🎨 Frontend scope (modal component, integration points)
- ✅ Acceptance criteria (testable requirements)
- 🧪 Verification plan (manual & automated testing)
- ⚠️ Risk mitigation (what could go wrong & how to prevent it)
- 📖 Implementation notes (which files to touch, recommended order)

### 3. Backlog Organization
**File:** `README.md`

Folder-level documentation that organizes current + future user management features.

---

## 7. Recommendation & Next Steps

### Approval: ✅ APPROVED

This feature is:
- ✅ **Legitimate:** Addresses real operational needs
- ✅ **Aligned:** Extends existing password management (Milestone 6)
- ✅ **Feasible:** Reuses existing infrastructure, no new provider dependencies
- ✅ **Secure:** Clear authorization model, audit logging, session management
- ✅ **Testable:** Comprehensive test coverage possible
- ✅ **Non-blocking:** Can be started anytime without blocking other work

### Suggested Timeline

**When to Start:**
- After Milestone 7 begins OR
- In parallel with ongoing Milestone 7 work (independent scope)
- **Estimated duration:** 3-4 development sessions (1 full developer week)

**Implementation Flow:**
1. Review `01-admin-password-reset.story.md` → align on requirements
2. Review `02-admin-password-reset-implementation.task.md` → technical deep-dive
3. Create feature branch: `feature/backlog/user-management/admin-password-reset`
4. Implement backend (password reset logic + endpoint)
5. Implement frontend (modal component + integration)
6. Test (unit + integration + manual)
7. Code review + merge to develop

### Success Criteria

After implementation, the system will:
- ✅ Allow admins to reset user passwords via UI + API
- ✅ Generate secure temporary passwords
- ✅ Notify users via email (optional)
- ✅ Revoke user's active sessions
- ✅ Log all reset attempts for compliance
- ✅ Prevent admins from resetting their own passwords
- ✅ Return meaningful error messages for edge cases

---

## 8. Frequently Asked Questions

**Q: Isn't this a security risk?**  
A: No. Password resets are a standard admin operation in any identity system. The implementation includes:
- Strict role-based authorization (admin role only)
- Self-reset prevention
- Audit logging (who reset whom, when)
- Session invalidation (forces user to re-authenticate)
- Secure temporary password (cryptographic entropy)

**Q: Why not just let admins see/change passwords in the UI?**  
A: Because passwords should never be readable. The secure pattern is:
1. Admin initiates reset → get temporary password (shown once)
2. Admin shares with user (via email or in-person)
3. User logs in → must change immediately

**Q: What if the admin forgets to check the temporary password before closing the modal?**  
A: The password is shown once in the success modal. If they close it without copying, they can reset again. No password is stored in database.

**Q: Can this be done via API only (no UI)?**  
A: Yes. The API endpoint `POST /admin/users/:userId/reset-password` is independent and could be called by external scripts. The UI is convenience layer.

**Q: What about users who log in via Google OAuth?**  
A: They cannot use password-based login anyway. The admin password reset still works (updates internal password), but user would continue using "Login with Google." Separate OAuth reset flow would be future work.

**Q: Will this impact performance?**  
A: No measurable impact. It's a single write to the user table + email send (async). Same performance profile as user CRUD or password change endpoints already in production.

---

## 9. References

- **Milestone 2:** User Management & RBAC — `docs/product/milestones/2/milestone.md`
- **Milestone 6:** Password Management — `docs/product/milestones/6/milestone.md`
- **Architecture:** Adapter Pattern & Cloud-Agnosticism — `docs/product/architecture/`
- **Vision:** Long-term goals — `docs/product/vision.md`

---

**Prepared by:** Product Owner (Claude)  
**For:** Development Team & System Administrators  
**Status:** Ready for Sprint Planning

