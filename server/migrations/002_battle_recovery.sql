ALTER TABLE world_battles ADD COLUMN IF NOT EXISTS simulation jsonb;
ALTER TABLE world_battles ADD COLUMN IF NOT EXISTS server_id text;
ALTER TABLE world_battles ADD COLUMN IF NOT EXISTS simulation_saved_at timestamptz;
