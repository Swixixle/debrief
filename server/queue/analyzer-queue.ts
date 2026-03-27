/**
 * BullMQ wrapper — opt-in when REDIS_URL + DEBRIEF_USE_BULLMQ=1.
 */
import { Queue } from "bullmq";
import Redis from "ioredis";

let _queue: Queue | null = null;

export const redisConnectionOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const;

/** New ioredis instance per BullMQ component (Queue vs Worker). */
export function createRedisConnection(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url || process.env.DEBRIEF_USE_BULLMQ !== "1") return null;
  return new Redis(url, { ...redisConnectionOptions });
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { count: 100, age: 3600 },
  removeOnFail: { count: 50 },
};

export function analyzerQueue(): Queue | null {
  if (_queue) return _queue;
  const connection = createRedisConnection();
  if (!connection) return null;
  _queue = new Queue("debrief-analyzer", {
    connection,
    defaultJobOptions,
  });
  return _queue;
}

export function useQueueForAnalyzer(): boolean {
  return analyzerQueue() !== null;
}
