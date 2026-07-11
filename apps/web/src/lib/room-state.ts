import type { RoomProjection } from "@three-zero-four/contracts";

export interface ProjectionTransition {
  needsResync: boolean;
  projection: RoomProjection;
}

export function applyProjection(
  current: RoomProjection | null,
  next: RoomProjection,
): ProjectionTransition {
  if (!current || next.eventVersion > current.eventVersion) {
    return {
      projection: next,
      needsResync: Boolean(
        current && next.eventVersion > current.eventVersion + 1,
      ),
    };
  }
  return { projection: current, needsResync: false };
}
