import type { RedisClientType } from "redis";
import { z } from "zod";
import type {
  RoomChangedNotice,
  RoomChangePublisher,
} from "../../contexts/rooms/application/room-change-notification.js";

export const ROOM_CHANGED_CHANNEL = "g304:room-changed";

const RoomChangedNoticeSchema = z
  .object({
    roomId: z.string().uuid(),
    eventVersion: z.number().int().positive(),
  })
  .strict();

function parseRoomChangedNotice(rawNotice: string): RoomChangedNotice | null {
  try {
    const parsed = RoomChangedNoticeSchema.safeParse(
      JSON.parse(rawNotice) as unknown,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class RedisRoomChangeBus implements RoomChangePublisher {
  private subscriber: RedisClientType | undefined;

  constructor(private readonly redis: RedisClientType) {}

  async start(
    handler: (notice: RoomChangedNotice) => Promise<void>,
  ): Promise<void> {
    if (this.subscriber) {
      throw new Error("Room change bus has already started");
    }
    const subscriber = this.redis.duplicate();
    subscriber.on("error", () => undefined);
    try {
      await subscriber.connect();
      await subscriber.subscribe(ROOM_CHANGED_CHANNEL, (rawNotice) => {
        const notice = parseRoomChangedNotice(rawNotice);
        if (!notice) return;
        void handler(notice).catch(() => undefined);
      });
      this.subscriber = subscriber;
    } catch (error) {
      if (subscriber.isOpen) await subscriber.quit();
      throw error;
    }
  }

  async publish(notice: RoomChangedNotice): Promise<void> {
    const parsed = RoomChangedNoticeSchema.parse(notice);
    await this.redis.publish(ROOM_CHANGED_CHANNEL, JSON.stringify(parsed));
  }

  async close(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    if (!subscriber) return;
    try {
      await subscriber.unsubscribe(ROOM_CHANGED_CHANNEL);
    } finally {
      if (subscriber.isOpen) await subscriber.quit();
    }
  }
}
