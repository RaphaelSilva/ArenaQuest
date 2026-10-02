import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { MB, fakeFile, summary, view } from './fixtures';

const mockClient = {
  submissions: {
    presign: vi.fn(),
    finalize: vi.fn(),
    remove: vi.fn(),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => mockClient };
});

import { UploadForm } from '../UploadForm';
import { formatBytes } from '../submission-format';

const t = dictPt.submissions;

function zone() {
  return screen.getByRole('button', { name: t.upload.dropzoneLabel });
}

function drop(...files: File[]) {
  fireEvent.drop(zone(), { dataTransfer: { files, types: ['Files'] } });
}

function renderForm(upload = vi.fn()) {
  return render(<UploadForm topicId="t1" summary={summary()} upload={upload} onFinished={vi.fn()} onClose={vi.fn()} />);
}

describe('UploadForm drop zone', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('renders a drop zone with its call to action, described by the type/size hint', () => {
    renderForm();
    const z = zone();
    expect(z).toHaveTextContent(t.upload.dropzoneCta);
    expect(z).toHaveAttribute('tabindex', '0');
    const hint = document.getElementById(z.getAttribute('aria-describedby') ?? '');
    expect(hint).toHaveTextContent(
      t.upload.fileHint(formatBytes(dictPt, 250 * MB), formatBytes(dictPt, 5 * MB), formatBytes(dictPt, 25 * MB)),
    );
    // The native input stays in the DOM, named by the field label.
    expect(screen.getByLabelText(t.upload.fileLabel)).toHaveAttribute('type', 'file');
  });

  it('shows an active state while a file is dragged over', () => {
    renderForm();
    fireEvent.dragOver(zone(), { dataTransfer: { files: [], types: ['Files'], dropEffect: 'none' } });
    expect(zone()).toHaveAttribute('data-state', 'active');
    expect(zone()).toHaveTextContent(t.upload.dropzoneActive);
    fireEvent.dragLeave(zone(), { relatedTarget: document.body });
    expect(zone()).toHaveAttribute('data-state', 'idle');
  });

  it('a dropped valid file is selected, prefills the title and shows its name and size', () => {
    renderForm();
    drop(fakeFile('Kata Heian.mp4', 'video/mp4', 3 * MB));
    expect(screen.getByLabelText(t.upload.titleLabel)).toHaveValue('Kata Heian');
    expect(zone()).toHaveAttribute('data-state', 'chosen');
    expect(zone()).toHaveTextContent(t.upload.dropzoneChosen('Kata Heian.mp4', formatBytes(dictPt, 3 * MB)));
    expect(zone()).toHaveTextContent(t.upload.dropzoneChange);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a dropped invalid file shows the same preflight error as a pick and sends no request', () => {
    renderForm();
    drop(fakeFile('notes.txt', 'text/plain', 10));
    expect(screen.getByRole('alert')).toHaveTextContent(t.preflight.unsupportedType);

    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));
    expect(screen.getByRole('alert')).toHaveTextContent(t.preflight.unsupportedType);
    expect(mockClient.submissions.presign).not.toHaveBeenCalled();
  });

  it('a multi-file drop uses only the first file', async () => {
    mockClient.submissions.presign.mockResolvedValue({
      submission: view({ id: 'new', status: 'pending', url: null }),
      uploadUrl: 'https://r2.example/put',
      expiresAt: '',
    });
    mockClient.submissions.finalize.mockResolvedValue(view({ id: 'new' }));
    renderForm(vi.fn().mockResolvedValue(undefined));

    drop(fakeFile('first.jpg', 'image/jpeg', 1000), fakeFile('second.pdf', 'application/pdf', 2000));
    expect(screen.getByLabelText(t.upload.titleLabel)).toHaveValue('first');
    expect(zone()).toHaveTextContent(t.upload.dropzoneChosen('first.jpg', formatBytes(dictPt, 1000)));

    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));
    await waitFor(() => expect(mockClient.submissions.presign).toHaveBeenCalledTimes(1));
    expect(mockClient.submissions.presign.mock.calls[0][1]).toMatchObject({ fileName: 'first.jpg', sizeBytes: 1000 });
  });

  it('clicking, Enter or Space on the zone opens the file picker', () => {
    renderForm();
    fireEvent.click(zone());
    fireEvent.keyDown(zone(), { key: 'Enter' });
    fireEvent.keyDown(zone(), { key: ' ' });
    fireEvent.keyDown(zone(), { key: 'a' });
    expect(clickSpy).toHaveBeenCalledTimes(3);
  });

  it('ignores drops and clicks while an upload is in progress', async () => {
    mockClient.submissions.presign.mockResolvedValue({
      submission: view({ id: 'new', status: 'pending', url: null }),
      uploadUrl: 'https://r2.example/put',
      expiresAt: '',
    });
    const upload = vi.fn(() => new Promise<void>(() => {}));
    renderForm(upload);

    drop(fakeFile('clip.mp4', 'video/mp4', MB));
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    clickSpy.mockClear();

    expect(zone()).toHaveAttribute('aria-disabled', 'true');
    expect(zone()).toHaveAttribute('data-state', 'disabled');
    expect(screen.getByLabelText(t.upload.fileLabel)).toBeDisabled();

    drop(fakeFile('other.jpg', 'image/jpeg', 1000));
    fireEvent.click(zone());
    fireEvent.keyDown(zone(), { key: 'Enter' });

    expect(clickSpy).not.toHaveBeenCalled();
    expect(zone()).toHaveTextContent(t.upload.dropzoneChosen('clip.mp4', formatBytes(dictPt, MB)));
    expect(screen.getByLabelText(t.upload.titleLabel)).toHaveValue('clip');
  });
});
