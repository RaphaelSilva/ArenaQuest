# i18n String Inventory

This file maps every user-facing string found in `apps/web/src/` to its dictionary key.
`fn` denotes a runtime-interpolation function entry.

---

## auth namespace

### Source: `src/components/auth/auth-tabs.tsx`
| Key | English |
|-----|---------|
| `auth.tabs.login` | Sign in |
| `auth.tabs.register` | Create account |

### Source: `src/components/auth/hero-panel.tsx`
| Key | English |
|-----|---------|
| `auth.hero.tagline` | Train with purpose. |
| `auth.hero.taglineAccent` | Evolve with data. |
| `auth.hero.description` | Learning platform for athletes… |
| `auth.hero.feature1Title` | Content Tracks |
| `auth.hero.feature1Desc` | Structured modules with videos… |
| `auth.hero.feature2Title` | Full Gamification |
| `auth.hero.feature2Desc` | XP, levels, badges… |
| `auth.hero.feature3Title` | Real-Time Progress |
| `auth.hero.feature3Desc` | Detailed dashboards… |

### Source: `src/app/(auth)/login/page.tsx`
| Key | English |
|-----|---------|
| `auth.login.title` | Welcome back |
| `auth.login.subtitle` | Sign in to your account… |
| `auth.login.emailLabel` | Email |
| `auth.login.emailPlaceholder` | you@email.com |
| `auth.login.passwordLabel` | Password |
| `auth.login.rememberMe` | Remember me |
| `auth.login.forgotPassword` | Forgot password |
| `auth.login.submitButton` | Enter the Arena |
| `auth.login.loadingButton` | Signing in… |
| `auth.login.orContinueWith` | or continue with |
| `auth.login.googleButton` | Sign in with Google |
| `auth.login.noAccount` | Don't have an account? |
| `auth.login.createAccountLink` | Create free account |
| `auth.login.activatedBanner` | Account activated! Sign in to continue. |
| `auth.login.passwordResetBanner` | Password reset successfully!… |
| `auth.login.errorEmailRequired` | Please enter your email. |
| `auth.login.errorPasswordRequired` | Please enter your password. |
| `auth.login.errorCheckEmail` | Please check your email to activate… |
| `auth.login.errorInvalidCredentials` | Invalid email or password. |

### Source: `src/app/(auth)/login/page.tsx`, `src/components/auth/register-*.tsx`
| Key | English |
|-----|---------|
| `auth.register.title` | Create your account |
| `auth.register.subtitle` | Start your high-performance journey today. |
| `auth.register.step1Label` | Your information |
| `auth.register.step2Label` | Account type |
| `auth.register.firstNameLabel` | First name |
| `auth.register.firstNamePlaceholder` | John |
| `auth.register.lastNameLabel` | Last name |
| `auth.register.lastNamePlaceholder` | Smith |
| `auth.register.passwordPlaceholder` | Minimum 8 characters |
| `auth.register.confirmPasswordLabel` | Confirm password |
| `auth.register.confirmPasswordPlaceholder` | Repeat password |
| `auth.register.continueButton` | Continue → |
| `auth.register.accountTypeTitle` | How will you use it? |
| `auth.register.accountTypeSubtitle` | This personalises your experience… |
| `auth.register.accountTypeLabel` | Account type |
| `auth.register.termsText` | I agree to the {termsLink} and {privacyLink}… |
| `auth.register.termsLink` | Terms of Use |
| `auth.register.privacyLink` | Privacy Policy |
| `auth.register.backButton` | ← Back |
| `auth.register.createButton` | Create account |
| `auth.register.creatingButton` | Creating account… |
| `auth.register.hasAccount` | Already have an account? |
| `auth.register.signInLink` | Sign in |
| `auth.register.errorRequired` | Required field |
| `auth.register.errorEmailInvalid` | Invalid email |
| `auth.register.errorPasswordMinLength` | Minimum 8 characters |
| `auth.register.errorPasswordsMismatch` | Passwords do not match |
| `auth.register.errorTerms` | Accept the terms to continue |
| `auth.register.errorRateLimited` | Too many attempts… |
| `auth.register.errorGeneral` | Could not complete registration… |
| `auth.register.errorNameTooShort` | Name too short |
| `auth.register.errorNameTooLong` | Name too long |
| `auth.register.errorNameInvalid` | Invalid name |
| `auth.register.errorPasswordNoDigit` | Include at least one number |
| `auth.register.errorPasswordInvalid` | Invalid password |

