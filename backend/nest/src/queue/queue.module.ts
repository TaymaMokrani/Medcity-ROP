import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

/**
 * The connection to Redis, shared by every queue.
 *
 * Background work — a severity analysis takes about seventy seconds — is put
 * on a queue in Redis instead of being done inside the request. A worker in
 * this gateway takes jobs off one at a time. Because the queue lives in Redis
 * and not in any process's memory, a job survives a restart of the gateway or
 * of the analyser, and is retried rather than lost.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ: a worker waits on Redis
 * indefinitely instead of giving up after a few attempts.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('REDIS_URL'),
          maxRetriesPerRequest: null,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
