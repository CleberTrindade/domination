-- Existing accounts may replay from Menu; only new registrations enter automatically.
ALTER TABLE world_players ADD COLUMN tutorial_phase text NOT NULL DEFAULT 'done'
 CHECK(tutorial_phase IN ('training','tour','done'));
ALTER TABLE world_players ADD COLUMN tutorial_step smallint NOT NULL DEFAULT 0
 CHECK(tutorial_step BETWEEN 0 AND 30);
