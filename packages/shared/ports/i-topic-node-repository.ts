import type { Entities } from '../types/entities';

export interface TopicNodeRecord {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  status: Entities.Config.TopicNodeStatus;
  tags: Entities.Content.Tag[];
  order: number;
  estimatedMinutes: number;
  prerequisiteIds: string[];
  archived: boolean;
}

export interface CreateTopicNodeInput {
  parentId?: string | null;
  title: string;
  content?: string;
  status?: Entities.Config.TopicNodeStatus;
  estimatedMinutes?: number;
  tagIds?: string[];
  prerequisiteIds?: string[];
  order?: number;
}

export interface UpdateTopicNodeInput {
  title?: string;
  content?: string;
  status?: Entities.Config.TopicNodeStatus;
  estimatedMinutes?: number;
  tagIds?: string[];
  prerequisiteIds?: string[];
}

export interface ITopicNodeRepository {
  findById(id: string): Promise<TopicNodeRecord | null>;
  /** Returns direct children. Pass `null` to list root-level nodes only. */
  listChildren(parentId: string | null, opts?: { limit?: number; offset?: number }): Promise<TopicNodeRecord[]>;
  /** Returns every node regardless of status or archive state, sorted by parent then order. */
  listAll(opts?: { limit?: number; offset?: number }): Promise<TopicNodeRecord[]>;
  create(data: CreateTopicNodeInput): Promise<TopicNodeRecord>;
  update(id: string, data: UpdateTopicNodeInput): Promise<TopicNodeRecord>;
  /** Move a node to a new parent (or root). Atomic: validates cycle, updates parent + order, renumbers siblings. */
  move(id: string, newParentId: string | null, newSortOrder?: number): Promise<TopicNodeRecord>;
  /** Soft-archive the node and cascade to all descendants. */
  archive(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  /** Returns true if making `nodeId` a child of `proposedParentId` would create a cycle. */
  wouldCreateCycle(nodeId: string, proposedParentId: string): Promise<boolean>;
}
