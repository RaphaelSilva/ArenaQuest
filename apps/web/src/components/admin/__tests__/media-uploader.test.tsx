/**
 * The shared uploader and the two targets it is configured with.
 *
 * The component is parameterised rather than forked, so this file has to prove
 * two things at once: that the *topics* lifecycle still runs exactly as it did
 * (same endpoints, same arguments), and that the event flyer runs the same
 * three steps against its own endpoints.
 *
 * The assertion that matters most in both is `sizeBytes === file.size` and the
 * `PUT` carrying that very `File`. The presign signs the declared byte count
 * into the URL as `ContentLength`, a *signed header* — a rounded number, a
 * ceiling, or bytes from a transformed blob all fail the signature.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dictPt } from '@web/i18n';
import { DictProvider } from '@web/context/dict-context';
import { AdminEventsApiError } from '@web/lib/admin-events-api';

const mockAdminMedia = vi.hoisted(() => ({
  getPresignedUrl: vi.fn(),
  finalize: vi.fn(),
}));
const mockAdminEvents = vi.hoisted(() => ({
  presignFlyer: vi.fn(),
  finalizeFlyer: vi.fn(),
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({ adminMedia: mockAdminMedia, adminEvents: mockAdminEvents }),
  };
});

import { MediaUploader } from '@web/components/admin/MediaUploader';
import type { MediaUploadTarget } from '@web/components/admin/media-upload-target';
import { useTopicMediaTarget } from '@web/components/admin/use-topic-media-target';
import { useEventFlyerTarget } from '@web/components/admin/events/use-event-flyer-target';

// ---------------------------------------------------------------------------
// A fake XHR that records exactly what was sent
// ---------------------------------------------------------------------------

let sentBodies: unknown[] = [];
const realXhr = globalThis.XMLHttpRequest;

class FakeXhr {
  status = 200;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send(body: unknown) {
    sentBodies.push(body);
    // Resolve on the next tick so the component observes `uploading` first.
    setTimeout(() => this.onload?.(), 0);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  sentBodies = [];
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = realXhr;
});

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

function makeFile(bytes: number, name = 'flyer.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('MediaUploader', () => {
  it('declares exactly file.size and PUTs that same File', async () => {
    const user = userEvent.setup();
    const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://r2.example/put', handle: 'h1' });
    const finalize = vi.fn().mockResolvedValue(undefined);
    const target: MediaUploadTarget = {
      presign,
      finalize,
      maxBytes: 5 * 1024 * 1024,
      multiple: false,
      labels: { dropzoneTitle: 'Enviar', dropzoneHint: 'dica', fileTooBig: 'grande demais' },
    };
    const onUploadComplete = vi.fn();

    render(
      <DictProvider value={dictPt}>
        <MediaUploader target={target} onUploadComplete={onUploadComplete} />
      </DictProvider>,
    );

    const file = makeFile(1234);
    await user.upload(screen.getByLabelText('Enviar'), file);

    await waitFor(() => expect(presign).toHaveBeenCalledTimes(1));
    expect(presign).toHaveBeenCalledWith({
      fileName: 'flyer.jpg',
      contentType: 'image/jpeg',
      sizeBytes: file.size,
    });
    expect(presign.mock.calls[0][0].sizeBytes).toBe(1234);

    await waitFor(() => expect(finalize).toHaveBeenCalledWith('h1'));
    // The very same object, not a re-encoded copy.
    expect(sentBodies).toEqual([file]);
    expect(onUploadComplete).toHaveBeenCalled();
  });

  it('refuses a file over the target ceiling without calling presign', async () => {
    const user = userEvent.setup();
    const presign = vi.fn();
    const target: MediaUploadTarget = {
      presign,
      finalize: vi.fn(),
      maxBytes: 1000,
      multiple: false,
      labels: { dropzoneTitle: 'Enviar', dropzoneHint: 'dica', fileTooBig: 'Passa do limite' },
    };

    render(
      <DictProvider value={dictPt}>
        <MediaUploader target={target} onUploadComplete={vi.fn()} />
      </DictProvider>,
    );

    await user.upload(screen.getByLabelText('Enviar'), makeFile(2000));

    expect(await screen.findByText('Passa do limite')).toBeInTheDocument();
    expect(presign).not.toHaveBeenCalled();
  });

  it('surfaces a finalize-time rejection as an error rather than a silent failure', async () => {
    const user = userEvent.setup();
    const target: MediaUploadTarget = {
      presign: vi.fn().mockResolvedValue({ uploadUrl: 'https://r2.example/put', handle: '' }),
      finalize: vi.fn().mockRejectedValue(new Error('Recusado pela API')),
      maxBytes: 5 * 1024 * 1024,
      multiple: false,
      labels: { dropzoneTitle: 'Enviar', dropzoneHint: 'dica', fileTooBig: 'grande demais' },
    };

    render(
      <DictProvider value={dictPt}>
        <MediaUploader target={target} onUploadComplete={vi.fn()} />
      </DictProvider>,
    );

    await user.upload(screen.getByLabelText('Enviar'), makeFile(10));
    expect(await screen.findByRole('alert')).toHaveTextContent('Recusado pela API');
  });
});

// ---------------------------------------------------------------------------
// The two targets
// ---------------------------------------------------------------------------

function Harness({ use }: { use: () => MediaUploadTarget }) {
  const target = use();
  captured = target;
  return null;
}
let captured: MediaUploadTarget | null = null;

function renderTarget(use: () => MediaUploadTarget): MediaUploadTarget {
  render(
    <DictProvider value={dictPt}>
      <Harness use={use} />
    </DictProvider>,
  );
  return captured as MediaUploadTarget;
}

describe('useTopicMediaTarget — the topics lifecycle, unchanged', () => {
  it('still presigns and finalizes against the topic endpoints with the declared size', async () => {
    mockAdminMedia.getPresignedUrl.mockResolvedValue({
      uploadUrl: 'https://r2.example/topic',
      media: { id: 'media-7' },
    });
    mockAdminMedia.finalize.mockResolvedValue({});

    const target = renderTarget(() => useTopicMediaTarget('topic-42'));

    const ticket = await target.presign({
      fileName: 'aula.mp4',
      contentType: 'video/mp4',
      sizeBytes: 999,
    });
    expect(mockAdminMedia.getPresignedUrl).toHaveBeenCalledWith('topic-42', {
      fileName: 'aula.mp4',
      contentType: 'video/mp4',
      sizeBytes: 999,
    });
    expect(ticket).toEqual({ uploadUrl: 'https://r2.example/topic', handle: 'media-7' });

    await target.finalize('media-7');
    expect(mockAdminMedia.finalize).toHaveBeenCalledWith('topic-42', 'media-7');

    // The 100 MB courtesy check the inline implementation used to make.
    expect(target.maxBytes).toBe(100 * 1024 * 1024);
    expect(target.multiple).toBe(true);
    expect(target.labels.dropzoneTitle).toBe(dictPt.admin.topics.media.uploader.dropzoneTitle);
  });
});

describe('useEventFlyerTarget — the same lifecycle, event endpoints', () => {
  it('presigns and finalizes the one flyer, with the shared 5 MB image ceiling', async () => {
    mockAdminEvents.presignFlyer.mockResolvedValue({
      uploadUrl: 'https://r2.example/flyer',
      expiresInSeconds: 3600,
      maxBytes: 5 * 1024 * 1024,
      flyer: { status: 'pending', key: 'k', type: 'image/jpeg', sizeBytes: 10, name: 'f.jpg' },
    });
    mockAdminEvents.finalizeFlyer.mockResolvedValue({});

    const target = renderTarget(() => useEventFlyerTarget('event-1'));

    const ticket = await target.presign({
      fileName: 'f.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(mockAdminEvents.presignFlyer).toHaveBeenCalledWith('event-1', {
      fileName: 'f.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    // An event owns exactly one flyer, so finalize needs no second id.
    expect(ticket.handle).toBe('');

    await target.finalize('');
    expect(mockAdminEvents.finalizeFlyer).toHaveBeenCalledWith('event-1');

    expect(target.maxBytes).toBe(5 * 1024 * 1024);
    // A second file would race the first for the one slot.
    expect(target.multiple).toBe(false);
  });

  it('translates the API rejections into this build language', async () => {
    const target = renderTarget(() => useEventFlyerTarget('event-1'));
    const d = dictPt.admin.events.flyer;

    mockAdminEvents.presignFlyer.mockRejectedValueOnce(
      new AdminEventsApiError(422, 'FileTooLarge', 'too big', 5 * 1024 * 1024),
    );
    await expect(
      target.presign({ fileName: 'f.jpg', contentType: 'image/jpeg', sizeBytes: 9_000_000 }),
    ).rejects.toThrow(d.errorTooLarge(5));

    mockAdminEvents.presignFlyer.mockRejectedValueOnce(
      new AdminEventsApiError(422, 'UnsupportedMediaType', 'not an image'),
    );
    await expect(
      target.presign({ fileName: 'f.pdf', contentType: 'application/pdf', sizeBytes: 10 }),
    ).rejects.toThrow(d.errorUnsupported);

    mockAdminEvents.finalizeFlyer.mockRejectedValueOnce(
      new AdminEventsApiError(422, 'NotUploaded', 'nothing there'),
    );
    await expect(target.finalize('')).rejects.toThrow(d.errorNotUploaded);
  });
});
