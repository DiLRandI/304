import { randomUUID } from "node:crypto";
import { roomClosureReason } from "@three-zero-four/room-domain";
import type { PostgresRoomStore } from "./room-store.js";

const ALL_AUTOMATION_KINDS = [
  "BOT_ACTION",
  "TURN_TIMEOUT",
  "DISCONNECT_GRACE",
  "TRICK_ADVANCE",
] as const;

export interface MaintenanceResult {
  closedRooms: number;
  purgedRooms: number;
  revokedSessions: number;
}

type MaintenanceStore = Pick<
  PostgresRoomStore,
  | "appendEventAndSnapshot"
  | "cancelAutomationForRoom"
  | "findStaleRoomIds"
  | "loadRoomForUpdate"
  | "loadSnapshot"
  | "purgeClosedRooms"
  | "revokeExpiredSessions"
  | "transaction"
>;

interface RoomMaintenanceDependencies {
  batchSize: number;
  closedRetentionDays: number;
  expiredSessionRevokeHours: number;
  lobbyIdleHours: number;
  store: MaintenanceStore;
  terminalRetentionDays: number;
}

function subtractHours(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1_000);
}

function subtractDays(now: Date, days: number): Date {
  return subtractHours(now, days * 24);
}

export class RoomMaintenance {
  private readonly dependencies: RoomMaintenanceDependencies;

  constructor(dependencies: RoomMaintenanceDependencies) {
    this.dependencies = dependencies;
  }

  async runOnce(now = new Date()): Promise<MaintenanceResult> {
    const lobbyCutoff = subtractHours(now, this.dependencies.lobbyIdleHours);
    const terminalCutoff = subtractDays(
      now,
      this.dependencies.terminalRetentionDays,
    );
    const closedCutoff = subtractDays(
      now,
      this.dependencies.closedRetentionDays,
    );
    const expiredSessionCutoff = subtractHours(
      now,
      this.dependencies.expiredSessionRevokeHours,
    );
    const revokedSessions = await this.dependencies.store.revokeExpiredSessions(
      expiredSessionCutoff,
      now,
      this.dependencies.batchSize,
    );
    const roomIds = await this.dependencies.store.findStaleRoomIds(
      lobbyCutoff,
      terminalCutoff,
      this.dependencies.batchSize,
    );
    let closedRooms = 0;
    for (const roomId of roomIds) {
      if (await this.closeIfStillStale(roomId, lobbyCutoff, terminalCutoff)) {
        closedRooms += 1;
      }
    }
    const purgedRooms = await this.dependencies.store.purgeClosedRooms(
      closedCutoff,
      this.dependencies.batchSize,
    );
    return { closedRooms, purgedRooms, revokedSessions };
  }

  private async closeIfStillStale(
    roomId: string,
    lobbyCutoff: Date,
    terminalCutoff: Date,
  ): Promise<boolean> {
    return this.dependencies.store.transaction(async (transaction) => {
      const room = await this.dependencies.store.loadRoomForUpdate(
        transaction,
        roomId,
      );
      if (!room) return false;
      const reason = roomClosureReason(room, { lobbyCutoff, terminalCutoff });
      if (!reason) return false;
      const snapshot = await this.dependencies.store.loadSnapshot(
        room.id,
        transaction,
      );
      if (!snapshot || snapshot.eventVersion !== room.eventVersion)
        return false;
      await this.dependencies.store.cancelAutomationForRoom(
        transaction,
        room.id,
        ALL_AUTOMATION_KINDS,
      );
      await this.dependencies.store.appendEventAndSnapshot(transaction, {
        roomId: room.id,
        expectedVersion: room.eventVersion,
        commandId: randomUUID(),
        actorPlayerId: null,
        eventType: "ROOM_CLOSED",
        payload: { reason },
        snapshot: snapshot.state,
        status: "closed",
        ruleProfileId: room.ruleProfileId,
      });
      return true;
    });
  }
}
