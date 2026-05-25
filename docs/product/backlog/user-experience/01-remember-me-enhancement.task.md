# Task 01: Remember Me Checkbox Enhancement

## Metadata
- **Status:** Pending
- **Complexity:** Low
- **Milestone:** Future Enhancement
- **Dependencies:** None
- **Category:** User Experience / Authentication

---

## Summary

Enhance the existing "Remember me" checkbox on the login page to fully persist user preference and pre-fill the email field on return visits. Additionally, ensure browser password manager integration works correctly by validating that the email and password input fields properly trigger the browser's native save-password prompt with appropriate `autoComplete` attributes.

---

## Problem Statement

Currently, the login page has a functional "Remember me" checkbox UI, but it does not:
1. Persist the user's email address when "Remember me" is checked
2. Pre-fill the email field on return visits based on the stored preference
3. Validate that browser password managers can properly detect and offer to save credentials

**User Impact:**
- Users must re-enter their email on every login, reducing convenience
- Browser password managers may not properly save credentials due to missing HTML5 semantic hints
- No visual confirmation that the preference was saved

---

## Architectural Context

### Cloud-Agnostic Approach
- Storage uses browser **localStorage** exclusively (no backend changes required)
- No new adapters or API endpoints needed
- Browser password manager integration relies on standard HTML5 attributes (`autoComplete`) supported across all modern browsers

### Current State
- Email field has `autoComplete="email"` ✓
- Password field has `autoComplete="current-password"` ✓
- "Remember me" checkbox exists but state is never consumed (lines 132, 231 in `page.tsx`)
- No persistence logic exists yet

---

## Requirements

### 1. Email Persistence
- When user checks "Remember me" and submits the login form successfully, store the email in `localStorage` under a key like `aq_remembered_email`
- Only store the email if the login is successful (credentials are valid)
- Allow users to edit the stored email without restrictions

### 2. Email Pre-Population
- On page load (LoginPageInner component), check if a stored email exists in localStorage
- If `aq_remembered_email` exists, pre-fill the email input field with this value
- Automatically check the "Remember me" checkbox if a stored email is detected

### 3. Clear Stored Email
- Provide a mechanism for users to clear the stored email (e.g., via a "Forget me" link or by unchecking "Remember me" before submission)
- When "Remember me" is unchecked before login submission, remove the stored email from localStorage

### 4. Browser Password Manager Integration Validation
- Verify that the email input has `type="email"` and `autoComplete="email"` (already present)
- Verify that the password input has `type="password"` and `autoComplete="current-password"` (already present)
- Ensure form structure follows HTML5 password manager detection conventions:
  - Email input precedes password input
  - Form tag wraps both inputs
  - Submit button is within the form

---

## Technical Constraints

- **No backend changes:** This feature is entirely client-side using localStorage
- **No new dependencies:** Use native browser APIs only
- **Backward compatible:** Users without stored email should see no change
- **Security:** Email is stored in plaintext in localStorage (acceptable for non-sensitive identifiers; password is never stored)
- **Privacy:** Users must explicitly opt-in by checking "Remember me"; default is no storage

---

## Scope

### 1. Update LoginForm Component

Modify `apps/web/src/app/(auth)/login/page.tsx`:

**On mount (add effect in LoginForm):**
- Read `localStorage` for `aq_remembered_email`
- If present, set `email` state to this value and `rememberMe` to `true`

**On successful login (in handleSubmit catch):**
- If `rememberMe` is checked, save email: `localStorage.setItem('aq_remembered_email', email.trim().toLowerCase())`
- If `rememberMe` is unchecked, remove any stored email: `localStorage.removeItem('aq_remembered_email')`

**On form submission:**
- Add a check: if `rememberMe` is false, remove the stored email before submission

**Optional enhancement (clear action):**
- Add a small "Forget" button or link next to the email input that clears the stored value and unchecks the checkbox

### 2. Validation Checklist

Confirm in the rendered HTML:
- Email input: `type="email"` + `autoComplete="email"` ✓ (existing)
- Password input: `type="password"` + `autoComplete="current-password"` ✓ (existing)
- Form element properly wraps both inputs ✓ (existing)
- Submit button is `type="submit"` inside the form ✓ (existing)

---

## Acceptance Criteria

- [ ] Email pre-fills when `aq_remembered_email` exists in localStorage
- [ ] "Remember me" checkbox is automatically checked when email is pre-filled
- [ ] On successful login with "Remember me" checked, email is persisted to localStorage
- [ ] On successful login with "Remember me" unchecked, email is removed from localStorage
- [ ] Browser password manager can detect and offer to save credentials (manual verification in Chrome, Firefox, Safari)
- [ ] Clearing browser localStorage clears the remembered email
- [ ] Multiple browsers maintain separate remembered emails (due to localStorage scope)
- [ ] No console errors or TypeScript type violations
- [ ] `make lint` passes
- [ ] No regressions in existing login/registration flows

---

## Verification Plan

### Automated Tests
1. Add unit tests in `apps/web/__tests__/app/(auth)/login.test.tsx`:
   - Test localStorage write on successful login with "Remember me" checked
   - Test localStorage removal on login with "Remember me" unchecked
   - Test email pre-fill when localStorage value exists
   - Test checkbox auto-check when email is pre-filled

### Manual Testing (Browser Validation)
1. **Email Pre-fill:**
   - Complete login with "Remember me" checked
   - Reload the page → email field should be populated
   - Checkbox should be checked

2. **Password Manager:**
   - Open Chrome DevTools → Application → Storage
   - Verify no passwords are stored in localStorage (password field should never persist)
   - Attempt login and accept browser's "Save password?" prompt
   - Verify browser saves the credentials (not our app)

3. **Cross-browser:**
   - Test in Chrome, Firefox, Safari (if available) to confirm password manager UI appears
   - Screenshot or record evidence of browser's native save-password dialog

4. **Clear & Forget:**
   - Test unchecking "Remember me" before login clears the value
   - Test that reloading after unchecking shows blank email field

---

## Notes

- This feature improves UX without backend impact, leveraging HTML5 conventions already in place
- Storage key (`aq_remembered_email`) is prefixed with `aq_` to avoid collisions with other apps in the domain
- Email is lowercased and trimmed before storage to match server-side normalization
- Consider adding optional analytics event when email is retrieved from storage (future enhancement)
