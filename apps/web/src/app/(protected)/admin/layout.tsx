'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { AdminSidebar } from '@web/components/layout/admin-sidebar';
import { Spinner } from '@web/components/spinner';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoading } = useAuth();
  const canAccessAdmin = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  useEffect(() => {
    if (!isLoading && !canAccessAdmin) {
      router.replace('/dashboard');
    }
  }, [isLoading, canAccessAdmin, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }

  if (!canAccessAdmin) return null;

  return (
    <div className="flex flex-1">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
