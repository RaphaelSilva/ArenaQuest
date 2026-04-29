export namespace Entities {

    export namespace Config {
        export enum UserStatus {
            ACTIVE = 'active',
            INACTIVE = 'inactive',
            PENDING = 'pending',
            BANNED = 'banned',
        }

        export enum TopicNodeStatus {
            DRAFT = 'draft',
            PUBLISHED = 'published',
            ARCHIVED = 'archived',
        }

        export enum MediaStatus {
            PENDING = 'pending',
            READY = 'ready',
            DELETED = 'deleted',
        }

        export enum ProgressStatus {
            NOT_STARTED = 'not_started',
            IN_PROGRESS = 'in_progress',
            COMPLETED = 'completed',
        }

    }

    export namespace Security {
        export interface Role {
            id: string;
            name: string;
            description: string;
            createdAt: Date;
        }
    }

    export namespace Identity {
        export interface User {
            id: string;
            name: string;
            email: string;
            status: Config.UserStatus;
            roles: Security.Role[];
            groups: UserGroup[];
            createdAt: Date;
        }

        export interface Profile {
            id: string;
            user: User;
            bio: string;
            avatarUrl: string;
            createdAt: Date;
            updatedAt: Date;
        }

        export interface UserGroup {
            id: string;
            name: string;
            description: string;
            users: User[];
            roles: Security.Role[];
            createdAt: Date;
        }

        export interface EnrollmentUser {
            id: string;
            user: User;
            topicNode: Content.TopicNode;
            grantedAt: Date;
            grantedBy: User;
        }

        export interface EnrollmentUserGroup {
            id: string;
            userGroup: UserGroup;
            topicNode: Content.TopicNode;
            grantedAt: Date;
            grantedBy: User;
        }
    }

    export namespace Content {

        export interface Media {
            id: string;
            topicNodeId: string;
            /** Resolved by the storage adapter at the route layer; empty string when returned by the repository. */
            url: string;
            type: string;
            storageKey: string;
            sizeBytes: number;
            originalName: string;
            uploadedById: string;
            status: Config.MediaStatus;
            createdAt: Date;
            updatedAt: Date;
        }

        export interface Tag {
            id: string;
            name: string;
            slug: string;
        }

        export interface TopicNode {
            id: string;
            parentId: TopicNode;
            title: string;
            content: string;
            status: Config.TopicNodeStatus;
            media: Media[];
            tags: Tag[];
            order: number;
            estimatedMinutes: number;
            prerequisiteIds: string[];
        }

    }

    export namespace Engagement {

        export interface Task {
            id: string;
            title: string;
            description: string;
            stages: TaskStage[];
            linkedTopic: Content.TopicNode[];
        }

        export interface TaskStage {
            id: string;
            task: Engagement.Task;
            linkedTopic: Content.TopicNode[];
            label: string;
            order: number;
        }

    }

    export namespace Progress {

        export interface TopicProgress {
            id: string;
            user: Identity.User;
            topicNode: Content.TopicNode;
            status: Config.ProgressStatus;
            completedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        }

        export interface TaskProgress {
            id: string;
            user: Identity.User;
            task: Engagement.Task;
            currentStage: Engagement.TaskStage;
            status: Config.ProgressStatus;
            completedAt: Date;
            updatedAt: Date;
            createdAt: Date;
        }
    }
}