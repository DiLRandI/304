/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomLobby } from "../src/components/room-lobby.js";
import { lobbyProjection } from "./browser-fixtures.js";

describe("RoomLobby", () => {
  it("shows a host the private invite code and an authoritative start control", async () => {
    const user = userEvent.setup();
    const start = vi.fn();

    render(<RoomLobby projection={lobbyProjection()} start={start} />);

    expect(screen.getByText("304-abcdefghijkl")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Start game" });
    await user.click(startButton);
    expect(start).toHaveBeenCalledOnce();
  });
});
