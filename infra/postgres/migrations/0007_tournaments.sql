CREATE TABLE tournaments (
  id uuid PRIMARY KEY,
  public_slug text NOT NULL UNIQUE CHECK (public_slug ~ '^[a-z0-9-]{4,80}$'),
  organizer_player_id uuid NOT NULL REFERENCES players(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'registration'
    CHECK (status IN ('registration', 'group_stage', 'knockout', 'completed', 'cancelled')),
  rule_profile_id text NOT NULL
    CHECK (rule_profile_id IN ('classic_304_4p', 'six_304_36')),
  team_count smallint NOT NULL CHECK (team_count BETWEEN 6 AND 32 AND team_count % 2 = 0),
  series_format text NOT NULL CHECK (series_format IN ('bo1', 'bo3')),
  bots_allowed boolean NOT NULL,
  bot_difficulty text NOT NULL CHECK (bot_difficulty IN ('easy', 'normal', 'strong')),
  third_place boolean NOT NULL,
  draw_seed text,
  event_version bigint NOT NULL DEFAULT 0 CHECK (event_version >= 0),
  locked_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  retain_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tournament_teams (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_number smallint NOT NULL CHECK (slot_number > 0),
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 2 AND 32),
  normalized_name text,
  captain_player_id uuid REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, slot_number),
  UNIQUE (tournament_id, normalized_name)
);

CREATE TABLE tournament_invite_digests (
  team_id uuid PRIMARY KEY REFERENCES tournament_teams(id) ON DELETE CASCADE,
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  rotated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tournament_memberships (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id),
  roster_position smallint NOT NULL CHECK (roster_position >= 0 AND roster_position < 3),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id),
  UNIQUE (team_id, roster_position)
);

CREATE TABLE tournament_groups (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  group_number smallint NOT NULL CHECK (group_number > 0),
  name text NOT NULL,
  UNIQUE (tournament_id, group_number)
);

CREATE TABLE tournament_group_teams (
  group_id uuid NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  draw_order smallint NOT NULL CHECK (draw_order > 0),
  PRIMARY KEY (group_id, team_id),
  UNIQUE (group_id, draw_order),
  UNIQUE (team_id)
);

CREATE TABLE tournament_rounds (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('group', 'knockout')),
  round_number smallint NOT NULL CHECK (round_number > 0),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'open', 'complete')),
  opened_at timestamptz,
  completed_at timestamptz,
  UNIQUE (tournament_id, stage, round_number)
);

CREATE TABLE tournament_fixtures (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
  group_id uuid REFERENCES tournament_groups(id),
  team_a_id uuid NOT NULL REFERENCES tournament_teams(id),
  team_b_id uuid REFERENCES tournament_teams(id),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'open', 'in_progress', 'postponed', 'complete', 'forfeited')),
  required_wins smallint NOT NULL CHECK (required_wins IN (1, 2)),
  wins_a smallint NOT NULL DEFAULT 0 CHECK (wins_a >= 0),
  wins_b smallint NOT NULL DEFAULT 0 CHECK (wins_b >= 0),
  winner_team_id uuid REFERENCES tournament_teams(id),
  forfeit_side text CHECK (forfeit_side IN ('A', 'B', 'both')),
  check_in_a_at timestamptz,
  check_in_b_at timestamptz,
  lineup_a jsonb,
  lineup_b jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (team_b_id IS NULL OR team_a_id <> team_b_id)
);

CREATE TABLE tournament_fixture_rooms (
  fixture_id uuid NOT NULL REFERENCES tournament_fixtures(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES rooms(id),
  sequence smallint NOT NULL CHECK (sequence > 0),
  attached_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz,
  PRIMARY KEY (fixture_id, sequence),
  UNIQUE (room_id)
);

CREATE TABLE tournament_fixture_games (
  fixture_id uuid NOT NULL REFERENCES tournament_fixtures(id) ON DELETE CASCADE,
  match_index smallint NOT NULL CHECK (match_index > 0 AND match_index <= 3),
  room_id uuid NOT NULL,
  terminal_event_version bigint NOT NULL CHECK (terminal_event_version > 0),
  winner_team_id uuid NOT NULL REFERENCES tournament_teams(id),
  final_token_differential integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, match_index),
  UNIQUE (room_id, terminal_event_version),
  FOREIGN KEY (room_id, terminal_event_version)
    REFERENCES game_events(room_id, event_version)
);

CREATE TABLE tournament_events (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version > 0),
  command_id uuid NOT NULL,
  actor_player_id uuid REFERENCES players(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, event_version),
  UNIQUE (tournament_id, command_id)
);

CREATE TABLE tournament_command_deduplications (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_player_id uuid NOT NULL REFERENCES players(id),
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, command_id)
);

CREATE TABLE tournament_outbox (
  id bigserial PRIMARY KEY,
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK (event_version > 0),
  audience text NOT NULL CHECK (audience IN ('private', 'public')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publishing_owner uuid,
  publishing_until timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error text,
  UNIQUE (tournament_id, event_version, audience)
);

CREATE INDEX tournaments_terminal_retention_idx
  ON tournaments (retain_until, id)
  WHERE status IN ('completed', 'cancelled');
CREATE INDEX tournament_fixtures_round_idx ON tournament_fixtures (round_id, status);
CREATE INDEX tournament_outbox_pending_idx
  ON tournament_outbox (id)
  WHERE published_at IS NULL;
