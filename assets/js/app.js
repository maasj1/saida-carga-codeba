
    // Supabase SDK v2 Initialization (CDN UMD build)
    // Credenciais vêm de assets/js/config.js (não versionado).
    // Sem config, o app mostra orientação em vez de quebrar em silêncio.
    var _cfg = (typeof window !== 'undefined' && window.CODEBA_CONFIG) || {};
    if (!_cfg.SUPABASE_URL || !_cfg.SUPABASE_KEY) {
      document.addEventListener('DOMContentLoaded', function(){
        document.body.innerHTML = '<div style="max-width:520px;margin:10vh auto;padding:32px;border-radius:16px;background:#fff;color:#1a3a6e;font-family:sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.15)">'
          + '<h2 style="margin:0 0 8px">Falta configurar o acesso ao banco</h2>'
          + '<p style="margin:0;color:#555">Copie <b>assets/js/config.example.js</b> para <b>assets/js/config.js</b> e preencha com a URL e a chave do seu projeto Supabase.</p></div>';
      });
      throw new Error('CODEBA_CONFIG ausente: crie assets/js/config.js a partir de config.example.js');
    }
    const supabaseClient = window.supabase.createClient(
      _cfg.SUPABASE_URL,
      _cfg.SUPABASE_KEY
    );
  

const DEFAULT_VEICULOS = ['Caminhão Baú','Carreta','Bitrem','Fiorino','Caminhonete','Van','Caminhão Truck','Toco'];
// Usuários iniciais da aba Usuários (cadastro local de nome/perfil).
// ATENÇÃO: o campo senha aqui NÃO vale para o login — o acesso é criado
// no Supabase Auth (Authentication → Users) e vinculado por login.
const DEFAULT_USERS = [
  {nome: 'Administrador', login: 'admin', senha: '', perfil: 'Administrador'},
  {nome: 'Fiel de Armazém', login: 'fiel', senha: '', perfil: 'Emissor (Fiel/Técnico)'},
  {nome: 'Agente Silva', login: 'portaria', senha: '', perfil: 'Agente de Portaria'}
];

let S = {
  navios:[], consig:[], mercs:[], lotes:[], tiposVeiculo:[],
  orders:[], rowId:0, quickType:null, portariaTarget:null,
  users:[], currentUser:null, pendentes:[]
};

const LS = {
  NAVIOS:'codeba_navios', CONSIG:'codeba_consig',
  MERCS:'codeba_mercs',   LOTES:'codeba_lotes',
  ORDERS:'codeba_orders',
  VEICULOS:'codeba_veiculos', USERS:'codeba_users',   SESSION:'codeba_session',
  PENDENTES:'codeba_sync_pendentes'
};

function saveLS(key) {
  const m = {
    navios:LS.NAVIOS, consig:LS.CONSIG, mercs:LS.MERCS,
    lotes:LS.LOTES,   orders:LS.ORDERS,
    tiposVeiculo:LS.VEICULOS, users:LS.USERS, currentUser:LS.SESSION,
    pendentes:LS.PENDENTES
  };
  localStorage.setItem(m[key], JSON.stringify(S[key]));
}

async function init() {
  loadAll();

  // Sessão do Supabase Auth (token guardado pelo próprio SDK)
  var sessaoOk = false;
  try {
    const { data } = await supabaseClient.auth.getSession();
    var au = data && data.session && data.session.user;
    if (au) {
      const perfil = await buscarPerfilAuth(au.id);
      if (perfil) {
        montarSessao(au, perfil);
        sessaoOk = true;
      } else {
        await supabaseClient.auth.signOut();
      }
    }
  } catch(e) {
    console.error('Erro ao restaurar sessão:', e);
  }

  if (sessaoOk) {
    // Carrega dados locais e depois sincroniza com Supabase
    refreshAll();
    updateBadge();
    updatePortariaBadge();
    carregarOrdensDoBanco().then(function() {
      ativarRealtimeOrdens();
      descarregarFilaAuditoria();
      sincronizarPendentes(true);
    });
  } else {
    // Sem sessao salva - mostra tela de login
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('login-username').focus();
  }
}

// ─── SUPABASE: Mapeamento de campos ─────────────────────────────────────────

function orderToDbRow(d) {
  return {
    num_carga:      d.numCarga,
    portao:         d.portao,
    armazem:        d.armazem,
    tipo_emissor:   d.tipoEmissor,
    consignatario:  d.consignatario,
    navio:          d.navio,
    carro:          d.carro,
    placa:          d.placa,
    motorista:      d.motorista,
    documento:      d.documento,
    data_descarga:  d.dataDescarga,
    doc_importacao: d.docImportacao,
    cidade:         d.cidade,
    container_num:  d.containerNum,
    container_tara: d.containerTara,
    container_cod:  d.containerCod,
    obs:            d.obs,
    responsavel:    d.responsavel,
    tipo_carga:     d.tipoCarga || 'mercadoria',
    items:          d.items,
    emitido_em:     d.emitidoEm,
    status:         d.status,
    liberado_em:    d.liberadoEm,
    agente_nome:    d.agenteName
  };
}

function dbRowToOrder(row) {
  return {
    numCarga:      row.num_carga,
    portao:        row.portao,
    armazem:       row.armazem,
    tipoEmissor:   row.tipo_emissor,
    consignatario: row.consignatario,
    navio:         row.navio,
    carro:         row.carro,
    placa:         row.placa,
    motorista:     row.motorista,
    documento:     row.documento,
    dataDescarga:  row.data_descarga,
    docImportacao: row.doc_importacao,
    cidade:        row.cidade,
    containerNum:  row.container_num,
    containerTara: row.container_tara,
    containerCod:  row.container_cod,
    obs:           row.obs,
    responsavel:   row.responsavel,
    tipoCarga:     row.tipo_carga || 'mercadoria',
    items:         row.items || [],
    emitidoEm:     row.emitido_em,
    status:        row.status,
    liberadoEm:    row.liberado_em,
    agenteName:    row.agente_nome
  };
}

// ─── SUPABASE: Carregar ordens do banco ──────────────────────────────────────

async function carregarOrdensDoBanco() {
  try {
    const { data, error } = await supabaseClient
      .from('ordens')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao carregar ordens:', error);
      return;
    }

    S.orders = (data || []).map(dbRowToOrder);
    saveLS('orders');
    updateBadge();
    updatePortariaBadge();
    renderPortaria();
  } catch(err) {
    console.error('Erro ao carregar ordens do banco:', err);
  }
}

// Alias usado por autenticarUsuario()
async function carregarDoSupabase() {
  await carregarOrdensDoBanco();
  ativarRealtimeOrdens();
}

// ─── FILA DE SINCRONIZAÇÃO (ordens "só locais") ───────────────────────────
// Se o INSERT falha (sem internet, 400 transitório...), o nº da OS entra em
// S.pendentes e é retentado em: login, restauração de sessão, volta da
// internet e a cada novo salvamento. Conflito 23505 (já existe no banco,
// ex.: a resposta se perdeu mas o insert passou) conta como sincronizado.
function marcarPendente(numCarga) {
  if (!numCarga) return;
  S.pendentes = S.pendentes || [];
  if (S.pendentes.indexOf(numCarga) < 0) {
    S.pendentes.push(numCarga);
    saveLS('pendentes');
  }
}

function desmarcarPendente(numCarga) {
  if (!numCarga || !S.pendentes) return;
  var i = S.pendentes.indexOf(numCarga);
  if (i >= 0) {
    S.pendentes.splice(i, 1);
    saveLS('pendentes');
  }
}

function ehPendente(numCarga) {
  return !!numCarga && !!S.pendentes && S.pendentes.indexOf(numCarga) >= 0;
}

// Selo "só local" exibido nas listagens para ordens fora do banco.
function marcaSync(numCarga) {
  if (!ehPendente(numCarga)) return '';
  return '<span class="ml-1 inline-flex items-center text-[10px] font-bold text-amber-700 bg-amber-100 border border-dashed border-amber-400 px-1.5 py-0.5 rounded-full" title="Ainda não sincronizou com o banco (visível só neste aparelho)">só local</span>';
}

var _sincronizando = false;

async function sincronizarPendentes(silencioso) {
  if (_sincronizando) return;
  if (!S.pendentes || !S.pendentes.length) return;
  if (!S.currentUser) return;
  _sincronizando = true;
  try {
    var antes = S.pendentes.length;
    var restantes = [];
    for (var i = 0; i < S.pendentes.length; i++) {
      var num = S.pendentes[i];
      var ordem = null;
      for (var k = 0; k < S.orders.length; k++) {
        if (S.orders[k].numCarga === num) { ordem = S.orders[k]; break; }
      }
      if (!ordem) continue; // ordem sumiu localmente: descarta da fila
      try {
        var res = await supabaseClient.from('ordens').insert([orderToDbRow(ordem)]);
        if (res.error) {
          if (res.error.code === '23505') {
            // Já existe no banco (resposta anterior se perdeu): ok.
          } else {
            restantes.push(num);
            continue;
          }
        }
      } catch(e) {
        restantes.push(num);
      }
    }
    S.pendentes = restantes;
    saveLS('pendentes');
    var feitas = antes - restantes.length;
    if (feitas > 0) {
      updateBadge();
      updatePortariaBadge();
      renderPortaria();
      if (!silencioso) toast(feitas + ' ordem(ns) pendente(s) sincronizada(s)!', 'success');
    }
    if (!silencioso && restantes.length > 0) {
      toast(restantes.length + ' ordem(ns) ainda sem sincronizar.', 'warning');
    }
  } finally {
    _sincronizando = false;
  }
}

// ─── SUPABASE: Realtime – sincronizacao entre navegadores ────────────────────

var _realtimeChannel = null;

function ativarRealtimeOrdens() {
  // Evita criar mais de um canal
  if (_realtimeChannel) return;

  _realtimeChannel = supabaseClient
    .channel('ordens-realtime')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ordens' },
      function(payload) {
        var novaOrdem = dbRowToOrder(payload.new);
        var existe = S.orders.some(function(o){ return o.numCarga === novaOrdem.numCarga; });
        if (!existe) {
          S.orders.unshift(novaOrdem);
          saveLS('orders');
          updateBadge();
          updatePortariaBadge();
          renderPortaria();
          toast('Nova ordem recebida: ' + novaOrdem.numCarga, 'info');
        }
      }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ordens' },
      function(payload) {
        var ordemAtualizada = dbRowToOrder(payload.new);
        var idx = -1;
        for(var i = 0; i < S.orders.length; i++) {
          if(S.orders[i].numCarga === ordemAtualizada.numCarga){ idx = i; break; }
        }
        if (idx >= 0) {
          S.orders[idx] = ordemAtualizada;
        } else {
          S.orders.unshift(ordemAtualizada);
        }
        saveLS('orders');
        updateBadge();
        updatePortariaBadge();
        renderPortaria();
      }
    )
    .subscribe(function() {});
}

// Mostra apenas as abas liberadas e abre a aba inicial do perfil.
function exibirAbas(botoes, abaInicial) {
  botoes.forEach(function(el) {
    if (el) { el.style.removeProperty('display'); el.classList.remove('hidden'); }
  });
  if (abaInicial && typeof switchTab === 'function') switchTab(abaInicial);
}

// Normaliza texto para comparação (minúsculas, sem acentos): 'Técnico' e
// 'Tecnico' passam a equivaler — permite exibir nomes com acento sem quebrar
// as checagens de perfil/status.
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function aplicarPermissoesPorPerfil(perfilUsuario) {
  // Referencia os botoes de aba pelo ID correto
  const btnEmitir    = document.getElementById('tab-emit');
  const btnPortaria  = document.getElementById('tab-portaria');
  const btnCadastros = document.getElementById('tab-manage');
  const btnUsuarios  = document.getElementById('tab-users');
  const btnSobre     = document.getElementById('tab-sobre');
  const btnRelatorio = document.getElementById('tab-relatorio');
  const btnAudit     = document.getElementById('tab-audit');

  // Oculta todas as abas antes de aplicar as permissoes do perfil
  [btnEmitir, btnPortaria, btnCadastros, btnUsuarios, btnSobre, btnRelatorio, btnAudit].forEach(function(el) {
    if (el) { el.style.setProperty('display', 'none', 'important'); el.classList.add('hidden'); }
  });

  // Normaliza o perfil para comparacao (minúsculas, sem acentos)
  const perfil = norm(perfilUsuario).trim();

  if (perfil.includes('portaria')) {
    exibirAbas([btnPortaria, btnSobre], 'portaria'); // Agente: só Portaria e Ajuda
  } else if (perfil.includes('fiel') || perfil.includes('tecnico') || perfil.includes('emissor')) {
    exibirAbas([btnEmitir, btnPortaria, btnCadastros, btnRelatorio, btnSobre], 'emit'); // Emissor: tudo exceto Usuarios
  } else if (perfil.includes('admin')) {
    exibirAbas([btnEmitir, btnPortaria, btnCadastros, btnRelatorio, btnUsuarios, btnAudit, btnSobre], 'emit'); // Admin: total (+ Auditoria)
  }
}

document.addEventListener('DOMContentLoaded', () => {
    // Busca os dados salvos no login
    const dadosUsuario = localStorage.getItem('usuario'); 
    
    if (dadosUsuario) {
        const usuario = JSON.parse(dadosUsuario);
        aplicarPermissoesPorPerfil(usuario.perfil);
    }
});

function startApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('flex');

  // Atualiza header com dados do usuario logado
  document.getElementById('user-display-name').textContent = x(S.currentUser.nome);
  document.getElementById('user-display-role').textContent = '(' + x(S.currentUser.perfil) + ')';
  document.getElementById('user-avatar').textContent = x(S.currentUser.nome.charAt(0).toUpperCase());

  exibirNumeroPendente();
  setToday();
  setCidadeDefault();
  refreshAll();
  updateBadge();
  checkEmpty();
  applyPermissions();

  ativarListenersFormulario();
}

// Liga uma única vez os listeners do formulário (totais automáticos +
// atalhos F9/F10/Esc). startApp() é legado e hoje ninguém o chama: o login
// Auth passa por montarSessao() → restaurarSessao(), por isso a chamada
// também está lá — sem isto os totais não atualizam ao digitar.
var _formListenersAtivos = false;
function ativarListenersFormulario() {
  if (_formListenersAtivos) return;
  _formListenersAtivos = true;

  var tb = document.getElementById('items-tbody');
  if (tb) tb.addEventListener('input', calcTotals);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F9')     { e.preventDefault(); saveOrder(); }
    if (e.key === 'F10')    { e.preventDefault(); printOrder(); }
    if (e.key === 'Escape') { closeQuickModal(); closeHistoryModal(); closePortariaModal(); }
  });
}

// Resume o erro PostgREST num objeto simples para aparecer legível no console
// (code/message/details/hint dizem exatamente o motivo do 400/403/409).
function resumirErroPostgrest(error) {
  if (!error) return error;
  return {
    code: error.code, message: error.message,
    details: error.details, hint: error.hint
  };
}

function loadAll() {
  // Carregar dados do localStorage (funcionamento garantido)
  S.navios       = JSON.parse(localStorage.getItem(LS.NAVIOS)   || '[]');
  S.consig       = JSON.parse(localStorage.getItem(LS.CONSIG)   || '[]');
  S.mercs        = JSON.parse(localStorage.getItem(LS.MERCS)    || '[]');
  S.lotes        = JSON.parse(localStorage.getItem(LS.LOTES)    || '[]');
  S.orders       = JSON.parse(localStorage.getItem(LS.ORDERS)   || '[]');
  S.pendentes    = JSON.parse(localStorage.getItem(LS.PENDENTES) || '[]');
  S.tiposVeiculo = JSON.parse(localStorage.getItem(LS.VEICULOS) || 'null');
  
  if (!S.tiposVeiculo || S.tiposVeiculo.length === 0) {
    S.tiposVeiculo = [...DEFAULT_VEICULOS];
    saveLS('tiposVeiculo');
  }
  
  S.users = JSON.parse(localStorage.getItem(LS.USERS) || 'null');
  if (!S.users || S.users.length === 0) {
    S.users = [...DEFAULT_USERS];
    saveLS('users');
  }
}

async function autenticarUsuario() {
  var u = tr(g('login-username').value);
  var p = g('login-password').value;
  if (!u || !p) {
    toast('Preencha usuário e senha.', 'warning');
    return;
  }

  try {
    // 1. Senha conferida com hash no servidor (nunca via consulta no front)
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: emailDoLogin(u),
      password: p
    });
    if (error || !data || !data.user) {
      console.error('signIn falhou:', error && { message: error.message, status: error.status });
      if (error && /confirm/i.test(error.message || '')) {
        toast('Conta ainda não confirmada. Recrie o usuário marcando Auto Confirm.', 'error');
      } else {
        toast('Usuário ou senha incorretos.', 'error');
      }
      return;
    }

    // 2. Perfil vinculado ao id imutável da conta (não ao nome nem ao login)
    const perfil = await buscarPerfilAuth(data.user.id);
    if (!perfil) {
      await supabaseClient.auth.signOut();
      toast('Conta sem perfil vinculado. Fale com o administrador.', 'error');
      return;
    }

    // 3. Ativa a sessão e carrega os dados do banco
    montarSessao(data.user, perfil);
    registrarAuditoria('LOGIN', 'sessao', perfil.login, { perfil: perfil.perfil });

    // 4. Carrega os dados do banco
    if (typeof carregarDoSupabase === 'function') {
      await carregarDoSupabase();
    }
    descarregarFilaAuditoria();
    sincronizarPendentes(true);

    toast('Login realizado com sucesso!', 'success');
  } catch (err) {
    console.error('Erro na autenticação:', err);
    toast('Erro ao tentar autenticar. Tente novamente.', 'error');
  }
}

// ─── AUTH (Supabase Auth) ───────────────────────────────────────────────────
// O login continua sendo o usuário simples ("admin", "fiel"...). Por dentro,
// vira "admin@codeba.local" — domínio interno, sem e-mail real. A senha é
// conferida com hash no servidor; o perfil vem da tabela `usuarios` pelo
// id imutável da conta (auth_id), nunca pelo nome ou login.
const AUTH_DOMAIN = 'codeba.local';

function emailDoLogin(login) {
  return tr(login).toLowerCase() + '@' + AUTH_DOMAIN;
}

// Perfil vinculado à conta (null se a conta não tiver vínculo).
async function buscarPerfilAuth(authId) {
  try {
    const { data, error } = await supabaseClient
      .from('usuarios')
      .select('nome,login,perfil')
      .eq('auth_id', authId)
      .single();
    if (error || !data) return null;
    return data;
  } catch(e) {
    console.error('Erro ao buscar perfil:', e);
    return null;
  }
}

// Monta a sessão em memória + interface (sem auditoria aqui; quem chama decide).
function montarSessao(authUser, perfil) {
  S.currentUser = {
    nome: perfil.nome, login: perfil.login, perfil: perfil.perfil,
    authId: authUser.id, email: authUser.email
  };

  // Ajusta a interface do usuário logado
  restaurarSessao(S.currentUser);

  // Fallbacks de compatibilidade para variantes de interface
  if (typeof aplicarPermissoesInterface === 'function') {
    aplicarPermissoesInterface();
  } else if (typeof renderHeader === 'function') {
    renderHeader();
  } else if (typeof verificarSessaoAoCarregar === 'function') {
    verificarSessaoAoCarregar();
  }

  var loginModal = g('login-modal') || g('modal-login');
  if (loginModal) loginModal.style.display = 'none';
}

// Expiração em outra aba: derruba a sessão local sem loop
// (logoutUser já zera S.currentUser antes do signOut).
supabaseClient.auth.onAuthStateChange(function(event){
  if (event === 'SIGNED_OUT' && S.currentUser) logoutUser();
});

// Internet de volta: tenta descarregar ordens "só locais".
window.addEventListener('online', function(){ sincronizarPendentes(true); });

// RestaurarSessao: Ajusta a interface do usuário logado
function restaurarSessao(usuario) {
  if (!usuario) return;

  document.getElementById('user-display-name').textContent = x(usuario.nome);
  document.getElementById('user-display-role').textContent = '(' + x(usuario.perfil) + ')';
  document.getElementById('user-avatar').textContent = x(usuario.nome.charAt(0).toUpperCase());
  
  document.getElementById('user-avatar').classList.remove('hidden');
  document.getElementById('user-display-name').classList.remove('hidden');
  document.getElementById('user-display-role').classList.remove('hidden');
  
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('flex');

  if (typeof aplicarPermissoesPorPerfil === 'function') {
    aplicarPermissoesPorPerfil(usuario.perfil);
  }

  // Listeners do formulário (sem isto: totais não recalculam e F9/F10 não funcionam)
  if (typeof ativarListenersFormulario === 'function') {
    ativarListenersFormulario();
  }

  // Preenche e trava os campos de identidade (emissor, responsável, agente)
  if (typeof aplicarIdentidadeUsuario === 'function') {
    aplicarIdentidadeUsuario();
  }
}

function logoutUser() {
  // Auditoria antes de limpar a sessão (precisa do usuário ainda ativo)
  try {
    if (S.currentUser) registrarAuditoria('LOGOUT', 'sessao', S.currentUser.login, null);
  } catch(e){}
  S.currentUser = null;
  try { supabaseClient.auth.signOut(); } catch(e){}
  // 1. Limpeza de Sessão: remove a chave legada do login antigo
  localStorage.removeItem('codeba_logged_user');
  
  // 2. Ocultação de Telas Protegidas: esconde navbar e seções principais
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('user-avatar').classList.add('hidden');
  document.getElementById('user-display-name').classList.add('hidden');
  document.getElementById('user-display-role').classList.add('hidden');
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.add('hidden');
  });
  document.getElementById('tab-emit').classList.add('hidden');
  document.getElementById('tab-portaria').classList.add('hidden');
  document.getElementById('tab-manage').classList.add('hidden');
  document.getElementById('tab-users').classList.add('hidden');
  document.getElementById('tab-sobre').classList.add('hidden');
  var _ta = document.getElementById('tab-audit'); if (_ta) _ta.classList.add('hidden');
  
  // 3. Limpeza de Campos e foco no login
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-username').focus();
}

function applyPermissions() {
  // Delega para a funcao unificada de permissoes
  if (S.currentUser) {
    aplicarPermissoesPorPerfil(S.currentUser.perfil);
  }
}

const ALL_TABS = ['emit','portaria','manage','relatorio','sobre','users','audit'];

