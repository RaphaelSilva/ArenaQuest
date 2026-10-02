'use client';

import { useEffect, useRef, useState } from 'react';
import VideoStage from '@web/components/catalog/MediaList/VideoStage';
import { useDict } from '@web/context/dict-context';

/** `MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED`, spelled out because not every runtime defines `MediaError`. */
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

type SubmissionVideoProps = {
  url: string;
  originalName: string;
};

/**
 * Wraps the course `VideoStage` with the playback fallback (RFC 0020 §4): when
 * the browser reports that it cannot decode the source — an HEVC `.mov` on a
 * browser without HEVC — the player is replaced by a message and a download
 * link. It reacts to the media element's error code only, never to the file
 * extension or the user agent.
 */
export function SubmissionVideo({ url, originalName }: SubmissionVideoProps) {
  const dict = useDict();
  const t = dict.submissions.viewer;
  const wrapper = useRef<HTMLDivElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    // A media `error` event does not bubble; listening in the capture phase on
    // the wrapper catches it without touching `VideoStage`.
    const onError = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLVideoElement && target.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setUnsupported(true);
      }
    };
    el.addEventListener('error', onError, true);
    return () => el.removeEventListener('error', onError, true);
  }, []);

  return (
    <div ref={wrapper}>
      {unsupported ? (
        <div
          role="alert"
          className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-[8px] border p-4 text-center"
          style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg3)' }}
        >
          <p className="text-[14px] font-semibold" style={{ color: 'var(--aq-text)' }}>
            {t.unsupportedVideo}
          </p>
          <a
            href={url}
            download={originalName}
            className="rounded-[8px] px-4 py-2 text-[12px] font-bold"
            style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
          >
            {t.download}
          </a>
        </div>
      ) : (
        <VideoStage url={url} />
      )}
    </div>
  );
}
