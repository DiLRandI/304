"use client";

import type { RoomProjection } from "@three-zero-four/contracts";
import { useState } from "react";
import { readLobbyRoomView } from "../model/lobby-view";

export function RoomLobby({
  leave,
  projection,
  start,
}: {
  leave(): void;
  projection: RoomProjection;
  start(): void;
}) {
  const view = readLobbyRoomView(projection);
  const [copyStatus, setCopyStatus] = useState("");
  if (!view) {
    return (
      <section aria-live="polite" className="safe-table-state">
        This private lobby could not be displayed safely.
      </section>
    );
  }
  const isHost = view.isHost;

  async function copyInvite(): Promise<void> {
    const clipboard = navigator.clipboard;
    if (typeof clipboard?.writeText !== "function") {
      setCopyStatus("Copy the invite code manually.");
      return;
    }
    try {
      await clipboard.writeText(projection.inviteCode);
      setCopyStatus("Invite code copied.");
    } catch {
      setCopyStatus("Copy the invite code manually.");
    }
  }

  return (
    <section aria-labelledby="lobby-title" className="room-lobby">
      <div className="lobby-heading">
        <p className="eyebrow">Private room</p>
        <h1 id="lobby-title">Set the table before the first hand.</h1>
        <p>
          Share this invite only with people you want at the table. The game
          service keeps cards and turn validation private to each seat.
        </p>
      </div>

      <section aria-label="Room invite" className="invite-panel">
        <p className="eyebrow">Invite code</p>
        <code>{projection.inviteCode}</code>
        <button onClick={() => void copyInvite()} type="button">
          Copy invite code
        </button>
        <p aria-live="polite" role="status">
          {copyStatus}
        </p>
      </section>

      <section aria-label="Lobby seats" className="lobby-seats">
        {view.lobby.seats.map((seat) => (
          <article data-seat-type={seat.occupantType} key={seat.seatIndex}>
            <p>Seat {seat.seatIndex + 1}</p>
            <h2>{seat.displayName ?? "Open seat"}</h2>
            <p>
              {seat.occupantType === "bot"
                ? `Bot · ${seat.botDifficulty ?? "easy"}`
                : seat.occupantType === "human"
                  ? "Player connected"
                  : "Waiting for a player or bot"}
            </p>
          </article>
        ))}
      </section>

      <p className="lobby-profile">
        {view.lobby.ruleProfileId === "six_304_36"
          ? "Six-seat 304-36 variant"
          : "Classic four-seat 304"}
      </p>
      <div className="lobby-actions">
        {isHost ? (
          <button className="primary-action" onClick={start} type="button">
            Start game
          </button>
        ) : (
          <p aria-live="polite" className="form-status">
            Waiting for the host to start the game.
          </p>
        )}
        <button className="leave-table" onClick={leave} type="button">
          Leave table
        </button>
      </div>
    </section>
  );
}
