ALTER TABLE world_battles ADD COLUMN IF NOT EXISTS winner_id uuid REFERENCES world_players(id);
UPDATE world_battles SET winner_id=attacker_id WHERE status='won' AND winner_id IS NULL;
CREATE TABLE IF NOT EXISTS world_battle_participants (
  battle_id uuid NOT NULL REFERENCES world_battles(id),
  player_id uuid NOT NULL REFERENCES world_players(id),
  side smallint NOT NULL CHECK (side BETWEEN 1 AND 4),
  joined_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('won','lost','left')),
  PRIMARY KEY (battle_id,player_id), UNIQUE (battle_id,side)
);
