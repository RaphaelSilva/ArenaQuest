'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Entities } from '@arenaquest/shared/types/entities';
import { ROLES } from '@arenaquest/shared/constants/roles';
import type { RoleName } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { adminUsersApi, type CreateUserInput, type UpdateUserInput } from '@web/lib/admin-users-api';
import { Spinner } from '@web/components/spinner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const ALL_ROLES: RoleName[] = [ROLES.ADMIN, ROLES.CONTENT_CREATOR, ROLES.TUTOR, ROLES.STUDENT];

// ---------------------------------------------------------------------------
// User form (create / edit)
// ---------------------------------------------------------------------------

type UserFormProps = {
  initial?: Entities.Identity.User;
  onSubmit: (data: CreateUserInput | Partial<UpdateUserInput>) => Promise<void>;
  onClose: () => void;
};

function UserForm({ initial, onSubmit, onClose }: UserFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<RoleName[]>(
    initial ? (initial.roles.map((r) => r.name as RoleName)) : [ROLES.STUDENT],
  );
  const [status, setStatus] = useState<Entities.Config.UserStatus | undefined>(
    initial?.status,
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isEdit = Boolean(initial);

  function toggleRole(role: RoleName) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('Name is required.'); return; }
    if (!isEdit && !email.trim()) { setError('Email is required.'); return; }
    if (!isEdit && password.length < 8) { setError('Password must be at least 8 characters.'); return; }

    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: Partial<UpdateUserInput> = { name: name.trim(), roles, status };
        await onSubmit(payload);
      } else {
        await onSubmit({ name: name.trim(), email: email.trim(), password, roles });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit User' : 'Create User'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {isEdit ? 'Edit User' : 'Create User'}
        </h2>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="uf-name" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Name
            </label>
            <input
              id="uf-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
          </div>

          {!isEdit && (
            <>
              <div>
                <label htmlFor="uf-email" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Email
                </label>
                <input
                  id="uf-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>
              <div>
                <label htmlFor="uf-password" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Password
                </label>
                <input
                  id="uf-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                />
              </div>
            </>
          )}

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Roles</legend>
            <div className="flex flex-wrap gap-2">
              {ALL_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {role}
                </label>
              ))}
            </div>
          </fieldset>

          {isEdit && (
            <div>
              <label htmlFor="uf-status" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Status
              </label>
              <select
                id="uf-status"
                value={status ?? ''}
                onChange={(e) => setStatus(e.target.value as Entities.Config.UserStatus)}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="pending">pending</option>
                <option value="banned">banned</option>
              </select>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting && <Spinner className="h-4 w-4" />}
              {isEdit ? 'Save changes' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm action"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900">
        <p className="mb-4 text-sm text-zinc-700 dark:text-zinc-300">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminUsersPage() {
  const router = useRouter();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const { accessToken, isLoading: authLoading } = useAuth();

  const [users, setUsers] = useState<Entities.Identity.User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Entities.Identity.User | undefined>(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState<Entities.Identity.User | undefined>(undefined);

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const fetchUsers = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const result = await adminUsersApi.list(accessToken, page, pageSize);
      setUsers(result.data);
      setTotal(result.total);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, pageSize]);

  useEffect(() => {
    if (isAdmin && accessToken) fetchUsers();
  }, [isAdmin, accessToken, fetchUsers]);

  async function handleCreate(data: CreateUserInput | Partial<UpdateUserInput>) {
    await adminUsersApi.create(accessToken!, data as CreateUserInput);
    setPage(1);
    await fetchUsers();
  }

  async function handleUpdate(data: CreateUserInput | Partial<UpdateUserInput>) {
    await adminUsersApi.update(accessToken!, editTarget!.id, data as Partial<UpdateUserInput>);
    await fetchUsers();
  }

  async function handleDeactivate() {
    await adminUsersApi.deactivate(accessToken!, deactivateTarget!.id);
    setDeactivateTarget(undefined);
    await fetchUsers();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">User Management</h1>
        <button
          onClick={() => { setEditTarget(undefined); setShowForm(true); }}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create User
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8 text-zinc-400" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Roles</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created At</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {users.map((u) => (
                  <tr key={u.id} className="bg-white dark:bg-zinc-900">
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50">{u.name}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{u.email}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {u.roles.map((r) => r.name).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.status === 'active'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Enrollments
                        </Link>
                        <button
                          onClick={() => { setEditTarget(u); setShowForm(true); }}
                          className="text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Edit
                        </button>
                        {u.status !== 'inactive' && (
                          <button
                            onClick={() => setDeactivateTarget(u)}
                            className="text-red-600 hover:underline dark:text-red-400"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value) as typeof pageSize); setPage(1); }}
                className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <span>
                Page {page} of {totalPages} ({total} total)
              </span>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Prev
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <UserForm
          initial={editTarget}
          onSubmit={editTarget ? handleUpdate : handleCreate}
          onClose={() => { setShowForm(false); setEditTarget(undefined); }}
        />
      )}

      {deactivateTarget && (
        <ConfirmDialog
          message={`Deactivate "${deactivateTarget.name}"? They will no longer be able to log in.`}
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivateTarget(undefined)}
        />
      )}
    </main>
  );
}