### Source: `src/components/auth/register-success.tsx`
| Key | English |
|-----|---------|
| `auth.registerSuccess.title` | Check your email |
| `auth.registerSuccess.message` | fn `(email) => …` |
| `auth.registerSuccess.spamHint` | Didn't receive it? Check your spam folder… |
| `auth.registerSuccess.backButton` | Back to sign in |

### Source: `src/components/auth/role-select.tsx`
| Key | English |
|-----|---------|
| `auth.role.participantTitle` | Participant |
| `auth.role.participantSub` | Learn and improve |
| `auth.role.participantDesc` | As a participant, you will have access… |
| `auth.role.instructorTitle` | Instructor |
| `auth.role.instructorSub` | Create and manage |
| `auth.role.instructorDesc` | As an instructor, you can create topics… |

### Source: `src/components/auth/password-strength.tsx`
| Key | English |
|-----|---------|
| `auth.passwordStrength.label` | Strength: |
| `auth.passwordStrength.weak` | Weak |
| `auth.passwordStrength.fair` | Fair |
| `auth.passwordStrength.good` | Good |
| `auth.passwordStrength.strong` | Strong |

### Source: `src/app/(auth)/forgot-password/page.tsx`
| Key | English |
|-----|---------|
| `auth.forgotPassword.title` | Forgot your password? |
| `auth.forgotPassword.subtitle` | Enter your email and we will send… |
| `auth.forgotPassword.emailLabel` | Email |
| `auth.forgotPassword.emailPlaceholder` | you@email.com |
| `auth.forgotPassword.submitButton` | Send reset link |
| `auth.forgotPassword.sendingButton` | Sending… |
| `auth.forgotPassword.backToLogin` | ← Back to sign in |
| `auth.forgotPassword.errorEmailRequired` | Please enter your email. |
| `auth.forgotPassword.errorRateLimited` | Too many attempts… |
| `auth.forgotPassword.successTitle` | Check your email |
| `auth.forgotPassword.successMessage` | If that address is registered… |
| `auth.forgotPassword.successSpamHint` | Didn't receive it? Check your spam folder… |
| `auth.forgotPassword.successBackButton` | Back to sign in |

### Source: `src/app/(auth)/activate/page.tsx`
| Key | English |
|-----|---------|
| `auth.activate.pendingTitle` | Activating your account… |
| `auth.activate.pendingMessage` | Just a moment. |
| `auth.activate.successTitle` | Account activated! |
| `auth.activate.successMessage` | Your account is ready. Sign in… |
| `auth.activate.successButton` | Go to sign in |
| `auth.activate.errorNetworkTitle` | Could not activate |
| `auth.activate.errorInvalidTitle` | Invalid link |
| `auth.activate.errorNetworkMessage` | There was a connection problem… |
| `auth.activate.errorInvalidMessage` | Invalid or expired link… |
| `auth.activate.retryButton` | Try again |
| `auth.activate.backToLogin` | Back to sign in |

### Source: `src/app/(auth)/reset-password/page.tsx`
| Key | English |
|-----|---------|
| `auth.resetPassword.title` | New password |
| `auth.resetPassword.subtitle` | Choose a password with at least 8 characters… |
| `auth.resetPassword.newPasswordLabel` | New password |
| `auth.resetPassword.confirmPasswordLabel` | Confirm password |
| `auth.resetPassword.newPasswordPlaceholder` | Minimum 8 characters |
| `auth.resetPassword.confirmPasswordPlaceholder` | Repeat new password |
| `auth.resetPassword.submitButton` | Reset password |
| `auth.resetPassword.loadingButton` | Resetting… |
| `auth.resetPassword.backToLogin` | ← Back to sign in |
| `auth.resetPassword.showPassword` | Show password |
| `auth.resetPassword.hidePassword` | Hide password |
| `auth.resetPassword.invalidLinkMessage` | Invalid link. Request a new reset link. |
| `auth.resetPassword.requestNewLink` | Request new link |
| `auth.resetPassword.requestNew` | Request new |
| `auth.resetPassword.errorRequired` | Required field |
| `auth.resetPassword.errorMinLength` | Minimum 8 characters |
| `auth.resetPassword.errorNoDigit` | Include at least one number |
| `auth.resetPassword.errorMismatch` | Passwords do not match |
| `auth.resetPassword.errorExpiredLink` | This link has expired or already been used… |
| `auth.resetPassword.errorRateLimited` | Too many attempts… |
| `auth.resetPassword.errorGeneral` | Could not reset the password… |

