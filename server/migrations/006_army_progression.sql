ALTER TABLE world_players ADD COLUMN army_level smallint NOT NULL DEFAULT 1 CHECK (army_level BETWEEN 1 AND 10);
ALTER TABLE world_battle_participants ADD COLUMN army_level smallint NOT NULL DEFAULT 1 CHECK (army_level BETWEEN 1 AND 10);
CREATE TABLE world_army_upgrades (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES world_players(id),
  from_level smallint NOT NULL CHECK (from_level BETWEEN 1 AND 9),
  to_level smallint NOT NULL CHECK (to_level=from_level+1),
  cost bigint NOT NULL CHECK (cost>0),
  created_at timestamptz NOT NULL,
  UNIQUE (player_id,to_level)
);
ALTER TABLE world_coin_ledger ALTER COLUMN battle_id DROP NOT NULL;
ALTER TABLE world_coin_ledger ADD COLUMN upgrade_id uuid REFERENCES world_army_upgrades(id);
ALTER TABLE world_coin_ledger DROP CONSTRAINT world_coin_ledger_kind_check;
ALTER TABLE world_coin_ledger ADD CONSTRAINT world_coin_ledger_kind_check CHECK (kind IN ('production','battle_loot','cpu_reward','cpu_loss','army_upgrade'));
ALTER TABLE world_coin_ledger ADD CONSTRAINT world_coin_ledger_context CHECK (num_nonnulls(battle_id,upgrade_id)=1 AND (kind<>'army_upgrade' OR upgrade_id IS NOT NULL));
CREATE UNIQUE INDEX world_coin_ledger_upgrade_once ON world_coin_ledger(upgrade_id,player_id,kind) WHERE upgrade_id IS NOT NULL;
