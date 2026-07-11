ALTER TABLE rooms
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{"botDifficulty":"easy","enableSecondBidding":true}'::jsonb,
  ADD COLUMN recovery_error text;

ALTER TABLE rooms DROP CONSTRAINT rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('lobby', 'in_hand', 'hand_result', 'closed', 'recovery_failed'));

ALTER TABLE command_deduplications
  ADD COLUMN actor_player_id uuid REFERENCES players(id);

CREATE TABLE IF NOT EXISTS session_command_deduplications (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, command_id)
);

CREATE INDEX IF NOT EXISTS game_events_room_actor_idx
  ON game_events(room_id, actor_player_id, event_version);
