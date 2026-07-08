import type { CSSProperties } from 'react';

function ShimmerBlock({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-2xl ${className ?? ''}`}
      style={{ background: 'var(--aq-bg3)', ...style }}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto" style={{ padding: '28px 32px 40px' }}>
      {/* Greeting row */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <ShimmerBlock style={{ width: 220, height: 28 }} />
          <ShimmerBlock style={{ width: 160, height: 16 }} />
        </div>
        <ShimmerBlock style={{ width: 80, height: 16 }} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ShimmerBlock style={{ height: 140 }} />
        <ShimmerBlock style={{ height: 140 }} />
        <ShimmerBlock style={{ height: 140 }} />
      </div>

      {/* Main 2-col grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left */}
        <div className="flex flex-col gap-4">
          <ShimmerBlock style={{ height: 220 }} />
          <ShimmerBlock style={{ height: 160 }} />
        </div>
        {/* Right */}
        <div className="flex flex-col gap-4">
          <ShimmerBlock style={{ height: 160 }} />
          <ShimmerBlock style={{ height: 220 }} />
        </div>
      </div>

      {/* Roadmap */}
      <ShimmerBlock style={{ height: 160 }} />
    </div>
  );
}
