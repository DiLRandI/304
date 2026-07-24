import {
  createLobby,
  inviteCode,
  playerId,
  projectRoom,
  roomId,
} from "@three-zero-four/room-domain";
import { describe, expect, it } from "vitest";
import { mapPersistedRoomProjection } from "../src/contexts/rooms/adapters/persistence/room-projection-record-mapper.js";

const hostId = playerId("9c9c7530-224f-4d5e-b354-1c78df2f063b");

describe("room projection record mapper", () => {
  it("hydrates omitted early settlement settings as disabled", () => {
    const projection = projectRoom(
      createLobby({
        host: { displayName: "Asha", playerId: hostId },
        id: roomId("12f8e3e8-6729-4c46-b78a-d1a0e804c55a"),
        inviteCode: inviteCode("304-AbCdEfGhIjKl_123"),
        profileId: "classic_304_4p",
        settings: {
          botDifficulty: "easy",
          enableSecondBidding: true,
          endHandWhenOutcomeCertain: true,
        },
      }),
      hostId,
    );
    const { endHandWhenOutcomeCertain: _, ...legacySettings } =
      projection.settings;

    expect(
      mapPersistedRoomProjection({ ...projection, settings: legacySettings }),
    ).toMatchObject({
      settings: { endHandWhenOutcomeCertain: false },
    });
  });
});