---

## admin namespace

### Source: `src/app/(protected)/admin/page.tsx`
| Key | English |
|-----|---------|
| `admin.dashboard.title` | Admin Dashboard |
| `admin.dashboard.subtitle` | Manage users, content and platform settings. |
| `admin.dashboard.userManagementTitle` | User Management |
| `admin.dashboard.userManagementDesc` | Create, edit and manage user accounts… |
| `admin.dashboard.userManagementButton` | View Users |
| `admin.dashboard.topicTreeTitle` | Topic Tree |
| `admin.dashboard.topicTreeDesc` | Create and organise topics… |
| `admin.dashboard.topicTreeButton` | View Topics |
| `admin.dashboard.tasksTitle` | Tasks |
| `admin.dashboard.tasksDesc` | Manage learning tasks… |
| `admin.dashboard.tasksButton` | View Tasks |
| `admin.dashboard.groupsTitle` | Groups |
| `admin.dashboard.groupsDesc` | Create and manage user groups… |
| `admin.dashboard.groupsButton` | View Groups |

### Source: `src/app/(protected)/admin/users/page.tsx`
| Key | English |
|-----|---------|
| `admin.users.title` | User Management |
| `admin.users.createButton` | Create User |
| `admin.users.errorLoading` | Failed to load users. |
| `admin.users.table.nameHeader` | Name |
| `admin.users.table.emailHeader` | Email |
| `admin.users.table.rolesHeader` | Roles |
| `admin.users.table.statusHeader` | Status |
| `admin.users.table.createdAtHeader` | Created |
| `admin.users.table.actionsHeader` | Actions |
| `admin.users.table.emptyMessage` | No users found. |
| `admin.users.pagination.rowsPerPage` | Rows per page: |
| `admin.users.pagination.pageInfo` | fn `(page, total, count) => …` |
| `admin.users.pagination.prev` | Previous |
| `admin.users.pagination.next` | Next |
| `admin.users.actions.enrollments` | Enrolments |
| `admin.users.actions.edit` | Edit |
| `admin.users.actions.deactivate` | Deactivate |
| `admin.users.form.createTitle` | Create User |
| `admin.users.form.editTitle` | Edit User |
| `admin.users.form.nameLabel` | Name |
| `admin.users.form.emailLabel` | Email |
| `admin.users.form.passwordLabel` | Password |
| `admin.users.form.rolesLabel` | Roles |
| `admin.users.form.statusLabel` | Status |
| `admin.users.form.cancelButton` | Cancel |
| `admin.users.form.saveButton` | Save changes |
| `admin.users.form.createButton` | Create user |
| `admin.users.form.errorNameRequired` | Name is required. |
| `admin.users.form.errorEmailRequired` | Email is required. |
| `admin.users.form.errorPasswordLength` | Password must be at least 8 characters. |
| `admin.users.form.errorGeneral` | Something went wrong. |
| `admin.users.confirm.deactivateMessage` | fn `(name) => …` |
| `admin.users.confirm.cancelButton` | Cancel |
| `admin.users.confirm.confirmButton` | Confirm |

### Source: `src/app/(protected)/admin/users/[userId]/page.tsx`
| Key | English |
|-----|---------|
| `admin.users.detail.backToUsers` | ← Back to users |
| `admin.users.detail.resetPasswordButton` | Reset Password |
| `admin.users.detail.tabEnrollments` | enrolments |
| `admin.users.detail.tabProfile` | profile |
| `admin.users.detail.rolesLabel` | Roles |
| `admin.users.detail.statusLabel` | Status |
| `admin.users.detail.memberSinceLabel` | Member since |
| `admin.users.detail.errorNotFound` | User not found. |
| `admin.users.detail.errorLoading` | Failed to load user. |

