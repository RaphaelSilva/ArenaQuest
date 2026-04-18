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
}
