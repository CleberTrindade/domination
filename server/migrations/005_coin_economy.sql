-- Coin amounts are integer hundredths; income starts when this migration runs.
ALTER TABLE world_players
  ADD COLUMN coin_balance bigint NOT NULL DEFAULT 100000 CHECK (coin_balance >= 0),
  ADD COLUMN coin_income_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN coin_income_remainder bigint NOT NULL DEFAULT 0 CHECK (coin_income_remainder >= 0 AND coin_income_remainder < 86400000);
ALTER TABLE world_areas ADD COLUMN cpu_reward_claimed boolean NOT NULL DEFAULT false;
UPDATE world_areas SET cpu_reward_claimed=true WHERE owner_id IS NOT NULL;
CREATE TABLE world_coin_ledger (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES world_players(id),
  battle_id uuid NOT NULL REFERENCES world_battles(id),
  kind text NOT NULL CHECK (kind IN ('production','battle_loot','cpu_reward','cpu_loss')),
  amount bigint NOT NULL CHECK (amount <> 0),
  created_at timestamptz NOT NULL,
  UNIQUE (battle_id,player_id,kind)
);
CREATE INDEX world_coin_ledger_player ON world_coin_ledger(player_id,created_at DESC);
