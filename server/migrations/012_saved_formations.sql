ALTER TABLE world_players
  ADD COLUMN army_formations jsonb NOT NULL DEFAULT '[{"id":"initial","name":"Formação 1","troops":["tanque"]}]'::jsonb
    CHECK(jsonb_typeof(army_formations)='array' AND jsonb_array_length(army_formations) BETWEEN 1 AND 10),
  ADD COLUMN active_formation_id text NOT NULL DEFAULT 'initial',
  ADD COLUMN formation_revision integer NOT NULL DEFAULT 0 CHECK(formation_revision>=0);
-- Preserve every existing player's equipped army as their first saved formation.
UPDATE world_players SET army_formations=jsonb_build_array(jsonb_build_object('id','initial','name','Formação 1','troops',ground_loadout));
