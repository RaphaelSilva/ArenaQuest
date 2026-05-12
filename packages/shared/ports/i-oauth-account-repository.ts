import type { Entities } from '../types/entities';

export interface IOAuthAccountRepository {
  /** Return the local User linked to a provider identity, or null if not found. */
  findUserByProvider(
    provider: string,
    providerUserId: string,
  ): Promise<Entities.Identity.User | null>;

  /** Persist a new oauth_accounts row linking a provider identity to a local user. */
  link(
    provider: string,
    providerUserId: string,
    userId: string,
    email: string,
  ): Promise<void>;

  /** Return the OAuthAccount record for a given user + provider, or null. */
  findByUser(
    provider: string,
    userId: string,
  ): Promise<Entities.OAuth.OAuthAccount | null>;
}
