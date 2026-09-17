-- 04_sequence_os.sql — numeração única da OS para todos os PCs
-- Rode a qualquer momento (idempotente). A sequence continua do maior
-- número já usado, então não repete nem pula o que existe.
CREATE SEQUENCE IF NOT EXISTS public.os_num_seq;

SELECT setval('public.os_num_seq',
  COALESCE((SELECT MAX(((regexp_match(num_carga, '-(\d+)$'))[1])::INT) FROM public.ordens), 0));

CREATE OR REPLACE FUNCTION public.next_os_num()
RETURNS INT LANGUAGE SQL AS $$ SELECT nextval('public.os_num_seq')::INT; $$;

GRANT USAGE, SELECT ON SEQUENCE public.os_num_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_os_num() TO authenticated;

-- conferência (consome 1 número de teste — vira lacuna normal):
-- SELECT public.next_os_num();
