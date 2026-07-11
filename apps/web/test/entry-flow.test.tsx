/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntryFlow } from "../src/components/entry-flow.js";
import { GameServiceError } from "../src/lib/game-client.js";
import {
  activeProjection,
  lobbyProjection,
  ROOM_ID,
} from "./browser-fixtures.js";

describe("EntryFlow", () => {
  afterEach(cleanup);

  it("creates a guest and starts a private bot practice table", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const client = {
      createGuest: vi.fn().mockResolvedValue({
        expiresAt: "2026-07-12T12:00:00.000Z",
        player: {
          displayName: "Asha",
          id: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        },
      }),
      createRoom: vi.fn().mockResolvedValue(lobbyProjection()),
      startRoom: vi.fn().mockResolvedValue(activeProjection(2)),
    };

    render(<EntryFlow client={client} onNavigate={onNavigate} />);

    await user.type(screen.getByLabelText("Display name"), "Asha");
    await user.click(screen.getByRole("button", { name: "Start practice" }));

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(`/room/${ROOM_ID}`),
    );
    expect(client.createGuest).toHaveBeenCalledWith("Asha");
    expect(client.createRoom).toHaveBeenCalledWith({
      botDifficulty: "easy",
      ruleProfileId: "classic_304_4p",
    });
    expect(client.startRoom).toHaveBeenCalledWith(ROOM_ID, 1);
  });

  it("announces a known safe service error without exposing protocol details", async () => {
    const user = userEvent.setup();
    const client = {
      createGuest: vi
        .fn()
        .mockRejectedValue(
          new GameServiceError("RATE_LIMITED", 429, "Please wait a moment."),
        ),
      createRoom: vi.fn(),
      startRoom: vi.fn(),
    };

    render(<EntryFlow client={client} onNavigate={vi.fn()} />);

    await user.type(screen.getByLabelText("Display name"), "Asha");
    await user.click(screen.getByRole("button", { name: "Start practice" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Please wait a moment.",
    );
  });
});