### Source: `src/components/admin/ResetPasswordModal.tsx`
| Key | English |
|-----|---------|
| `admin.users.resetPasswordModal.confirmTitle` | fn `(name) => …` |
| `admin.users.resetPasswordModal.confirmMessage` | This will end all active sessions… |
| `admin.users.resetPasswordModal.sendEmailLabel` | Send email notification to the user |
| `admin.users.resetPasswordModal.noteLabel` | Optional note to include in the email |
| `admin.users.resetPasswordModal.notePlaceholder` | Leave a message for the user… |
| `admin.users.resetPasswordModal.noteCharCount` | fn `(count) => …` |
| `admin.users.resetPasswordModal.cancelButton` | Cancel |
| `admin.users.resetPasswordModal.confirmButton` | Confirm |
| `admin.users.resetPasswordModal.loadingMessage` | Resetting password... |
| `admin.users.resetPasswordModal.successTitle` | Password Reset Successfully |
| `admin.users.resetPasswordModal.successMessage` | Share this temporary password… |
| `admin.users.resetPasswordModal.copyButton` | Copy password |
| `admin.users.resetPasswordModal.copiedButton` | Copied! |
| `admin.users.resetPasswordModal.closeButton` | Close |
| `admin.users.resetPasswordModal.failedTitle` | Password Reset Failed |
| `admin.users.resetPasswordModal.retryButton` | Try again |
| `admin.users.resetPasswordModal.errorPermission` | You do not have permission… |
| `admin.users.resetPasswordModal.errorNotFound` | User not found. |
| `admin.users.resetPasswordModal.errorSelfReset` | You cannot reset your own password… |
| `admin.users.resetPasswordModal.errorEmailFailed` | An error occurred. The password may have been updated… |
| `admin.users.resetPasswordModal.errorGeneral` | An error occurred while resetting the password. |

### Source: `src/app/(protected)/admin/topics/page.tsx`
| Key | English |
|-----|---------|
| `admin.topics.title` | Topic Tree |
| `admin.topics.subtitle` | Build and organise your educational hierarchy. |
| `admin.topics.newRootButton` | New Root Topic |
| `admin.topics.errorLoading` | Failed to load topics. |
| `admin.topics.empty` | No topics yet. Create your first root topic. |
| `admin.topics.backToTopics` | Back to topics |
| `admin.topics.selectToEdit` | Select a topic to edit its details |
| `admin.topics.untitledTopic` | Untitled topic |
| `admin.topics.topicIdLabel` | Topic ID: |
| `admin.topics.collapseButton` | Collapse |
| `admin.topics.expandButton` | Expand |
| `admin.topics.dragToReorder` | Drag to reorder |
| `admin.topics.addChildButton` | + Child |
| `admin.topics.archiveButton` | Archive |
| `admin.topics.moveUp` | Move up |
| `admin.topics.moveDown` | Move down |
| `admin.topics.reorderTitle` | Click to reorder… |
| `admin.topics.form.newRootTitle` | New root topic |
| `admin.topics.form.addChildTitle` | Add child topic |
| `admin.topics.form.titleLabel` | Title |
| `admin.topics.form.titleRequired` | Title is required. |
| `admin.topics.form.cancelButton` | Cancel |
| `admin.topics.form.createButton` | Create |
| `admin.topics.form.errorGeneral` | Something went wrong. |
| `admin.topics.detail.titleLabel` | Title |
| `admin.topics.detail.statusLabel` | Status |
| `admin.topics.detail.contentLabel` | Content (Markdown) |
| `admin.topics.detail.minutesLabel` | Estimated Minutes |
| `admin.topics.detail.tagIdsLabel` | Tag IDs |
| `admin.topics.detail.tagIdsHint` | (comma-separated) |
| `admin.topics.detail.tagIdsPlaceholder` | tag-id-1, tag-id-2 |
| `admin.topics.detail.prereqIdsLabel` | Prerequisite IDs |
| `admin.topics.detail.prereqIdsPlaceholder` | node-id-1, node-id-2 |
| `admin.topics.detail.saveButton` | Save changes |
| `admin.topics.detail.statusDraft` | Draft |
| `admin.topics.detail.statusPublished` | Published |
| `admin.topics.detail.statusArchived` | Archived |
| `admin.topics.confirm.archiveMessage` | fn `(title) => …` |
| `admin.topics.confirm.cancelButton` | Cancel |
| `admin.topics.confirm.confirmButton` | Confirm |
| `admin.topics.toast.orderSaved` | Order saved |
| `admin.topics.toast.moveFailed` | Move failed |
| `admin.topics.toast.topicCreated` | Topic created |
| `admin.topics.toast.topicArchived` | Topic archived |
| `admin.topics.toast.changesSaved` | Changes saved |
| `admin.topics.toast.failedLoadMedia` | Failed to load media |
| `admin.topics.toast.failedReloadMedia` | Failed to reload media |
| `admin.topics.toast.failedRename` | Failed to rename topic |
| `admin.topics.toast.failedArchive` | Failed to archive topic |
| `admin.topics.toast.failedSave` | Failed to save changes |
| `admin.topics.toast.moveCycle` | Cannot move: the operation would create a circular dependency |

