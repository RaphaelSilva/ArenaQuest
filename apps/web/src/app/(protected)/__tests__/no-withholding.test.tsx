import { render, screen, fireEvent, waitFor, type RenderResult } from '@testing-library/react';
import Link from 'next/link';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMeBillingApi } from '@web/lib/me-billing-api';
import type { Standing } from '@web/lib/admin-billing-api';
import {
  makeStatementTransport,
  statementWith,
} from '@web/components/billing/__tests__/statement-fixture';

/**
 * The milestone's central non-goal, asserted rather than merely inspected: a
 * `delinquent` standing withholds nothing.
 *
 * The protected layout is rendered twice with the same children — once for a
 * student the API reports as `good`, once for one it reports as `delinquent` —
 * and every link and control reachable in the first must still be reachable in
 * the second. The only difference the second render is allowed to show is the
 * notice's own two controls.
 */

let client: { meBilling: ReturnType<typeof createMeBillingApi> };

const routerMocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
  usePathname: () => '/dashboard',
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u1', roles: [] }, isLoading: false, logout: vi.fn() }),
  useHasRole: () => true,
}));

vi.mock('@web/context/theme-context', () => ({
  useTheme: () => ({ preference: 'system', cyclePreference: vi.fn() }),
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import ProtectedLayout from '../layout';

const banner = dictEn.layout.standingBanner;

/** Children standing in for whatever screen the student happened to be on. */
function Screen() {
  return (
    <main>
      <Link href="/catalog/kata">{'catalog-item'}</Link>
      <button type="button">{'screen-action'}</button>
      <input aria-label="screen-field" defaultValue="" />
    </main>
  );
}

async function renderAt(standing: Standing): Promise<RenderResult> {
  const http = makeStatementTransport(() => statementWith(standing));
  client = { meBilling: createMeBillingApi(http) };
  const view = render(
    <DictProvider value={dictEn}>
      <ProtectedLayout>
        <Screen />
      </ProtectedLayout>
    </DictProvider>,
  );
  await waitFor(() => expect(http).toHaveBeenCalled());
  // Open the mobile drawer too, so the comparison covers every navigation
  // entry the app offers and not only the desktop bar.
  fireEvent.click(screen.getByRole('button', { name: dictEn.layout.nav.openMenu }));
  return view;
}

/** Every interactive affordance on screen, identified the way a user finds it. */
function affordances(view: RenderResult): string[] {
  const root = view.container;
  const names = Array.from(
    root.querySelectorAll('a, button, input, select, textarea'),
  ).map((el) => {
    const tag = el.tagName.toLowerCase();
    const label =
      el.getAttribute('aria-label') ?? (el.textContent ?? '').trim() ?? '';
    const href = el.getAttribute('href') ?? '';
    const disabled = el.hasAttribute('disabled') ? ':disabled' : '';
    return `${tag}|${href}|${label}${disabled}`;
  });
  return names.sort();
}

describe('A delinquent standing withholds nothing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers a delinquent student every affordance a student in good standing has', async () => {
    const good = await renderAt('good');
    const goodAffordances = affordances(good);
    // Guards the comparison below against passing on an empty render.
    expect(goodAffordances.length).toBeGreaterThan(8);
    good.unmount();

    const delinquent = await renderAt('delinquent');
    const delinquentAffordances = affordances(delinquent);

    for (const affordance of goodAffordances) {
      expect(delinquentAffordances).toContain(affordance);
    }

    // And the only thing the delinquent render adds is the notice itself.
    const added = delinquentAffordances.filter((a) => !goodAffordances.includes(a));
    expect(added).toEqual(
      [`a|/settings/billing|${banner.link}`, `button||${banner.dismiss}`].sort(),
    );
  });

  it('disables nothing and dims nothing for a delinquent student', async () => {
    const view = await renderAt('delinquent');
    expect(affordances(view).some((a) => a.endsWith(':disabled'))).toBe(false);
    expect(view.container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
    expect(view.container.querySelector('fieldset[disabled]')).toBeNull();
  });

  it('still renders the screen the student was on, unchanged', async () => {
    await renderAt('delinquent');
    expect(screen.getByRole('link', { name: 'catalog-item' })).toHaveAttribute(
      'href',
      '/catalog/kata',
    );
    expect(screen.getByRole('button', { name: 'screen-action' })).toBeEnabled();
    expect(screen.getByLabelText('screen-field')).toBeEnabled();
  });

  it('does not redirect a delinquent student anywhere', async () => {
    await renderAt('delinquent');
    expect(routerMocks.replace).not.toHaveBeenCalled();
    expect(routerMocks.push).not.toHaveBeenCalled();
  });
});
