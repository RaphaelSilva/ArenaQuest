/**
 * R2StorageAdapter — implements IStorageAdapter backed by Cloudflare R2.
 *
 * Two access paths:
 *  - Native R2Bucket binding  → object CRUD (put/get/delete/head/list)
 *  - S3-compatible HTTP client → presigned URLs (client uploads bypass the Worker)
 *
 * @aws-sdk/* imports are intentionally confined to this file.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  IStorageAdapter,
  PutObjectOptions,
  PresignedUrlOptions,
  StorageObject,
  StorageObjectMetadata,
  ListObjectsResult,
} from '@arenaquest/shared/ports';

export interface R2StorageAdapterConfig {
  bucket: R2Bucket;
  /** R2 S3-compatible endpoint, e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com */
  s3Endpoint: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Base URL for publicly accessible objects. Required by `getPublicUrl`. */
  publicBase?: string;
}

export class R2StorageAdapter implements IStorageAdapter {
  private readonly bucket: R2Bucket;
  private readonly bucketName: string;
  private readonly publicBase: string | undefined;
  private readonly s3Endpoint: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private s3Client: S3Client | null = null;

  constructor(config: R2StorageAdapterConfig) {
    if (!config.s3Endpoint) {
      throw new Error('R2StorageAdapter: s3Endpoint is required');
    }

    this.bucket = config.bucket;
    this.bucketName = config.bucketName;
    this.publicBase = config.publicBase || undefined;
    this.s3Endpoint = config.s3Endpoint;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
  }

  /**
   * The S3 client, built on first use. The credentials are checked here rather
   * than in the constructor: the container builds this adapter on every
   * request, so an eager throw took down every route (login included) on a
   * Worker missing them, while only the S3 calls below actually need them.
   */
  private get s3(): S3Client {
    if (!this.s3Client) {
      if (!this.accessKeyId || !this.secretAccessKey) {
        throw new Error('R2StorageAdapter: accessKeyId and secretAccessKey are required');
      }
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: this.s3Endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });
    }
    return this.s3Client;
  }

  async putObject(
    key: string,
    body: ArrayBuffer | ReadableStream | string,
    options?: PutObjectOptions,
  ): Promise<void> {
    await this.bucket.put(key, body, {
      httpMetadata: options?.metadata?.contentType
        ? { contentType: String(options.metadata.contentType) }
        : undefined,
      customMetadata: this.buildCustomMetadata(options?.metadata),
    });
  }

  async getObject(key: string): Promise<ArrayBuffer | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return obj.arrayBuffer();
  }

  async deleteObject(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.bucket.delete(keys);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      return true;
      // S3 SDK error shape is untyped
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async headObject(key: string): Promise<StorageObject | null> {
    const obj = await this.bucket.head(key);
    if (!obj) return null;
    return this.toStorageObject(obj);
  }

  async getPresignedUploadUrl(key: string, options?: PresignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresInSeconds ?? 3600;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ...(options?.contentType && { ContentType: options.contentType }),
      ...(options?.maxSizeBytes !== undefined && { ContentLength: options.maxSizeBytes }),
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async getPresignedDownloadUrl(key: string, options?: PresignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresInSeconds ?? 3600;
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  getPublicUrl(key: string): string {
    if (!this.publicBase) {
      throw new Error(
        'R2StorageAdapter: publicBase is not configured — bucket is not publicly accessible',
      );
    }
    const base = this.publicBase.replace(/\/$/, '');
    return `${base}/${key}`;
  }

  async listObjects(prefix: string, cursor?: string, limit = 100): Promise<ListObjectsResult> {
    const result = await this.bucket.list({
      prefix,
      cursor,
      limit,
      include: ['customMetadata', 'httpMetadata'],
    });

    return {
      objects: result.objects.map(obj => this.toStorageObject(obj)),
      nextCursor: result.truncated ? result.cursor : undefined,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private toStorageObject(obj: R2Object): StorageObject {
    return {
      key: obj.key,
      size: obj.size,
      lastModified: obj.uploaded,
      metadata: obj.customMetadata
        ? (obj.customMetadata as StorageObjectMetadata)
        : undefined,
    };
  }

  private buildCustomMetadata(
    metadata?: StorageObjectMetadata,
  ): Record<string, string> | undefined {
    if (!metadata) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (k !== 'contentType' && k !== 'size' && v !== undefined) {
        out[k] = String(v);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
