'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { Nav } from '@web/components/layout/nav';
import { SidebarProvider } from '@web/context/sidebar-context';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user === null) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }

  if (user === null) return null;

  return (
    <SidebarProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Nav />
        <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </SidebarProvider>
  );
}