### Source: `src/components/admin/MediaUploader.tsx`
| Key | English |
|-----|---------|
| `admin.topics.media.sectionTitle` | Media Attachments |
| `admin.topics.media.sectionSubtitle` | Upload and manage files associated with this topic. |
| `admin.topics.media.uploader.dropzoneTitle` | Click to upload or drag and drop |
| `admin.topics.media.uploader.dropzoneHint` | PDF, Video or Images up to 100MB |
| `admin.topics.media.uploader.preparing` | Preparing... |
| `admin.topics.media.uploader.uploading` | Uploading... |
| `admin.topics.media.uploader.finishing` | Finishing... |
| `admin.topics.media.uploader.uploadComplete` | Upload complete |
| `admin.topics.media.uploader.fileTooBig` | File too large (max 100MB) |

### Source: `src/components/admin/MediaList.tsx`
| Key | English |
|-----|---------|
| `admin.topics.media.list.empty` | No media attached to this topic. |
| `admin.topics.media.list.deleteConfirm` | Are you sure you want to delete this media? |
| `admin.topics.media.list.deleteFailed` | Failed to delete media |
| `admin.topics.media.list.downloadView` | Download / View |
| `admin.topics.media.list.delete` | Delete |

### Source: `src/app/(protected)/admin/tasks/page.tsx`, `src/app/(protected)/admin/tasks/[id]/page.tsx`
| Key | English |
|-----|---------|
| `admin.tasks.title` | Tasks |
| `admin.tasks.subtitle` | Create and manage learning tasks |
| `admin.tasks.newButton` | New Task |
| `admin.tasks.errorLoading` | Failed to load tasks |
| `admin.tasks.empty` | No tasks yet. Create your first task. |
| `admin.tasks.backToTasks` | Back to tasks |
| `admin.tasks.selectToEdit` | Select a task to edit its details |
| `admin.tasks.untitledTask` | Untitled task |
| `admin.tasks.taskIdLabel` | Task ID: |
| `admin.tasks.detail.titleLabel` | Title |
| `admin.tasks.detail.descriptionLabel` | Description (Markdown) |
| `admin.tasks.detail.preview` | Preview |
| `admin.tasks.detail.saveButton` | Save |
| `admin.tasks.detail.linkedTopicsTitle` | Linked Topics |
| `admin.tasks.detail.stagesTitle` | Stages |
| `admin.tasks.detail.statusTitle` | Status |
| `admin.tasks.detail.publishButton` | Publish |
| `admin.tasks.detail.archiveButton` | Archive |
| `admin.tasks.detail.moveToDraftButton` | Move to Draft |
| `admin.tasks.detail.savingButton` | Saving… |
| `admin.tasks.cannotPublish.title` | Cannot publish this task yet: |
| `admin.tasks.cannotPublish.noStages` | Add at least one stage before publishing. |
| `admin.tasks.cannotPublish.linkedTopicNotPublished` | Every linked topic must be published. |
| `admin.tasks.confirm.archiveMessage` | fn `(title) => …` |
| `admin.tasks.confirm.cancelButton` | Cancel |
| `admin.tasks.confirm.confirmButton` | Confirm |
| `admin.tasks.errors.failedLoadDetail` | Failed to load task details |
| `admin.tasks.errors.failedSave` | Failed to save changes |
| `admin.tasks.errors.failedStatus` | Failed to update status |
| `admin.tasks.errors.failedTopicLinks` | Failed to update topic links |
| `admin.tasks.errors.failedArchive` | Failed to archive task |
| `admin.tasks.errors.failedCreate` | Failed to create task |
| `admin.tasks.errors.failedRename` | Failed to rename task |
| `admin.tasks.errors.invalidTransition` | That status transition is not allowed. |
| `admin.tasks.errors.linkedTopicNotPublished` | All linked topics must be published while the task is published. |
| `admin.tasks.editPage.backToTasks` | ← Back to tasks |
| `admin.tasks.editPage.pageTitle` | Edit Task |

