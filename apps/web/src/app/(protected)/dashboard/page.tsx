import type { Metadata } from 'next';
import { DashboardContent } from '@web/components/dashboard/DashboardContent';

export const metadata: Metadata = { title: 'Dashboard — ArenaQuest' };

export default function DashboardPage() {
  return <DashboardContent />;
}
