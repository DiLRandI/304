"use client";

import type { RoomProjection } from "@three-zero-four/contracts";
import { useRef, useState } from "react";
import type {
  CreateRoomOptions,
  GuestSession,
} from "../api/game-service-client";
import { RoomGatewayError } from "../application/room-gateway-error";
import { JoinRoomForm } from "./join-room-form";
import { StartTableForm } from "./start-table-form";

export interface EntryClient {
  createGuest(displayName: string): Promise<GuestSession>;
  createRoom(options: CreateRoomOptions): Promise<RoomProjection>;
  startRoom(roomId: string, expectedVersion: number): Promise<RoomProjection>;
}

type EntryMode = "private" | "practice";

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
        <StartTableForm
          botDifficulty={botDifficulty}
          busy={busy}
          displayName={displayName}
          displayNameInput={startNameInput}
          displayNameInvalid={startNameInvalid}
          endHandWhenOutcomeCertain={endHandWhenOutcomeCertain}
          onBotDifficultyChange={setBotDifficulty}
          onCreatePrivate={() => void createTable("private")}
          onDisplayNameChange={updateDisplayName}
          onDisplayNameInvalid={() => {
            setStartNameInvalid(true);
            setStatus("Enter a display name before joining a table.");
          }}
          onEndHandWhenOutcomeCertainChange={setEndHandWhenOutcomeCertain}
          onRuleProfileChange={setRuleProfileId}
          onStartPractice={() => void createTable("practice")}
          ruleProfileId={ruleProfileId}
        />

        <JoinRoomForm
          busy={busy}
          displayName={displayName}
          displayNameInput={joinNameInput}
          displayNameInvalid={joinNameInvalid}
          inviteCode={inviteCode}
          inviteCodeInput={inviteCodeInput}
          inviteCodeInvalid={inviteCodeInvalid}
          onDisplayNameChange={updateDisplayName}
          onDisplayNameInvalid={() => {
            setJoinNameInvalid(true);
            setStatus("Enter a display name and private invite code to join.");
          }}
          onInviteCodeChange={updateInviteCode}
          onInviteCodeInvalid={() => {
            setInviteCodeInvalid(true);
            setStatus("Enter a display name and private invite code to join.");
          }}
          onJoin={() => void joinRoom()}
        />
      </div>

      <p aria-live="polite" className="form-status" role="status">
        {status}
      </p>
    </section>
  );
}
