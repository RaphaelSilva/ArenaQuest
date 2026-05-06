import type { Metadata } from 'next';
import { DashboardClient } from '@web/components/dashboard/dashboard-client';

export const metadata: Metadata = { title: 'Dashboard — ArenaQuest' };

export default function DashboardPage() {
  return <DashboardClient />;
}
