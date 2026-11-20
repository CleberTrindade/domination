CREATE INDEX IF NOT EXISTS world_participant_player ON world_battle_participants(player_id,battle_id);
CREATE INDEX IF NOT EXISTS world_battle_attacker_history ON world_battles(attacker_id,finished_at DESC) WHERE status<>'active';
CREATE INDEX IF NOT EXISTS world_battle_defender_history ON world_battles(defender_id,finished_at DESC) WHERE status<>'active';
