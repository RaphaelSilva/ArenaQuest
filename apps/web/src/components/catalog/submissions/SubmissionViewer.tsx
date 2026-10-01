'use client';

import VideoStage from '@web/components/catalog/MediaList/VideoStage';
import PdfStage from '@web/components/catalog/MediaList/PdfStage';
import { ImageGallery } from '@web/components/catalog/MediaViewers/ImageGallery';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import { useDict } from '@web/context/dict-context';
import type { SubmissionView } from '@web/lib/submissions-api';
import { SubmissionModal } from './SubmissionModal';
import { formatBytes, submissionKind } from './submission-format';

type SubmissionViewerProps = {
  submission: SubmissionView;
  onClose: () => void;
};

/**
 * Opens one ready submission in the existing course viewers (video, PDF,
 * image). Task 07 replaces this simple modal with the full-screen viewer.
 */
export function SubmissionViewer({ submission, onClose }: SubmissionViewerProps) {
  const dict = useDict();
  const kind = submissionKind(submission.contentType);
  const url = submission.url;

  return (
    <SubmissionModal label={dict.submissions.viewer.label(submission.title)} onClose={onClose}>
      {!url ? (
        <p className="text-[13px]" style={{ color: 'var(--aq-text2)' }}>
          {dict.submissions.viewer.unavailable}
        </p>
      ) : kind === 'video' ? (
        <VideoStage url={url} />
      ) : kind === 'image' ? (
        <ImageGallery url={url} title={submission.title} />
      ) : (
        <PdfStage url={url} originalName={submission.originalName} fileSize={formatBytes(dict, submission.sizeBytes)} />
      )}
      {submission.description && (
        <MarkdownViewer content={submission.description} className="mt-4 break-words text-[14px]" />
      )}
    </SubmissionModal>
  );
}
