'use client';

import { Logo } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';

export function HeroPanel() {
  const dict = useDict();
  const h = dict.auth.hero;
  const features = [
    { icon: '⚡', bg: 'oklch(0.74 0.19 52 / 0.12)', title: h.feature1Title, desc: h.feature1Desc },
    { icon: '🏆', bg: 'oklch(0.65 0.16 240 / 0.12)', title: h.feature2Title, desc: h.feature2Desc },
    { icon: '📊', bg: 'oklch(0.68 0.17 150 / 0.12)', title: h.feature3Title, desc: h.feature3Desc },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 64px', position: 'relative', zIndex: 1, maxWidth: 520 }} className="aq-hero-panel">
      <div style={{ marginBottom: 56 }}>
        <Logo size="lg" />
      </div>

      <div style={{ marginBottom: 48 }}>
        <h1 style={{ fontFamily: 'var(--font-space-grotesk), Space Grotesk, sans-serif', fontSize: 38, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1.1, marginBottom: 14 }}>
          {h.tagline}<br />
          <span style={{ color: 'var(--aq-accent)' }}>{h.taglineAccent}</span>
        </h1>
        <p style={{ fontSize: 15, color: 'var(--aq-text2)', lineHeight: 1.6, maxWidth: 340 }}>
          {h.description}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, border: '1px solid var(--aq-border2)', background: f.bg }}>
              {f.icon}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--aq-text)' }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--aq-text3)', marginTop: 2, lineHeight: 1.4 }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
