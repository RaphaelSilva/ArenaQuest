'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi, AuthApiError } from '@web/lib/auth-api';
import { Spinner } from '@web/components/spinner';

type ActivateState =
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; reason: 'invalid' | 'network' };

function ActivateInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';
  const [state, setState] = useState<ActivateState>(token ? { kind: 'pending' } : { kind: 'error', reason: 'invalid' });

  const runActivation = useCallback(async () => {
    try {
      await authApi.activate({ token });
      setState({ kind: 'success' });
    } catch (err) {
      if (err instanceof AuthApiError && err.code === 'NetworkError') {
        setState({ kind: 'error', reason: 'network' });
      } else {
        setState({ kind: 'error', reason: 'invalid' });
      }
    }
  }, [token]);

  useEffect(() => {
    // Fire the network call once the component is mounted with a token.
    // The setState calls inside `runActivation` only run after `await
    // authApi.activate(...)` resolves — they are async, not synchronous
    // within the effect body — but the lint rule cannot see through the
    // useCallback boundary, so silence it explicitly here.
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runActivation();
  }, [token, runActivation]);

  const retry = useCallback(() => {
    setState({ kind: 'pending' });
    runActivation();
  }, [runActivation]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)', color: 'var(--aq-text)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', padding: 24 }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)' }} />
        <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, oklch(0.74 0.19 52 / 0.10) 0%, transparent 70%)', top: -200, right: -100 }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 440, padding: '40px 36px', background: 'var(--aq-bg2)', border: '1px solid var(--aq-border)', borderRadius: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }} className="aq-anim">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--aq-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontWeight: 700, fontSize: 14, color: '#0B0E17' }}>
            AQ
          </div>
          <div style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontWeight: 700, fontSize: 16, letterSpacing: '-0.3px' }}>
            Arena<span style={{ color: 'var(--aq-accent)' }}>Quest</span>
          </div>
        </div>

        {state.kind === 'pending' && (
          <>
            <Spinner className="h-8 w-8" />
            <h1 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 20, fontWeight: 700 }}>
              Ativando sua conta…
            </h1>
            <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.6 }}>
              Aguarde só um instante.
            </p>
          </>
        )}

        {state.kind === 'success' && (
          <>
            <div className="aq-success-icon" style={{ width: 64, height: 64, borderRadius: '50%', background: 'oklch(0.68 0.17 150 / 0.15)', border: '2px solid var(--aq-accent3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
              ✓
            </div>
            <h1 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700 }}>
              Conta ativada!
            </h1>
            <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.6, maxWidth: 320 }}>
              Sua conta está pronta. Faça login para entrar na Arena.
            </p>
            <button
              type="button"
              onClick={() => router.push('/login?activated=1')}
              style={{ marginTop: 8, width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)' }}
            >
              Ir para login
            </button>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--aq-error-bg)', border: '2px solid var(--aq-error)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'var(--aq-error)' }}>
              !
            </div>
            <h1 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700 }}>
              {state.reason === 'network' ? 'Não foi possível ativar' : 'Link inválido'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--aq-text2)', lineHeight: 1.6, maxWidth: 340 }}>
              {state.reason === 'network'
                ? 'Houve um problema de conexão. Tente novamente.'
                : 'Link inválido ou expirado. Solicite um novo cadastro ou contate o suporte.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 8 }}>
              {state.reason === 'network' && (
                <button
                  type="button"
                  onClick={retry}
                  style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--aq-accent)', color: '#0B0E17', boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)' }}
                >
                  Tentar novamente
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push('/login')}
                style={{ width: '100%', padding: 13, borderRadius: 10, border: '1px solid var(--aq-border2)', background: 'var(--aq-bg3)', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', fontSize: 14, fontWeight: 500, cursor: 'pointer', color: 'var(--aq-text2)' }}
              >
                Voltar ao login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ActivatePage() {
  // useSearchParams() must be wrapped in <Suspense> for static export under
  // Next 15 — otherwise the build-time prerender hook complains.
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--aq-bg)' }}><Spinner className="h-8 w-8" /></div>}>
      <ActivateInner />
    </Suspense>
  );
}
