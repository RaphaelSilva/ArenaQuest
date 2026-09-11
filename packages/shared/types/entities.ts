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

        export enum TaskStatus {
            DRAFT = 'draft',
            PUBLISHED = 'published',
            ARCHIVED = 'archived',
        }

        /** Controls which authenticated users can see a topic node. */
        export enum TopicVisibility {
            /** Any authenticated user can see this node. */
            PUBLIC = 'public',
            /** A grant (enrollment) is required; this is the production default. */
            RESTRICTED = 'restricted',
            /** Visible to admins and the node creator only. */
            PRIVATE = 'private',
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

        /**
         * Billing period length of a contract. Constrained by the
         * `cycle IN ('monthly','quarterly','yearly')` CHECK on `billing_plans`
         * and `subscriptions` (RFC 0013 section 1).
         */
        export enum BillingCycle {
            MONTHLY = 'monthly',
            QUARTERLY = 'quarterly',
            YEARLY = 'yearly',
        }

        /**
         * Lifecycle of a signed contract. Constrained by the
         * `status IN ('active','paused','cancelled','superseded')` CHECK on
         * `subscriptions`. `paused` suppresses future issuance only: invoices
         * already open keep their due dates and keep counting toward standing.
         */
        export enum ContractStatus {
            ACTIVE = 'active',
            PAUSED = 'paused',
            CANCELLED = 'cancelled',
            SUPERSEDED = 'superseded',
        }

        /**
         * Whether a contract carries the catalogue terms or individually
         * negotiated ones. Constrained by the
         * `terms_source IN ('standard','negotiated')` CHECK on `subscriptions`.
         */
        export enum ContractTermsSource {
            STANDARD = 'standard',
            NEGOTIATED = 'negotiated',
        }

        /**
         * Lifecycle of a charge. Constrained by the
         * `status IN ('open','paid','void')` CHECK on `invoices`. `paid` is a
         * cache of the balance sum, never an independent truth.
         */
        export enum InvoiceStatus {
            OPEN = 'open',
            PAID = 'paid',
            VOID = 'void',
        }

        /**
         * How money was received. Constrained by the
         * `method IN ('cash','pix','bank_transfer','card','gateway','other')`
         * CHECK on `payments`. `gateway` is reserved: SQLite cannot alter a
         * CHECK without rebuilding the table, so the value exists from day one
         * and no code in this milestone produces it (RFC 0013 #9).
         */
        export enum PaymentMethod {
            CASH = 'cash',
            PIX = 'pix',
            BANK_TRANSFER = 'bank_transfer',
            CARD = 'card',
            GATEWAY = 'gateway',
            OTHER = 'other',
        }

        /**
         * The derived label a billing report shows for a student. It is never
         * persisted: it is only ever the return value of `resolveStanding`
         * (RFC 0013 section 2).
         */
        export enum BillingStanding {
            GOOD = 'good',
            DUE = 'due',
            DELINQUENT = 'delinquent',
            EXEMPT = 'exempt',
        }

        /**
         * A signed, append-only override on a single invoice. Constrained by
         * the `kind IN ('discount','credit','waiver','surcharge')` CHECK on
         * `invoice_adjustments`. `surcharge` is reserved: every adjustment is
         * applied by hand and nothing in this system accrues a fee on its own.
         */
        export enum AdjustmentKind {
            DISCOUNT = 'discount',
            CREDIT = 'credit',
            WAIVER = 'waiver',
            SURCHARGE = 'surcharge',
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
            timezone: string;
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
            mediaCount?: {
                video: number;
                audio: number;
                pdf: number;
                total: number;
            };
        }

    }

    export namespace Engagement {

        export interface Task {
            id: string;
            title: string;
            description: string;
            status: Config.TaskStatus;
            createdBy: string;
            createdAt: Date;
            updatedAt: Date;
            stages: TaskStage[];
            linkedTopic: Content.TopicNode[];
        }

        export interface TaskStage {
            id: string;
            task: Engagement.Task;
            linkedTopic: Content.TopicNode[];
            label: string;
            order: number;
            createdAt: Date;
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

    export namespace OAuth {
        export interface OAuthAccount {
            provider: string;
            providerUserId: string;
            userId: string;
            email: string;
            createdAt: Date;
        }
    }

    export namespace Gamification {
        export interface XpEvent {
            id: string;
            userId: string;
            sourceKind: string;
            sourceId: string | null;
            points: number;
            idempotencyKey: string;
            earnedAt: Date;
        }

        export interface UserXp {
            userId: string;
            totalXp: number;
            updatedAt: Date;
        }

        export interface UserStreak {
            userId: string;
            currentStreak: number;
            longestStreak: number;
            lastActivityDate: string | null;
            updatedAt: Date;
        }

        export interface LevelDefinition {
            level: number;
            rankTitle: string;
            minXp: number;
            maxXp: number | null;
        }

        export interface Badge {
            id: string;
            slug: string;
            name: string;
            iconEmoji: string;
            description: string;
            xpReward: number;
            ruleKind: string;
            ruleParams: string;
            active: boolean;
            createdAt: string;
            updatedAt: string;
        }

        export interface QuestDefinition {
            id: string;
            kind: 'daily' | 'weekly';
            title: string;
            description: string;
            predicateKind: string;
            predicateParams: string; // Raw JSON from DB
            xpReward: number;
            active: boolean;
            createdAt: Date;
            updatedAt: Date;
        }

        export interface Mission {
            id: string;
            title: string;
            description: string;
            startAt: string;
            endAt: string;
            predicateKind: string;
            predicateParams: string;
            xpReward: number;
            badgeId: string | null;
            active: boolean;
            createdAt: Date;
            updatedAt: Date;
        }
    }

    /**
     * Student billing, contracts and receivables (RFC 0013).
     *
     * Money is always an integer count of a currency's minor unit
     * (`amountMinor`); how many minor units make a whole is `Currency.exponent`
     * — 2 for BRL, 0 for JPY, 8 for BTC — so no amount here is meaningful
     * without the currency row it points at.
     *
     * No entity in this namespace carries a standing field. Standing is derived
     * on every read by `resolveStanding` and never stored, because a stored flag
     * goes stale at midnight when nothing is running.
     */
    export namespace Billing {
        /** Reference data. `exponent` is how many minor units make one whole. */
        export interface Currency {
            code: string;
            exponent: number;
            symbol: string;
            name: string;
            /** Exactly one currency is active per tenant. */
            active: boolean;
        }

        /**
         * The shelf: what a student can be sold. Freely editable, because a
         * subscription snapshots its terms at signature and never reads them
         * again.
         */
        export interface BillingPlan {
            id: string;
            name: string;
            description: string;
            amountMinor: number;
            currency: string;
            cycle: Config.BillingCycle;
            graceDays: number;
            /** Reserved for a future per-topic plan; read by nothing in v1. */
            scopeTopicId: string | null;
            archived: boolean;
            createdAt: Date;
            updatedAt: Date;
        }

        /**
         * The executed contract. `amountMinor`, `currency`, `cycle` and
         * `graceDays` are snapshots taken from the plan at signature; a
         * negotiated contract is this same row with different terms and
         * `termsSource = 'negotiated'`. Amending supersedes rather than edits:
         * every version of a chain shares one `contractGroupId`.
         */
        export interface Subscription {
            id: string;
            userId: string;
            /** Provenance only — the terms below are never re-read from it. */
            planId: string;
            /** The first version sets this to its own id. */
            contractGroupId: string;
            supersedesId: string | null;
            termsSource: Config.ContractTermsSource;
            amountMinor: number;
            currency: string;
            cycle: Config.BillingCycle;
            graceDays: number;
            /** 1..28, so a February due date is always a real day. */
            dueDay: number;
            status: Config.ContractStatus;
            /** YYYY-MM-DD — this version's start, not the student's. */
            startDate: string;
            /** YYYY-MM-DD; set on cancel or supersede. No invoice past it. */
            endDate: string | null;
            termsNote: string;
            signedBy: string;
            signedAt: Date;
            updatedAt: Date;
        }

        /**
         * A charge for one period, snapshot from the contract. The period is
         * the idempotency key of the invoice run. An amount of 0 is issued like
         * any other and settles on arrival.
         */
        export interface Invoice {
            id: string;
            subscriptionId: string;
            userId: string;
            /** YYYY-MM-DD, inclusive. */
            periodStart: string;
            /** YYYY-MM-DD, exclusive. */
            periodEnd: string;
            dueDate: string;
            amountMinor: number;
            currency: string;
            /** Snapshot; the copy `resolveStanding` reads. */
            graceDays: number;
            status: Config.InvoiceStatus;
            issuedAt: Date;
            voidedAt: Date | null;
            voidReason: string | null;
        }

        /**
         * A signed, append-only override on one invoice. Applied by hand;
         * nothing accrues on its own.
         */
        export interface InvoiceAdjustment {
            id: string;
            invoiceId: string;
            kind: Config.AdjustmentKind;
            /** Signed and never zero; negative reduces what is owed. */
            amountMinor: number;
            reason: string;
            appliedBy: string;
            appliedAt: Date;
        }

        /**
         * Money actually received. Append-only: a mistake is corrected by a
         * reversing row whose amount is negative, never by an UPDATE.
         */
        export interface Payment {
            id: string;
            invoiceId: string;
            /** Signed and never zero; negative is a reversal. */
            amountMinor: number;
            currency: string;
            method: Config.PaymentMethod;
            /** When the money moved, not when it was typed in. */
            paidAt: Date;
            /** Receipt number today; a gateway charge id later. */
            externalReference: string | null;
            note: string;
            reversesId: string | null;
            recordedBy: string;
            recordedAt: Date;
        }

        /**
         * "Stop chasing this one." Suppresses the delinquency list and the
         * reminder mail while a dispute is open or a payment is being verified.
         * The debt is unchanged and still counts in every total. A scholarship
         * is a free plan, not a hold.
         */
        export interface BillingStandingHold {
            userId: string;
            reason: string;
            /** YYYY-MM-DD; null never expires. An expired hold is no hold. */
            expiresAt: string | null;
            setBy: string;
            setAt: Date;
        }
    }
}