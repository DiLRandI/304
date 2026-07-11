/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomLobby } from "../src/components/room-lobby.js";
import { lobbyProjection } from "./browser-fixtures.js";

describe("RoomLobby", () => {
  afterEach(cleanup);

  it("shows a host the private invite code and an authoritative start control", async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const leave = vi.fn();

    render(
      <RoomLobby leave={leave} projection={lobbyProjection()} start={start} />,
    );

    expect(screen.getByText("304-abcdefghijkl")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Start game" });
    await user.click(startButton);
    expect(start).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Leave table" }));
    expect(leave).toHaveBeenCalledOnce();
  });

  it("uses the server-projected host role after ownership transfers", () => {
    render(
      <RoomLobby
        leave={vi.fn()}
        projection={lobbyProjection(1, 1, true)}
        start={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Start game" })).toBeTruthy();
  });
});
