# Plan — Task 06: Migrate Participant Routes to the Dictionary

Detailed technical plan to migrate all strings in the participant-facing route groups (catalog, dashboard, tasks, settings, enrollment) and their dedicated components to typed dictionaries.

## Proposed Changes

### Participant-Facing Routes & Components

#### [MODIFY] Catalog Routes & Components
* **Pages**:
  * [layout.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/catalog/layout.tsx)
  * [page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/catalog/page.tsx)
  * [[id]/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/catalog/[id]/page.tsx)
  * [[id]/[subtopicId]/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx)
* **Components**:
  * [BadgesStrip.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/BadgesStrip.tsx)
  * [CatalogBreadcrumb.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/CatalogBreadcrumb.tsx)
  * [CatalogSidebar.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/CatalogSidebar.tsx)
  * [Comments.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/Comments.tsx)
  * [ContentSection.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/ContentSection.tsx)
  * [FilesGrid.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/FilesGrid.tsx)
  * [MediaCard.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MediaCard.tsx)
  * [MediaGallery.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MediaGallery.tsx)
  * [MediaTabs.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MediaTabs.tsx)
  * [MediaViewer.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MediaViewer.tsx)
  * [ImageGallery.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MediaViewers/ImageGallery.tsx)
  * [PdfViewer.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MediaViewers/PdfViewer.tsx)
  * [VideoPlayer.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MediaViewers/VideoPlayer.tsx)
  * [MobileSearchBar.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/MobileSearchBar.tsx)
  * [PhotosGrid.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/PhotosGrid.tsx)
  * [SubtopicCard.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/SubtopicCard.tsx)
  * [SubtopicSidebar.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/SubtopicSidebar.tsx)
  * [TopicHeader.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/TopicHeader.tsx)
  * [VideoPlayerWithPlaylist.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx)

#### [MODIFY] Dashboard Components
* **Components**:
  * [BadgesGrid.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/BadgesGrid.tsx)
  * [DailyTasks.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/DailyTasks.tsx)
  * [DashboardContent.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/DashboardContent.tsx)
  * [MissionsList.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/MissionsList.tsx)
  * [Roadmap.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/Roadmap.tsx)
  * [StatCardLevel.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/StatCardLevel.tsx)
  * [StatCardRanking.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/StatCardRanking.tsx)
  * [StatCardStreak.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/StatCardStreak.tsx)
  * [WeeklyChallenges.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/WeeklyChallenges.tsx)

#### [MODIFY] Tasks Routes & Components
* **Pages**:
  * [page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/tasks/page.tsx)
  * [[id]/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/tasks/[id]/page.tsx)
* **Components**:
  * [student-task-card.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/tasks/student-task-card.tsx)
  * [student-task-detail.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/tasks/student-task-detail.tsx)

#### [MODIFY] Settings & Enrollment
* **Pages**:
  * [page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(protected)/settings/page.tsx)
* **Components**:
  * [enrollments-tab.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/enrollment/enrollments-tab.tsx)

#### [MODIFY] Tests Updates
* Update any participant-focused test specifications asserting literal strings:
  * [CatalogSidebar.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/__tests__/CatalogSidebar.test.tsx)
  * [catalog-sidebar.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/__tests__/catalog-sidebar.test.tsx)
  * [subtopic-detail.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/catalog/__tests__/subtopic-detail.test.tsx)
  * [dashboard.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/dashboard/__tests__/dashboard.test.tsx)
  * [stage-editor.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/tasks/__tests__/stage-editor.test.tsx)
  * [student-task-card.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/tasks/__tests__/student-task-card.test.tsx)
  * [student-task-detail.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/tasks/__tests__/student-task-detail.test.tsx)
  * [task-topic-picker.test.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/tasks/__tests__/task-topic-picker.test.tsx)

---

## Verification Plan

### Automated Tests
- Run `make lint` and `make test-web` to verify everything is green.