### Source: `src/components/tasks/stage-editor.tsx`
| Key | English |
|-----|---------|
| `admin.tasks.stages.addButton` | Add Stage |
| `admin.tasks.stages.adding` | Adding… |
| `admin.tasks.stages.empty` | No stages yet. |
| `admin.tasks.stages.deleteButton` | Delete |
| `admin.tasks.stages.deleteTooltip` | Delete stage |
| `admin.tasks.stages.deletePublishedTooltip` | Cannot delete a stage while the task is published |
| `admin.tasks.stages.topicsTitle` | Topics in this stage |
| `admin.tasks.stages.noTopics` | No topics in the catalogue. |
| `admin.tasks.stages.addTopicHint` | Add this topic to the task first |
| `admin.tasks.stages.errorSetMismatch` | The stage list has changed. Please try again. |
| `admin.tasks.stages.errorDeleteForbidden` | Stages cannot be deleted while the task is published. |
| `admin.tasks.stages.errorTopicNotInTask` | A stage cannot link a topic outside the task. Add it to the task first. |
| `admin.tasks.stages.errorGeneral` | Stage operation failed |

### Source: `src/components/tasks/task-topic-picker.tsx`
| Key | English |
|-----|---------|
| `admin.tasks.stages.noTopics` | No topics in the catalogue. |

### Source: `src/app/(protected)/admin/groups/page.tsx`, `src/app/(protected)/admin/groups/[groupId]/page.tsx`
| Key | English |
|-----|---------|
| `admin.groups.title` | Group Management |
| `admin.groups.subtitle` | Group CRUD requires backend endpoints… |
| `admin.groups.comingSoon` | Coming soon — group management is under development. |
| `admin.groups.detailTitle` | fn `(groupId) => …` |
| `admin.groups.detailSubtitle` | Detailed group management is waiting… |
| `admin.groups.detailComingSoon` | Group management interface coming soon. |
| `admin.groups.backToGroups` | ← Back to groups |

---

## catalog namespace

### Source: `src/app/(protected)/catalog/page.tsx`
| Key | English |
|-----|---------|
| `catalog.title` | Catalogue |
| `catalog.empty` | No topics available yet. |

### Source: `src/app/(protected)/catalog/[id]/page.tsx`
| Key | English |
|-----|---------|
| `catalog.breadcrumb.catalogue` | Catalogue |
| `catalog.topicPage.progress` | Progress |
| `catalog.topicPage.subtopics` | Subtopics |
| `catalog.topicPage.noSubtopics` | No subtopics yet |
| `catalog.topicPage.addSubtopic` | + Add subtopic |
| `catalog.topicPage.errorNotFound` | Topic not found |

---

## dashboard namespace

### Source: `src/components/dashboard/DashboardContent.tsx`
| Key | English |
|-----|---------|
| `dashboard.greeting.goodMorning` | Good morning |
| `dashboard.greeting.goodAfternoon` | Good afternoon |
| `dashboard.greeting.goodEvening` | Good evening |
| `dashboard.trackSubtitle` | Track your progress and keep the momentum. |
| `dashboard.errorLoading` | Failed to load dashboard. |

### Source: `src/components/dashboard/StatCardLevel.tsx`
| Key | English |
|-----|---------|
| `dashboard.levelCard.label` | Level & XP |
| `dashboard.levelCard.ariaLabel` | Level and XP |
| `dashboard.levelCard.xpTotal` | fn `(xp) => …` |
| `dashboard.levelCard.xpToNext` | fn `(xp) => …` |
| `dashboard.levelCard.xpProgressLabel` | XP progress to next level |

