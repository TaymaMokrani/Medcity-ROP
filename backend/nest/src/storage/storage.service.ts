import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import { contentTypeOf, isOwnedKey } from './keys';

export interface ListedObject {
  size: number;
  modified: Date;
}

export interface StoredObject {
  stream: Readable;
  contentType: string;
  length?: number;
}

/**
 * The only place that talks to object storage.
 *
 * S3's API, so the same code runs against the MinIO container locally and
 * against Amazon S3 or any S3-compatible store in production — only the
 * STORAGE_* settings change. The bucket is private: nothing in it is reachable
 * without going through the gateway, which checks the doctor's grant first.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: config.get<string>('STORAGE_REGION') ?? 'us-east-1',
      credentials: {
        accessKeyId: config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('STORAGE_SECRET_KEY'),
      },
      // MinIO serves buckets as a path (host/bucket/key), not a subdomain.
      forcePathStyle: true,
    });
  }

  /** Fails the start-up loudly if storage cannot be reached, rather than
   * letting the first upload discover it in front of a doctor. */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch (error) {
      throw new Error(
        `Object storage is unreachable (${String(error)}). ` +
          'Is the MinIO container running? docker compose ps',
      );
    }
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`created bucket ${this.bucket}`);
    }
  }

  async put(key: string, body: Buffer | string, contentType?: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType ?? contentTypeOf(key),
      }),
    );
  }

  /** The object as a stream, for handing straight to a response. */
  async open(key: string): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        stream: result.Body as Readable,
        contentType: result.ContentType ?? contentTypeOf(key),
        length: result.ContentLength,
      };
    } catch (error) {
      if (statusOf(error) === 404) {
        throw new NotFoundException('No such file');
      }
      throw error;
    }
  }

  /** The whole object in memory. For photographs sent on to the analysers. */
  async read(key: string): Promise<Buffer> {
    const { stream } = await this.open(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  /** Every object under a prefix, with its size and date. Used to verify a
   * copy and to find what the nightly cleanup may remove. */
  async list(prefix: string): Promise<Map<string, ListedObject>> {
    const found = new Map<string, ListedObject>();
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key) {
          found.set(item.Key, {
            size: item.Size ?? 0,
            modified: item.LastModified ?? new Date(0),
          });
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return found;
  }

  /** Throws unless the bucket answers. For the health check. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Deletes keys this app wrote. Anything else is ignored, not deleted. */
  async remove(keys: string[]): Promise<void> {
    const owned = [...new Set(keys.filter(isOwnedKey))];
    // S3 accepts at most 1000 keys per request.
    for (let i = 0; i < owned.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: owned.slice(i, i + 1000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
  }
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}
