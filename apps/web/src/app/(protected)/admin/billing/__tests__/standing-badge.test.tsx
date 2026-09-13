import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { Standing } from '@web/lib/admin-billing-api';
import { StandingBadge } from '../standing-badge';

const STANDINGS: Standing[] = ['good', 'due', 'delinquent', 'exempt'];

describe('StandingBadge', () => {
  it.each(STANDINGS)('renders the %s standing the API resolved', (standing) => {
    render(
      <DictProvider value={dictEn}>
        <StandingBadge standing={standing} />
      </DictProvider>,
    );
    expect(screen.getByText(dictEn.admin.billing.standing[standing])).toBeInTheDocument();
  });

  it('labels a held standing as on hold rather than as a second delinquency spelling', () => {
    render(
      <DictProvider value={dictEn}>
        <StandingBadge standing="exempt" />
      </DictProvider>,
    );
    expect(screen.getByText(dictEn.admin.billing.standing.exempt)).toBeInTheDocument();
    expect(screen.queryByText(dictEn.admin.billing.standing.delinquent)).not.toBeInTheDocument();
  });
});
