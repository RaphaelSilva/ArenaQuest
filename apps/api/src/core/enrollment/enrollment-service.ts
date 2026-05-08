import type {
  IEnrollmentRepository,
  IUserRepository,
  ITopicNodeRepository,
  EnrollmentUserRecord,
  EnrollmentGroupRecord,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

export class EnrollmentService {
  constructor(
    private readonly enrollment: IEnrollmentRepository,
    private readonly users: IUserRepository,
    private readonly topics: ITopicNodeRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // User grants
  // ---------------------------------------------------------------------------

  async listUserGrants(userId: string): Promise<ControllerResult<EnrollmentUserRecord[]>> {
    const user = await this.users.findById(userId);
    if (!user) return { ok: false, status: 404, error: 'NotFound' };

    const grants = await this.enrollment.listUserGrants(userId);
    return { ok: true, data: grants };
  }

  async grantUser(
    userId: string,
    topicNodeId: string,
    actorId: string,
  ): Promise<ControllerResult<{ grant: EnrollmentUserRecord; created: boolean }>> {
    const [user, topic] = await Promise.all([
      this.users.findById(userId),
      this.topics.findById(topicNodeId),
    ]);
    if (!user) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'user not found' } };
    if (!topic) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'topic not found' } };

    const existing = await this.enrollment
      .listUserGrants(userId)
      .then((grants) => grants.find((g) => g.topicNodeId === topicNodeId) ?? null);

    const grant = await this.enrollment.grantUser(userId, topicNodeId, actorId);
    const created = !existing;

    console.info(
      JSON.stringify({
        event: 'enrollment.grant_user',
        actor: actorId,
        userId,
        topicNodeId,
        grantId: grant.id,
        created,
        at: new Date().toISOString(),
      }),
    );

    return { ok: true, data: { grant, created } };
  }

  async revokeUser(
    userId: string,
    topicNodeId: string,
    actorId: string,
    opts?: { cascade?: boolean },
  ): Promise<ControllerResult<void>> {
    const user = await this.users.findById(userId);
    if (!user) return { ok: false, status: 404, error: 'NotFound' };

    await this.enrollment.revokeUser(userId, topicNodeId, opts);

    console.info(
      JSON.stringify({
        event: 'enrollment.revoke_user',
        actor: actorId,
        userId,
        topicNodeId,
        cascade: opts?.cascade ?? false,
        at: new Date().toISOString(),
      }),
    );

    return { ok: true, data: undefined };
  }

  // ---------------------------------------------------------------------------
  // Group grants
  // ---------------------------------------------------------------------------

  async listGroupGrants(groupId: string): Promise<ControllerResult<EnrollmentGroupRecord[]>> {
    const grants = await this.enrollment.listGroupGrants(groupId);
    return { ok: true, data: grants };
  }

  async grantGroup(
    groupId: string,
    topicNodeId: string,
    actorId: string,
  ): Promise<ControllerResult<{ grant: EnrollmentGroupRecord; created: boolean }>> {
    const topic = await this.topics.findById(topicNodeId);
    if (!topic) return { ok: false, status: 404, error: 'NotFound', meta: { detail: 'topic not found' } };

    const existing = await this.enrollment
      .listGroupGrants(groupId)
      .then((grants) => grants.find((g) => g.topicNodeId === topicNodeId) ?? null);

    const grant = await this.enrollment.grantGroup(groupId, topicNodeId, actorId);
    const created = !existing;

    console.info(
      JSON.stringify({
        event: 'enrollment.grant_group',
        actor: actorId,
        groupId,
        topicNodeId,
        grantId: grant.id,
        created,
        at: new Date().toISOString(),
      }),
    );

    return { ok: true, data: { grant, created } };
  }

  async revokeGroup(
    groupId: string,
    topicNodeId: string,
    actorId: string,
    opts?: { cascade?: boolean },
  ): Promise<ControllerResult<void>> {
    await this.enrollment.revokeGroup(groupId, topicNodeId, opts);

    console.info(
      JSON.stringify({
        event: 'enrollment.revoke_group',
        actor: actorId,
        groupId,
        topicNodeId,
        cascade: opts?.cascade ?? false,
        at: new Date().toISOString(),
      }),
    );

    return { ok: true, data: undefined };
  }
}
