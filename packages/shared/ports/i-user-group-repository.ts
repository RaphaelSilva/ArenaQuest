export interface UserGroupRecord {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  createdAt: string;
}

export interface IUserGroupRepository {
  listAll(): Promise<UserGroupRecord[]>;
}