function switchTab(t) {
  ALL_TABS.forEach(function(id) {
    document.getElementById('pane-'+id).classList.toggle('hidden', id !== t);
    document.getElementById('tab-'+id).classList.toggle('active', id === t);
    document.getElementById('tab-'+id).classList.toggle('text-white', id === t);
  });
  // Fecha o menu mobile ao trocar de aba (só em telas < lg)
  try {
    if (window.innerWidth < 1024) {
      var nav = document.getElementById('main-nav');
      if (nav && !nav.classList.contains('hidden')) closeMobileMenu();
    }
    // Rola para o topo ao trocar de aba no celular
    if (window.innerWidth < 768) window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch(e){}
  // Reanima o painel exibido (reflow reinicia a animação a cada troca)
  var pane = document.getElementById('pane-'+t);
  if (pane) {
    pane.classList.remove('tab-enter');
    void pane.offsetWidth;
    pane.classList.add('tab-enter');
  }
  if (t === 'portaria') renderPortaria();
  if (t === 'relatorio') iniciarFiltrosRelatorio();
  if (t === 'emit') preReservarNumeroOS(); // formulário em branco já mostra o número
}

// ─── MENU MOBILE (hamburger < lg) ─────────────────────────────────────────
function toggleMobileMenu() {
  var nav = document.getElementById('main-nav');
  var btn = document.getElementById('mobile-menu-btn');
  var iOpen = document.getElementById('mobile-menu-icon-open');
  var iClose = document.getElementById('mobile-menu-icon-close');
  if (!nav) return;
  var opening = nav.classList.contains('hidden');
  nav.classList.toggle('hidden', !opening);
  nav.classList.toggle('flex', opening);
  if (btn) btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (iOpen) iOpen.classList.toggle('hidden', opening);
  if (iClose) iClose.classList.toggle('hidden', !opening);
}

function closeMobileMenu() {
  var nav = document.getElementById('main-nav');
  var btn = document.getElementById('mobile-menu-btn');
  var iOpen = document.getElementById('mobile-menu-icon-open');
  var iClose = document.getElementById('mobile-menu-icon-close');
  if (!nav) return;
  // No desktop o nav é sempre visível (lg:flex); só esconde no mobile
  if (window.innerWidth < 1024) {
    nav.classList.add('hidden');
    nav.classList.remove('flex');
  }
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (iOpen) iOpen.classList.remove('hidden');
  if (iClose) iClose.classList.add('hidden');
}

// Garante estado correto ao redimensionar (ex.: girar o celular)
window.addEventListener('resize', function() {
  var nav = document.getElementById('main-nav');
  if (!nav) return;
  if (window.innerWidth >= 1024) {
    nav.classList.remove('hidden');
  } else if (btnMenuFechado()) {
    nav.classList.add('hidden');
  }
  function btnMenuFechado() {
    var btn = document.getElementById('mobile-menu-btn');
    return btn && btn.getAttribute('aria-expanded') !== 'true';
  }
});

// ─── NUMERAÇÃO DA OS (sequence única no banco) ───────────────────────────────
// O número é reservado no banco no momento de salvar/imprimir — nunca antes.
// Assim dois PCs nunca geram a mesma OS. No formulário, fica pendente ('--').
function exibirNumeroPendente() {
  g('f-num-carga').value = '';
  g('order-number-display').textContent = '--';
}

// Reserva o próximo número (atômico entre PCs). Retorna "OS-AAAA-NNNNN" ou null.
async function reservarNumeroOS() {
  try {
    const { data, error } = await supabaseClient.rpc('next_os_num');
    if (error || data === null || data === undefined) throw error || new Error('rpc vazio');
    return 'OS-' + new Date().getFullYear() + '-' + String(data).padStart(5, '0');
  } catch(e) {
    console.error('Erro ao reservar número da OS:', e);
    return null;
  }
}

function aplicarNumeroOS(num) {
  g('f-num-carga').value = num;
  g('order-number-display').textContent = num;
}

var _reservandoNumero = false;

// Pré-reserva e exibe o número ao abrir um formulário em branco.
// Só reserva se o campo estiver vazio (não queima numeração à toa) e
// nunca sobrescreve um número já exibido (ex.: ordem reaberta).
async function preReservarNumeroOS() {
  if (_reservandoNumero) return;
  var campo = g('f-num-carga');
  if (!campo || campo.value) return;
  _reservandoNumero = true;
  try {
    var num = await reservarNumeroOS();
    if (!g('f-num-carga').value) {
      if (num) aplicarNumeroOS(num);
      else exibirNumeroPendente();
    }
  } finally {
    _reservandoNumero = false;
  }
}

function setToday() {
  document.getElementById('f-data-descarga').value = new Date().toISOString().split('T')[0];
}

function setCidadeDefault() {
  const el = document.getElementById('f-cidade');
  if (el && !el.value) el.value = 'Ilhéus - BA';
}

function refreshAll() {
  fillDL('list-navio',  S.navios,  function(v){ return v; });
  fillDL('list-consig', S.consig,  function(v){ return v; });
  buildMercDL();
  refreshCarroSelect();
  renderManage();
  updatePortariaBadge();
  renderUsers();
}

function fillDL(id, arr, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = arr.map(function(i){ return '<option value="'+x(fn(i))+'"></option>'; }).join('');
}

function buildMercDL() {
  let dl = document.getElementById('merc-dl');
  if (!dl) { dl = document.createElement('datalist'); dl.id='merc-dl'; document.body.appendChild(dl); }
  dl.innerHTML = S.mercs.map(function(m){ return '<option value="'+x(m.nome)+'">'+m.codigo+'</option>'; }).join('');
}

function refreshCarroSelect() {
  const sel = document.getElementById('f-carro');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Selecione...</option>' +
    S.tiposVeiculo.map(function(v){ return '<option value="'+x(v)+'"'+(cur===v?' selected':'')+'>'+x(v)+'</option>'; }).join('');
}

function renderManage() {
  renderList('list-ui-navios', S.navios, 'navio',
    function(v){ return '<span class="flex-1 text-sm text-gray-700">'+x(v)+'</span>'; });
  renderList('list-ui-consig', S.consig, 'consignatario',
    function(v){ return '<span class="flex-1 text-sm text-gray-700">'+x(v)+'</span>'; });
  renderList('list-ui-mercs',  S.mercs,  'mercadoria',
    function(v){ return '<span class="flex-1 text-sm text-gray-700">'+x(v.nome)+'</span>'+(v.codigo?'<span class="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-mono mr-2">'+x(v.codigo)+'</span>':''); });
  renderList('list-ui-lotes',  S.lotes,  'lote',
    function(v){ return '<span class="flex-1 text-sm text-gray-700">'+x(v)+'</span>'; });
  renderList('list-ui-veiculos', S.tiposVeiculo, 'veiculo',
    function(v){ return '<span class="flex-1 text-sm text-gray-700">'+x(v)+'</span>'; });

  var counts = {navios:'count-navios',consig:'count-consig',mercs:'count-mercs',lotes:'count-lotes',tiposVeiculo:'count-veiculos'};
  Object.keys(counts).forEach(function(k){
    var el = document.getElementById(counts[k]);
    if (el) el.textContent = S[k].length;
  });
}

function renderList(ulId, arr, type, rowFn) {
  const ul = document.getElementById(ulId);
  if (!ul) return;
  ul.innerHTML = arr.length === 0
    ? '<li class="text-xs text-gray-400 text-center py-4">Nenhum cadastro ainda.</li>'
    : arr.map(function(item,i){
        return '<li class="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-blue-50 rounded-xl transition group">' +
          rowFn(item,i) +
          '<button onclick="removeCadastro(\''+type+'\','+i+')" tabindex="-1"' +
          ' class="opacity-0 group-hover:opacity-100 transition text-red-400 hover:text-red-600 w-6 h-6 flex items-center justify-center rounded-lg text-base font-bold">x</button>' +
          '</li>';
      }).join('');
}

function addCadastro(type) {
  var m = {
    navio:         { input:'input-navio',    arr:'navios',       label:'Navio' },
    consignatario: { input:'input-consig',   arr:'consig',       label:'Consignatário' },
    lote:          { input:'input-lote',     arr:'lotes',        label:'Lote' },
    veiculo:       { input:'input-veiculo',  arr:'tiposVeiculo', label:'Tipo de Veículo' },
  };

  if (type === 'mercadoria') {
    var nome   = tr(document.getElementById('input-merc-nome').value);
    var codigo = tr(document.getElementById('input-merc-codigo').value);
    if (!nome) { toast('Digite o nome da mercadoria.','warning'); return; }
    S.mercs.push({nome:nome,codigo:codigo});
    saveLS('mercs');
    document.getElementById('input-merc-nome').value = '';
    document.getElementById('input-merc-codigo').value = '';
    refreshAll(); toast('Mercadoria cadastrada!','success'); return;
  }

  var cfg = m[type];
  if (!cfg) return;
  var v = tr(document.getElementById(cfg.input).value);
  if (!v) { toast('Digite o nome do(a) '+cfg.label+'.','warning'); return; }

  var arr = S[cfg.arr];
  if (arr.indexOf(v) >= 0) { toast(cfg.label+' já cadastrado(a)!','info'); return; }
  arr.push(v);
  saveLS(cfg.arr);
  document.getElementById(cfg.input).value = '';
  refreshAll();
  toast(cfg.label+' cadastrado(a)!','success');
}

function removeCadastro(type, i) {
  var map = {navio:'navios',consignatario:'consig',mercadoria:'mercs',lote:'lotes',veiculo:'tiposVeiculo'};
  var key = map[type];
  if (!key) return;
  S[key].splice(i,1);
  saveLS(key);
  refreshAll();
  toast('Removido.','info');
}

// USERS CRUD
function renderUsers() {
  var tb = g('users-tbody');
  var emp = g('users-empty');
  var c = g('count-users');
  if (!tb || !c) return;

  c.textContent = S.users.length;
  if (S.users.length === 0) {
    tb.innerHTML = '';
    emp.classList.remove('hidden');
  } else {
    emp.classList.add('hidden');
    tb.innerHTML = S.users.map(function(u, i){
      var btn = (u.login === 'admin') 
        ? '<span class="text-xs text-gray-400">Protegido</span>'
        : '<button onclick="removeUser('+i+')" class="text-red-500 hover:text-red-700 font-bold px-2 py-1 bg-red-50 rounded">Remover</button>';
      return '<tr class="border-b border-gray-100 hover:bg-slate-50 transition">' +
        '<td class="px-3 py-2 font-semibold text-navy-700">' + x(u.nome) + '</td>' +
        '<td class="px-3 py-2 font-mono text-xs">' + x(u.login) + '</td>' +
        '<td class="px-3 py-2 text-xs">' + x(u.perfil) + '</td>' +
        '<td class="px-3 py-2 text-center">' + btn + '</td>' +
        '</tr>';
    }).join('');
  }
}

function addUser() {
  var n = tr(g('u-nome').value);
  var l = tr(g('u-login').value).toLowerCase();
  var p = g('u-perfil').value;

  if (!n || !l) { toast('Preencha Nome e Login!','warning'); return; }
  var dup = S.users.find(function(u){ return (u.login||'').toLowerCase() === l; });
  if (dup) { toast('Login já existe!','error'); return; }

  // Sem senha aqui: o acesso é criado no Supabase Auth (login@codeba.local)
  S.users.push({nome:n, login:l, perfil:p});
  saveLS('users');
  registrarAuditoria('USUARIO_CRIADO', 'usuario', l, { nome: n, perfil: p });

  g('u-nome').value = ''; g('u-login').value = '';
  renderUsers();
  toast('Usuário cadastrado! Crie o acesso dele no Supabase Auth.','success');
}

function removeUser(i) {
  if (S.users[i].login === 'admin') { toast('O Administrador padrão não pode ser removido.','error'); return; }
  if (S.users[i].login === S.currentUser.login) { toast('Você não pode remover si próprio.','error'); return; }
  if (!confirm('Remover o usuário ' + S.users[i].nome + '?')) return;

  registrarAuditoria('USUARIO_REMOVIDO', 'usuario', S.users[i].login, { nome: S.users[i].nome, perfil: S.users[i].perfil });
  S.users.splice(i,1);
  saveLS('users');
  renderUsers();
  toast('Usuário removido.','info');
}

function openQuickModal(type) {
  S.quickType = type;
  var labels = {navio:'Navio', consignatario:'Consignatário'};
  document.getElementById('quick-modal-title').textContent = 'Cadastro Rápido - '+(labels[type]||type);
  document.getElementById('quick-input').value = '';
  document.getElementById('quick-modal-hint').textContent =
    type === 'navio'
      ? 'Informe o nome completo do navio. Ele será adicionado à lista e selecionado automaticamente.'
      : 'Informe o nome completo do consignatário. Ele será adicionado e selecionado automaticamente.';
  document.getElementById('quick-modal').classList.remove('hidden');
  setTimeout(function(){ document.getElementById('quick-input').focus(); }, 60);
}

function closeQuickModal() {
  document.getElementById('quick-modal').classList.add('hidden');
  S.quickType = null;
}

function saveQuick() {
  var v = tr(document.getElementById('quick-input').value);
  if (!v) { toast('Campo não pode ser vazio.','warning'); return; }
  if (S.quickType === 'navio') {
    if (S.navios.indexOf(v) < 0) { S.navios.push(v); saveLS('navios'); }
    document.getElementById('f-navio').value = v;
  } else {
    if (S.consig.indexOf(v) < 0) { S.consig.push(v); saveLS('consig'); }
    document.getElementById('f-consignatario').value = v;
  }
  refreshAll();
  closeQuickModal();
  toast('Cadastrado e selecionado!','success');
}

function addItemRow(d) {
  d = d || {};
  var tbody = document.getElementById('items-tbody');
  var id    = ++S.rowId;
  var row   = document.createElement('tr');
  row.className  = 'item-row border-b border-gray-100 hover:bg-slate-50 transition';
  row.dataset.rid = id;
  row.innerHTML =
    '<td class="px-3 py-2"><input type="text" list="merc-dl" placeholder="' + ((S.tipoCarga === 'material') ? 'Material' : 'Mercadoria') + '" value="'+x(d.merc||'')+'" class="cell-input w-full" /></td>' +
    '<td class="px-3 py-2"><input type="text" placeholder="Código" value="'+x(d.codigo||'')+'" class="cell-input w-24 font-mono" /></td>' +
    '<td class="px-3 py-2"><input type="text" placeholder="Caixa, Saco..." value="'+x(d.emb||'')+'" class="cell-input w-24" /></td>' +
    '<td class="px-3 py-2"><input type="number" min="0" step="1" placeholder="0" value="'+(d.qtd||'')+'" class="cell-input w-16 text-right qty-i" /></td>' +
    '<td class="px-3 py-2"><input type="number" min="0" step="0.001" placeholder="0,000" value="'+(d.pesoUnit||'')+'" class="cell-input w-24 text-right unit-i" /></td>' +
    '<td class="px-3 py-2"><input type="number" min="0" step="0.001" readonly placeholder="--" value="'+(d.pesoTot||'')+'" class="cell-input w-24 text-right bg-slate-100 font-semibold text-navy-700 tot-i" /></td>' +
    '<td class="px-3 py-2"><input type="number" min="0" step="0.01" placeholder="0,00" value="'+(d.valor||'')+'" class="cell-input w-24 text-right valor-i" /></td>' +
    '<td class="px-3 py-2 text-center"><button onclick="removeItemRow('+id+')" tabindex="-1" class="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 text-base font-bold flex items-center justify-center mx-auto transition">x</button></td>';
  tbody.appendChild(row);
  row.querySelector('input').focus();
  checkEmpty(); calcTotals();
}

function removeItemRow(id) {
  var el = document.querySelector('tr[data-rid="'+id+'"]');
  if (el) el.remove();
  checkEmpty(); calcTotals();
}

function calcTotals() {
  var tPeso = 0, tValor = 0;
  document.querySelectorAll('#items-tbody tr').forEach(function(row){
    var qty  = parseFloat(row.querySelector('.qty-i') ? row.querySelector('.qty-i').value : 0)   || 0;
    var unit = parseFloat(row.querySelector('.unit-i') ? row.querySelector('.unit-i').value : 0)  || 0;
    var val  = parseFloat(row.querySelector('.valor-i') ? row.querySelector('.valor-i').value : 0) || 0;
    var tot  = qty * unit;
    var ti   = row.querySelector('.tot-i');
    if (ti) ti.value = tot > 0 ? tot.toFixed(3) : '';
    tPeso += tot; tValor += val;
  });
  document.getElementById('total-peso').textContent  =
    tPeso.toLocaleString('pt-BR',{minimumFractionDigits:3}) + ' kg';
  document.getElementById('total-valor').textContent =
    'R$ ' + tValor.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function checkEmpty() {
  var empty = document.querySelectorAll('#items-tbody tr').length === 0;
  document.getElementById('items-empty').classList.toggle('hidden',!empty);
}

// ─── TIPO DE CARGA (Mercadoria | Material) ───────────────────────────────────

function setTipoCarga(t) {
  S.tipoCarga = (t === 'material') ? 'material' : 'mercadoria';
  var mat = (S.tipoCarga === 'material');
  var bMerc = g('tipo-mercadoria'), bMat = g('tipo-material');
  var clsOn  = 'px-3 py-1.5 text-xs font-bold rounded-md bg-white text-navy-700 transition';
  var clsOff = 'px-3 py-1.5 text-xs font-semibold rounded-md text-white/70 hover:text-white transition';
  if (bMerc) bMerc.className = mat ? clsOff : clsOn;
  if (bMat)  bMat.className  = mat ? clsOn  : clsOff;
  var tit = g('itens-titulo');
  if (tit) tit.textContent = mat ? 'Itens do Material' : 'Itens da Mercadoria';
  var col = g('itens-col-titulo');
  if (col) col.textContent = mat ? 'Material' : 'Mercadoria';
  // Atualiza o exemplo dentro das linhas já adicionadas (só o placeholder)
  document.querySelectorAll('#items-tbody tr').forEach(function(row){
    var inp = row.querySelector('input');
    if (inp) inp.placeholder = mat ? 'Material' : 'Mercadoria';
  });
}

function collect() {
  var rows  = document.querySelectorAll('#items-tbody tr');
  var items = [];
  rows.forEach(function(r){
    var ins = r.querySelectorAll('input');
    items.push({
      merc: ins[0]?ins[0].value:'', codigo:ins[1]?ins[1].value:'', emb:ins[2]?ins[2].value:'',
      qtd:  ins[3]?ins[3].value:'', pesoUnit:ins[4]?ins[4].value:'', pesoTot:ins[5]?ins[5].value:'',
      valor:ins[6]?ins[6].value:''
    });
  });
  return {
    numCarga:      g('f-num-carga').value,
    portao:        g('f-portao').value,
    armazem:       g('f-armazem').value,
    tipoEmissor:   g('f-tipo-emissor').value,
    consignatario: g('f-consignatario').value,
    navio:         g('f-navio').value,
    carro:         g('f-carro').value,
    placa:         g('f-placa').value,
    motorista:     g('f-motorista').value,
    documento:     g('f-documento').value,
    dataDescarga:  g('f-data-descarga').value,
    docImportacao: g('f-doc-importacao').value,
    cidade:        g('f-cidade').value,
    containerNum:  g('f-container-num').value,
    containerTara: g('f-container-tara').value,
    containerCod:  g('f-container-codigo').value,
    obs:           g('f-obs').value,
    responsavel:   g('f-responsavel').value,
    tipoCarga:     S.tipoCarga || 'mercadoria',
    items:         items,
    emitidoEm:     new Date().toLocaleString('pt-BR'),
    status:        STATUS.PENDENTE,
    liberadoEm:    null,
    agenteName:    null,
  };
}

// ─── PLACA: formatos ABC-1234 (antigo) ou ABC1D23 (Mercosul) ─────────────────

// Normaliza enquanto digita: maiúsculas, só letras/números, hífen automático.
function normalizarPlaca(v) {
  var s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  if (/^[A-Z]{3}[0-9]{4}$/.test(s)) return s.slice(0, 3) + '-' + s.slice(3);
  return s;
}

function placaValida(v) {
  var s = String(v || '').toUpperCase().trim();
  return /^[A-Z]{3}-[0-9]{4}$/.test(s) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(s);
}

function formatarPlaca(el) {
  if (!el) return;
  el.value = normalizarPlaca(el.value);
  try { el.setSelectionRange(el.value.length, el.value.length); } catch(e){}
}

function validate(d) {
  var req = [
    {k:'portao',       l:'Portão Nº',            id:'f-portao'},
    {k:'armazem',      l:'Local de Armazenagem',   id:'f-armazem'},
    {k:'tipoEmissor',  l:'Tipo de Emissor',        id:'f-tipo-emissor'},
    {k:'consignatario',l:'Consignatário',          id:'f-consignatario'},
    {k:'carro',        l:'Carro / Tipo de Veículo',id:'f-carro'},
    {k:'placa',        l:'Placa',                  id:'f-placa'},
    {k:'motorista',    l:'Motorista',              id:'f-motorista'},
    {k:'documento',    l:'Prontuário / CNH / CPF', id:'f-documento'},
    {k:'dataDescarga', l:'Data Descarga',          id:'f-data-descarga'},
    {k:'responsavel',  l:'Responsável pela Emissão',id:'f-responsavel'},
  ];
  for (var i=0;i<req.length;i++) {
    var r = req[i];
    if (!((d[r.k]||'').trim())) {
      toast('Campo obrigatorio: "'+r.l+'"','error');
      var el = g(r.id); if(el) el.focus();
      return false;
    }
  }
  // Placa: só aceita ABC-1234 ou ABC1D23 (normaliza antes de validar)
  d.placa = normalizarPlaca(d.placa);
  var pel = g('f-placa'); if (pel) pel.value = d.placa;
  if (!placaValida(d.placa)) {
    toast('Placa inválida. Use o formato ABC-1234 ou ABC1D23.','error');
    if (pel) pel.focus();
    return false;
  }
  // Data de descarga não pode ser futura
  var hoje = new Date().toISOString().slice(0,10);
  if (d.dataDescarga && d.dataDescarga > hoje) {
    toast('Data de Descarga não pode ser futura.','error');
    var dt = g('f-data-descarga'); if (dt) dt.focus();
    return false;
  }
  // Ordem vazia não salva
  if (!d.items || !d.items.length) {
    toast('Adicione ao menos 1 item em Mercadoria/Material.','error');
    return false;
  }
  return true;
}

// Salvar sem imprimir (F9). Trava reentrância: duplo clique/F9 gera 1 OS só.
var _salvando = false;
async function saveOrder() {
  if (_salvando) return;
  _salvando = true;
  try {
  var d = collect();
  if (!validate(d)) return;

  // Placa já com OS aberta: evita duas saídas pendentes do mesmo veículo.
  // Checa antes de reservar número para não queimar numeração à toa.
  var aberta = null;
  for (var k = 0; k < S.orders.length; k++) {
    if (S.orders[k].placa === d.placa && S.orders[k].status === STATUS.PENDENTE) { aberta = S.orders[k]; break; }
  }
  if (aberta) {
    toast('Placa ' + d.placa + ' já tem OS aberta (' + aberta.numCarga + ').','warning');
    return;
  }

  // Número exibido foi pré-reservado; só reserva se o campo estiver vazio
  if (!d.numCarga) {
    d.numCarga = await reservarNumeroOS();
    if (!d.numCarga) {
      toast('Sem conexão com o banco: número da OS indisponível.', 'error');
      return;
    }
    aplicarNumeroOS(d.numCarga);
  }

  // Salva localmente primeiro para resposta imediata
  S.orders.unshift(d);
  saveLS('orders');
  updateBadge();
  updatePortariaBadge();

  // Auditoria: único rastro com totais da ordem recém-emitida
  (function(){
    var soma = function(k){ return d.items.reduce(function(s,it){ return s+(parseFloat(it[k])||0); }, 0); };
    registrarAuditoria('ORDEM_EMITIDA', 'ordem', d.numCarga, {
      placa: d.placa, consignatario: d.consignatario, tipoCarga: d.tipoCarga || 'mercadoria',
      qtd: soma('qtd'), peso: soma('pesoTot'), valor: soma('valor')
    });
  })();

  // Limpa o formulario apos salvar (preserva campos travados de identidade)
  g('items-tbody').innerHTML = ''; S.rowId = 0;
  document.querySelectorAll('#pane-emit input:not([readonly]):not([disabled]),#pane-emit select:not([disabled]),#pane-emit textarea:not([readonly]):not([disabled])')
    .forEach(function(el){ el.value=''; });
  // O número usado foi consumido: zera o campo (readonly, não coberto pelo
  // seletor acima) para pré-reservar o PRÓXIMO número. Sem isto, o número
  // trava e o save seguinte dá conflito de UNIQUE no banco.
  g('f-num-carga').value = '';
  checkEmpty(); calcTotals(); setToday(); setCidadeDefault(); preReservarNumeroOS(); refreshCarroSelect();
  aplicarIdentidadeUsuario();
  setTipoCarga('mercadoria');

  toast('Ordem ' + d.numCarga + ' salva com sucesso! Aguardando Portaria.','success');

  // Envia para o Supabase (Realtime notificara os outros navegadores)
  try {
    var { error } = await supabaseClient
      .from('ordens')
      .insert([orderToDbRow(d)]);
    if (error) {
      console.error('Erro ao salvar ordem no Supabase:', resumirErroPostgrest(error));
      marcarPendente(d.numCarga);
      toast('Salvo localmente. Falha ao sincronizar com banco.', 'warning');
    } else {
      desmarcarPendente(d.numCarga);
    }
  } catch(err) {
    console.error('Excecao ao salvar no Supabase:', err);
    marcarPendente(d.numCarga);
  }
  // Aproveita a conexão (se voltou) para descarregar a fila de pendentes.
  sincronizarPendentes(true);
  } finally {
    _salvando = false;
  }
}

// Imprimir (F10): usa o número da ordem reaberta ou reserva um novo.
// Reserva só quando necessário para não queimar numeração à toa.
async function printOrder() {
  var d = collect();
  if (!validate(d)) return;
  if (!d.numCarga) {
    d.numCarga = await reservarNumeroOS();
    if (!d.numCarga) {
      toast('Sem conexão com o banco: número da OS indisponível.', 'error');
      return;
    }
    aplicarNumeroOS(d.numCarga);
  }
  buildPrint(d);
  setTimeout(function(){ window.print(); }, 250);
}

// ─── DOCUMENTO DE IMPRESSÃO (blocos de construção) ───────────────────────────

function printLinhaItem(it, i) {
  return '<tr><td>'+(i+1)+'</td><td>'+x(it.merc)+'</td><td>'+x(it.codigo)+'</td><td>'+x(it.emb)+'</td>'+
    '<td style="text-align:right">'+(it.qtd||0)+'</td>'+
    '<td style="text-align:right">'+fn(it.pesoUnit,3)+'</td>'+
    '<td style="text-align:right">'+fn(it.pesoTot,3)+'</td>'+
    '<td style="text-align:right">R$ '+fn(it.valor,2)+'</td></tr>';
}

function printItensRows(d) {
  if (!d.items.length) {
    return '<tr><td colspan="8" style="text-align:center;color:#888;font-style:italic">Sem itens listados.</td></tr>';
  }
  return d.items.map(printLinhaItem).join('');
}

function printContainerSec(d) {
  if (!(d.containerNum||d.containerTara||d.containerCod)) return '';
  return [
    '<div class="psec">Container</div>',
    '<div class="pgrid pg3">',
    '<div class="pf"><label>Sigla / Número</label><span>'+(x(d.containerNum)||'--')+'</span></div>',
    '<div class="pf"><label>Tara (kg)</label><span>'+(x(d.containerTara)||'--')+'</span></div>',
    '<div class="pf"><label>Código</label><span>'+(x(d.containerCod)||'--')+'</span></div>',
    '</div><div class="pdiv"></div>'
  ].join('');
}

function printObsSec(d) {
  if (!d.obs) return '';
  return [
    '<div class="psec">Observações</div>',
    '<div style="font-size:9pt;border:.5pt solid #ccc;border-radius:3pt;padding:5pt;min-height:20pt;margin-bottom:4pt">'+x(d.obs)+'</div>'
  ].join('');
}

function printValidacaoLine(d) {
  return (d.status === STATUS.LIBERADO && d.liberadoEm)
    ? 'Liberado na Portaria por <strong>'+x(d.agenteName)+'</strong> em <strong>'+x(d.liberadoEm)+'</strong>'
    : '<span style="color:#b45309">Aguardando Validação da Portaria</span>';
}

function printSecaoItens(d, iRows, tPeso, tValor) {
  var nomeItem = (d.tipoCarga === 'material') ? 'Material' : 'Mercadoria';
  return [
    '<div class="psec">Itens ' + (d.tipoCarga === 'material' ? 'do Material' : 'da Mercadoria') + '</div>',
    '<table class="ptbl">',
      '<thead><tr>',
        '<th style="width:18pt">#</th>',
        '<th>' + nomeItem + '</th>',
        '<th style="width:50pt">Código</th>',
        '<th style="width:48pt">Embalagem</th>',
        '<th style="width:28pt;text-align:right">Qtd.</th>',
        '<th style="width:52pt;text-align:right">Peso Unit.</th>',
        '<th style="width:52pt;text-align:right">Peso Total</th>',
        '<th style="width:52pt;text-align:right">Valor</th>',
      '</tr></thead>',
      '<tbody>',
        iRows,
        '<tr>',
          '<td colspan="5" style="text-align:right;font-weight:700;color:#1a3a6e;border-top:1pt solid #1a3a6e">TOTAIS</td>',
          '<td style="text-align:right;font-weight:700;color:#1a3a6e;border-top:1pt solid #1a3a6e">'+tPeso.toLocaleString('pt-BR',{minimumFractionDigits:3})+' kg</td>',
          '<td style="border-top:1pt solid #1a3a6e"></td>',
          '<td style="text-align:right;font-weight:700;color:#1a3a6e;border-top:1pt solid #1a3a6e">R$ '+tValor.toLocaleString('pt-BR',{minimumFractionDigits:2})+'</td>',
        '</tr>',
      '</tbody>',
    '</table>',
    '<div class="pdiv"></div>'
  ].join('');
}

function printSecaoAutenticacao(d) {
  return [
    '<div class="pauth">',
      '<div class="pauth-title">Autenticacao Digital e Auditoria</div>',
      '<div class="pauth-body">',
        '<div class="pauth-info">',
          '<div class="pauth-row"><strong>Emissão:</strong> Emitido eletronicamente por <strong>'+x(d.responsavel)+'</strong> em <strong>'+x(d.emitidoEm)+'</strong></div>',
          '<div class="pauth-row" style="margin-top:6pt"><strong>Validação Portaria:</strong> '+printValidacaoLine(d)+'</div>',
          '<div style="margin-top:10pt;font-size:7pt;color:#888;border-top:.5pt solid #ccc;padding-top:4pt">Documento digital emitido via Sistema de Controle de Saída - CODEBA</div>',
        '</div>',
        '<div class="pauth-qr">',
          '<div id="print-qr" style="width:64pt;height:64pt"></div>',
          '<p style="font-size:6pt;color:#888;margin-top:2pt;text-align:center">Escaneie para verificar</p>',
        '</div>',
      '</div>',
    '</div>'
  ].join('');
}

// Base pública do sistema (GitHub Pages). O QR impresso precisa funcionar em
// qualquer celular, então usa sempre o endereço canônico — nunca o endereço
// local de onde se imprimiu (file://, localhost...). Se a hospedagem mudar,
// atualize esta constante.
var BASE_URL_VERIFICACAO = 'https://maasj1.github.io/saida-carga-codeba/';

// URL pública de conferência da OS (lida pelo QR).
function urlVerificacaoOS(numCarga) {
  return BASE_URL_VERIFICACAO + 'verificar.html?os=' + encodeURIComponent(numCarga || '');
}

function renderQrPrint(d) {
  // O QR abre a página pública de conferência da OS (verificar.html).
  var qrStr = urlVerificacaoOS(d.numCarga);
  var box = g('print-qr');
  if (!box) return;
  box.innerHTML = '';
  try {
    if (typeof QRCode === 'undefined') throw new Error('lib qrcodejs não carregada');
    // Gera num nó temporário e congela como imagem data-URL: <img> embutida
    // imprime com fidelidade, sem depender do timing canvas→img da lib nem do
    // elemento estar visível na tela (o documento de impressão é display:none).
    // Gera em 180px e exibe em ~64pt para sair nítido no papel.
    var tmp = document.createElement('div');
    new QRCode(tmp, {
      text: qrStr, width:180, height:180,
      colorDark:'#1a3a6e', colorLight:'#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    var canvas = tmp.querySelector('canvas');
    if (canvas && canvas.toDataURL) {
      var img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = 'QR de autenticidade ' + d.numCarga;
      img.style.width = '64pt';
      img.style.height = '64pt';
      box.appendChild(img);
    } else if (tmp.firstChild) {
      box.appendChild(tmp.firstChild); // fallback: usa o original (tabela)
    } else {
      throw new Error('falha ao desenhar o QR');
    }
  } catch(e) {
    var msg = (e && e.message) || String(e);
    console.error('QR indisponivel:', msg);
    toast('QR indisponível (' + msg + '). Impresso código textual.', 'warning');
    box.innerHTML = '<span style="font-size:7pt;color:#666;word-break:break-all">' + x(qrStr) + '</span>';
  }
}

// Orquestra a montagem do documento de impressão.
function buildPrint(d) {
  var soma = function(k){ return d.items.reduce(function(s,r){ return s+(parseFloat(r[k])||0); }, 0); };
  var tPeso = soma('pesoTot'), tValor = soma('valor');

  var navioLine = d.navio
    ? '<div class="pf"><label>Navio</label><span>'+x(d.navio)+'</span></div>'
    : '';

  // Data de emissão (só a data, sem a hora) para o cabeçalho do documento.
  var dataEmissaoCab = String(d.emitidoEm || '').split(',')[0].trim() || String(d.emitidoEm || '');

  g('print-document').innerHTML = [
    '<div class="flex items-center justify-between border-b-2 border-slate-800 pb-4 mb-4 pt-2"><!-- Lado Esquerdo: Logo oficial (mantida no tamanho ampliado) --><div><img src="assets/img/logo-codeba.png" alt="CODEBA Autoridade Portuária" style="height: 65px !important; width: auto !important; max-height: none !important;" class="object-contain"></div><!-- Lado Direito: Título do Documento e Número da OS --><div class="text-right"><h1 class="text-xl font-extrabold text-slate-900 tracking-wide uppercase leading-tight">Ordem de Saída de Carga</h1><p class="text-lg font-bold text-blue-900 mt-0.5">Nº '+x(d.numCarga)+'</p><p class="text-xs text-slate-500">Emitido em: '+x(dataEmissaoCab)+'</p></div></div>',
    '<div class="pdiv"></div>',

    '<div class="psec">Identificacao</div>',
    '<div class="pgrid pg4">',
      '<div class="pf"><label>Portão N</label><span>'+x(d.portao)+'</span></div>',
      '<div class="pf"><label>Local de Armazenagem</label><span>'+x(d.armazem)+'</span></div>',
      '<div class="pf"><label>Tipo Emissor</label><span>'+x(d.tipoEmissor)+'</span></div>',
      '<div class="pf"><label>Responsável</label><span>'+x(d.responsavel)+'</span></div>',
    '</div>',
    '<div class="pdiv"></div>',

    '<div class="psec">Dados da Carga</div>',
    '<div class="pgrid pg3">',
      '<div class="pf"><label>Consignatário</label><span>'+x(d.consignatario)+'</span></div>',
      navioLine,
      '<div class="pf"><label>Carro / Tipo de Veículo</label><span>'+(x(d.carro)||'--')+'</span></div>',
    '</div>',
    '<div class="pgrid pg4" style="margin-top:4pt">',
      '<div class="pf"><label>Placa</label><span style="font-family:monospace;letter-spacing:1pt">'+x(d.placa)+'</span></div>',
      '<div class="pf"><label>Motorista</label><span>'+x(d.motorista)+'</span></div>',
      '<div class="pf"><label>Prontuário/CNH/CPF</label><span>'+x(d.documento)+'</span></div>',
      '<div class="pf"><label>Data Descarga</label><span>'+fd(d.dataDescarga)+'</span></div>',
    '</div>',
    '<div class="pgrid pg2" style="margin-top:4pt">',
      '<div class="pf"><label>Doc. Importação (DI/BL)</label><span>'+(x(d.docImportacao)||'--')+'</span></div>',
      '<div class="pf"><label>Cidade / Estado</label><span>'+(x(d.cidade)||'Ilhéus - BA')+'</span></div>',
    '</div>',
    '<div class="pdiv"></div>',

    printSecaoItens(d, printItensRows(d), tPeso, tValor),

    printContainerSec(d), printObsSec(d),

    printSecaoAutenticacao(d),
  ].join('');

  renderQrPrint(d);
}

// ─── PORTARIA (blocos de construção) ─────────────────────────────────────────

// Perfil do usuário logado em minúsculas (comparação case-insensitive).
function perfilAtual() {
  return norm(S.currentUser && S.currentUser.perfil);
}

function podeLiberarSaida() {
  var p = perfilAtual();
  return !!S.currentUser && (p.includes('admin') || p.includes('portaria'));
}

function podeExcluirOrdem() {
  return !!S.currentUser && perfilAtual().includes('admin');
}

function casaBuscaPortaria(o, search) {
  return !search
    || o.numCarga.toLowerCase().indexOf(search) >= 0
    || (o.placa||'').toLowerCase().indexOf(search) >= 0;
}

function filtrarOrdensPortaria(search) {
  var porStatus = function(st){
    return S.orders.filter(function(o){ return o.status === st && casaBuscaPortaria(o, search); });
  };
  return { pendentes: porStatus(STATUS.PENDENTE), concluidas: porStatus(STATUS.LIBERADO) };
}

function botaoConfirmarSaida(o) {
  if (!podeLiberarSaida()) return '<span class="text-xs text-gray-400">Sem Permissao</span>';
  return '<button onclick="openPortariaModal(\''+x(o.numCarga)+'\')"' +
    ' class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition mx-auto">' +
    '<svg class="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' +
    'Confirmar Saída</button>';
}

function botaoExcluirOrdem(numCarga) {
  if (!podeExcluirOrdem()) return '';
  return '<button onclick="excluirOrdem(\''+x(numCarga)+'\')"' +
    ' title="Excluir ordem"' +
    ' class="w-8 h-8 flex items-center justify-center mx-auto rounded-lg bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 transition">' +
    '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
    '</button>';
}

function linhaOrdemPendente(o) {
  return '<tr class="border-b border-gray-100 hover:bg-amber-50 transition">' +
    '<td class="px-4 py-3 font-bold text-navy-700 text-sm">'+x(o.numCarga)+'</td>' +
    '<td class="px-4 py-3 text-sm text-gray-700">'+x(o.consignatario)+'</td>' +
    '<td class="px-4 py-3 font-mono text-sm font-semibold tracking-widest">'+x(o.placa)+'</td>' +
    '<td class="px-4 py-3 text-sm text-gray-700">'+x(o.motorista)+'</td>' +
    '<td class="px-4 py-3 text-sm text-gray-600">'+(x(o.carro)||'--')+'</td>' +
    '<td class="px-4 py-3 text-xs text-gray-500">'+x(o.emitidoEm)+'</td>' +
    '<td class="px-4 py-3">' + badgeStatus(o.status) + marcaSync(o.numCarga) + '</td>' +
    '<td class="px-4 py-3 text-center">' + botaoConfirmarSaida(o) + '</td>' +
    '<td class="px-4 py-3 text-center">' + botaoExcluirOrdem(o.numCarga) + '</td>' +
    '</tr>';
}

function linhaOrdemConcluida(o) {
  return '<tr class="border-b border-gray-100 hover:bg-emerald-50 transition">' +
    '<td class="px-4 py-3 font-bold text-navy-700 text-sm">'+x(o.numCarga)+'</td>' +
    '<td class="px-4 py-3 text-sm text-gray-700">'+x(o.consignatario)+'</td>' +
    '<td class="px-4 py-3 font-mono text-sm font-semibold tracking-widest">'+x(o.placa)+'</td>' +
    '<td class="px-4 py-3 text-sm text-gray-700">'+(x(o.agenteName)||'--')+'</td>' +
    '<td class="px-4 py-3"><span class="badge-done">'+x(o.liberadoEm)+'</span></td>' +
    '<td class="px-4 py-3 text-center">' + botaoExcluirOrdem(o.numCarga) + '</td>' +
    '</tr>';
}

// Preenche uma das tabelas da portaria (ou mostra o estado vazio).
function renderListaPortaria(tbodyId, emptyId, ordens, linhaFn) {
  var tbody = g(tbodyId), empty = g(emptyId);
  if (ordens.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    tbody.innerHTML = ordens.map(linhaFn).join('');
  }
}

function renderPortaria() {
  var search = (g('portaria-search') ? g('portaria-search').value : '').toLowerCase();
  var listas = filtrarOrdensPortaria(search);
  renderListaPortaria('portaria-tbody', 'portaria-empty', listas.pendentes, linhaOrdemPendente);
  renderListaPortaria('concluidas-tbody', 'concluidas-empty', listas.concluidas, linhaOrdemConcluida);
}

function updatePortariaBadge() {
  var n = S.orders.filter(function(o){ return o.status === STATUS.PENDENTE; }).length;
  var b = g('portaria-badge');
  if (!b) return;
  b.textContent = n;
  b.classList.toggle('hidden', n === 0);
  // Tambem atualiza o badge de histórico
  updateBadge();
}

function openPortariaModal(numCarga) {
  var o = null;
  for(var i=0;i<S.orders.length;i++){ if(S.orders[i].numCarga === numCarga){ o=S.orders[i]; break; } }
  if (!o) return;
  S.portariaTarget = numCarga;
  g('portaria-modal-info').innerHTML =
    '<div class="grid grid-cols-2 gap-2 text-sm">' +
    '<div><span class="text-gray-500 text-xs uppercase font-semibold">OS</span><br/><strong class="text-navy-700">'+x(o.numCarga)+'</strong></div>' +
    '<div><span class="text-gray-500 text-xs uppercase font-semibold">Placa</span><br/><strong class="font-mono">'+x(o.placa)+'</strong></div>' +
    '<div><span class="text-gray-500 text-xs uppercase font-semibold">Motorista</span><br/>'+x(o.motorista)+'</div>' +
    '<div><span class="text-gray-500 text-xs uppercase font-semibold">Veículo</span><br/>'+(x(o.carro)||'--')+'</div>' +
    '</div>';
  aplicarIdentidadeUsuario(); // nome do agente já vem preenchido e travado
  g('portaria-modal').classList.remove('hidden');
  setTimeout(function(){ g('portaria-agente').focus(); }, 60);
}

function closePortariaModal() {
  g('portaria-modal').classList.add('hidden');
  S.portariaTarget = null;
}

async function confirmarSaidaExec() {
  var agente = tr(g('portaria-agente').value);
  if (!agente) { toast('Informe o nome do agente de portaria.','warning'); return; }

  var idx = -1;
  for(var i=0;i<S.orders.length;i++){ if(S.orders[i].numCarga === S.portariaTarget){ idx=i; break; } }
  if (idx < 0) { toast('Ordem não encontrada.','error'); return; }

  var liberadoEm = new Date().toLocaleString('pt-BR');
  var numCargaTarget = S.portariaTarget;

  // Atualiza localmente
  S.orders[idx].status     = STATUS.LIBERADO;
  S.orders[idx].agenteName = agente;
  S.orders[idx].liberadoEm = liberadoEm;
  saveLS('orders');
  updatePortariaBadge();
  registrarAuditoria('SAIDA_LIBERADA', 'ordem', numCargaTarget, { agente: agente, liberadoEm: liberadoEm });
  closePortariaModal();
  renderPortaria();
  toast('Saída confirmada! OS ' + numCargaTarget + ' liberada com sucesso.','success');

  // Atualiza no Supabase (Realtime notificara os outros navegadores)
  try {
    var { error } = await supabaseClient
      .from('ordens')
      .update({ status: STATUS.LIBERADO, agente_nome: agente, liberado_em: liberadoEm })
      .eq('num_carga', numCargaTarget);
    if (error) {
      console.error('Erro ao atualizar ordem no Supabase:', resumirErroPostgrest(error));
      toast('Status atualizado localmente. Falha ao sincronizar com banco.', 'warning');
    }
  } catch(err) {
    console.error('Excecao ao atualizar no Supabase:', err);
  }
}

// ─── EXCLUIR ORDEM (apenas Administrador) ─────────────────────────────────────

async function excluirOrdem(numCarga) {
  // Dupla verificacao de seguranca no lado cliente
  if (!podeExcluirOrdem()) {
    toast('Apenas o Administrador pode excluir ordens.', 'error');
    return;
  }

  if (!confirm('Tem certeza que deseja EXCLUIR a ordem ' + numCarga + '? Esta ação não pode ser desfeita.')) return;

  // Auditoria ANTES de remover (único rastro após o delete)
  (function(){
    var alvo = null;
    for (var k = 0; k < S.orders.length; k++) {
      if (S.orders[k].numCarga === numCarga) { alvo = S.orders[k]; break; }
    }
    registrarAuditoria('ORDEM_EXCLUIDA', 'ordem', numCarga, alvo ? {
      placa: alvo.placa, consignatario: alvo.consignatario,
      motorista: alvo.motorista, status: alvo.status
    } : null);
  })();

  // Remove localmente
  S.orders = S.orders.filter(function(o){ return o.numCarga !== numCarga; });
  saveLS('orders');
  updateBadge();
  updatePortariaBadge();
  renderPortaria();
  toast('Ordem ' + numCarga + ' excluída com sucesso.', 'success');

  // Exclui no Supabase
  try {
    var { error } = await supabaseClient
      .from('ordens')
      .delete()
      .eq('num_carga', numCarga);
    if (error) {
      console.error('Erro ao excluir ordem no Supabase:', resumirErroPostgrest(error));
      toast('Removido localmente. Falha ao excluir do banco.', 'warning');
    }
  } catch(err) {
    console.error('Excecao ao excluir no Supabase:', err);
  }
}

function openHistoryModal() {
  var content = g('history-content');
  var empty   = g('history-empty');

  if (S.orders.length === 0) {
    content.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    content.innerHTML = S.orders.map(function(o,i){
      var statusBadge = badgeStatus(o.status);
      return '<div class="flex items-center gap-3 p-3 bg-slate-50 hover:bg-blue-50 rounded-xl border border-gray-100 cursor-pointer transition group" onclick="reloadOrder('+i+')">' +
        '<div class="w-10 h-10 rounded-xl bg-navy-600 flex items-center justify-center flex-shrink-0">' +
          '<svg class="w-5 h-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>' +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-bold text-navy-700">'+x(o.numCarga)+'</p>' +
          '<p class="text-xs text-gray-500 truncate">'+x(o.consignatario)+' - Placa: '+x(o.placa)+'</p>' +
        '</div>' +
        '<div class="text-right flex flex-col items-end gap-1">' +
          statusBadge + marcaSync(o.numCarga) +
          '<p class="text-xs text-gray-400">'+x(o.emitidoEm)+'</p>' +
          '<p class="text-xs text-blue-500 opacity-0 group-hover:opacity-100 transition font-medium">Reabrir</p>' +
        '</div>' +
        '</div>';
    }).join('');
  }
  g('history-modal').classList.remove('hidden');
}

function closeHistoryModal() { g('history-modal').classList.add('hidden'); }

function reloadOrder(i) {
  var o = S.orders[i];
  if (!o) return;
  closeHistoryModal(); switchTab('emit');

  var fm = function(id, val){ var el = g(id); if(el) el.value = val||''; };
  fm('f-num-carga', o.numCarga);
  g('order-number-display').textContent = o.numCarga||'--';
  fm('f-portao',o.portao); fm('f-armazem',o.armazem);

  // Preserva valores antigos fora da lista atual (ex.: armazém em texto livre)
  garantirOpcao(g('f-armazem'), o.armazem, '(antigo)');
  fm('f-tipo-emissor',o.tipoEmissor); fm('f-consignatario',o.consignatario);
  fm('f-navio',o.navio); fm('f-placa',o.placa);
  fm('f-motorista',o.motorista); fm('f-documento',o.documento);
  fm('f-data-descarga',o.dataDescarga); fm('f-doc-importacao',o.docImportacao);
  fm('f-cidade',o.cidade||'Ilhéus - BA'); fm('f-container-num',o.containerNum);
  fm('f-container-tara',o.containerTara); fm('f-container-codigo',o.containerCod);
  fm('f-obs',o.obs); fm('f-responsavel',o.responsavel);

  garantirOpcao(g('f-carro'), o.carro);

  g('items-tbody').innerHTML = ''; S.rowId = 0;
  (o.items||[]).forEach(function(it){ addItemRow(it); });
  calcTotals();
  setTipoCarga(o.tipoCarga || 'mercadoria');
  toast('Ordem carregada para visualização/reimpressão.','info');
}

function clearHistory() {
  if (!confirm('Limpar todo o histórico de ordens?')) return;
  S.orders=[]; saveLS('orders'); updateBadge(); updatePortariaBadge(); closeHistoryModal();
  toast('Histórico limpo.','info');
}

function updateBadge() {
  var b = g('order-count-badge');
  var n = S.orders.length;
  b.textContent = n;
  b.classList.toggle('hidden', n===0);
  b.classList.toggle('flex', n>0);
}

function clearForm() {
  if (!confirm('Limpar o formulário? Dados não salvos serão perdidos.')) return;
  document.querySelectorAll('#pane-emit input:not([readonly]):not([disabled]),#pane-emit select:not([disabled]),#pane-emit textarea:not([readonly]):not([disabled])')
    .forEach(function(el){ el.value=''; });
  g('items-tbody').innerHTML=''; S.rowId=0;
  checkEmpty(); calcTotals(); setToday(); setCidadeDefault(); preReservarNumeroOS(); refreshCarroSelect();
  aplicarIdentidadeUsuario();
  setTipoCarga('mercadoria');
  toast('Formulário limpo.','info');
}

function toast(msg, type) {
  type = type||'info';
  var colors = {success:'#16a34a',error:'#dc2626',warning:'#d97706',info:'#1a3a6e'};
  var icons  = {success:'V',error:'X',warning:'!',info:'i'};
  var el = document.createElement('div');
  el.className = 'toast pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-white text-sm font-medium max-w-xs';
  el.style.background = colors[type]||colors.info;
  el.innerHTML = '<span style="font-size:1rem;line-height:1">'+(icons[type]||'i')+'</span><span>'+x(msg)+'</span>';
  g('toast-container').appendChild(el);
  setTimeout(function(){ el.remove(); }, 3400);
}

// ─── IDENTIDADE DO USUÁRIO (campos automáticos e travados) ───────────────────
// Tipo de Emissor  = PERFIL do usuário logado (ex.: "Emissor (Fiel/Tecnico)")
// Responsável      = NOME do usuário logado
// Agente Portaria  = NOME do usuário logado

// Preenche e trava: Tipo de Emissor + Responsável (aba Emitir)
// e Agente da Portaria (modal da portaria) com os dados do login.
function aplicarIdentidadeUsuario() {
  var u = S.currentUser;
  if (!u) return;

  var tem = g('f-tipo-emissor');
  if (tem) {
    tem.value = u.perfil || '';
    tem.readOnly = true;
    tem.style.cursor = 'not-allowed';
    tem.title = 'Preenchido automaticamente com o seu perfil de acesso';
  }

  var resp = g('f-responsavel');
  if (resp) {
    resp.value = u.nome || '';
    resp.readOnly = true;
    resp.style.cursor = 'not-allowed';
    resp.title = 'Preenchido automaticamente com o seu nome de usuário';
  }

  var ag = g('portaria-agente');
  if (ag) {
    ag.value = u.nome || '';
    ag.readOnly = true;
    ag.style.cursor = 'not-allowed';
    ag.title = 'Preenchido automaticamente com o seu nome de usuário';
  }
}

function g(id)  { return document.getElementById(id); }

// ─── TEMA CLARO/ESCURO ──────────────────────────────────────────────────────

function aplicarTema(t, salvar) {
  var dark = (t === 'dark');
  document.documentElement.classList.toggle('dark', dark);
  try { document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; } catch(e){}
  if (salvar !== false) {
    try { localStorage.setItem('codeba_theme', dark ? 'dark' : 'light'); } catch(e){}
  }
  atualizarIconeTema();
}

function alternarTema() {
  aplicarTema(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
}

function atualizarIconeTema() {
  var dark = document.documentElement.classList.contains('dark');
  document.querySelectorAll('[data-theme-icon="moon"]').forEach(function(el){ el.classList.toggle('hidden', dark); });
  document.querySelectorAll('[data-theme-icon="sun"]').forEach(function(el){ el.classList.toggle('hidden', !dark); });
  var t = g('theme-toggle');
  if (t) t.title = dark ? 'Mudar para tema claro' : 'Mudar para tema escuro';
}
function x(s)   { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function tr(s)  { return (s||'').trim(); }
function fn(v,d){ var n=parseFloat(v); return isNaN(n)||n===0?(d===2?'0,00':'0,000'):n.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fd(s)  { if(!s)return'--'; var p=s.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }

// ─── CONSTANTES DE DOMÍNIO ──────────────────────────────────────────────────
// Status possíveis de uma ordem. Usar STATUS.* em vez do texto corrido evita
// erros de digitação e facilita mudar o texto em um só lugar.
const STATUS = {
  PENDENTE: 'Aguardando Portaria',
  LIBERADO: 'Liberado'
};

// Selo de situação usado nas tabelas (portaria, histórico, relatório).
function badgeStatus(status) {
  return status === STATUS.LIBERADO
    ? '<span class="badge-done">Liberado</span>'
    : '<span class="badge-pending">Aguardando</span>';
}

// Garante que um <select> tenha a opção antes de selecioná-la (evita valor
// invisível ao reabrir ordens antigas com valores fora da lista atual).
function garantirOpcao(sel, valor, rotuloAntigo) {
  if (!sel || !valor) return;
  var found = false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === valor) { found = true; break; }
  }
  if (!found) {
    var opt = document.createElement('option');
    opt.value = valor;
    opt.textContent = rotuloAntigo ? (valor + ' ' + rotuloAntigo) : valor;
    sel.appendChild(opt);
  }
  sel.value = valor;
}


// ─── AUDITORIA (quem fez o quê e quando) ─────────────────────────────────────
// Ações: LOGIN, LOGOUT, ORDEM_EMITIDA, ORDEM_IMPRESSA, SAIDA_LIBERADA,
//        ORDEM_EXCLUIDA, USUARIO_CRIADO, USUARIO_REMOVIDO.
// Fire-and-forget: registra em segundo plano e NUNCA bloqueia a operação.
// Sem rede, empilha em localStorage (codeba_audit_queue) e reenvia depois.
const LS_AUDIT_QUEUE = 'codeba_audit_queue';

function contextoAuditoria() {
  var u = S.currentUser || {};
  return {
    usuario_nome: u.nome || null,
    usuario_login: u.login || null,
    usuario_perfil: u.perfil || null
  };
}

function lerFilaAuditoria() {
  try {
    var q = JSON.parse(localStorage.getItem(LS_AUDIT_QUEUE) || '[]');
    return Array.isArray(q) ? q : [];
  } catch(e) { return []; }
}

function registrarAuditoria(acao, entidade, entidadeId, detalhes) {
  try {
    var reg = contextoAuditoria();
    reg.acao = acao;
    reg.entidade = entidade || null;
    reg.entidade_id = entidadeId || null;
    reg.detalhes = detalhes || null;
    var q = lerFilaAuditoria();
    q.push(reg);
    localStorage.setItem(LS_AUDIT_QUEUE, JSON.stringify(q));
  } catch(e) { console.warn('auditoria (fila):', e); }
  descarregarFilaAuditoria();
}

var _descarregandoAuditoria = false;

async function descarregarFilaAuditoria() {
  if (_descarregandoAuditoria) return;
  _descarregandoAuditoria = true;
  try {
    var q = lerFilaAuditoria();
    if (!q.length) return;
    var restantes = [];
    for (var i = 0; i < q.length; i++) {
      try {
        var r = await supabaseClient.from('auditoria').insert([q[i]]);
        if (r && r.error) restantes.push(q[i]);
      } catch(e) { restantes.push(q[i]); }
    }
    try { localStorage.setItem(LS_AUDIT_QUEUE, JSON.stringify(restantes)); } catch(e){}
  } catch(e) {
    console.warn('auditoria:', e);
  } finally {
    _descarregandoAuditoria = false;
  }
}

// Selo colorido por tipo de ação na tela de auditoria.
function badgeAcaoAuditoria(acao) {
  var verde = ['LOGIN','ORDEM_EMITIDA','ORDEM_IMPRESSA','SAIDA_LIBERADA','USUARIO_CRIADO'];
  var vermelho = ['ORDEM_EXCLUIDA','USUARIO_REMOVIDO'];
  var cls = verde.indexOf(acao) >= 0 ? 'badge-done'
    : (vermelho.indexOf(acao) >= 0 ? 'badge-danger' : 'badge-pending');
  return '<span class="'+cls+'">'+x(acao || '--').replace(/_/g,' ')+'</span>';
}

function fmtDataHoraBR(iso) {
  if (!iso) return '--';
  try {
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  } catch(e) { return iso; }
}

function linhaAuditoria(r) {
  var det = '';
  try { det = r.detalhes ? x(JSON.stringify(r.detalhes)) : '<span class="text-gray-400">--</span>'; }
  catch(e) { det = '<span class="text-gray-400">--</span>'; }
  return '<tr class="border-b border-gray-100 hover:bg-blue-50 transition">' +
    '<td class="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">' + fmtDataHoraBR(r.criado_em) + '</td>' +
    '<td class="px-4 py-2.5 text-sm font-medium text-gray-800">' + x(r.usuario_nome) + '</td>' +
    '<td class="px-4 py-2.5 text-xs text-gray-500">' + x(r.usuario_perfil) + '</td>' +
    '<td class="px-4 py-2.5">' + badgeAcaoAuditoria(r.acao) + '</td>' +
    '<td class="px-4 py-2.5 font-mono text-xs font-semibold text-navy-700">' + x(r.entidade_id) + '</td>' +
    '<td class="px-4 py-2.5 text-xs text-gray-600 font-mono truncate max-w-xs" title="' + det + '">' + det + '</td>' +
    '</tr>';
}

// Consulta a auditoria com os filtros da tela (padrão: últimos 30 dias).
async function carregarAuditoria() {
  if (!S._auditInit) {
    var hoje = new Date(), ini = new Date();
    ini.setDate(hoje.getDate() - 30);
    var iso = function(d){ return d.toISOString().slice(0,10); };
    if (g('f-aud-data-ini') && !g('f-aud-data-ini').value) g('f-aud-data-ini').value = iso(ini);
    if (g('f-aud-data-fim') && !g('f-aud-data-fim').value) g('f-aud-data-fim').value = iso(hoje);
    S._auditInit = true;
  }
  var tbody = g('audit-tbody'), empty = g('audit-empty');
  var mostraVazio = function(msg){
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    if (msg) empty.querySelector('p').textContent = msg;
  };
  try {
    var q = supabaseClient.from('auditoria').select('*').order('criado_em', { ascending: false }).limit(200);
    var di = g('f-aud-data-ini') ? g('f-aud-data-ini').value : '';
    var df = g('f-aud-data-fim') ? g('f-aud-data-fim').value : '';
    var ac = g('f-aud-acao') ? g('f-aud-acao').value : '';
    var us = g('f-aud-usuario') ? tr(g('f-aud-usuario').value) : '';
    var os = g('f-aud-os') ? tr(g('f-aud-os').value) : '';
    if (di) q = q.gte('criado_em', di + 'T00:00:00');
    if (df) q = q.lte('criado_em', df + 'T23:59:59');
    if (ac) q = q.eq('acao', ac);
    if (us) q = q.or('usuario_nome.ilike.%' + us + '%,usuario_login.ilike.%' + us + '%');
    if (os) q = q.eq('entidade_id', os);
    var res = await q;
    if (res.error) throw res.error;
    var rows = res.data || [];
    if (!rows.length) { mostraVazio('Nenhum registro encontrado com os filtros aplicados.'); return; }
    empty.classList.add('hidden');
    tbody.innerHTML = rows.map(linhaAuditoria).join('');
    g('audit-count-badge').textContent = rows.length;
  } catch(err) {
    console.error('Erro ao carregar auditoria:', err);
    mostraVazio('Não foi possível carregar. Verifique se a tabela "auditoria" foi criada no Supabase (veja a Ajuda).');
  }
}

// ─── ABA RELATORIOS ───────────────────────────────────────────────────────────

function iniciarFiltrosRelatorio() {
  // Popula dropdown de consignatarios (unicos das ordens + cadastros)
  var consigSet = new Set(S.consig);
  S.orders.forEach(function(o){ if(o.consignatario) consigSet.add(o.consignatario); });
  var listConsig = g('dd-consig-list');
  if (listConsig) {
    listConsig.innerHTML = Array.from(consigSet).sort().map(function(c){
      return '<label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm">' +
        '<input type="checkbox" class="chk-consig w-3.5 h-3.5 accent-navy-600" value="'+x(c)+'" onchange="atualizarLabelDropdown(\'consig\')"> '+x(c)+'</label>';
    }).join('') || '<p class="text-xs text-gray-400 text-center py-2">Nenhum consignatario cadastrado.</p>';
  }

  // Popula dropdown de mercadorias (unicas dos itens das ordens + cadastros)
  var mercSet = new Set(S.mercs.map(function(m){ return m.nome; }));
  S.orders.forEach(function(o){
    (o.items||[]).forEach(function(it){ if(it.merc) mercSet.add(it.merc); });
  });
  var listMerc = g('dd-merc-list');
  if (listMerc) {
    listMerc.innerHTML = Array.from(mercSet).sort().map(function(m){
      return '<label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm">' +
        '<input type="checkbox" class="chk-merc w-3.5 h-3.5 accent-emerald-600" value="'+x(m)+'" onchange="atualizarLabelDropdown(\'merc\')"> '+x(m)+'</label>';
    }).join('') || '<p class="text-xs text-gray-400 text-center py-2">Nenhuma mercadoria cadastrada.</p>';
  }
}

function toggleDropdown(id) {
  // Fecha todos os outros dropdowns antes de abrir
  ['dd-consig','dd-merc'].forEach(function(did){
    if (did !== id) { var el = g(did); if(el) el.classList.add('hidden'); }
  });
  var dd = g(id);
  if (dd) dd.classList.toggle('hidden');
}

// Fecha dropdowns ao clicar fora
document.addEventListener('click', function(e) {
  if (!e.target.closest('#dd-consig-wrap') && !e.target.closest('#dd-merc-wrap')) {
    var c = g('dd-consig'); if(c) c.classList.add('hidden');
    var m = g('dd-merc');   if(m) m.classList.add('hidden');
  }
});

function atualizarLabelDropdown(tipo) {
  var selecionados = Array.from(document.querySelectorAll('.chk-'+tipo+':checked')).map(function(el){ return el.value; });
  var label = g('dd-'+tipo+'-label');
  if (!label) return;
  if (selecionados.length === 0) {
    label.textContent = tipo === 'consig' ? 'Todos os consignatarios' : 'Todas as mercadorias';
    label.classList.add('text-gray-500');
    label.classList.remove('text-navy-700','font-semibold');
  } else {
    label.textContent = selecionados.length === 1 ? selecionados[0] : selecionados.length + ' selecionados';
    label.classList.remove('text-gray-500');
    label.classList.add('text-navy-700','font-semibold');
  }
}

function limparFiltros() {
  document.querySelectorAll('.chk-consig,.chk-merc').forEach(function(el){ el.checked = false; });
  atualizarLabelDropdown('consig');
  atualizarLabelDropdown('merc');
  var ini = g('f-rel-data-ini'); if(ini) ini.value = '';
  var fim = g('f-rel-data-fim'); if(fim) fim.value = '';
  var sp = g('f-rel-status-pend'); if(sp) sp.checked = true;
  var sl = g('f-rel-status-lib');  if(sl) sl.checked = true;
  var res = g('rel-resultado'); if(res) res.classList.add('hidden');
  S.lastRelatorio = null;
}

// Lê os filtros da tela (seletores normalizados em minúsculas para comparar).
function coletarFiltrosRelatorio() {
  var textos = function(sel){
    return Array.from(document.querySelectorAll(sel+':checked')).map(function(el){ return el.value; });
  };
  var minusc = function(sel){
    return textos(sel).map(function(v){ return v.toLowerCase(); });
  };
  return {
    consigSel: minusc('.chk-consig'),
    mercSel:   minusc('.chk-merc'),
    consigLabels: textos('.chk-consig'),
    mercLabels:   textos('.chk-merc'),
    dataIni: g('f-rel-data-ini') ? g('f-rel-data-ini').value : '',
    dataFim: g('f-rel-data-fim') ? g('f-rel-data-fim').value : '',
    incPend: g('f-rel-status-pend') ? g('f-rel-status-pend').checked : true,
    incLib:  g('f-rel-status-lib')  ? g('f-rel-status-lib').checked  : true
  };
}

// Aplica os filtros sobre as ordens (pura: não toca na tela).
function filtrarOrdensRelatorio(f) {
  return S.orders.filter(function(o) {
    if (o.status === STATUS.PENDENTE && !f.incPend) return false;
    if (o.status === STATUS.LIBERADO && !f.incLib)  return false;
    if (f.consigSel.length > 0 && !f.consigSel.includes((o.consignatario||'').toLowerCase())) return false;
    if (f.dataIni && o.dataDescarga && o.dataDescarga < f.dataIni) return false;
    if (f.dataFim && o.dataDescarga && o.dataDescarga > f.dataFim) return false;
    // Mercadoria: a ordem precisa ter ao menos 1 item da lista selecionada
    if (f.mercSel.length > 0) {
      var temMerc = (o.items||[]).some(function(it){
        return f.mercSel.includes((it.merc||'').toLowerCase());
      });
      if (!temMerc) return false;
    }
    return true;
  });
}

// Soma quantidade/peso/valor por ordem e agrega por mercadoria (pura).
// Retorna { linhas, grandQtd, grandPeso, grandValor, mercMap }.
function calcularTotaisRelatorio(ordens, mercSel) {
  var tot = { linhas: [], grandQtd: 0, grandPeso: 0, grandValor: 0, mercMap: {} };
  tot.linhas = ordens.map(function(o) {
    var itens = mercSel.length > 0
      ? (o.items||[]).filter(function(it){ return mercSel.includes((it.merc||'').toLowerCase()); })
      : (o.items||[]);
    var soma = function(k){ return itens.reduce(function(s,it){ return s + (parseFloat(it[k])||0); }, 0); };
    var l = { ordem: o, qtd: soma('qtd'), peso: soma('pesoTot'), valor: soma('valor') };
    tot.grandQtd   += l.qtd;
    tot.grandPeso  += l.peso;
    tot.grandValor += l.valor;
    itens.forEach(function(it) {
      var nome = it.merc || '(sem nome)';
      if (!tot.mercMap[nome]) tot.mercMap[nome] = { qtd:0, peso:0, valor:0 };
      tot.mercMap[nome].qtd   += (parseFloat(it.qtd)||0);
      tot.mercMap[nome].peso  += (parseFloat(it.pesoTot)||0);
      tot.mercMap[nome].valor += (parseFloat(it.valor)||0);
    });
    return l;
  });
  return tot;
}

// Linha da tabela de ordens (pura).
function linhaOrdemRelatorio(l) {
  var o = l.ordem;
  return '<tr class="border-b border-gray-100 hover:bg-blue-50 transition">' +
    '<td class="px-4 py-2.5 font-bold text-navy-700 text-sm">'  + x(o.numCarga) + '</td>' +
    '<td class="px-4 py-2.5 text-sm text-gray-600">'            + fd(o.dataDescarga) + '</td>' +
    '<td class="px-4 py-2.5 text-sm text-gray-700">'            + x(o.consignatario) + '</td>' +
    '<td class="px-4 py-2.5 font-mono text-sm font-semibold">'  + x(o.placa) + '</td>' +
    '<td class="px-4 py-2.5 text-sm text-gray-700">'            + x(o.motorista) + '</td>' +
    '<td class="px-4 py-2.5">'                                   + badgeStatus(o.status) + marcaSync(o.numCarga) + '</td>' +
    '<td class="px-4 py-2.5 text-right text-sm font-semibold text-gray-700">' + l.qtd.toLocaleString('pt-BR') + '</td>' +
    '<td class="px-4 py-2.5 text-right text-sm font-semibold text-gray-700">' + l.peso.toLocaleString('pt-BR',{minimumFractionDigits:3}) + '</td>' +
    '<td class="px-4 py-2.5 text-right text-sm font-semibold text-gray-700">R$ ' + l.valor.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</td>' +
    '</tr>';
}

// Linha de totais gerais + linhas de mercadorias consolidadas (puras).
function linhaTotaisGeraisRelatorio(tot) {
  return '<tr class="bg-navy-50 font-bold border-t-2 border-navy-300">' +
    '<td class="px-4 py-3 text-navy-700 text-sm" colspan="6">TOTAIS GERAIS</td>' +
    '<td class="px-4 py-3 text-right text-navy-700">' + tot.grandQtd.toLocaleString('pt-BR') + '</td>' +
    '<td class="px-4 py-3 text-right text-navy-700">' + tot.grandPeso.toLocaleString('pt-BR',{minimumFractionDigits:3}) + '</td>' +
    '<td class="px-4 py-3 text-right text-navy-700">R$ ' + tot.grandValor.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</td>' +
    '</tr>';
}

function linhaMercadoriaRelatorio(nome, m) {
  return '<tr class="border-b border-gray-100 hover:bg-emerald-50 transition">' +
    '<td class="px-4 py-2.5 text-sm font-medium text-gray-800">' + x(nome) + '</td>' +
    '<td class="px-4 py-2.5 text-right text-sm font-semibold text-gray-700">' + m.qtd.toLocaleString('pt-BR') + '</td>' +
    '<td class="px-4 py-2.5 text-right text-sm font-semibold text-gray-700">' + m.peso.toLocaleString('pt-BR',{minimumFractionDigits:3}) + '</td>' +
    '<td class="px-4 py-2.5 text-right text-sm font-semibold text-gray-700">R$ ' + m.valor.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</td>' +
    '</tr>';
}

// Cartões de resumo do topo (puro).
function cartoesResumoRelatorio(qtdOrdens, tot) {
  var cards = [
    { label:'Total de Ordens', val: qtdOrdens, icon:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color:'navy' },
    { label:'Qtd. Total', val: tot.grandQtd.toLocaleString('pt-BR'), icon:'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 014-4z', color:'blue' },
    { label:'Peso Total (kg)', val: tot.grandPeso.toLocaleString('pt-BR',{minimumFractionDigits:3}), icon:'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3', color:'amber' },
    { label:'Valor Total (R$)', val: 'R$ '+tot.grandValor.toLocaleString('pt-BR',{minimumFractionDigits:2}), icon:'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color:'emerald' }
  ];
  return cards.map(function(c){
    var bg = { navy:'from-navy-700 to-navy-600', blue:'from-blue-600 to-blue-500', amber:'from-amber-500 to-amber-400', emerald:'from-emerald-600 to-emerald-500' }[c.color] || 'from-navy-700 to-navy-600';
    return '<div class="bg-gradient-to-br '+bg+' rounded-2xl p-4 text-white shadow-sm">' +
      '<div class="flex items-center gap-3">' +
        '<div class="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">' +
          '<svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="'+c.icon+'"/></svg>' +
        '</div>' +
        '<div>' +
          '<p class="text-white/70 text-xs font-medium">'+c.label+'</p>' +
          '<p class="text-white font-bold text-lg leading-tight">'+c.val+'</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Orquestra: filtrar → calcular → renderizar → guardar para o PDF.
function gerarRelatorio() {
  var f = coletarFiltrosRelatorio();
  if (f.dataIni && f.dataFim && f.dataIni > f.dataFim) {
    toast('Período inválido: a data inicial é maior que a final.','error');
    return;
  }
  var ordens = filtrarOrdensRelatorio(f);
  var tot = calcularTotaisRelatorio(ordens, f.mercSel);

  var rowsHtml = tot.linhas.map(linhaOrdemRelatorio).join('');
  if (ordens.length > 0) rowsHtml += linhaTotaisGeraisRelatorio(tot);

  var mercsHtml = Object.keys(tot.mercMap).sort().map(function(nome){
    return linhaMercadoriaRelatorio(nome, tot.mercMap[nome]);
  }).join('');

  g('rel-totais').innerHTML = cartoesResumoRelatorio(ordens.length, tot);
  g('rel-tbody').innerHTML = rowsHtml;
  g('rel-mercs-tbody').innerHTML = mercsHtml || '<tr><td colspan="4" class="text-center text-xs text-gray-400 py-4">Nenhum item encontrado.</td></tr>';
  g('rel-count-badge').textContent = ordens.length;
  g('rel-empty').classList.toggle('hidden', ordens.length > 0);
  g('rel-resultado').classList.remove('hidden');

  S.lastRelatorio = {
    ordens: ordens,
    mercMap: tot.mercMap,
    grandQtd: tot.grandQtd,
    grandPeso: tot.grandPeso,
    grandValor: tot.grandValor,
    filtros: {
      consignatarios: f.consigLabels,
      mercadorias: f.mercLabels,
      dataIni: f.dataIni,
      dataFim: f.dataFim,
      incPend: f.incPend,
      incLib: f.incLib
    }
  };

  g('rel-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

var _logoCodebaCache = null;
function carregarLogoCodeba() {
  if (_logoCodebaCache) return Promise.resolve(_logoCodebaCache);
  return new Promise(function(resolve){
    var done = false;
    var finish = function(val){ if(!done){ done = true; resolve(val); } };
    try {
      var img = new Image();
      img.onload = function(){
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth || 600;
          c.height = img.naturalHeight || 140;
          c.getContext('2d').drawImage(img, 0, 0);
          _logoCodebaCache = c.toDataURL('image/png');
          finish(_logoCodebaCache);
        } catch(e){ finish(null); }
      };
      img.onerror = function(){ finish(null); };
      img.src = 'assets/img/logo-codeba.png';
      setTimeout(function(){ finish(_logoCodebaCache); }, 3000);
    } catch(e){ finish(null); }
  });
}

// ─── PDF DO RELATÓRIO (blocos de construção) ─────────────────────────────────

function fmtNum(v, d){ return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:d, maximumFractionDigits:d}); }

function somarItensOrdem(o) {
  var itens = o.items || [];
  var soma = function(k){ return itens.reduce(function(s,it){ return s + (parseFloat(it[k])||0); }, 0); };
  return { qtd: soma('qtd'), peso: soma('pesoTot'), valor: soma('valor') };
}

function linhaOrdemPDF(o) {
  var t = somarItensOrdem(o);
  return [
    o.numCarga || '--',
    o.dataDescarga ? fd(o.dataDescarga) : '--',
    o.consignatario || '--',
    o.placa || '--',
    o.motorista || '--',
    o.status || '--',
    t.qtd.toLocaleString('pt-BR'),
    fmtNum(t.peso, 3),
    fmtNum(t.valor, 2)
  ];
}

// Cabeçalho: logo oficial + título + linha divisória.
async function desenharCabecalhoPDF(doc, pageW, R, PDF, agora) {
  var emitidoEm = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});

  var logoDataUrl = await carregarLogoCodeba();
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', 14, 5, 60, 13); } catch(e) { logoDataUrl = null; }
  }
  if (!logoDataUrl) {
    // Fallback em texto caso a imagem não carregue (ex.: file:// sem acesso)
    doc.setTextColor.apply(doc, PDF.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('CODEBA', 14, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('AUTORIDADE PORTUARIA', 14, 16);
  }

  doc.setTextColor.apply(doc, PDF.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Relatório de Ordens de Saída de Carga', pageW - 14, 9, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('CODEBA - Porto de Ilhéus', pageW - 14, 14, { align: 'right' });
  doc.setFontSize(8);
  doc.text('Emitido em: ' + emitidoEm + '   |   Total de ordens: ' + R.ordens.length, pageW - 14, 18, { align: 'right' });

  doc.setDrawColor.apply(doc, PDF.navy);
  doc.setLineWidth(0.8);
  doc.line(PDF.margem, 22, pageW - PDF.margem, 22);
}

// Filtros + resumo. Retorna o Y onde a primeira tabela deve começar.
function desenharResumoPDF(doc, pageW, R) {
  var y = 28;
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Filtros aplicados:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  var f = R.filtros;
  var filtrosTxt = 'Consignatário: ' + (f.consignatarios.length ? f.consignatarios.join(', ') : 'Todos')
    + '  |  Mercadoria: ' + (f.mercadorias.length ? f.mercadorias.join(', ') : 'Todas')
    + '  |  Período: ' + (f.dataIni ? fd(f.dataIni) : '...') + ' a ' + (f.dataFim ? fd(f.dataFim) : '...')
    + '  |  Status: ' + [(f.incPend ? 'Aguardando' : null), (f.incLib ? 'Liberado' : null)].filter(Boolean).join(' + ');
  var linhas = doc.splitTextToSize(filtrosTxt, pageW - 28);
  doc.text(linhas, 14, y + 5);
  y += 5 + (linhas.length * 4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Resumo:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  var resumo = 'Ordens: ' + R.ordens.length
    + '   |   Qtd. Total: ' + R.grandQtd.toLocaleString('pt-BR')
    + '   |   Peso Total: ' + R.grandPeso.toLocaleString('pt-BR', {minimumFractionDigits:3}) + ' kg'
    + '   |   Valor Total: R$ ' + R.grandValor.toLocaleString('pt-BR', {minimumFractionDigits:2});
  doc.text(resumo, 14, y + 5);
  return y + 11;
}

function tabelaOrdensPDF(doc, R, y, PDF, tableMargin) {
  doc.autoTable({
    startY: y,
    margin: tableMargin,
    tableWidth: 'auto',
    head: [['Nº OS', 'Data Descarga', 'Consignatário', 'Placa', 'Motorista', 'Status', 'Qtd.', 'Peso (kg)', 'Valor (R$)']],
    body: R.ordens.map(linhaOrdemPDF),
    foot: [[
      { content: 'TOTAIS GERAIS', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: R.grandQtd.toLocaleString('pt-BR'), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: fmtNum(R.grandPeso, 3), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: fmtNum(R.grandValor, 2), styles: { halign: 'right', fontStyle: 'bold' } }
    ]],
    styles: { fontSize: 7, cellPadding: 2, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: PDF.navy, textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    footStyles: { fillColor: [232, 237, 245], textColor: PDF.navy },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 22 },
      1: { halign: 'center', cellWidth: 24 },
      2: { halign: 'left',   cellWidth: 52 },
      3: { halign: 'center', cellWidth: 24 },
      4: { halign: 'left',   cellWidth: 45 },
      5: { halign: 'center', cellWidth: 26 },
      6: { halign: 'right',  cellWidth: 24 },
      7: { halign: 'right',  cellWidth: 26 },
      8: { halign: 'right',  cellWidth: 26 }
    }
  });
}

function tabelaMercadoriasPDF(doc, R, PDF, tableMargin) {
  var mercNomes = Object.keys(R.mercMap || {}).sort();
  if (mercNomes.length === 0) return;
  var pageH = doc.internal.pageSize.getHeight();
  var y2 = doc.lastAutoTable.finalY + 8;
  if (y2 > pageH - 30) { doc.addPage(); y2 = 20; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor.apply(doc, PDF.navyEscuro);
  doc.text('Mercadorias Consolidadas', 14, y2);
  doc.autoTable({
    startY: y2 + 3,
    margin: tableMargin,
    tableWidth: 'auto',
    head: [['Mercadoria', 'Qtd. Total', 'Peso Total (kg)', 'Valor Total (R$)']],
    body: mercNomes.map(function(nome){
      var m = R.mercMap[nome];
      return [nome, m.qtd.toLocaleString('pt-BR'), fmtNum(m.peso, 3), fmtNum(m.valor, 2)];
    }),
    styles: { fontSize: 7, cellPadding: 2, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [4, 120, 87], textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    alternateRowStyles: { fillColor: [236, 253, 245] },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right', cellWidth: 40 },
      2: { halign: 'right', cellWidth: 40 },
      3: { halign: 'right', cellWidth: 40 }
    }
  });
}

// Rodapé desenhado UMA única vez ao final (evita texto duplicado/sobreposto
// que ocorria ao usar didDrawPage nas duas tabelas).
function desenharRodapePDF(doc, pageW, PDF) {
  var totalPgs = doc.internal.getNumberOfPages();
  for (var pg = 1; pg <= totalPgs; pg++) {
    doc.setPage(pg);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor.apply(doc, PDF.cinza);
    doc.text('CODEBA - Sistema de Ordem de Saída de Carga | Página ' + pg + ' de ' + totalPgs, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });
  }
}

async function exportarRelatorioPDF() {
  if (!S.lastRelatorio || !S.lastRelatorio.ordens || S.lastRelatorio.ordens.length === 0) {
    toast('Gere o relatório com resultados antes de exportar.', 'warning');
    return;
  }
  if (!window.jspdf) {
    toast('Biblioteca de PDF não carregada. Verifique a conexão.', 'error');
    return;
  }
  try {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var R = S.lastRelatorio;
    var pageW = doc.internal.pageSize.getWidth();
    // Identidade visual do PDF em um só lugar (cores e margem em mm)
    var PDF = { margem: 14, navy: [26, 58, 110], navyEscuro: [20, 45, 87], cinza: [130, 130, 130] };
    var tableMargin = { top: 26, left: PDF.margem, right: PDF.margem, bottom: PDF.margem };
    var agora = new Date();

    await desenharCabecalhoPDF(doc, pageW, R, PDF, agora);
    var y = desenharResumoPDF(doc, pageW, R);
    tabelaOrdensPDF(doc, R, y, PDF, tableMargin);
    tabelaMercadoriasPDF(doc, R, PDF, tableMargin);
    desenharRodapePDF(doc, pageW, PDF);

    var stamp = agora.toISOString().slice(0,10).replace(/-/g,'');
    doc.save('relatorio-CODEBA-' + stamp + '.pdf');
    toast('Relatório exportado em PDF.', 'success');
  } catch (err) {
    console.error('Erro ao exportar PDF:', err);
    toast('Erro ao gerar PDF. Tente novamente.', 'error');
  }
}

// ─── FIM ABA RELATORIOS ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function(){
  init();
  atualizarIconeTema();
  setTipoCarga('mercadoria');
});
