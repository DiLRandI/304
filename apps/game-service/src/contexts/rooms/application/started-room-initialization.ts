import type { Room } from "@three-zero-four/room-domain";
import type { NewAutomationJob } from "./room-persistence-model.js";

export interface StartedRoomSnapshotFactory {
  create(room: Room): unknown;
}

export interface StartedRoomAutomationFactory {
  create(room: Room, snapshot: unknown): NewAutomationJob | null;
}
