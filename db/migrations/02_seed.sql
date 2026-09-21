-- 02_seed.sql — usuários/perfis iniciais (sem senha: o acesso é no Auth)
-- Rode antes: 01_tabelas.sql. Depois: criar os acessos no Auth (README) e 03_auth_rls.sql
INSERT INTO public.usuarios (nome, login, perfil) VALUES
  ('Administrador',   'admin',    'Administrador'),
  ('Fiel de Armazém', 'fiel',     'Emissor (Fiel/Técnico)'),
  ('Agente Silva',    'portaria', 'Agente de Portaria')
ON CONFLICT (login) DO NOTHING;
