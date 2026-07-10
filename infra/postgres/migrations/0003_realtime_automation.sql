ALTER TABLE rooms
  ADD CONSTRAINT rooms_rule_profile_check
  CHECK (rule_profile_id IN ('classic_304_4p', 'six_304_36'));

ALTER TABLE room_seats
  ADD COLUMN connection_status text NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('online', 'disconnected', 'autopilot')),
  ADD COLUMN last_presence_at timestamptz,
  ADD COLUMN disconnected_at timestamptz,
  ADD COLUMN autopilot_started_at timestamptz;

UPDATE room_seats
SET connection_status = 'online'
WHERE occupant_type = 'bot';

CREATE TABLE room_outbox (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publishing_owner uuid,
  publishing_until timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error text,
  UNIQUE (room_id, event_version)
);

CREATE INDEX room_outbox_pending_idx
  ON room_outbox (id)
  WHERE published_at IS NULL;

CREATE TABLE room_automation_jobs (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  expected_event_version bigint NOT NULL CHECK (expected_event_version >= 0),
  kind text NOT NULL
    CHECK (kind IN ('BOT_ACTION', 'TURN_TIMEOUT', 'DISCONNECT_GRACE')),
  target_seat_index smallint NOT NULL
    CHECK (target_seat_index >= 0 AND target_seat_index < 6),
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'completed', 'cancelled')),
  lease_owner uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (room_id, kind, expected_event_version, target_seat_index)
);

CREATE INDEX room_automation_jobs_due_idx
  ON room_automation_jobs (due_at, id)
  WHERE state = 'pending';
