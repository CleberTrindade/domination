ALTER TABLE world_battles
  ADD COLUMN IF NOT EXISTS retaliation_of uuid REFERENCES world_battles(id);
CREATE INDEX IF NOT EXISTS world_received_attacks
  ON world_battles(defender_id, started_at DESC) WHERE defender_id IS NOT NULL;
