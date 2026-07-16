import { describe, expect, it, vi } from "vitest";
import { PostgresRoomStore } from "../src/contexts/rooms/adapters/persistence/postgres-room-store.js";
import type { Database } from "../src/platform/postgres/database.js";

const claimLossCases: readonly [
  code: string,
  operation: (store: PostgresRoomStore) => Promise<void>,
][] = [
  [
    "OUTBOX_CLAIM_LOST",
    (store) => store.markRoomNotificationPublished(1, "owner-1"),
  ],
  [
    "OUTBOX_CLAIM_LOST",
    (store) => store.releaseRoomNotification(1, "owner-1", "failed"),
  ],
  [
    "AUTOMATION_CLAIM_LOST",
    (store) => store.completeAutomationJob("job-1", "owner-1"),
  ],
  [
    "AUTOMATION_CLAIM_LOST",
    (store) => store.releaseAutomationJob("job-1", "owner-1", "failed"),
  ],
];

describe("PostgresRoomStore durable claim errors", () => {
  it.each(
    claimLossCases,
  )("classifies %s as a room conflict", async (code, operation) => {
    const database = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Database;
    const store = new PostgresRoomStore(database);

    await expect(operation(store)).rejects.toMatchObject({
      code,
      kind: "conflict",
      name: "RoomApplicationError",
    });
  });
});
