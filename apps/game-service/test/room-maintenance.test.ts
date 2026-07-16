import { describe, expect, it, vi } from "vitest";
import { RoomMaintenance } from "../src/contexts/rooms/application/room-maintenance.js";
import type { RoomMaintenanceStore } from "../src/contexts/rooms/application/room-maintenance-ports.js";

describe("RoomMaintenance", () => {
  it("uses the injected command identity when closing a stale room", async () => {
    const appendEventAndSnapshot = vi.fn().mockResolvedValue(undefined);
    const transaction = { query: vi.fn() };
    const store = {
      appendEventAndSnapshot,
      cancelAutomationForRoom: vi.fn().mockResolvedValue(undefined),
      findStaleRoomIds: vi.fn().mockResolvedValue(["room-1"]),
      loadRoomForUpdate: vi.fn().mockResolvedValue({
        eventVersion: 3,
        id: "room-1",
        ruleProfileId: "classic_304_4p",
        status: "lobby",
        updatedAt: new Date("2026-07-12T00:00:00.000Z"),
      }),
      loadSnapshot: vi.fn().mockResolvedValue({
        eventVersion: 3,
        state: { phase: "setup" },
      }),
      purgeClosedRooms: vi.fn().mockResolvedValue(0),
      revokeExpiredSessions: vi.fn().mockResolvedValue(0),
      transaction: async <T>(
        callback: (value: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    } satisfies RoomMaintenanceStore<typeof transaction>;
    const maintenance = new RoomMaintenance({
      batchSize: 100,
      closedRetentionDays: 30,
      commandIds: { next: () => "maintenance-command-1" },
      expiredSessionRevokeHours: 24,
      lobbyIdleHours: 24,
      store,
      terminalRetentionDays: 14,
    });

    await expect(
      maintenance.runOnce(new Date("2026-07-14T00:00:00.000Z")),
    ).resolves.toEqual({
      closedRooms: 1,
      purgedRooms: 0,
      revokedSessions: 0,
    });
    expect(appendEventAndSnapshot).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        commandId: "maintenance-command-1",
        eventType: "ROOM_CLOSED",
        roomId: "room-1",
      }),
    );
  });
});
