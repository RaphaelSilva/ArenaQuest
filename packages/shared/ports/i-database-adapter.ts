/**
 * IDatabaseAdapter
 *
 * Cloud-agnostic contract for all database persistence operations.
 *
 * Architecture notes:
 * - The adapter is split into typed Repository interfaces, one per domain aggregate.
 * - No ORM, query builder, or provider SDK types ever cross this boundary.
 * - Designed to be backed by PostgreSQL/JSONB (Neon, Supabase, RDS), MongoDB Atlas,
 *   Cloud Firestore, or DynamoDB — the business layer is unaware of the choice.
 * - All methods return plain domain objects (as defined in @arenaquest/shared).
 *
 * Usage:
 *   const db: IDatabaseAdapter = container.resolve('database');
 *   const user = await db.users.findById('usr_123');
 */

import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Generic query primitives
// ---------------------------------------------------------------------------

/**
 * A partial record used for equality-based filtering.
 * Extend with more operators (gt, lt, in, like) as query needs grow.
 */
export type WhereClause<T> = Partial<{
  [K in keyof T]: T[K] | { in: T[K][] };
}>;

/** Pagination and sorting options shared by all findMany calls. */
export interface FindManyOptions<T> {
  where?: WhereClause<T>;
  /** Maximum number of records to return. */
  limit?: number;
  /** Number of records to skip (offset-based paging). */
  offset?: number;
  /** Field name to sort by. */
  orderBy?: keyof T;
  /** Sort direction. Defaults to 'asc'. */
  orderDirection?: 'asc' | 'desc';
}

/** Result wrapper for paginated findMany calls. */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Generic repository interface
// ---------------------------------------------------------------------------

/**
 * Base CRUD contract for a single entity type.
 * `T`  = full entity (what gets returned)
 * `TCreate` = shape required to create a new record (no id/timestamps)
 * `TUpdate` = partial update shape
 */
export interface IRepository<T, TCreate, TUpdate = Partial<TCreate>> {
  /**
   * Find a single entity by its primary key.
   * Returns null when not found.
   */
  findById(id: string): Promise<T | null>;

  /**
   * Fetch a list of entities matching the given filter/sort/page options.
   */
  findMany(options?: FindManyOptions<T>): Promise<PaginatedResult<T>>;

  /**
   * Find a single entity matching a where clause.
   * Returns null when not found.
   */
  findOne(where: WhereClause<T>): Promise<T | null>;

  /**
   * Persist a new entity. The adapter is responsible for generating the id
   * and setting createdAt / updatedAt timestamps.
   */
  create(data: TCreate): Promise<T>;

  /**
   * Persist multiple new entities in a single transaction.
   */
  createMany(data: TCreate[]): Promise<T[]>;

  /**
   * Apply a partial update to an existing entity.
   * Returns the updated entity, or null if the id was not found.
   */
  update(id: string, data: TUpdate): Promise<T | null>;

  /**
   * Remove an entity by id.
   * Returns true if a record was deleted, false if the id was not found.
   */
  delete(id: string): Promise<boolean>;

  /**
   * Count entities matching an optional where clause.
   */
  count(where?: WhereClause<T>): Promise<number>;

