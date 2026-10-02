import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { SubmissionsApiError } from '@web/lib/submissions-api';
import { view } from './fixtures';

const mockClient = { submissions: { edit: vi.fn() } };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { EditSubmissionDialog } from '../EditSubmissionDialog';

const t = dictPt.submissions;

describe('EditSubmissionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('edits title, description and visibility; sharing asks a confirmation naming classmates', async () => {
    const saved = view({ title: 'Kata final', description: 'Left', visibility: 'shared' });
    mockClient.submissions.edit.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(
      <EditSubmissionDialog topicId="t1" submission={view()} sharingEnabled onSaved={onSaved} onClose={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText(t.upload.titleLabel), { target: { value: 'Kata final' } });
    fireEvent.change(screen.getByLabelText(t.upload.descriptionLabel), { target: { value: 'Left' } });

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    // Not shared yet: the confirmation names who will see it.
    expect(screen.getByText(t.visibility.confirmShare)).toBeInTheDocument();
    expect(t.visibility.confirmShare).toMatch(/colegas/);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: t.visibility.confirm }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: t.edit.save }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(mockClient.submissions.edit).toHaveBeenCalledWith('t1', 's1', {
      title: 'Kata final',
      description: 'Left',
      visibility: 'shared',
    });
  });

  it('cancelling the confirmation keeps the submission private', () => {
    render(<EditSubmissionDialog topicId="t1" submission={view()} sharingEnabled onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: t.visibility.cancel }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('has no visibility switch when sharing is off, and never sends a visibility', async () => {
    mockClient.submissions.edit.mockResolvedValue(view());
    render(
      <EditSubmissionDialog topicId="t1" submission={view()} sharingEnabled={false} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.edit.save }));
    await waitFor(() => expect(mockClient.submissions.edit).toHaveBeenCalled());
    expect(mockClient.submissions.edit.mock.calls[0][2]).not.toHaveProperty('visibility');
  });

  it('replaces the switch with a note on a moderated submission', () => {
    render(
      <EditSubmissionDialog
        topicId="t1"
        submission={view({ moderated: true })}
        sharingEnabled
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText(t.edit.moderated)).toBeInTheDocument();
  });

  it('maps a 409 SUBMISSION_MODERATED to a translated message', async () => {
    mockClient.submissions.edit.mockRejectedValue(new SubmissionsApiError('Moderated', 409, 'SUBMISSION_MODERATED'));
    render(<EditSubmissionDialog topicId="t1" submission={view()} sharingEnabled onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t.edit.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.moderated);
  });
});
