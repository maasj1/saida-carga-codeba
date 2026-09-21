-- 05_verificacao_publica.sql — RPC da página pública verificar.html (QR)
-- Rode após: 01..04 (ou use db/setup.sql, que já inclui tudo).
-- Expõe SOMENTE campos não sensíveis (nunca documento/CNH/CPF nem obs).

CREATE OR REPLACE FUNCTION public.verificar_os(p_num TEXT)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'num_carga',     o.num_carga,
    'status',        o.status,
    'consignatario', o.consignatario,
    'placa',         o.placa,
    'motorista',     o.motorista,
    'carro',         o.carro,
    'data_descarga', o.data_descarga,
    'tipo_carga',    o.tipo_carga,
    'emitido_em',    o.emitido_em,
    'liberado_em',   o.liberado_em,
    'agente_nome',   o.agente_nome
  )
  FROM public.ordens o
  WHERE o.num_carga = p_num
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.verificar_os(TEXT) TO anon, authenticated;

-- Recarrega o cache do PostgREST para enxergar a função nova.
NOTIFY pgrst, 'reload schema';

-- Teste (troque pelo número real): deve retornar 1 linha JSON.
-- SELECT public.verificar_os('OS-2026-00001');
