import type { Room } from "@three-zero-four/room-domain";
import type { NewAutomationJob } from "./room-persistence-model.js";

export interface StartedRoomSnapshot {
  readonly schemaVersion: 1 | 2;
  readonly state: unknown;
}

export interface StartedRoomSnapshotFactory {
  create(room: Room): StartedRoomSnapshot;
}

export interface StartedRoomAutomationFactory {
  create(room: Room, snapshot: StartedRoomSnapshot): NewAutomationJob | null;
}
