# Release Notes: Login Registration & Activation Flow

This release implements a secure, self-service registration and activation flow for ArenaQuest, replacing previous placeholders with a robust backend and a premium frontend experience.

## Key Features

### 1. Public Self-Registration (Task 01)
- **New Endpoint**: `POST /auth/register` allows new users to sign up.
- **Security First**: 
  - Users are created with `INACTIVE` status by default.
  - Rate limiting (5 requests / 15 minutes) to prevent spam.
  - Password policy: Minimum 8 characters with at least one digit.
  - Email enumeration protection: The API returns the same success response even if the email is already registered.

### 2. Activation System (Task 02)
- **Email Delivery**: Integrated `IMailer` with Resend (production) and Console (development) adapters.
- **Secure Tokens**: 
  - Activation tokens are generated as 32-byte secure random values.
  - Only the SHA-256 hash of the token is stored in the database.
  - Tokens expire after 24 hours and are single-use.
- **Smart Notifications**: Sends an activation link for new registrations and a security notice if an existing email is used.

### 3. Premium Web Experience (Task 03)
- **Dynamic Registration Form**: A two-step animated form that handles real API calls and validation errors.
- **Activation Page**: A new `/activate` route with a premium design, including loading states, success animations, and error handling.
- **UX Improvements**: 
  - Inline validation mapping API errors back to form fields.
  - "Check your email" success state after registration.
  - Flash banners on the login page after successful activation.
  - LocalStorage hints to remind unactivated users to check their email.

## Technical Improvements
- **Architecture**: Followed Ports and Adapters pattern for mailer and repositories.
- **Testing**: Added comprehensive integration tests for both API and Web components (100% pass rate).
- **Frontend**: Implemented using React Suspense and smooth CSS animations for a premium feel.

---
*Date: April 30, 2026*
