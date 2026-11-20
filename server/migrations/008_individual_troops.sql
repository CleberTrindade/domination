-- Existing general training becomes the initial level of every troop type.
ALTER TABLE world_players ADD COLUMN troop_levels jsonb;
ALTER TABLE world_army_upgrades ADD COLUMN troop_kind text NOT NULL DEFAULT 'all'
  CHECK (troop_kind IN ('all','tanque','desliz','heli','canhao','central'));
ALTER TABLE world_army_upgrades DROP CONSTRAINT world_army_upgrades_player_id_to_level_key;
ALTER TABLE world_army_upgrades ADD CONSTRAINT world_army_upgrade_type_level UNIQUE(player_id,troop_kind,to_level);