  /**
   * Check whether an entity with the given id exists.
   */
  exists(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Create / Update DTOs per aggregate
// (Omit id and generated timestamps — the adapter owns those)
// ---------------------------------------------------------------------------

type OmitGenerated<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

// Identity
type UserCreate = OmitGenerated<Entities.Identity.User>;
type UserUpdate = Partial<UserCreate>;

type UserGroupCreate = OmitGenerated<Entities.Identity.UserGroup>;
type UserGroupUpdate = Partial<UserGroupCreate>;

type ProfileCreate = OmitGenerated<Entities.Identity.Profile>;
type ProfileUpdate = Partial<ProfileCreate>;

type EnrollmentUserCreate = OmitGenerated<Entities.Identity.EnrollmentUser>;
type EnrollmentUserGroupCreate = OmitGenerated<Entities.Identity.EnrollmentUserGroup>;

// Security
type RoleCreate = OmitGenerated<Entities.Security.Role>;
type RoleUpdate = Partial<RoleCreate>;

// Content
type TopicNodeCreate = OmitGenerated<Entities.Content.TopicNode>;
type TopicNodeUpdate = Partial<TopicNodeCreate>;

type MediaCreate = OmitGenerated<Entities.Content.Media>;
type TagCreate = OmitGenerated<Entities.Content.Tag>;
type TagUpdate = Partial<TagCreate>;

// Engagement
type TaskCreate = OmitGenerated<Entities.Engagement.Task>;
type TaskUpdate = Partial<TaskCreate>;

type TaskStageCreate = OmitGenerated<Entities.Engagement.TaskStage>;
type TaskStageUpdate = Partial<TaskStageCreate>;

// Progress
type TopicProgressCreate = OmitGenerated<Entities.Progress.TopicProgress>;
type TopicProgressUpdate = Partial<TopicProgressCreate>;

type TaskProgressCreate = OmitGenerated<Entities.Progress.TaskProgress>;
type TaskProgressUpdate = Partial<TaskProgressCreate>;

// ---------------------------------------------------------------------------
// Domain-specific repository extensions
// ---------------------------------------------------------------------------

/** Extended operations for the User aggregate. */
export interface IUserRepository
  extends IRepository<Entities.Identity.User, UserCreate, UserUpdate> {
  /** Look up a user by their unique email address. */
  findByEmail(email: string): Promise<Entities.Identity.User | null>;
  /** Assign one or more roles to a user. */
  assignRoles(userId: string, roleIds: string[]): Promise<void>;
  /** Remove one or more roles from a user. */
  removeRoles(userId: string, roleIds: string[]): Promise<void>;
  /** Add a user to one or more groups. */
  addToGroups(userId: string, groupIds: string[]): Promise<void>;
}

/** Extended operations for the TopicNode tree. */
export interface ITopicNodeRepository
  extends IRepository<Entities.Content.TopicNode, TopicNodeCreate, TopicNodeUpdate> {
  /** Return all direct children of a given parent node. */
  findChildren(parentId: string): Promise<Entities.Content.TopicNode[]>;
  /** Return the full subtree rooted at the given node (recursive). */
  findSubtree(rootId: string): Promise<Entities.Content.TopicNode[]>;
  /** Return all root-level nodes (parentId is null). */
  findRoots(): Promise<Entities.Content.TopicNode[]>;
  /** Reorder siblings by providing an array of ids in the desired order. */
  reorder(orderedIds: string[]): Promise<void>;
}

/** Extended operations for enrollment management. */
export interface IEnrollmentRepository {
  enrollUser(data: EnrollmentUserCreate): Promise<Entities.Identity.EnrollmentUser>;
  enrollGroup(data: EnrollmentUserGroupCreate): Promise<Entities.Identity.EnrollmentUserGroup>;
  revokeUserEnrollment(userId: string, topicNodeId: string): Promise<boolean>;
  revokeGroupEnrollment(groupId: string, topicNodeId: string): Promise<boolean>;
  findEnrolledTopics(userId: string): Promise<Entities.Content.TopicNode[]>;
  findEnrolledUsers(topicNodeId: string): Promise<Entities.Identity.User[]>;
}

/** Extended operations for user progress tracking. */
export interface IProgressRepository {
  topicProgress: IRepository<
    Entities.Progress.TopicProgress,
    TopicProgressCreate,
    TopicProgressUpdate
  >;
  taskProgress: IRepository<
    Entities.Progress.TaskProgress,
    TaskProgressCreate,
    TaskProgressUpdate
  >;
  /** Return a user's progress snapshot across all enrolled topics. */
  getUserProgressSummary(
    userId: string,
  ): Promise<{
    topicsTotal: number;
    topicsCompleted: number;
    tasksTotal: number;
    tasksCompleted: number;
  }>;
}

// ---------------------------------------------------------------------------
// Main adapter interface
// ---------------------------------------------------------------------------

/**
 * IDatabaseAdapter
 *
 * The single entry point injected into services and route handlers.
 * Each property exposes a typed repository for one domain aggregate.
 *
 * Transactional operations across multiple repositories should be performed
 * via `transaction()`, which receives a callback executed inside a single
 * atomic unit.
 */
export interface IDatabaseAdapter {
  // Identity
  users: IUserRepository;
  userGroups: IRepository<
    Entities.Identity.UserGroup,
    UserGroupCreate, UserGroupUpdate>;
  profiles: IRepository<Entities.Identity.Profile, ProfileCreate, ProfileUpdate>;
  enrollments: IEnrollmentRepository;

  // Security
  roles: IRepository<Entities.Security.Role, RoleCreate, RoleUpdate>;

  // Content
  topicNodes: ITopicNodeRepository;
  media: IRepository<Entities.Content.Media, MediaCreate>;
  tags: IRepository<Entities.Content.Tag, TagCreate, TagUpdate>;

  // Engagement
  tasks: IRepository<Entities.Engagement.Task, TaskCreate, TaskUpdate>;
  taskStages: IRepository<Entities.Engagement.TaskStage, TaskStageCreate, TaskStageUpdate>;

  // Progress
  progress: IProgressRepository;

  /**
   * Execute a callback inside a single atomic transaction.
   * The adapter passed to the callback is scoped to the transaction.
   * Rolls back automatically on any thrown error.
   *
   * @example
   * await db.transaction(async (tx) => {
   *   const user = await tx.users.create({ ... });
   *   await tx.profiles.create({ user, ... });
   * });
   */
  transaction<T>(callback: (tx: IDatabaseAdapter) => Promise<T>): Promise<T>;

  /**
   * Verify the database connection is healthy.
   * Used by the /health endpoint.
   */
  ping(): Promise<boolean>;
}