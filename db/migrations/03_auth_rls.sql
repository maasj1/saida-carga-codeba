-- 03_auth_rls.sql — Auth + Row Level Security
-- Rode antes: 01_tabelas.sql, 02_seed.sql e a criação dos 3 usuários no
-- Authentication → Users (admin@, fiel@, portaria@codeba.local).
-- Pré-requisito no dashboard: Providers → Email habilitado, "Confirm email" desligado.

-- helper: é admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.usuarios
    WHERE auth_id = auth.uid() AND perfil ILIKE '%admin%');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- RLS
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

-- remove policies permissivas legadas (se existirem), que anulariam as novas
DROP POLICY IF EXISTS "Leitura publica de ordens" ON public.ordens;
DROP POLICY IF EXISTS "Insercao de ordens" ON public.ordens;
DROP POLICY IF EXISTS "Atualizacao de ordens" ON public.ordens;
DROP POLICY IF EXISTS "Exclusao de ordens" ON public.ordens;
DROP POLICY IF EXISTS "Leitura publica para login" ON public.usuarios;
DROP POLICY IF EXISTS "Insercao publica de usuarios" ON public.usuarios;

-- policies novas
DROP POLICY IF EXISTS "usuarios_perfil" ON public.usuarios;
CREATE POLICY "usuarios_perfil" ON public.usuarios FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "ordens_leitura" ON public.ordens;
DROP POLICY IF EXISTS "ordens_insercao" ON public.ordens;
DROP POLICY IF EXISTS "ordens_atualizacao" ON public.ordens;
DROP POLICY IF EXISTS "ordens_exclusao_admin" ON public.ordens;
CREATE POLICY "ordens_leitura" ON public.ordens FOR SELECT TO authenticated USING (true);
CREATE POLICY "ordens_insercao" ON public.ordens FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ordens_atualizacao" ON public.ordens FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "ordens_exclusao_admin" ON public.ordens FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "auditoria_insercao" ON public.auditoria;
DROP POLICY IF EXISTS "auditoria_leitura_admin" ON public.auditoria;
CREATE POLICY "auditoria_insercao" ON public.auditoria FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auditoria_leitura_admin" ON public.auditoria FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON public.usuarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ordens TO authenticated;
GRANT SELECT, INSERT ON public.auditoria TO authenticated;

-- vincula perfis às contas (tem que retornar 3 linhas)
UPDATE public.usuarios u SET auth_id = a.id FROM auth.users a
  WHERE a.email = lower(u.login) || '@codeba.local' AND u.auth_id IS NULL;
