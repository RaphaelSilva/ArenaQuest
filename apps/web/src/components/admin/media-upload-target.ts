/**
 * The upload lifecycle, as `MediaUploader` sees it.
 *
 * `MediaUploader` used to call `client.adminMedia.*` directly, which bound it to
 * one endpoint family — topic media. Event flyers run the *same* three steps
 * against a different path, so the steps are injected instead of imported
 * (Milestone 20, Task 06). There is exactly one uploader component; a second
 * implementation would drift from the lifecycle the topic path proved.
 *
 * ---------------------------------------------------------------------------
 * `sizeBytes` is load-bearing
 * ---------------------------------------------------------------------------
 *
 * Both presign implementations sign the **declared** byte count into the
 * upload URL: it reaches R2 as `ContentLength`, which the presigner lists in
 * `X-Amz-SignedHeaders`. The `PUT` must therefore carry exactly that many
 * bytes, or the signature fails. `MediaUploader` declares `file.size` and sends
 * the very same `File`. Do not round it, recompute it from a transformed blob,
 * or declare a ceiling in its place.
 */

/** What a presign call is told about the file. */
export interface MediaUploadPresign {
  fileName: string;
  contentType: string;
  /** Exactly `file.size` — see the module header. */
  sizeBytes: number;
}

/** What a presign call hands back. */
export interface MediaUploadTicket {
  /** The presigned `PUT` target. */
  uploadUrl: string;
  /**
   * Opaque handle threaded back into {@link MediaUploadTarget.finalize}.
   *
   * Topic media puts the new media id here; an event flyer has nothing to
   * identify (the event owns exactly one) and puts an empty string.
   */
  handle: string;
}

/** Copy the uploader renders that depends on *what* is being uploaded. */
export interface MediaUploadLabels {
  dropzoneTitle: string;
  /** States the accepted types and the ceiling, before a file is chosen. */
  dropzoneHint: string;
  /** Shown when the picked file is already over {@link MediaUploadTarget.maxBytes}. */
  fileTooBig: string;
}

/** One endpoint family the uploader can drive. */
export interface MediaUploadTarget {
  presign(input: MediaUploadPresign): Promise<MediaUploadTicket>;
  finalize(handle: string): Promise<void>;
  /**
   * Largest size this target accepts, in bytes.
   *
   * A courtesy check only: it spares a doomed round trip, and the API re-checks
   * the stored bytes regardless. It is never the gate.
   */
  maxBytes: number;
  /** Whether more than one file may be queued at once. */
  multiple: boolean;
  /** `accept` attribute for the file input, or `undefined` for anything. */
  accept?: string;
  labels: MediaUploadLabels;
}
