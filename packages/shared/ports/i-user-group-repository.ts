export interface UserGroupRecord {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  createdAt: string;
}

export interface GroupMemberRecord {
  userId: string;
  name: string;
  email: string;
}

export interface CreateUserGroupInput {
  id: string;
  name: string;
  description: string;
}

export interface IUserGroupRepository {
  listAll(): Promise<UserGroupRecord[]>;
  getById(id: string): Promise<UserGroupRecord | null>;
  findByName(name: string): Promise<UserGroupRecord | null>;
  create(input: CreateUserGroupInput): Promise<UserGroupRecord>;
  listMembers(groupId: string): Promise<GroupMemberRecord[]>;
  /** Idempotent: adding an existing member is a no-op. */
  addMember(groupId: string, userId: string): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
}
