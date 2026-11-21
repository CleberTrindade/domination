ALTER TABLE world_players ADD COLUMN battles_completed integer NOT NULL DEFAULT 0 CHECK(battles_completed>=0);
ALTER TABLE world_players ADD COLUMN ground_loadout jsonb NOT NULL DEFAULT '["tanque"]'::jsonb CHECK(jsonb_typeof(ground_loadout)='array' AND jsonb_array_length(ground_loadout) BETWEEN 1 AND 3);
UPDATE world_players p SET battles_completed=(SELECT count(*) FROM world_battle_participants x JOIN world_battles b ON b.id=x.battle_id WHERE x.player_id=p.id AND b.status IN ('won','lost') AND x.outcome IN ('won','lost') AND b.finished_at-b.started_at>=interval '30 seconds' AND (x.side<>2 OR b.result->'balance'->>'defenderParticipated'='true'));
ALTER TABLE world_army_upgrades DROP CONSTRAINT world_army_upgrades_troop_kind_check;
ALTER TABLE world_army_upgrades ADD CONSTRAINT world_army_upgrades_troop_kind_check CHECK(troop_kind IN ('all','tanque','desliz','heli','canhao','central','batedor','foguetes','blindado','antiaereo','engenheiro','artilharia'));
