/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomLobby } from "../src/features/room/ui/room-lobby.js";
import { lobbyProjection } from "./browser-fixtures.js";

const originalClipboard = navigator.clipboard;

function setClipboard(
  clipboard: { writeText(text: string): Promise<void> } | undefined,
): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
}

async function expectCopyStatus(message: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Copy invite code" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(message),
  );
}

describe("RoomLobby", () => {
  afterEach(() => {
    cleanup();
    setClipboard(originalClipboard);
    vi.restoreAllMocks();
  });

  it("asks the guest to copy manually when the Clipboard API is unavailable", async () => {
    setClipboard(undefined);
    render(
      <RoomLobby
        leave={vi.fn()}
        projection={lobbyProjection()}
        start={vi.fn()}
      />,
    );

    await expectCopyStatus("Copy the invite code manually.");
  });

  it("reports success only after writing the exact invite code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(
      <RoomLobby
        leave={vi.fn()}
        projection={lobbyProjection()}
        start={vi.fn()}
      />,
    );

    await expectCopyStatus("Invite code copied.");
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("304-abcdefghijkl");
  });

  it("asks the guest to copy manually when clipboard writing rejects", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("permission denied")),
    });
    render(
      <RoomLobby
        leave={vi.fn()}
        projection={lobbyProjection()}
        start={vi.fn()}
      />,
    );

    await expectCopyStatus("Copy the invite code manually.");
  });

  it("asks the guest to copy manually when clipboard writing throws", async () => {
    setClipboard({
      writeText: vi.fn().mockImplementation(() => {
        throw new Error("clipboard unavailable");
      }),
    });
    render(
      <RoomLobby
        leave={vi.fn()}
        projection={lobbyProjection()}
        start={vi.fn()}
      />,
    );

    await expectCopyStatus("Copy the invite code manually.");
  });

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

  it("shows the configured early-settlement choice in the lobby summary", () => {
    render(
      <RoomLobby
        leave={vi.fn()}
        projection={lobbyProjection()}
        start={vi.fn()}
      />,
    );

    expect(
      screen.getByText("End hands early when the outcome is certain"),
    ).toBeTruthy();
  });
});
