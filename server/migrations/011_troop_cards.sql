-- Credit production earned under the previous rate before changing the rules.
WITH income AS (
 SELECT p.id,
   (floor(greatest(0,extract(epoch FROM (now()-p.coin_income_at)))*1000)::numeric
    * (SELECT count(*) FROM world_areas a WHERE a.owner_id=p.id) * 100000
    + p.coin_income_remainder) AS numerator
 FROM world_players p
)
UPDATE world_players p SET
 coin_balance=p.coin_balance+(floor(i.numerator/8640000000)*100)::bigint,
 coin_income_remainder=mod(i.numerator,8640000000)::bigint,
 coin_income_at=greatest(p.coin_income_at,now())
FROM income i WHERE i.id=p.id;
ALTER TABLE world_players ADD COLUMN troop_cards jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(troop_cards)='object');
ALTER TABLE world_army_upgrades ADD COLUMN cards_spent integer NOT NULL DEFAULT 0 CHECK(cards_spent>=0);
CREATE TABLE world_daily_rewards (
 player_id uuid NOT NULL REFERENCES world_players(id),
 reward_day date NOT NULL,
 battle_cards integer NOT NULL DEFAULT 0 CHECK(battle_cards BETWEEN 0 AND 60),
 mission_cards integer NOT NULL DEFAULT 0 CHECK(mission_cards BETWEEN 0 AND 60),
 battles integer NOT NULL DEFAULT 0 CHECK(battles>=0),
 captures integer NOT NULL DEFAULT 0 CHECK(captures>=0),
 wins integer NOT NULL DEFAULT 0 CHECK(wins>=0),
 missions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(missions)='array'),
 PRIMARY KEY(player_id,reward_day)
);
CREATE TABLE world_card_rewards (
 battle_id uuid NOT NULL REFERENCES world_battles(id),
 player_id uuid NOT NULL REFERENCES world_players(id),
 reward_day date NOT NULL,
 opponent_key text NOT NULL,
 eligible boolean NOT NULL,
 cards jsonb NOT NULL,
 battle_cards integer NOT NULL CHECK(battle_cards BETWEEN 0 AND 10),
 mission_cards integer NOT NULL CHECK(mission_cards BETWEEN 0 AND 60),
 missions jsonb NOT NULL,
 reason text,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(battle_id,player_id)
);
CREATE INDEX world_card_rewards_daily ON world_card_rewards(player_id,reward_day,opponent_key) WHERE eligible;
