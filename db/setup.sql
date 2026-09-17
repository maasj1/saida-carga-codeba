-- ═══════════════════════════════════════════════════════════════════
-- CODEBA · Porto de Ilhéus — SETUP COMPLETO DO BANCO (query única)
-- ═══════════════════════════════════════════════════════════════════
-- Como usar: Supabase → SQL Editor → New query → cole ESTE arquivo todo → Run.
-- É idempotente: pode rodar quantas vezes quiser sem duplicar nada.
--
-- PRÉ-REQUISITO (dashboard, 1ª vez):
--   Authentication → Users → criar 3 contas (Add user → Auto Confirm):
--     admin@codeba.local / fiel@codeba.local / portaria@codeba.local
--   Authentication → Providers → Email habilitado, "Confirm email" DESLIGADO.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. TABELAS ─────────────────────────────────────────────────────
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
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usuario_nome   TEXT,
  usuario_login  TEXT,
  usuario_perfil TEXT,
  acao           TEXT NOT NULL,
  entidade       TEXT,
  entidade_id    TEXT,
  detalhes       JSONB
);

-- ── 2. COLUNA NOVA EM BANCO ANTIGO ─────────────────────────────────
-- (Era a causa do erro 400 no INSERT: o app envia tipo_carga sempre.)
ALTER TABLE public.ordens
  ADD COLUMN IF NOT EXISTS tipo_carga TEXT DEFAULT 'mercadoria';

-- Remove coluna legada de senha (login agora é Supabase Auth), se existir.
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS senha;
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── 2b. NORMALIZA TIPOS LEGADOS ────────────────────────────────────
-- Se alguma coluna foi criada como varchar(N) no banco antigo (ex.: perfil
-- como varchar(20), que não cabe 'Emissor (Fiel/Tecnico)' = 22 letras e
-- quebrava o seed com ERROR 22001), converte para TEXT automaticamente.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('usuarios', 'ordens', 'auditoria')
      AND data_type = 'character varying'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE TEXT',
      r.table_name, r.column_name);
  END LOOP;
END $$;

-- ── 3. USUÁRIOS PADRÃO (só insere se o login ainda não existir) ─────
INSERT INTO public.usuarios (nome, login, perfil) VALUES
  ('Administrador',   'admin',    'Administrador'),
  ('Fiel de Armazem', 'fiel',     'Emissor (Fiel/Tecnico)'),
  ('Agente Silva',    'portaria', 'Agente de Portaria')
ON CONFLICT (login) DO NOTHING;

-- ── 4. VÍNCULO CONTA ↔ PERFIL (tem que retornar 3 linhas) ───────────
UPDATE public.usuarios u SET auth_id = a.id FROM auth.users a
  WHERE a.email = lower(u.login) || '@codeba.local' AND u.auth_id IS NULL;

-- ── 5. HELPER + RLS + PERMISSÕES ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.usuarios
    WHERE auth_id = auth.uid() AND perfil ILIKE '%admin%');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

-- Remove policies legadas (abertas demais / nomes antigos), se existirem.
DROP POLICY IF EXISTS "Leitura publica de ordens"   ON public.ordens;
DROP POLICY IF EXISTS "Insercao de ordens"           ON public.ordens;
DROP POLICY IF EXISTS "Atualizacao de ordens"        ON public.ordens;
DROP POLICY IF EXISTS "Exclusao de ordens"           ON public.ordens;
DROP POLICY IF EXISTS "Leitura publica para login"   ON public.usuarios;
DROP POLICY IF EXISTS "Insercao publica de usuarios" ON public.usuarios;

DROP POLICY IF EXISTS "usuarios_perfil"      ON public.usuarios;
CREATE POLICY "usuarios_perfil" ON public.usuarios FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "ordens_leitura"        ON public.ordens;
DROP POLICY IF EXISTS "ordens_insercao"       ON public.ordens;
DROP POLICY IF EXISTS "ordens_atualizacao"    ON public.ordens;
DROP POLICY IF EXISTS "ordens_exclusao_admin" ON public.ordens;
CREATE POLICY "ordens_leitura"        ON public.ordens FOR SELECT TO authenticated USING (true);
CREATE POLICY "ordens_insercao"       ON public.ordens FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ordens_atualizacao"    ON public.ordens FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "ordens_exclusao_admin" ON public.ordens FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "auditoria_insercao"     ON public.auditoria;
DROP POLICY IF EXISTS "auditoria_leitura_admin" ON public.auditoria;
CREATE POLICY "auditoria_insercao"     ON public.auditoria FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auditoria_leitura_admin" ON public.auditoria FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON public.usuarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ordens TO authenticated;
GRANT SELECT, INSERT ON public.auditoria TO authenticated;

-- ── 6. SEQUENCE ÚNICA DA OS (2 PCs nunca repetem número) ────────────
CREATE SEQUENCE IF NOT EXISTS public.os_num_seq;

-- Continua de onde as OSs existentes pararam (lê o maior número atual).
SELECT setval('public.os_num_seq',
  coalesce((SELECT max(((regexp_match(num_carga, '-(\d+)$'))[1])::int) FROM public.ordens), 0));

CREATE OR REPLACE FUNCTION public.next_os_num()
RETURNS INT LANGUAGE SQL AS $$ SELECT nextval('public.os_num_seq')::int; $$;

GRANT USAGE, SELECT ON SEQUENCE public.os_num_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_os_num() TO authenticated;

-- ── 7. RECARREGA O CACHE DO POSTGREST (obrigatório após ALTER TABLE) ─
NOTIFY pgrst, 'reload schema';

-- ── 8. VERIFICAÇÃO (confira o retorno) ──────────────────────────────
-- 8a. Tem que retornar 3 linhas (os 3 perfis vinculados):
SELECT login, perfil, auth_id IS NOT NULL AS vinculado FROM public.usuarios;
-- 8b. A coluna tipo_carga tem que aparecer na lista:
SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ordens' AND column_name = 'tipo_carga';
