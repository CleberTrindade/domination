-- One first-attempt evaluation per player, area and ownership context.
CREATE TABLE world_difficulty_surveys (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES world_players(id),
  area_id text NOT NULL REFERENCES world_areas(id),
  context text NOT NULL CHECK (context IN ('cpu','occupied')),
  battle_id uuid NOT NULL REFERENCES world_battles(id),
  side smallint NOT NULL CHECK (side IN (1,3,4)),
  outcome text NOT NULL CHECK (outcome IN ('won','lost')),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL,
  answered_at timestamptz,
  UNIQUE (player_id,area_id,context),
  FOREIGN KEY (battle_id,player_id) REFERENCES world_battle_participants(battle_id,player_id),
  CHECK ((rating IS NULL) = (answered_at IS NULL))
);
CREATE INDEX world_difficulty_surveys_pending ON world_difficulty_surveys(player_id,created_at,id) WHERE rating IS NULL;
