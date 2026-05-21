/**
 * Wrapper hooks that inject auth context (refreshSession, setAccessToken, onSessionExpired)
 * into all API client function calls. These hooks simplify usage in components.
 */

import { useAuth } from '@web/hooks/use-auth';
import { topicsApi } from '@web/lib/topics-api';
import { tasksApi } from '@web/lib/tasks-api';
import { accountApi } from '@web/lib/account-api';
import { adminTopicsApi, type CreateTopicInput, type UpdateTopicInput, type MoveTopicInput } from '@web/lib/admin-topics-api';
import { adminMediaApi, type PresignInput } from '@web/lib/admin-media-api';
import { adminUsersApi, type CreateUserInput, type UpdateUserInput } from '@web/lib/admin-users-api';
import { adminTasksApi, type TaskStatus, type CreateTaskInput, type UpdateTaskInput } from '@web/lib/admin-tasks-api';
import { adminEnrollmentApi } from '@web/lib/admin-enrollment-api';
import { progressApi } from '@web/lib/progress-api';
import { getDashboard } from '@web/lib/dashboard-api';

export function useTopicsApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    list: () => topicsApi.list(accessToken!, refreshSession, setAccessToken, onSessionExpired),
    getById: (id: string) =>
      topicsApi.getById(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
    visit: (id: string) =>
      topicsApi.visit(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
    listProgress: () =>
      topicsApi.listProgress(accessToken!, refreshSession, setAccessToken, onSessionExpired),
    complete: (id: string) =>
      topicsApi.complete(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
  };
}

export function useTasksApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    list: () => tasksApi.list(accessToken!, refreshSession, setAccessToken, onSessionExpired),
    getById: (id: string) =>
      tasksApi.getById(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
    checkIn: (taskId: string, stageId: string) =>
      tasksApi.checkIn(
        accessToken!,
        taskId,
        stageId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
  };
}

export function useAccountApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    changePassword: (currentPassword: string, newPassword: string) =>
      accountApi.changePassword(
        accessToken!,
        currentPassword,
        newPassword,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
  };
}

export function useAdminTopicsApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    list: () =>
      adminTopicsApi.list(accessToken!, refreshSession, setAccessToken, onSessionExpired),
    create: (data: CreateTopicInput) =>
      adminTopicsApi.create(accessToken!, data, refreshSession, setAccessToken, onSessionExpired),
    update: (id: string, data: UpdateTopicInput) =>
      adminTopicsApi.update(
        accessToken!,
        id,
        data,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    move: (id: string, data: MoveTopicInput) =>
      adminTopicsApi.move(
        accessToken!,
        id,
        data,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    archive: (id: string) =>
      adminTopicsApi.archive(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
  };
}

export function useAdminMediaApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    list: (topicId: string) =>
      adminMediaApi.list(
        accessToken!,
        topicId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    getPresignedUrl: (topicId: string, data: PresignInput) =>
      adminMediaApi.getPresignedUrl(
        accessToken!,
        topicId,
        data,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    finalize: (topicId: string, mediaId: string) =>
      adminMediaApi.finalize(
        accessToken!,
        topicId,
        mediaId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    delete: (topicId: string, mediaId: string) =>
      adminMediaApi.delete(
        accessToken!,
        topicId,
        mediaId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
  };
}

export function useAdminUsersApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    list: (page?: number, pageSize?: number) =>
      adminUsersApi.list(
        accessToken!,
        refreshSession,
        setAccessToken,
        onSessionExpired,
        page,
        pageSize,
      ),
    create: (data: CreateUserInput) =>
      adminUsersApi.create(accessToken!, data, refreshSession, setAccessToken, onSessionExpired),
    update: (id: string, data: Partial<UpdateUserInput>) =>
      adminUsersApi.update(
        accessToken!,
        id,
        data,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    deactivate: (id: string) =>
      adminUsersApi.deactivate(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
  };
}

export function useAdminTasksApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    list: (status?: TaskStatus) =>
      adminTasksApi.list(
        accessToken!,
        refreshSession,
        setAccessToken,
        onSessionExpired,
        status,
      ),
    create: (data: CreateTaskInput) =>
      adminTasksApi.create(accessToken!, data, refreshSession, setAccessToken, onSessionExpired),
    getById: (id: string) =>
      adminTasksApi.getById(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
    update: (id: string, data: UpdateTaskInput) =>
      adminTasksApi.update(
        accessToken!,
        id,
        data,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    archive: (id: string) =>
      adminTasksApi.archive(accessToken!, id, refreshSession, setAccessToken, onSessionExpired),
    setTaskTopics: (id: string, topicIds: string[]) =>
      adminTasksApi.setTaskTopics(
        accessToken!,
        id,
        topicIds,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    createStage: (taskId: string, label: string) =>
      adminTasksApi.createStage(
        accessToken!,
        taskId,
        label,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    updateStage: (taskId: string, stageId: string, label: string) =>
      adminTasksApi.updateStage(
        accessToken!,
        taskId,
        stageId,
        label,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    deleteStage: (taskId: string, stageId: string) =>
      adminTasksApi.deleteStage(
        accessToken!,
        taskId,
        stageId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    reorderStages: (taskId: string, stageIds: string[]) =>
      adminTasksApi.reorderStages(
        accessToken!,
        taskId,
        stageIds,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    setStageTopics: (taskId: string, stageId: string, topicIds: string[]) =>
      adminTasksApi.setStageTopics(
        accessToken!,
        taskId,
        stageId,
        topicIds,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
  };
}

export function useAdminEnrollmentApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    listUserGrants: (userId: string) =>
      adminEnrollmentApi.listUserGrants(
        accessToken!,
        userId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    grantUserTopic: (userId: string, topicNodeId: string) =>
      adminEnrollmentApi.grantUserTopic(
        accessToken!,
        userId,
        topicNodeId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    revokeUserTopic: (userId: string, topicId: string, cascade?: boolean) =>
      adminEnrollmentApi.revokeUserTopic(
        accessToken!,
        userId,
        topicId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
        cascade,
      ),
    listGroupGrants: (groupId: string) =>
      adminEnrollmentApi.listGroupGrants(
        accessToken!,
        groupId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    grantGroupTopic: (groupId: string, topicNodeId: string) =>
      adminEnrollmentApi.grantGroupTopic(
        accessToken!,
        groupId,
        topicNodeId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      ),
    revokeGroupTopic: (groupId: string, topicId: string, cascade?: boolean) =>
      adminEnrollmentApi.revokeGroupTopic(
        accessToken!,
        groupId,
        topicId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
        cascade,
      ),
  };
}

export function useProgressApi() {
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  return {
    getSummary: () =>
      progressApi.getSummary(accessToken!, refreshSession, setAccessToken, onSessionExpired),
    getTopics: () =>
      progressApi.getTopics(accessToken!, refreshSession, setAccessToken, onSessionExpired),
    getTasks: () =>
      progressApi.getTasks(accessToken!, refreshSession, setAccessToken, onSessionExpired),
  };
}

export async function getDashboardWithAuth(
  accessToken: string | null,
  refreshSession: () => Promise<string | null>,
  setAccessToken: (token: string | null) => void,
  onSessionExpired: () => void,
) {
  return getDashboard(accessToken!, refreshSession, setAccessToken, onSessionExpired);
}