### Source: `src/components/dashboard/StatCardStreak.tsx`
| Key | English |
|-----|---------|
| `dashboard.streakCard.label` | Streak |
| `dashboard.streakCard.day` | day |
| `dashboard.streakCard.days` | days |
| `dashboard.streakCard.inARow` | in a row |
| `dashboard.streakCard.personalBest` | Personal best: |
| `dashboard.streakCard.weekActivity` | Weekly activity |

### Source: `src/components/dashboard/StatCardRanking.tsx`
| Key | English |
|-----|---------|
| `dashboard.rankingCard.label` | Ranking |
| `dashboard.rankingCard.noData` | No ranking data yet. |
| `dashboard.rankingCard.of` | of |

### Source: `src/components/dashboard/DailyTasks.tsx`
| Key | English |
|-----|---------|
| `dashboard.dailyTasks.title` | Today's Tasks |
| `dashboard.dailyTasks.empty` | No daily tasks today. |
| `dashboard.dailyTasks.progressLabel` | Daily tasks progress |

### Source: `src/components/dashboard/WeeklyChallenges.tsx`
| Key | English |
|-----|---------|
| `dashboard.weeklyChallenges.title` | Weekly Challenges |
| `dashboard.weeklyChallenges.empty` | No weekly challenges this week. |

### Source: `src/components/dashboard/MissionsList.tsx`
| Key | English |
|-----|---------|
| `dashboard.missions.title` | Special Missions |
| `dashboard.missions.empty` | No active missions right now. |
| `dashboard.missions.ends` | Ends |
| `dashboard.missions.badge` | Badge: |

### Source: `src/components/dashboard/BadgesGrid.tsx`
| Key | English |
|-----|---------|
| `dashboard.badges.title` | Badges |
| `dashboard.badges.empty` | No badges yet. Keep learning to earn some! |
| `dashboard.badges.earned` | earned |
| `dashboard.badges.lockedPrefix` | Locked: |
| `dashboard.badges.earnedTitle` | fn `(name, xp) => …` |
| `dashboard.badges.lockedTitle` | fn `(name) => …` |

### Source: `src/components/dashboard/Roadmap.tsx`
| Key | English |
|-----|---------|
| `dashboard.roadmap.title` | Learning Roadmap |
| `dashboard.roadmap.empty` | Your learning roadmap will appear here. |

---

## tasks namespace

### Source: `src/app/(protected)/tasks/page.tsx`
| Key | English |
|-----|---------|
| `tasks.title` | Missions |
| `tasks.empty` | No missions available right now. Check back soon! |

### Source: `src/components/tasks/student-task-card.tsx`
| Key | English |
|-----|---------|
| `tasks.card.stageCount` | fn `(n) => …` |
| `tasks.card.topicCount` | fn `(n) => …` |
| `tasks.card.explore` | Explore → |

### Source: `src/components/tasks/student-task-detail.tsx`
| Key | English |
|-----|---------|
| `tasks.detail.backToMissions` | ← Back to missions |
| `tasks.detail.completedLabel` | ✓ Mission completed! |
| `tasks.detail.stagesTitle` | Stages |
| `tasks.detail.noStages` | No stages defined yet. |
| `tasks.detail.stageLabel` | fn `(n) => …` |
| `tasks.detail.stagesAriaLabel` | Mission stages |
| `tasks.detail.completedAt` | fn `(date) => …` |
| `tasks.detail.stageTopicsAriaLabel` | fn `(label) => …` |
| `tasks.detail.checkInButton` | Check in |
| `tasks.detail.checkInLoading` | Checking in… |
| `tasks.detail.checkInAriaLabel` | fn `(label) => …` |
| `tasks.detail.locked` | Locked |
| `tasks.detail.lockedTooltip` | Complete previous stages first |
| `tasks.detail.lockedAriaLabel` | Stage locked. Complete previous stages first. |
| `tasks.detail.errorOutOfOrder` | fn `(stage) => …` |
| `tasks.detail.errorGeneral` | Could not record check-in. Please try again. |

---

## enrollment namespace

