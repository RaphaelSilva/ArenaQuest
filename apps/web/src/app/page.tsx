import Link from 'next/link';
import { Logo } from '@web/components/design-system';
import { dict } from '@web/i18n';
import { brand, PLATFORM_NAME } from '@web/lib/brand';
import { whatsappLink } from '@web/lib/whatsapp';

// ─── Types ────────────────────────────────────────────────────────────────────

type Plan = {
  id: string;
  badge: string;
  emoji: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  highlighted: boolean;
  accentTop: string;
};

type ContactIntent = {
  id: string;
  emoji: string;
  accentTop: string;
  badge: string;
  title: string;
  description: string;
  cta: string;
  /** Pre-filled first message, so the incoming chat identifies the button. */
  message: string;
};

// ─── Data ─────────────────────────────────────────────────────────────────────
/**
 * TODO: When we public is ready, we need to update this data
 */
const PLANS: Plan[] = [
  {
    id: 'starter',
    badge: 'Iniciante',
    emoji: '🏅',
    name: 'Arena Starter',
    price: 'R$ 49',
    period: '/mês',
    description: 'Ideal para quem está começando a jornada no esporte e quer estrutura para evoluir.',
    features: [
      'Acesso a 1 trilha de aprendizado',
      'Missões semanais básicas',
      'Dashboard de progresso pessoal',
      'Suporte por e-mail',
    ],
    cta: 'Começar agora',
    highlighted: false,
    accentTop: 'linear-gradient(90deg, var(--aq-accent2), var(--aq-accent3))',
  },
  {
    id: 'pro',
    badge: 'Mais popular',
    emoji: '⚡',
    name: 'Arena Pro',
    price: 'R$ 99',
    period: '/mês',
    description: 'Para atletas sérios que querem acompanhamento completo e acesso a todo o conteúdo.',
    features: [
      'Acesso ilimitado a todas as trilhas',
      'Missões diárias personalizadas',
      'Check-in de etapas e progresso detalhado',
      'Ranking e conquistas desbloqueadas',
      'Suporte prioritário',
    ],
    cta: 'Entrar na Arena',
    highlighted: true,
    accentTop: 'linear-gradient(90deg, var(--aq-accent), var(--aq-accent2))',
  },
  {
    id: 'elite',
    badge: 'Equipes',
    emoji: '🏆',
    name: 'Arena Elite',
    price: 'R$ 199',
    period: '/mês',
    description: 'Para clubes e academias que precisam gerenciar turmas inteiras com relatórios avançados.',
    features: [
      'Tudo do Arena Pro',
      'Gerenciamento de grupos e turmas',
      'Painel administrativo completo',
      'Relatórios de desempenho por atleta',
      'Integração com calendário esportivo',
      'Gerente de conta dedicado',
    ],
    cta: 'Falar com vendas',
    highlighted: false,
    accentTop: 'linear-gradient(90deg, var(--aq-accent3), var(--aq-accent))',
  },
];

/**
 * The three WhatsApp CTAs a tenant with a public number shows instead of the
 * placeholder plans. Each intent carries its own pre-filled message, which is
 * the only attribution available without a tracker: the text that arrives says
 * which button was pressed.
 */
