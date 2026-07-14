import type { RefObject } from "react";

export function JoinRoomForm({
  busy,
  displayName,
  displayNameInput,
  displayNameInvalid,
  inviteCode,
  inviteCodeInput,
  inviteCodeInvalid,
  onDisplayNameChange,
  onDisplayNameInvalid,
  onInviteCodeChange,
  onInviteCodeInvalid,
  onJoin,
}: {
  busy: boolean;
  displayName: string;
  displayNameInput: RefObject<HTMLInputElement | null>;
  displayNameInvalid: boolean;
  inviteCode: string;
  inviteCodeInput: RefObject<HTMLInputElement | null>;
  inviteCodeInvalid: boolean;
  onDisplayNameChange(value: string): void;
  onDisplayNameInvalid(): void;
  onInviteCodeChange(value: string): void;
  onInviteCodeInvalid(): void;
  onJoin(): void;
}) {
  return (
    <form
      aria-labelledby="join-room-title"
      className="entry-card entry-card-muted"
      onSubmit={(event) => {
        event.preventDefault();
        onJoin();
      }}
    >
      <h2 id="join-room-title">Join a private room</h2>
      <label>
        Name for this room
        <input
          aria-invalid={displayNameInvalid || undefined}
          autoComplete="nickname"
          maxLength={48}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          onInvalid={onDisplayNameInvalid}
          placeholder="How should the table know you?"
          ref={displayNameInput}
          required
          value={displayName}
        />
      </label>
      <label>
        Invite code
        <input
          aria-invalid={inviteCodeInvalid || undefined}
          onChange={(event) => onInviteCodeChange(event.target.value)}
          onInvalid={onInviteCodeInvalid}
          placeholder="304-…"
          ref={inviteCodeInput}
          required
          value={inviteCode}
        />
      </label>
      <p>
        Invite codes work only for the people you share them with. Your cards
        remain private to your seat.
      </p>
      <button disabled={busy} type="submit">
        Join private room
      </button>
    </form>
  );
}
