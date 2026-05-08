export interface EnrollmentUserRecord {
  id: string;
  userId: string;
  topicNodeId: string;
  grantedBy: string;
  grantedAt: string;
}

export interface EnrollmentGroupRecord {
  id: string;
  groupId: string;
  topicNodeId: string;
  grantedBy: string;
  grantedAt: string;
}

export interface IEnrollmentRepository {
  /**
   * Returns the full set of topic IDs a student can access: union of direct
   * user grants, group grants, and ALL descendants of any granted subtree.
   * Uses a recursive CTE — O(grants + descendants), no materialised cache.
   */
  getEffectiveAccessTopicIds(userId: string): Promise<string[]>;

  // User grants
  listUserGrants(userId: string): Promise<EnrollmentUserRecord[]>;
  grantUser(userId: string, topicNodeId: string, grantedBy: string): Promise<EnrollmentUserRecord>;
  revokeUser(userId: string, topicNodeId: string, opts?: { cascade?: boolean }): Promise<void>;

  // Group grants
  listGroupGrants(groupId: string): Promise<EnrollmentGroupRecord[]>;
  grantGroup(
    groupId: string,
    topicNodeId: string,
    grantedBy: string,
  ): Promise<EnrollmentGroupRecord>;
  revokeGroup(groupId: string, topicNodeId: string, opts?: { cascade?: boolean }): Promise<void>;
}
