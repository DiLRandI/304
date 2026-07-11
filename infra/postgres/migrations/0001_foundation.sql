CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 48),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  secret_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  invite_code text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('lobby', 'in_hand', 'hand_result', 'closed')),
  rule_profile_id text NOT NULL,
  event_version bigint NOT NULL DEFAULT 0 CHECK (event_version >= 0),
  host_player_id uuid NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_seats (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat_index smallint NOT NULL CHECK (seat_index >= 0 AND seat_index < 6),
  player_id uuid REFERENCES players(id),
  occupant_type text NOT NULL CHECK (occupant_type IN ('human', 'bot', 'empty')),
  bot_difficulty text,
  joined_at timestamptz,
  PRIMARY KEY (room_id, seat_index),
  CHECK (
    (occupant_type = 'human' AND player_id IS NOT NULL) OR
    (occupant_type <> 'human' AND player_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS game_snapshots (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version >= 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  rule_profile_id text NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, event_version)
);

CREATE TABLE IF NOT EXISTS game_events (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version > 0),
  command_id uuid NOT NULL UNIQUE,
  actor_player_id uuid REFERENCES players(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, event_version)
);

CREATE TABLE IF NOT EXISTS command_deduplications (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, command_id)
);

CREATE INDEX IF NOT EXISTS sessions_player_active_idx
  ON sessions(player_id, expires_at) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS room_seats_one_human_player_per_room_idx
  ON room_seats(room_id, player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_events_room_version_idx ON game_events(room_id, event_version);
CREATE INDEX IF NOT EXISTS game_snapshots_room_version_idx ON game_snapshots(room_id, event_version DESC);
