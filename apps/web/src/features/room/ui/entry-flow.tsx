"use client";

import type { RoomProjection } from "@three-zero-four/contracts";
import { useRef, useState } from "react";
import type {
  CreateRoomOptions,
  GuestSession,
} from "../api/game-service-client";
import { RoomGatewayError } from "../application/room-gateway-error";

export interface EntryClient {
  createGuest(displayName: string): Promise<GuestSession>;
  createRoom(options: CreateRoomOptions): Promise<RoomProjection>;
  startRoom(roomId: string, expectedVersion: number): Promise<RoomProjection>;
}

export type EntryMode = "create" | "join" | "practice";

function safeEntryError(error: unknown): string {
  if (error instanceof RoomGatewayError) return error.message;
  return "We could not prepare that table. Please try again.";
}

export function EntryFlow({
  client,
  onNavigate,
}: {
  client: EntryClient;
  onNavigate(path: string): void;
}) {
  const [mode, setMode] = useState<EntryMode>("practice");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [ruleProfileId, setRuleProfileId] =
    useState<CreateRoomOptions["ruleProfileId"]>("classic_304_4p");
  const [botDifficulty, setBotDifficulty] =
    useState<NonNullable<CreateRoomOptions["botDifficulty"]>>("easy");
  const [endHandWhenOutcomeCertain, setEndHandWhenOutcomeCertain] =
    useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [inviteCodeInvalid, setInviteCodeInvalid] = useState(false);
  const displayNameInput = useRef<HTMLInputElement>(null);
  const inviteCodeInput = useRef<HTMLInputElement>(null);

  function selectMode(nextMode: EntryMode): void {
    setMode(nextMode);
    setStatus("");
    setInviteCodeInvalid(false);
  }

  async function createTable(): Promise<void> {
    const name = displayName.trim();
    if (!name) {
      setNameInvalid(true);
      setStatus("Enter a display name before joining a table.");
      displayNameInput.current?.focus();
      return;
    }
    setNameInvalid(false);
    setBusy(true);
    setStatus(
      mode === "practice"
        ? "Preparing your practice table…"
        : "Creating your private room…",
    );
    try {
      await client.createGuest(name);
      const created = await client.createRoom({
        botDifficulty,
        endHandWhenOutcomeCertain,
        ruleProfileId,
      });
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
      setNameInvalid(!name);
      setInviteCodeInvalid(!roomReference);
      setStatus("Enter a display name and private invite code to join.");
      if (!name) displayNameInput.current?.focus();
      else inviteCodeInput.current?.focus();
      return;
    }
    setNameInvalid(false);
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
        <p className="eyebrow">No account required</p>
        <h1 id="play-title">Find your next hand.</h1>
        <p>
          Learn with bots, host friends, or join by invite. Your cards stay
          private to your seat.
        </p>
      </div>

      <form
        aria-label="Choose a 304 table"
        className="entry-card entry-card-shared"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "join") void joinRoom();
          else void createTable();
        }}
      >
        <label>
          Display name
          <input
            aria-invalid={nameInvalid || undefined}
            autoComplete="nickname"
            maxLength={48}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (event.target.value.trim()) setNameInvalid(false);
            }}
            placeholder="How should the table know you?"
            ref={displayNameInput}
            value={displayName}
          />
        </label>

        <fieldset className="entry-mode-switch">
          <legend className="sr-only">Table mode</legend>
          {(["practice", "create", "join"] as const).map((entryMode) => (
            <button
              aria-pressed={mode === entryMode}
              key={entryMode}
              onClick={() => selectMode(entryMode)}
              type="button"
            >
              {entryMode.slice(0, 1).toUpperCase() + entryMode.slice(1)}
            </button>
          ))}
        </fieldset>

        {mode === "join" ? (
          <div className="entry-settings">
            <label>
              Invite code
              <input
                aria-invalid={inviteCodeInvalid || undefined}
                onChange={(event) => {
                  setInviteCode(event.target.value);
                  if (event.target.value.trim()) setInviteCodeInvalid(false);
                }}
                placeholder="304-…"
                ref={inviteCodeInput}
                value={inviteCode}
              />
            </label>
            <p>Use the private code shared by your host.</p>
          </div>
        ) : (
          <div className="entry-settings">
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
            <label className="checkbox-control">
              <input
                checked={endHandWhenOutcomeCertain}
                onChange={(event) =>
                  setEndHandWhenOutcomeCertain(event.target.checked)
                }
                type="checkbox"
              />
              End hand when outcome is certain
            </label>
          </div>
        )}

        <button disabled={busy} type="submit">
          {mode === "practice"
            ? "Start practice"
            : mode === "create"
              ? "Create private room"
              : "Join private room"}
        </button>
      </form>

      <p aria-live="polite" className="form-status" role="status">
        {status}
      </p>
    </section>
  );
}
