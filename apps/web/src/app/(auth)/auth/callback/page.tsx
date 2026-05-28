'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';

const AlertIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.1" />
    <path d="M5.5 3.5v2.5M5.5 7.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

function MissingTokenError() {
  const dict = useDict();
  const d = dict.auth.oauthCallback;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }} className="aq-anim">
      <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 9, background: 'var(--aq-error-bg)', border: '1px solid oklch(0.65 0.22 15 / 0.3)', fontSize: 13, color: 'var(--aq-error)' }}>
        <AlertIcon /> {d.missingParams}
      </div>
      <Link
        href="/login"
        style={{ display: 'inline-block', padding: '11px 24px', borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)', textDecoration: 'none' }}
      >
        {d.backToLogin}
      </Link>
    </div>
  );
}

function StoringSession({ accessToken }: { accessToken: string }) {
  const router = useRouter();
  const { loginWithAccessToken } = useAuth();
  const dict = useDict();

  useEffect(() => {
    loginWithAccessToken(accessToken);
    router.replace('/dashboard');
  }, [accessToken, loginWithAccessToken, router]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <Spinner className="h-8 w-8" />
      <p style={{ fontSize: 13, color: 'var(--aq-text2)' }}>{dict.auth.oauthCallback.authenticating}</p>
    </div>
  );
}

function OAuthCallbackInner() {
  const searchParams = useSearchParams();
  const accessToken = searchParams?.get('accessToken') ?? '';

  if (!accessToken) {
    return <MissingTokenError />;
  }

  return <StoringSession accessToken={accessToken} />;
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)' }}><Spinner className="h-8 w-8" /></div>}>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)', color: 'var(--aq-text)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'var(--aq-bg2)', borderRadius: 16, border: '1px solid var(--aq-border)', padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--aq-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-space-grotesk)', fontWeight: 700, fontSize: 15, color: '#0B0E17' }}>AQ</div>
            <span style={{ fontFamily: 'var(--font-space-grotesk)', fontWeight: 700, fontSize: 18 }}>Arena<span style={{ color: 'var(--aq-accent)' }}>Quest</span></span>
          </div>
          <OAuthCallbackInner />
        </div>
      </div>
    </Suspense>
  );
}
