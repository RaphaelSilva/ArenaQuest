'use client';

import { useState, useRef } from 'react';
import { adminMediaApi, type PresignInput } from '@web/lib/admin-media-api';

type UploadState = 'idle' | 'presigning' | 'uploading' | 'finalizing' | 'success' | 'error';

type ActiveUpload = {
  id: string;
  file: File;
  progress: number;
  state: UploadState;
  error?: string;
  abortController?: AbortController;
};

type MediaUploaderProps = {
  topicId: string;
  token: string;
  onUploadComplete: () => void;
};

export function MediaUploader({ topicId, token, onUploadComplete }: MediaUploaderProps) {
  const [uploads, setUploads] = useState<ActiveUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newUploads: ActiveUpload[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      state: 'idle',
    }));

    setUploads((prev) => [...prev, ...newUploads]);

    // Process each upload
    for (const upload of newUploads) {
      processUpload(upload);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processUpload = async (upload: ActiveUpload) => {
    const updateUpload = (updates: Partial<ActiveUpload>) => {
      setUploads((prev) => prev.map((u) => (u.id === upload.id ? { ...u, ...updates } : u)));
    };

    updateUpload({ state: 'presigning' });
    const abortController = new AbortController();
    updateUpload({ abortController });

    try {
      // 1. Presign
      const presignData: PresignInput = {
        fileName: upload.file.name,
        contentType: upload.file.type || 'application/octet-stream',
        sizeBytes: upload.file.size,
      };
      
      // Basic client side validation
      if (upload.file.size > 100 * 1024 * 1024) {
          throw new Error('File too large (Max 100MB)');
      }

      const { uploadUrl, media } = await adminMediaApi.getPresignedUrl(token, topicId, presignData);

      // 2. Upload to R2
      updateUpload({ state: 'uploading' });
      
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', upload.file.type || 'application/octet-stream');
      
      abortController.signal.addEventListener('abort', () => xhr.abort());

      const uploadPromise = new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            updateUpload({ progress });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));
      });

      xhr.send(upload.file);
      await uploadPromise;

      // 3. Finalize
      updateUpload({ state: 'finalizing', progress: 100 });
      await adminMediaApi.finalize(token, topicId, media.id);

      updateUpload({ state: 'success' });
      onUploadComplete();
      
      // Clear success after 3s
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.id !== upload.id));
      }, 3000);

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Upload failed');
      if (error.message === 'Upload cancelled') {
        setUploads((prev) => prev.filter((u) => u.id !== upload.id));
      } else {
        updateUpload({ state: 'error', error: error.message });
      }
    }
  };

  const cancelUpload = (id: string) => {
    const upload = uploads.find((u) => u.id === id);
    if (upload?.abortController) {
      upload.abortController.abort();
    }
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className="group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 transition-all hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/10"
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="rounded-full bg-indigo-100 p-3 text-indigo-600 transition-transform group-hover:scale-110 dark:bg-indigo-500/20 dark:text-indigo-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Click to upload or drag and drop
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          PDF, Video, or Images up to 100MB
        </p>
      </div>

      {uploads.length > 0 && (
        <div className="space-y-3">
          {uploads.map((upload) => (
            <div key={upload.id} className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 truncate">
                   <svg className="h-5 w-5 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {upload.file.name}
                  </span>
                </div>
                {upload.state !== 'success' && upload.state !== 'error' && (
                  <button
                    onClick={() => cancelUpload(upload.id)}
                    className="flex-shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              
              {upload.state === 'error' ? (
                <p className="mt-2 text-xs text-red-500">{upload.error}</p>
              ) : upload.state === 'success' ? (
                 <p className="mt-2 text-xs text-emerald-500">Upload complete</p>
              ) : (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-zinc-500 mb-1">
                    <span>
                      {upload.state === 'presigning' && 'Preparing...'}
                      {upload.state === 'uploading' && 'Uploading...'}
                      {upload.state === 'finalizing' && 'Finishing...'}
                    </span>
                    <span>{upload.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
