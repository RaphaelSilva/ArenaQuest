import type { Entities } from '@arenaquest/shared/types/entities';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export type LoginResponse = {
  accessToken: string;
  user: Pick<Entities.Identity.User, 'id' | 'name' | 'email' | 'roles'>;
};

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    console.log('API_URL', API_URL);
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Login failed (${res.status})`);
    }

    return res.json();
  },

  async logout(): Promise<void> {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },

  async refresh(): Promise<{ accessToken: string } | null> {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) return null;
    return res.json();
  },
};