const CONTACT_INTENTS: ContactIntent[] = [
  {
    id: 'trial',
    emoji: '🥋',
    accentTop: 'linear-gradient(90deg, var(--aq-accent), var(--aq-accent2))',
    ...dict.landing.contact.intents.trial,
  },
  {
    id: 'schedule',
    emoji: '🗓️',
    accentTop: 'linear-gradient(90deg, var(--aq-accent2), var(--aq-accent3))',
    ...dict.landing.contact.intents.schedule,
  },
  {
    id: 'teacher',
    emoji: '💬',
    accentTop: 'linear-gradient(90deg, var(--aq-accent3), var(--aq-accent))',
    ...dict.landing.contact.intents.teacher,
  },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" stroke="var(--aq-accent3)" strokeWidth="1" />
      <path d="M4.5 7L6.5 9L9.5 5" stroke="var(--aq-accent3)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WhatsappIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.69 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1.02 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <article
      className="relative flex flex-col rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        background: plan.highlighted ? 'var(--aq-bg2)' : 'var(--aq-bg2)',
        borderColor: plan.highlighted ? 'var(--aq-accent)' : 'var(--aq-border2)',
        boxShadow: plan.highlighted
          ? '0 0 0 1px var(--aq-accent), 0 8px 40px rgba(0,0,0,0.4)'
          : '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Top accent strip */}
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: plan.accentTop }}
      />

      {/* Popular badge */}
      {plan.highlighted && (
        <div className="absolute top-4 right-4">
          <span
            className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              background: 'var(--aq-accent)',
              color: '#0B0E17',
              letterSpacing: '0.8px',
            }}
          >
            {plan.badge}
          </span>
        </div>
      )}

      <div className="flex flex-col flex-1 p-7 pt-8 gap-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
              style={{ background: 'var(--aq-bg3)' }}
            >
              {plan.emoji}
            </span>
            {!plan.highlighted && (
              <span
                className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: 'var(--aq-bg3)',
                  color: 'var(--aq-text3)',
                  letterSpacing: '0.8px',
                }}
              >
                {plan.badge}
              </span>
            )}
          </div>

          <h2
            className="text-lg font-bold mb-1"
            style={{
              color: 'var(--aq-text)',
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: '-0.3px',
            }}
          >
            {plan.name}
          </h2>

          <p className="text-sm leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
            {plan.description}
          </p>
        </div>

        {/* Price */}
        <div className="flex items-end gap-1">
          <span
            className="text-4xl font-bold leading-none"
            style={{
              color: plan.highlighted ? 'var(--aq-accent)' : 'var(--aq-text)',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {plan.price}
          </span>
          <span className="mb-1 text-sm" style={{ color: 'var(--aq-text3)' }}>
            {plan.period}
          </span>
        </div>

        {/* Divider */}
        <div className="h-px" style={{ background: 'var(--aq-border)' }} />

        {/* Features */}
        <ul className="flex flex-col gap-3 flex-1">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                <CheckIcon />
              </span>
              <span className="text-sm" style={{ color: 'var(--aq-text2)' }}>
                {feature}
              </span>
            </li>
          ))}
        </ul>

        {/* CTA — não leva a nenhuma página ainda */}
        <button
          type="button"
          disabled
          className="mt-2 w-full rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 cursor-not-allowed opacity-70"
          style={
            plan.highlighted
              ? {
                  background: 'var(--aq-accent)',
                  color: '#0B0E17',
                  boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)',
                  fontFamily: "'Space Grotesk', sans-serif",
                }
              : {
                  background: 'var(--aq-bg3)',
                  border: '1px solid var(--aq-border2)',
                  color: 'var(--aq-text2)',
                  fontFamily: "'Space Grotesk', sans-serif",
                }
          }
          aria-label={`${plan.cta} — em breve`}
          title="Em breve"
        >
          {plan.cta}
          <ArrowRightIcon />
        </button>
      </div>
    </article>
  );
}

// ─── ContactCard ──────────────────────────────────────────────────────────────

/**
 * One contact intent as a card whose CTA is a real `wa.me` link. It is an
 * anchor, not a button: the CTA must be focusable, middle-clickable and
 * crawlable, none of which a `<button disabled>` can be.
 */
