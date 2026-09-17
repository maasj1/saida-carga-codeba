# CODEBA — Ordem de Saída de Carga (Porto de Ilhéus)

Sistema web para emitir, liberar e auditar ordens de saída de caminhões com carga no Porto de Ilhéus — substituindo a folha de papel por registro digital com código de verificação, portaria, relatórios em PDF e trilha de auditoria.

## Funcionalidades
- **Emitir Ordem** — dados do veículo/motorista, itens de mercadoria ou material, impressão com QR de verificação.
- **Portaria** — busca por OS/placa, confirmação de saída com agente e data/hora, concluídas.
- **Cadastros** — navios, consignatários, mercadorias, lotes, tipos de veículo.
- **Relatórios** — filtros por período/cliente/mercadoria/status + exportação em PDF.
- **Auditoria** (admin) — quem fez o quê e quando, com filtros.
- **Usuários** — perfis Emissor, Portaria e Administrador.
- Tema claro/escuro, Central de Ajuda em linguagem simples.

## Stack
HTML + Tailwind (CDN) + JavaScript puro + Supabase (Postgres, Auth, Realtime). Sem build: é só abrir ou servir os arquivos estáticos.

## Estrutura
```
index.html                → marcação (telas e modais)
assets/css/styles.css     → estilos (inclui tema escuro e impressão)
assets/js/app.js          → toda a lógica
assets/js/config.js       → credenciais LOCAIS (não versionado; ver config.example.js)
assets/img/               → logo e imagens
db/migrations/            → SQL versionado (rodar em ordem)
```

## Setup em 10 minutos

### 1. Banco (Supabase → SQL Editor, nesta ordem)
1. `db/migrations/01_tabelas.sql`
2. `db/migrations/02_seed.sql`
3. Crie os acessos: **Authentication → Users → Add user** (Auto Confirm marcado):
   `admin@codeba.local`, `fiel@codeba.local`, `portaria@codeba.local` (senhas de 6+ caracteres).
   Antes: **Providers → Email** habilitado, **"Confirm email" desligado**.
4. `db/migrations/03_auth_rls.sql` (o `UPDATE` final deve retornar 3 linhas = vínculos).
5. `db/migrations/04_sequence_os.sql`.

### 2. App
```bash
cp assets/js/config.example.js assets/js/config.js
# edite config.js com a URL e a publishable key (Project Settings → Data API / API Keys)
python -m http.server 8000
# abra http://localhost:8000 — entre com admin + senha criada no passo 3
```

### 3. GitHub Pages (opcional)
Settings → Pages → Deploy from branch (`main`, `/root`). Os caminhos `assets/...` são relativos, funcionam em subpath sem mudança.

## Segurança
- Senhas com hash no Supabase Auth; perfis vinculados pelo id imutável da conta.
- RLS: logados leem/escrevem ordens; **só admin deleta e lê auditoria**.
- A chave publicável vai em `config.js` (ignorado pelo git) — **nunca commite esse arquivo**.
- Para novos usuários: aba Usuários (nome/perfil) + criar acesso no Auth + rodar o `UPDATE` de vínculo da migration 03.

## Licença
MIT — ver `LICENSE`.
