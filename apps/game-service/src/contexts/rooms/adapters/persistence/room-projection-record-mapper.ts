import {
  eventVersion,
  inviteCode,
  type RoomProjection,
  roomId,
  seatPosition,
} from "@three-zero-four/room-domain";
import { z } from "zod";

const projectionSeatSchema = z.strictObject({
  botDifficulty: z.enum(["easy", "normal", "strong"]).optional(),
  connectionStatus: z.enum(["autopilot", "disconnected", "online"]),
  displayName: z.string().nullable(),
  isHost: z.boolean(),
  isViewer: z.boolean(),
  occupantType: z.enum(["bot", "empty", "human"]),
  position: z.number().int().nonnegative(),
});

const projectionSchema = z.strictObject({
  eventVersion: z.number().int().positive(),
  id: z.string(),
  inviteCode: z.string(),
  profileId: z.enum(["classic_304_4p", "six_304_36"]),
  seats: z.array(projectionSeatSchema),
  settings: z.strictObject({
    botDifficulty: z.enum(["easy", "normal", "strong"]),
    enableSecondBidding: z.boolean(),
  }),
  status: z.enum([
    "closed",
    "hand_result",
    "in_hand",
    "lobby",
    "recovery_failed",
  ]),
  viewerSeatPosition: z.number().int().nonnegative().nullable(),
});

export class RoomProjectionRecordMappingError extends Error {
  constructor() {
    super("Stored room projection is invalid");
    this.name = "RoomProjectionRecordMappingError";
  }
}

export function mapPersistedRoomProjection(value: unknown): RoomProjection {
  try {
    const parsed = projectionSchema.parse(value);
    const seatCount = parsed.profileId === "six_304_36" ? 6 : 4;
    if (
      parsed.seats.length !== seatCount ||
      parsed.seats.some(
        (seat, index) =>
          seat.position !== index ||
          (seat.occupantType === "bot") !==
            (seat.botDifficulty !== undefined) ||
          (seat.occupantType === "empty") !== (seat.displayName === null),
      )
    ) {
      throw new RoomProjectionRecordMappingError();
    }
    const viewerSeatPosition =
      parsed.viewerSeatPosition === null
        ? null
        : seatPosition(parsed.viewerSeatPosition, seatCount);
    if (
      parsed.seats.filter((seat) => seat.isViewer).length !==
        (viewerSeatPosition === null ? 0 : 1) ||
      (viewerSeatPosition !== null &&
        !parsed.seats[viewerSeatPosition]?.isViewer)
    ) {
      throw new RoomProjectionRecordMappingError();
    }
    return {
      ...parsed,
      eventVersion: eventVersion(parsed.eventVersion),
      id: roomId(parsed.id),
      inviteCode: inviteCode(parsed.inviteCode),
      seats: parsed.seats.map(({ botDifficulty, ...seat }) => {
        const mappedSeat = {
          ...seat,
          position: seatPosition(seat.position, seatCount),
        };
        return botDifficulty === undefined
          ? mappedSeat
          : { ...mappedSeat, botDifficulty };
      }),
      viewerSeatPosition,
    };
  } catch {
    throw new RoomProjectionRecordMappingError();
  }
}
