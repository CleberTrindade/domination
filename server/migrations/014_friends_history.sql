-- Invite codes are public player identifiers, never login credentials.
ALTER TABLE world_players ADD COLUMN friend_code text;
UPDATE world_players SET friend_code=upper(substr(replace(id::text,'-',''),1,10));
ALTER TABLE world_players ALTER COLUMN friend_code SET DEFAULT upper(substr(md5(random()::text||clock_timestamp()::text),1,10));
ALTER TABLE world_players ALTER COLUMN friend_code SET NOT NULL;
ALTER TABLE world_players ADD CONSTRAINT world_player_friend_code UNIQUE(friend_code);
CREATE TABLE world_friendships (
 id uuid PRIMARY KEY,
 player_a uuid NOT NULL REFERENCES world_players(id),
 player_b uuid NOT NULL REFERENCES world_players(id),
 requester_id uuid NOT NULL REFERENCES world_players(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 accepted_at timestamptz,
 CHECK(player_a<player_b),
 CHECK(requester_id IN (player_a,player_b)),
 CHECK((status='accepted')=(accepted_at IS NOT NULL)),
 UNIQUE(player_a,player_b)
);
CREATE INDEX world_friendships_a ON world_friendships(player_a,status);
CREATE INDEX world_friendships_b ON world_friendships(player_b,status);
CREATE TABLE world_battle_replays (
 battle_id uuid PRIMARY KEY REFERENCES world_battles(id),
 format_version smallint NOT NULL DEFAULT 1 CHECK(format_version=1),
 engine_version text NOT NULL,
 config jsonb NOT NULL,
 frames integer NOT NULL CHECK(frames BETWEEN 0 AND 11000),
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='array'),
 created_at timestamptz NOT NULL DEFAULT now()
);
