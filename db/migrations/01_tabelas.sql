-- 01_tabelas.sql — estrutura base (instalação nova)
-- Rode antes: nada. Depois: 02_seed.sql
-- Quem já tem o banco antigo: apenas garanta a coluna auth_id (03) e,
-- opcionalmente, remova a coluna legada: alter table public.usuarios drop column senha;

CREATE TABLE IF NOT EXISTS public.usuarios (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome    TEXT NOT NULL,
  login   TEXT NOT NULL UNIQUE,
  perfil  TEXT NOT NULL DEFAULT 'Emissor (Fiel/Tecnico)',
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.ordens (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  num_carga      TEXT NOT NULL UNIQUE,
  portao         TEXT,
  armazem        TEXT,
  tipo_emissor   TEXT,
  consignatario  TEXT,
  navio          TEXT,
  carro          TEXT,
  placa          TEXT,
  motorista      TEXT,
  documento      TEXT,
  data_descarga  TEXT,
  doc_importacao TEXT,
  cidade         TEXT,
  container_num  TEXT,
  container_tara TEXT,
  container_cod  TEXT,
  obs            TEXT,
  responsavel    TEXT,
  tipo_carga     TEXT DEFAULT 'mercadoria',
  items          JSONB DEFAULT '[]',
  emitido_em     TEXT,
  status         TEXT DEFAULT 'Aguardando Portaria',
  liberado_em    TEXT,
  agente_nome    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.auditoria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usuario_nome  TEXT,
  usuario_login TEXT,
  usuario_perfil TEXT,
  acao          TEXT NOT NULL,
  entidade      TEXT,
  entidade_id   TEXT,
  detalhes      JSONB
);
