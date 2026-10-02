import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { SubmissionsApiError, type UploadOptions } from '@web/lib/submissions-api';
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

function pick(file: File) {
  fireEvent.change(screen.getByLabelText(t.upload.fileLabel), { target: { files: [file] } });
}

function presigned(id = 'new') {
  return { submission: view({ id, status: 'pending', url: null }), uploadUrl: 'https://r2.example/put', expiresAt: '' };
}

describe('UploadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts every submission type plus .mov on the file input', () => {
    render(<UploadForm topicId="t1" summary={summary()} onFinished={vi.fn()} onClose={vi.fn()} />);
    const accept = screen.getByLabelText(t.upload.fileLabel).getAttribute('accept') ?? '';
    expect(accept.split(',')).toEqual(expect.arrayContaining(['video/quicktime', 'video/mp4', 'application/pdf', '.mov']));
  });

  it('refuses a video over the summary limit with the limit, before any presign', async () => {
    const s = summary({ limits: { perTopicMax: 10, storagePerStudentBytes: 1024 * MB, videoMaxBytes: 50 * MB } });
    render(<UploadForm topicId="t1" summary={s} onFinished={vi.fn()} onClose={vi.fn()} />);

    pick(fakeFile('IMG_0042.MOV', 'video/quicktime', 60 * MB));
    expect(screen.getByRole('alert')).toHaveTextContent(t.preflight.tooLarge(formatBytes(dictPt, 50 * MB)));

    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));
    expect(screen.getByRole('alert')).toHaveTextContent(t.preflight.tooLarge('50 MB'));
    expect(mockClient.submissions.presign).not.toHaveBeenCalled();
  });

  it('refuses any file when the topic quota is full, before any presign', () => {
    const s = summary({ usage: { topicCount: 10, bytes: 0 } });
    render(<UploadForm topicId="t1" summary={s} onFinished={vi.fn()} onClose={vi.fn()} />);

    pick(fakeFile('photo.jpg', 'image/jpeg', 1000));
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));

    expect(screen.getByRole('alert')).toHaveTextContent(t.preflight.topicFull(10));
    expect(mockClient.submissions.presign).not.toHaveBeenCalled();
  });

  it('refuses a file over the remaining storage, before any presign', () => {
    const s = summary({ usage: { topicCount: 1, bytes: 1020 * MB } });
    render(<UploadForm topicId="t1" summary={s} onFinished={vi.fn()} onClose={vi.fn()} />);

    pick(fakeFile('clip.mp4', 'video/mp4', 10 * MB));
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));

    expect(screen.getByRole('alert')).toHaveTextContent(t.preflight.storageFull('4 MB', '1 GB'));
    expect(mockClient.submissions.presign).not.toHaveBeenCalled();
  });

  it('refuses a type outside the submission list', () => {
    render(<UploadForm topicId="t1" summary={summary()} onFinished={vi.fn()} onClose={vi.fn()} />);
    pick(fakeFile('notes.txt', 'text/plain', 10));
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));
    expect(screen.getByRole('alert')).toHaveTextContent(t.preflight.unsupportedType);
    expect(mockClient.submissions.presign).not.toHaveBeenCalled();
  });

  it('prefills the title, resolves a typeless .mov and uploads with progress, then finalizes', async () => {
    mockClient.submissions.presign.mockResolvedValue(presigned());
    mockClient.submissions.finalize.mockResolvedValue(view({ id: 'new' }));
    let report: ((fraction: number) => void) | undefined;
    let finish: (() => void) | undefined;
    const upload = vi.fn((_url: string, _file: Blob, _type: string, opts?: UploadOptions) => {
      report = opts?.onProgress;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const onFinished = vi.fn();
    const onActive = vi.fn();

    render(
      <UploadForm
        topicId="t1"
        summary={summary()}
        upload={upload}
        onActiveUploadChange={onActive}
        onFinished={onFinished}
        onClose={vi.fn()}
      />,
    );

    pick(fakeFile('IMG_0042.MOV', '', 20 * MB));
    expect(screen.getByLabelText(t.upload.titleLabel)).toHaveValue('IMG_0042');
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));

    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(mockClient.submissions.presign).toHaveBeenCalledWith('t1', {
      fileName: 'IMG_0042.MOV',
      contentType: 'video/quicktime',
      sizeBytes: 20 * MB,
      title: 'IMG_0042',
      visibility: 'private',
    });
    expect(upload.mock.calls[0][2]).toBe('video/quicktime');
    expect(onActive).toHaveBeenCalledWith('new');

    act(() => report?.(0.42));
    expect(screen.getByRole('progressbar', { name: t.upload.progressLabel })).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(t.upload.uploading(42))).toBeInTheDocument();

    await act(async () => finish?.());
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('uploaded'));
    expect(mockClient.submissions.finalize).toHaveBeenCalledWith('t1', 'new');
  });

  it('Cancel aborts the PUT and then deletes the pending row', async () => {
    mockClient.submissions.presign.mockResolvedValue(presigned('pend'));
    mockClient.submissions.remove.mockResolvedValue(undefined);
    let signal: AbortSignal | undefined;
    const upload = vi.fn((_url: string, _file: Blob, _type: string, opts?: UploadOptions) => {
      signal = opts?.signal;
      return new Promise<void>((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new SubmissionsApiError('Aborted', 0, 'aborted')));
      });
    });
    const onFinished = vi.fn();

    render(<UploadForm topicId="t1" summary={summary()} upload={upload} onFinished={onFinished} onClose={vi.fn()} />);
    pick(fakeFile('clip.mp4', 'video/mp4', MB));
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));

    const cancel = await screen.findByRole('button', { name: t.upload.cancelUpload });
    fireEvent.click(cancel);

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('cancelled'));
    expect(signal?.aborted).toBe(true);
    expect(mockClient.submissions.remove).toHaveBeenCalledWith('t1', 'pend');
    expect(mockClient.submissions.finalize).not.toHaveBeenCalled();
  });

  it('maps a 409 quota refusal from the API to a translated message', async () => {
    mockClient.submissions.presign.mockRejectedValue(
      new SubmissionsApiError('Quota', 409, 'SUBMISSION_QUOTA', { reason: 'count', used: 10, limit: 10 }),
    );
    render(<UploadForm topicId="t1" summary={summary()} upload={vi.fn()} onFinished={vi.fn()} onClose={vi.fn()} />);
    pick(fakeFile('photo.png', 'image/png', 1000));
    fireEvent.click(screen.getByRole('button', { name: t.upload.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.quotaCount(10));
  });

  it('omits the visibility switch when sharing is off', () => {
    render(
      <UploadForm topicId="t1" summary={summary({ sharingEnabled: false })} onFinished={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