function ContactCard({ intent, number }: { intent: ContactIntent; number: string }) {
  const href = whatsappLink(number, intent.message);
  if (!href) return null;

  return (
    <article
      className="relative flex flex-col rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        background: 'var(--aq-bg2)',
        borderColor: 'var(--aq-border2)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Top accent strip */}
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: intent.accentTop }} />

      <div className="flex flex-col flex-1 p-7 pt-8 gap-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
              style={{ background: 'var(--aq-bg3)' }}
            >
              {intent.emoji}
            </span>
            <span
              className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                background: 'var(--aq-bg3)',
                color: 'var(--aq-text3)',
                letterSpacing: '0.8px',
              }}
            >
              {intent.badge}
            </span>
          </div>

          <h2
            className="text-lg font-bold mb-1"
            style={{
              color: 'var(--aq-text)',
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: '-0.3px',
            }}
          >
            {intent.title}
          </h2>

          <p className="text-sm leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
            {intent.description}
          </p>
        </div>

        {/* Divider */}
        <div className="h-px mt-auto" style={{ background: 'var(--aq-border)' }} />

        {/* CTA — opens WhatsApp with the intent's message already typed */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2"
          style={{
            background: 'var(--aq-accent)',
            color: '#0B0E17',
            boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)',
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          <WhatsappIcon />
          {intent.cta}
        </a>
      </div>
    </article>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

/**
 * The stock section: placeholder plans whose CTAs are deliberately inert.
 * Rendered for every tenant that has no public WhatsApp number.
 */
function PricingSection() {
  return (
    <section className="px-6 py-16 flex flex-col items-center gap-10">
      <div className="text-center flex flex-col gap-3">
        <p
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--aq-text3)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Planos & Preços
        </p>
        <h2
          className="text-3xl font-bold"
          style={{
            color: 'var(--aq-text)',
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: '-0.5px',
          }}
        >
          Escolha seu plano
        </h2>
        <p className="text-sm max-w-sm mx-auto" style={{ color: 'var(--aq-text2)' }}>
          Todos os planos incluem 7 dias grátis. Cancele a qualquer momento sem burocracia.
        </p>
      </div>

      <div className="grid w-full max-w-5xl grid-cols-1 gap-5 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>

      <p className="text-xs" style={{ color: 'var(--aq-text3)' }}>
        * Os botões de assinatura estarão disponíveis em breve. Para acessar a plataforma,{' '}
        <Link
          href="/login"
          className="underline underline-offset-2 transition-colors"
          style={{ color: 'var(--aq-accent)' }}
        >
          faça login aqui
        </Link>
        .
      </p>
    </section>
  );
}

/**
 * The WhatsApp section: the same three-card rhythm, but every card is a real
 * click-to-chat link. Rendered only when `brand.whatsapp` resolves, so a tenant
 * without a number keeps the disabled plan CTAs rather than a dead link.
 */
function ContactSection({ number }: { number: string }) {
  const copy = dict.landing.contact;
  return (
    <section className="px-6 py-16 flex flex-col items-center gap-10">
      <div className="text-center flex flex-col gap-3">
        <p
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--aq-text3)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {copy.eyebrow}
        </p>
        <h2
          className="text-3xl font-bold"
          style={{
            color: 'var(--aq-text)',
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: '-0.5px',
          }}
        >
          {copy.title}
        </h2>
        <p className="text-sm max-w-sm mx-auto" style={{ color: 'var(--aq-text2)' }}>
          {copy.subtitle}
        </p>
      </div>

      <div className="grid w-full max-w-5xl grid-cols-1 gap-5 sm:grid-cols-3">
        {CONTACT_INTENTS.map((intent) => (
          <ContactCard key={intent.id} intent={intent} number={number} />
        ))}
      </div>

      <p className="text-xs" style={{ color: 'var(--aq-text3)' }}>
        {copy.note}
      </p>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div
      className="min-h-full flex flex-col"
      style={{ background: 'var(--aq-bg)', color: 'var(--aq-text)' }}
    >
      {/* Topbar */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-0 h-14"
        style={{ background: 'var(--aq-bg2)', borderBottom: '1px solid var(--aq-border)' }}
      >
        <Logo />

        <nav className="flex items-center gap-3" aria-label="Navegação principal">
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 hover:text-[var(--aq-text)]"
            style={{ color: 'var(--aq-text2)' }}
          >
            Entrar
          </Link>
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200"
            style={{
              background: 'var(--aq-accent)',
              color: '#0B0E17',
              fontFamily: "'Space Grotesk', sans-serif",
              boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.3)',
            }}
          >
            Começar grátis
          </Link>
        </nav>
      </header>

      <main className="flex flex-col flex-1">
        {/* Hero */}
        <section className="flex flex-col items-center text-center px-6 pt-20 pb-16 gap-6">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-widest"
            style={{
              borderColor: 'var(--aq-accent)',
              background: 'var(--aq-accent-glow)',
              color: 'var(--aq-accent)',
            }}
          >
            🚀 Plataforma de Aprendizado Esportivo
          </div>

          <h1
            className="max-w-2xl text-5xl font-bold leading-tight"
            style={{
              color: 'var(--aq-text)',
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: '-1px',
            }}
          >
            Evolua na sua{' '}
            <span style={{ color: 'var(--aq-accent)' }}>Arena</span>
            {', '}
            <br className="hidden sm:block" />
            no seu ritmo
          </h1>

          <p
            className="max-w-lg text-lg leading-relaxed"
            style={{ color: 'var(--aq-text2)' }}
          >
            Trilhas de aprendizado estruturadas, missões diárias e acompanhamento de progresso
            para atletas e equipes que levam o desenvolvimento a sério.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-xl px-8 py-3.5 text-base font-bold transition-all duration-200"
              style={{
                background: 'var(--aq-accent)',
                color: '#0B0E17',
                fontFamily: "'Space Grotesk', sans-serif",
                boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)',
              }}
            >
              Entrar na Arena
              <ArrowRightIcon />
            </Link>
            <Link
              href="/login"
              className="rounded-xl border px-8 py-3.5 text-base font-medium transition-colors duration-200"
              style={{
                borderColor: 'var(--aq-border2)',
                color: 'var(--aq-text2)',
                background: 'var(--aq-bg2)',
              }}
            >
              Já tenho conta
            </Link>
          </div>

          {/* Social proof */}
          <p className="text-xs" style={{ color: 'var(--aq-text3)' }}>
            Sem cartão de crédito · Acesso imediato · Cancele quando quiser
          </p>
        </section>

        {/* Divider */}
        <div className="mx-auto w-full max-w-5xl px-6">
          <div className="h-px" style={{ background: 'var(--aq-border)' }} />
        </div>

        {/* Plans, or WhatsApp contact when the brand carries a public number. */}
        {brand.whatsapp ? <ContactSection number={brand.whatsapp} /> : <PricingSection />}
      </main>

      {/* Footer */}
      <footer
        className="border-t px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs"
        style={{ borderColor: 'var(--aq-border)', color: 'var(--aq-text3)' }}
      >
        <Logo textOnly className="text-sm" />
        <span>
          © {new Date().getFullYear()} {brand.fullName}. {dict.landing.footer.rights}
          {brand.showPoweredBy && (
            <span style={{ marginLeft: 8, color: 'var(--aq-text3)' }}>
              {dict.landing.footer.poweredBy} {PLATFORM_NAME}
            </span>
          )}
        </span>
        <Link
          href="/login"
          className="font-medium transition-colors"
          style={{ color: 'var(--aq-accent)' }}
        >
          Acessar plataforma →
        </Link>
      </footer>
    </div>
  );
}