### Source: `src/components/enrollment/enrollments-tab.tsx`
| Key | English |
|-----|---------|
| `enrollment.directGrantsTitle` | fn `(count) => …` |
| `enrollment.grantButton` | Grant topic access |
| `enrollment.noGrants` | No topics granted yet. |
| `enrollment.grantedAt` | Granted |
| `enrollment.revokeButton` | Revoke |
| `enrollment.pickerTitle` | Grant topic access |
| `enrollment.searchPlaceholder` | Search topics… |
| `enrollment.noTopicsFound` | No published topics found. |
| `enrollment.alreadyGranted` | Already granted |
| `enrollment.cancelButton` | Cancel |
| `enrollment.revokeDialog.title` | fn `(topic) => …` |
| `enrollment.revokeDialog.cascade` | Also revoke descendant grants |
| `enrollment.revokeDialog.cancelButton` | Cancel |
| `enrollment.revokeDialog.revokeButton` | Revoke |
| `enrollment.errorLoading` | Failed to load enrolments. |
| `enrollment.errorGrant` | Failed to grant access. |
| `enrollment.errorRevoke` | Failed to revoke access. |

---

## settings namespace

### Source: `src/app/(protected)/settings/page.tsx`
| Key | English |
|-----|---------|
| `settings.title` | Settings |
| `settings.subtitle` | Manage your account preferences. |
| `settings.changePassword.title` | Change password |
| `settings.changePassword.subtitle` | After saving, other open sessions will be signed out. |
| `settings.changePassword.currentPasswordLabel` | Current password |
| `settings.changePassword.currentPasswordPlaceholder` | Your current password |
| `settings.changePassword.newPasswordLabel` | New password |
| `settings.changePassword.newPasswordPlaceholder` | Minimum 8 characters |
| `settings.changePassword.confirmPasswordLabel` | Confirm new password |
| `settings.changePassword.confirmPasswordPlaceholder` | Repeat new password |
| `settings.changePassword.submitButton` | Save new password |
| `settings.changePassword.loadingButton` | Saving… |
| `settings.changePassword.successToast` | Password changed successfully! |
| `settings.changePassword.closeToast` | Close |
| `settings.changePassword.showPassword` | Show password |
| `settings.changePassword.hidePassword` | Hide password |
| `settings.changePassword.errorRequired` | Required field |
| `settings.changePassword.errorMinLength` | Minimum 8 characters |
| `settings.changePassword.errorNoDigit` | Include at least one number |
| `settings.changePassword.errorMismatch` | Passwords do not match |
| `settings.changePassword.errorCurrentInvalid` | Current password is incorrect |
| `settings.changePassword.errorGeneral` | Could not change password. Please try again. |

---

## layout namespace

### Source: `src/components/layout/nav.tsx`
| Key | English |
|-----|---------|
| `layout.nav.dashboard` | Dashboard |
| `layout.nav.catalog` | Catalogue |
| `layout.nav.tasks` | Missions |
| `layout.nav.settings` | Settings |
| `layout.nav.admin` | Admin |
| `layout.nav.signOut` | Sign out |
| `layout.nav.openMenu` | Open menu |
| `layout.nav.closeMenu` | Close menu |

### Source: `src/components/layout/admin-sidebar.tsx`
| Key | English |
|-----|---------|
| `layout.adminSidebar.title` | Admin |
| `layout.adminSidebar.users` | Users |
| `layout.adminSidebar.topics` | Topics |
| `layout.adminSidebar.tasks` | Tasks |
| `layout.adminSidebar.groups` | Groups |

---

## common namespace

Shared across all UI.

| Key | English |
|-----|---------|
| `common.cancel` | Cancel |
| `common.confirm` | Confirm |
| `common.save` | Save |
| `common.saveChanges` | Save changes |
| `common.back` | Back |
| `common.close` | Close |
| `common.retry` | Try again |
| `common.loading` | Loading… |
| `common.edit` | Edit |
| `common.delete` | Delete |
| `common.archive` | Archive |
| `common.create` | Create |
| `common.publish` | Publish |
| `common.showPassword` | Show password |
| `common.hidePassword` | Hide password |

---

## errors namespace

| Key | English |
|-----|---------|
| `errors.networkError` | There was a connection problem. Please check your internet. |
| `errors.forbidden` | You do not have permission to access this resource. |
| `errors.somethingWentWrong` | Something went wrong. Please try again. |
