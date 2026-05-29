'use client';

import type { FetchWithAuthOptions } from './fetch-with-auth';
import { fetchWithAuth } from './fetch-with-auth';
import * as topicsApiModule from './topics-api';
import * as tasksApiModule from './tasks-api';
import * as accountApiModule from './account-api';
import * as adminTopicsApiModule from './admin-topics-api';
import * as adminTasksApiModule from './admin-tasks-api';
import * as adminUsersApiModule from './admin-users-api';
import * as adminMediaApiModule from './admin-media-api';
import * as adminEnrollmentApiModule from './admin-enrollment-api';
import * as progressApiModule from './progress-api';
import * as dashboardApiModule from './dashboard-api';
import * as commentsApiModule from './comments-api';

// HTTP transport interface — injectable for testing
export interface HttpTransport {
  (method: string, path: string, options?: FetchWithAuthOptions): Promise<Response>;
}

// Create transport wrapper around fetchWithAuth
export function createFetchTransport(
  token: string | null,
  refreshFn: () => Promise<string | null>,
  onTokenUpdate: (token: string) => void,
  onSessionExpired: () => void,
): HttpTransport {
  return async (method: string, path: string, options?: FetchWithAuthOptions): Promise<Response> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
    return fetchWithAuth(
      `${apiUrl}${path}`,
      {
        ...options,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers ?? {}),
        },
      },
      token,
      refreshFn,
      onTokenUpdate,
      onSessionExpired,
    );
  };
}

// Main ApiClient class
export class ApiClient {
  private http: HttpTransport;

  constructor(
    token: string | null,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ) {
    this.http = createFetchTransport(token, refreshFn, onTokenUpdate, onSessionExpired);
  }

  // Domain-grouped namespaces
  get topics() {
    return topicsApiModule.createTopicsApi(this.http);
  }

  get tasks() {
    return tasksApiModule.createTasksApi(this.http);
  }

  get account() {
    return accountApiModule.createAccountApi(this.http);
  }

  get adminTopics() {
    return adminTopicsApiModule.createAdminTopicsApi(this.http);
  }

  get adminTasks() {
    return adminTasksApiModule.createAdminTasksApi(this.http);
  }

  get adminUsers() {
    return adminUsersApiModule.createAdminUsersApi(this.http);
  }

  get adminMedia() {
    return adminMediaApiModule.createAdminMediaApi(this.http);
  }

  get adminEnrollment() {
    return adminEnrollmentApiModule.createAdminEnrollmentApi(this.http);
  }

  get progress() {
    return progressApiModule.createProgressApi(this.http);
  }

  get dashboard() {
    return dashboardApiModule.createDashboardApi(this.http);
  }

  get comments() {
    return commentsApiModule.createCommentsApi(this.http);
  }
}
