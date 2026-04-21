import type { Entities } from '../types/entities';

export interface UserRecord extends Entities.Identity.User {
  passwordHash: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  status?: Entities.Config.UserStatus;
  /** Role names to assign on creation (e.g. ['student']). Defaults to no roles. */
  roleNames?: string[];
}

export interface UpdateUserInput {
  name?: string;
  status?: Entities.Config.UserStatus;
  /** Replace the user's roles with this list of role names. Omit to leave roles unchanged. */
  roleNames?: string[];
}

export interface IUserRepository {
  findById(id: string): Promise<Entities.Identity.User | null>;
  /** Returns the full record including passwordHash — never expose this over the wire. */
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: CreateUserInput): Promise<Entities.Identity.User>;
  update(id: string, data: Partial<UpdateUserInput>): Promise<Entities.Identity.User>;
  delete(id: string): Promise<void>;
  list(opts?: { limit?: number; offset?: number }): Promise<Entities.Identity.User[]>;
  count(): Promise<number>;
  /**
   * Count distinct users who are currently `active` AND hold the `admin` role.
   * Used to prevent mutations that would leave the platform with no admins.
   */
  countActiveAdmins(): Promise<number>;
  /**
   * Update only the password hash column for a user.
   * Used by the transparent PBKDF2 rehash path — isolated from the general
   * `update` method to avoid accidentally overwriting other fields.
   */
  updatePasswordHash(id: string, hash: string): Promise<void>;
}
