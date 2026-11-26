import type { Metadata } from 'next';
import { DashboardContent } from '@web/components/dashboard/DashboardContent';
import { PaymentDueCard } from '@web/components/dashboard/PaymentDueCard';

export const metadata: Metadata = { title: 'Dashboard — ArenaQuest' };

export default function DashboardPage() {
  // One more block, never a gate: the card renders nothing unless the student
  // has an open invoice that can be paid online.
  return <DashboardContent notice={<PaymentDueCard />} />;
}
