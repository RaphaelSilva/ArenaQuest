/**
 * IStorageAdapter
 *
 * Cloud-agnostic contract for object storage operations.
 * Concrete implementations must be provided for each supported provider
 * (Cloudflare R2, AWS S3, Backblaze B2, GCS, etc.) without leaking any
 * provider-specific SDK into the business layer.
 *
 * Upload flow (recommended):
 *   1. Client requests a presigned upload URL via `getPresignedUploadUrl`.
 *   2. Client uploads directly to the storage provider (zero bytes through the Worker).
 *   3. Worker stores only the object key / public URL in the database.
 */

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** Supported media MIME types the platform accepts. */
export type StorageMediaType =
  | 'application/pdf'
  | 'video/mp4'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | string; // allow extension for future types

/** Metadata that can be attached to a stored object. */
export interface StorageObjectMetadata {
  /** Original filename provided by the uploader. */
  originalName?: string;
  /** Content MIME type. */
  contentType?: StorageMediaType;
  /** Size in bytes. */
  size?: number;
  /** Arbitrary key/value pairs (e.g. uploadedBy, topicId). */
  [key: string]: string | number | undefined;
}

/** Options for putting an object into storage. */
export interface PutObjectOptions {
  metadata?: StorageObjectMetadata;
  /** Visibility of the object. Defaults to 'private'. */
  visibility?: 'public' | 'private';
}

/** Options for generating a presigned URL. */
export interface PresignedUrlOptions {
  /** Seconds until the URL expires. Defaults to 3600 (1 hour). */
  expiresInSeconds?: number;
  /** Expected content type — enforced by some providers on upload URLs. */
  contentType?: StorageMediaType;
  /** Maximum allowed upload size in bytes (upload URLs only). */
  maxSizeBytes?: number;
}

/** Represents a stored object returned by getObject / listObjects. */
export interface StorageObject {
  /** Storage key (path within the bucket). */
  key: string;
  /** Size in bytes. */
  size: number;
  /** Last modification timestamp. */
  lastModified: Date;
  /** Attached metadata. */
  metadata?: StorageObjectMetadata;
}

/** Result of a listObjects call. */
export interface ListObjectsResult {
  objects: StorageObject[];
  /** Cursor for fetching the next page (undefined when no more results). */
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IStorageAdapter {
  /**
   * Upload an object directly from the Worker (small files, server-side ops).
   * For large uploads prefer `getPresignedUploadUrl` to avoid Worker memory limits.
   *
   * @param key    - Storage key, e.g. `topics/abc123/intro.pdf`
   * @param body   - File contents as ArrayBuffer, ReadableStream, or string
   * @param options - Optional metadata and visibility
   */
  putObject(
    key: string,
    body: ArrayBuffer | ReadableStream | string,
    options?: PutObjectOptions,
  ): Promise<void>;

  /**
   * Retrieve an object's contents as an ArrayBuffer.
   * Returns null when the key does not exist.
   *
   * @param key - Storage key
   */
  getObject(key: string): Promise<ArrayBuffer | null>;

  /**
   * Delete a single object. Resolves silently if the key does not exist.
   *
   * @param key - Storage key
   */
  deleteObject(key: string): Promise<void>;

  /**
   * Delete multiple objects in a single batched operation.
   * Resolves silently for keys that do not exist.
   *
   * @param keys - Array of storage keys
   */
  deleteObjects(keys: string[]): Promise<void>;

  /**
   * Check whether an object exists without fetching its contents.
   *
   * @param key - Storage key
   */
  objectExists(key: string): Promise<boolean>;

  /**
   * Retrieve metadata for an object without downloading its contents.
   * Returns null when the key does not exist.
   *
   * @param key - Storage key
   */
  headObject(key: string): Promise<StorageObject | null>;

  /**
   * Generate a short-lived presigned URL that allows the client to upload
   * a file DIRECTLY to the storage bucket (bypassing the Worker entirely).
   *
   * @param key     - Destination storage key
   * @param options - Expiry, content type, max size
   */
  getPresignedUploadUrl(key: string, options?: PresignedUrlOptions): Promise<string>;

  /**
   * Generate a short-lived presigned URL that allows the client to download
   * a private object directly from the storage provider.
   *
   * @param key     - Source storage key
   * @param options - Expiry duration
   */
  getPresignedDownloadUrl(key: string, options?: PresignedUrlOptions): Promise<string>;

  /**
   * Return the public URL for an object stored with `visibility: 'public'`.
   * Throws if the bucket/object is not publicly accessible.
   *
   * @param key - Storage key
   */
  getPublicUrl(key: string): string;

  /**
   * List objects under a given key prefix with optional pagination.
   *
   * @param prefix  - Key prefix to filter by (e.g. `topics/abc123/`)
   * @param cursor  - Pagination cursor from a previous call
   * @param limit   - Maximum number of results to return (default: 100)
   */
  listObjects(prefix: string, cursor?: string, limit?: number): Promise<ListObjectsResult>;
}