# Plan — Task 07: Migrate Shared Layout, Navigation, and Design-System Strings

Detailed technical plan to migrate all remaining layout files, global header, navigation sidebar, footer, spinner, and design-system component defaults to typed dictionaries.

## Proposed Changes

### Shared Layout & Global Components

#### [MODIFY] Global layouts
* [Root layout](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/layout.tsx)
* [(auth) group layout](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(auth)/layout.tsx)
* [(protected) group layout](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/layout.tsx)

#### [MODIFY] Layout Components
* [Nav / Navigation chrome](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/layout/nav.tsx)
* [Admin Sidebar](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/layout/admin-sidebar.tsx)

#### [MODIFY] Shared Components
* [Spinner](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/spinner.tsx)

#### [MODIFY] Design-System Components
* [Button](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/design-system/Button.tsx)
* [Input](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/design-system/Input.tsx)
* [Table](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/design-system/Table.tsx)

## Verification Plan

### Automated Tests
- Run `make lint` and `make test-web` to verify everything is green.
