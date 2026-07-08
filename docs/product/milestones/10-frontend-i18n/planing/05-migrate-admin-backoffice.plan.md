# Plan — Task 05: Migrate `(protected)/admin/**` strings to the dictionary

Detailed technical plan to migrate all strings in the admin backoffice route group and components to typed dictionaries.

## Proposed Changes

### [Component] Admin Backoffice i18n Migration

#### [MODIFY] [layout.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/layout.tsx)
* Update any layout-level admin branding or structure copy.

#### [MODIFY] [page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/page.tsx)
* Update the main admin dashboard page to load and read strings from the dictionary (e.g., admin title, card titles like user management, topics, tasks, groups).

#### [MODIFY] [users/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/users/page.tsx)
* Localize the users listing table, headers, buttons ("Criar Usuário"), empty state message, pagination text, inline action buttons, modal form labels/placeholders, and alert/error messages using the dictionary.

#### [MODIFY] [users/[userId]/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/users/[userId]/page.tsx)
* Localize the user detail page, back links, tabs (enrollments/profile), details labels (status, roles), and loading/error states.

#### [MODIFY] [groups/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/groups/page.tsx)
* Localize placeholder/coming-soon texts for groups management.

#### [MODIFY] [groups/[groupId]/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/groups/[groupId]/page.tsx)
* Localize group details placeholder text.

#### [MODIFY] [topics/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/topics/page.tsx)
* Localize the main topics hierarchy manager tree, root topic creation actions, tree nodes (collapse/expand, add child, archive, moving controls), edit form inputs, and associated success/error messages.

#### [MODIFY] [tasks/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/tasks/page.tsx)
* Localize tasks list view page headers, placeholders, action buttons, table columns, and status pills.

#### [MODIFY] [tasks/[id]/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/admin/tasks/[id]/page.tsx)
* Localize the main task editor interface, forms, linked topics sections, stages CRUD buttons, publishing preconditions warnings, and edit states.

#### [MODIFY] [MediaUploader.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/admin/MediaUploader.tsx)
* Localize dropzone messages, dynamic uploading states, and limit/error messages.

#### [MODIFY] [MediaList.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/admin/MediaList.tsx)
* Localize attachment titles, actions (delete, download/view), empty states, and confirmations.

#### [MODIFY] [ResetPasswordModal.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/admin/ResetPasswordModal.tsx)
* Localize reset password confirm titles/messages, input notes, character counts, status loaders, and successfully generated temporary password screens.

#### [MODIFY] [topics.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/__tests__/app/admin/topics.test.tsx)
* Convert hardcoded PT assertions to dynamically load `dictPt.admin.topics` values.

#### [MODIFY] [ResetPasswordModal.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/__tests__/components/admin/ResetPasswordModal.test.tsx)
* Convert hardcoded PT assertions to dynamically load `dictPt.admin.users.resetPasswordModal` values.

## Verification Plan

### Automated Tests
- Run `tsc --noEmit`, `make lint-web` and `make test-web` to ensure strict TS and no errors.
