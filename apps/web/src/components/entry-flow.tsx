"use client";

import type { RoomProjection } from "@three-zero-four/contracts";
import { useRef, useState } from "react";
import {
  type CreateRoomOptions,
  GameServiceError,
  type GuestSession,
} from "../features/room/api/game-service-client";

export interface EntryClient {
  createGuest(displayName: string): Promise<GuestSession>;
  createRoom(options: CreateRoomOptions): Promise<RoomProjection>;
  startRoom(roomId: string, expectedVersion: number): Promise<RoomProjection>;
}

type EntryMode = "private" | "practice";

function safeEntryError(error: unknown): string {
  if (error instanceof GameServiceError) return error.message;
  return "We could not prepare that table. Please try again.";
}

export function EntryFlow({
  client,
  onNavigate,
}: {
  client: EntryClient;
  onNavigate(path: string): void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [ruleProfileId, setRuleProfileId] =
    useState<CreateRoomOptions["ruleProfileId"]>("classic_304_4p");
  const [botDifficulty, setBotDifficulty] =
    useState<NonNullable<CreateRoomOptions["botDifficulty"]>>("easy");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteCodeInvalid, setInviteCodeInvalid] = useState(false);
  const [joinNameInvalid, setJoinNameInvalid] = useState(false);
  const [startNameInvalid, setStartNameInvalid] = useState(false);
  const inviteCodeInput = useRef<HTMLInputElement>(null);
  const joinNameInput = useRef<HTMLInputElement>(null);
  const startNameInput = useRef<HTMLInputElement>(null);

  function updateDisplayName(value: string): void {
    setDisplayName(value);
    if (value.trim()) {
      setJoinNameInvalid(false);
      setStartNameInvalid(false);
    }
  }

  function updateInviteCode(value: string): void {
    setInviteCode(value);
    if (value.trim()) setInviteCodeInvalid(false);
  }

  async function createTable(mode: EntryMode): Promise<void> {
    const name = displayName.trim();
    if (!name) {
      setStartNameInvalid(true);
      setStatus("Enter a display name before joining a table.");
      startNameInput.current?.focus();
      return;
    }
    setStartNameInvalid(false);
    setBusy(true);
    setStatus(
      mode === "practice"
        ? "Preparing your practice table…"
        : "Creating your private room…",
    );
    try {
      await client.createGuest(name);
      const created = await client.createRoom({ botDifficulty, ruleProfileId });
      if (mode === "practice") {
        const started = await client.startRoom(
          created.roomId,
          created.eventVersion,
        );
        setStatus("Practice table is ready.");
        onNavigate(`/room/${started.roomId}`);
      } else {
        setStatus("Private room is ready.");
        onNavigate(`/room/${created.roomId}`);
      }
    } catch (caught) {
      setStatus(safeEntryError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(): Promise<void> {
    const name = displayName.trim();
    const roomReference = inviteCode.trim();
    if (!name || !roomReference) {
      setJoinNameInvalid(!name);
      setInviteCodeInvalid(!roomReference);
      setStatus("Enter a display name and private invite code to join.");
      if (!name) joinNameInput.current?.focus();
      else inviteCodeInput.current?.focus();
      return;
    }
    setJoinNameInvalid(false);
    setInviteCodeInvalid(false);
    setBusy(true);
    setStatus("Joining the private table…");
    try {
      await client.createGuest(name);
      onNavigate(`/room/${encodeURIComponent(roomReference)}`);
    } catch (caught) {
      setStatus(safeEntryError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="play-title" className="entry-flow">
      <div className="entry-heading">
        <p className="eyebrow">Private tables · no account required</p>
        <h1 id="play-title">Find your next hand.</h1>
        <p>
          Practice with bots or create a private table for people you know.
          There is no wagering, public matchmaking, or hidden card sharing.
        </p>
      </div>

      <div className="entry-grid">
        <form
          className="entry-card"
          onSubmit={(event) => {
            event.preventDefault();
            void createTable("practice");
          }}
        >
          <h2>Start a table</h2>
          <label>
            Display name
            <input
              aria-invalid={startNameInvalid || undefined}
              autoComplete="nickname"
              maxLength={48}
              onChange={(event) => updateDisplayName(event.target.value)}
              onInvalid={() => {
                setStartNameInvalid(true);
                setStatus("Enter a display name before joining a table.");
              }}
              placeholder="How should the table know you?"
              ref={startNameInput}
              required
              value={displayName}
            />
          </label>
          <label>
            Rule profile
            <select
              onChange={(event) =>
                setRuleProfileId(
                  event.target.value as CreateRoomOptions["ruleProfileId"],
                )
              }
              value={ruleProfileId}
            >
              <option value="classic_304_4p">Classic 304 · four seats</option>
              <option value="six_304_36">304-36 · six seats</option>
            </select>
          </label>
          <label>
            Bot difficulty
            <select
              onChange={(event) =>
                setBotDifficulty(
                  event.target.value as NonNullable<
                    CreateRoomOptions["botDifficulty"]
                  >,
                )
              }
              value={botDifficulty}
            >
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="strong">Strong</option>
            </select>
          </label>
          <div className="entry-actions">
            <button disabled={busy} type="submit">
              Start practice
            </button>
            <button
              disabled={busy}
              onClick={() => void createTable("private")}
              type="button"
            >
              Create private room
            </button>
          </div>
        </form>

        <form
          aria-labelledby="join-room-title"
          className="entry-card entry-card-muted"
          onSubmit={(event) => {
            event.preventDefault();
            void joinRoom();
          }}
        >
          <h2 id="join-room-title">Join a private room</h2>
          <label>
            Name for this room
            <input
              aria-invalid={joinNameInvalid || undefined}
              autoComplete="nickname"
              maxLength={48}
              onChange={(event) => updateDisplayName(event.target.value)}
              onInvalid={() => {
                setJoinNameInvalid(true);
                setStatus(
                  "Enter a display name and private invite code to join.",
                );
              }}
              placeholder="How should the table know you?"
              ref={joinNameInput}
              required
              value={displayName}
            />
          </label>
          <label>
            Invite code
            <input
              aria-invalid={inviteCodeInvalid || undefined}
              onChange={(event) => updateInviteCode(event.target.value)}
              onInvalid={() => {
                setInviteCodeInvalid(true);
                setStatus(
                  "Enter a display name and private invite code to join.",
                );
              }}
              placeholder="304-…"
              ref={inviteCodeInput}
              required
              value={inviteCode}
            />
          </label>
          <p>
            Invite codes work only for the people you share them with. Your
            cards remain private to your seat.
          </p>
          <button disabled={busy} type="submit">
            Join private room
          </button>
        </form>
      </div>

      <p aria-live="polite" className="form-status" role="status">
        {status}
      </p>
    </section>
  );
}
