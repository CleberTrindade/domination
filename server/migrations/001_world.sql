CREATE TABLE IF NOT EXISTS world_players (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 24),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS world_sessions (
  token_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES world_players(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS world_sessions_expiry ON world_sessions(expires_at);
CREATE TABLE IF NOT EXISTS world_areas (
  id text PRIMARY KEY,
  state_id text NOT NULL DEFAULT 'SE',
  name text NOT NULL,
  ordinal integer NOT NULL UNIQUE,
  description text NOT NULL,
  cpu_share double precision NOT NULL CHECK (cpu_share BETWEEN .30 AND .40),
  owner_id uuid REFERENCES world_players(id),
  conquered_at timestamptz,
  version integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS world_battles (
  id uuid PRIMARY KEY,
  area_id text NOT NULL REFERENCES world_areas(id),
  attacker_id uuid NOT NULL REFERENCES world_players(id),
  defender_id uuid REFERENCES world_players(id),
  area_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('active','won','lost','abandoned','interrupted','expired')),
  defense_share double precision NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz NOT NULL,
  result jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS world_one_attack_per_area ON world_battles(area_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS world_one_attack_per_player ON world_battles(attacker_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS world_battle_history ON world_battles(finished_at DESC) WHERE status <> 'active';
CREATE INDEX IF NOT EXISTS world_area_owner ON world_areas(owner_id);
INSERT INTO world_areas(id,name,ordinal,description,cpu_share) VALUES
 ('se-litoral-sul','Litoral Sul',1,'Abra caminho pelas bases próximas ao litoral.',.32),
 ('se-agreste','Agreste',2,'Expanda suas posições e dispute as fábricas.',.34),
 ('se-alto-sertao','Alto Sertão',3,'Escolha suas rotas e preserve os reforços.',.35),
 ('se-sao-francisco','Vale do São Francisco',4,'Controle as travessias e contenha a defesa.',.37),
 ('se-aracaju','Aracaju · Capital',5,'Supere a guarnição mais preparada do estado.',.39)
ON CONFLICT (id) DO NOTHING;
