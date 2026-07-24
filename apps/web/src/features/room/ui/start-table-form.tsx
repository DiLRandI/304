import type { RefObject } from "react";
import type { CreateRoomOptions } from "../api/game-service-client";

type BotDifficulty = NonNullable<CreateRoomOptions["botDifficulty"]>;

export function StartTableForm({
  botDifficulty,
  busy,
  displayName,
  displayNameInvalid,
  displayNameInput,
  endHandWhenOutcomeCertain,
  onBotDifficultyChange,
  onCreatePrivate,
  onDisplayNameChange,
  onDisplayNameInvalid,
  onEndHandWhenOutcomeCertainChange,
  onRuleProfileChange,
  onStartPractice,
  ruleProfileId,
}: {
  botDifficulty: BotDifficulty;
  busy: boolean;
  displayName: string;
  displayNameInvalid: boolean;
  displayNameInput: RefObject<HTMLInputElement | null>;
  onBotDifficultyChange(value: BotDifficulty): void;
  onCreatePrivate(): void;
  onDisplayNameChange(value: string): void;
  onDisplayNameInvalid(): void;
  onEndHandWhenOutcomeCertainChange(value: boolean): void;
  onRuleProfileChange(value: CreateRoomOptions["ruleProfileId"]): void;
  onStartPractice(): void;
  ruleProfileId: CreateRoomOptions["ruleProfileId"];
  endHandWhenOutcomeCertain: boolean;
}) {
  return (
    <form
      className="entry-card"
      onSubmit={(event) => {
        event.preventDefault();
        onStartPractice();
      }}
    >
      <h2>Start a table</h2>
      <label>
        Display name
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
        Rule profile
        <select
          onChange={(event) =>
            onRuleProfileChange(
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
            onBotDifficultyChange(event.target.value as BotDifficulty)
          }
          value={botDifficulty}
        >
          <option value="easy">Easy</option>
          <option value="normal">Normal</option>
          <option value="strong">Strong</option>
        </select>
      </label>
      <label>
        <input
          checked={endHandWhenOutcomeCertain}
          onChange={(event) =>
            onEndHandWhenOutcomeCertainChange(event.target.checked)
          }
          type="checkbox"
        />
        End hand when outcome is certain
      </label>
      <div className="entry-actions">
        <button disabled={busy} type="submit">
          Start practice
        </button>
        <button disabled={busy} onClick={onCreatePrivate} type="button">
          Create private room
        </button>
      </div>
    </form>
  );
}
