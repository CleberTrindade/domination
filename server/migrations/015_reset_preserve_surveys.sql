-- Survey evidence must survive clearing operational match history.
ALTER TABLE world_difficulty_surveys ADD COLUMN battle_context jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE world_difficulty_surveys s SET battle_context=jsonb_build_object(
 'startedAt',b.started_at,'finishedAt',b.finished_at,'status',b.status,'result',b.result)
FROM world_battles b WHERE b.id=s.battle_id;
DO $$ DECLARE fk record; BEGIN
 FOR fk IN SELECT conname FROM pg_constraint WHERE conrelid='world_difficulty_surveys'::regclass
 AND contype='f' AND confrelid IN ('world_battles'::regclass,'world_battle_participants'::regclass)
 LOOP EXECUTE format('ALTER TABLE world_difficulty_surveys DROP CONSTRAINT %I',fk.conname); END LOOP;
END $$;
-- Player/area foreign keys and unique first-attempt constraints remain intact.
CREATE TABLE world_reset_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 command text NOT NULL CHECK(command='reset de batalha'),
 created_at timestamptz NOT NULL DEFAULT now(),
 before_counts jsonb NOT NULL
);
