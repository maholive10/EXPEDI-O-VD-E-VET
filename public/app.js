/* Expedição VD / VET — CD Barueri */
'use strict';

// ================= estado e utilidades =================
const S = {
  token: lsGet('exp_token'),
  boot: null,
  view: 'painel',
  data: { vd: null, vet: null },
  filtros: { painel: { tipo: 'TODOS', sit: 'TODOS', q: '' }, vd: { st: '', tr: '', q: '' }, vet: { st: '', tr: '', q: '' } },
  vetAba: 'rotas',
  hist: { aba: 'VD', de: null, ate: null, st: '', tr: '', q: '' },
  cad: 'posicoes',
  upTipo: 'VD',
  cache: {},
};
const LEVEL = { operacao: 0, lider: 1, coordenador: 2, admin: 3 };
const ST_LABEL = {
  nao_expedido: 'Não expedido', pendente: 'Pendente expedição', em_carregamento: 'Em carregamento', expedido: 'Expedido',
};
const ST_CLASS = { nao_expedido: 'mute', pendente: 'mute', em_carregamento: 'carr', expedido: 'livre' };

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem storage */ } }
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const role = () => S.boot?.user?.role || 'operacao';
const can = (r) => LEVEL[role()] >= LEVEL[r];
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const normRota = (r) => { const s = norm(r); return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s; };
const chave = (r) => `${normRota(r.rota)}|${norm(r.transportadora)}|${norm(r.motorista)}`;
const chaveRT = (r) => `${normRota(r.rota)}|${norm(r.transportadora)}`;
const rotaNum = (r) => parseInt(r.rota, 10) || 0;
const byRota = (a, b) => rotaNum(a) - rotaNum(b) || String(a.rota).localeCompare(String(b.rota)) || a.transportadora.localeCompare(b.transportadora);

const fmtPeso = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtPesoT = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtData = (d) => (d ? d.split('-').reverse().join('/') : '');
const fmtHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const fmtDH = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDHfull = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDias = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const toLocalInput = (iso) => { const d = iso ? new Date(iso) : new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
function duracao(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  if (h < 48) return `${h}h${r ? String(r).padStart(2, '0') : ''}`;
  return `${Math.floor(h / 24)} dias`;
}
function parsePeso(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s); return Number.isFinite(n) ? n : 0;
}
function atrasada(r) {
  if (r.tipo !== 'VD' || !r.previsto || r.status === 'expedido') return false;
  const lim = new Date(`${r.data}T${r.previsto}:00`).getTime() + (S.boot.settings?.toleranciaAtrasoMin || 0) * 60000;
  return Date.now() > lim;
}
const posNome = (id) => S.boot.posicoes.find((p) => p.id === id)?.nome || '';
const posLabel = (id) => { const p = S.boot.posicoes.find((x) => x.id === id); return p ? `${p.tipo === 'DOCA' ? 'Doca' : 'Stage'} ${p.nome}` : ''; };
const colabAtivos = () => S.boot.colaboradores.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
const errosAtivos = () => S.boot.erros.filter((e) => e.ativo).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

async function api(action, body = {}) {
  const res = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  let j = {};
  try { j = await res.json(); } catch { /* vazio */ }
  if (!res.ok) throw new Error(j.error || `Falha na comunicação (${res.status})`);
  return j;
}

let toastT;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, err ? 5000 : 2800);
}
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; }
}

// ================= modal =================
function openModal({ title, body, foot = '', wide = false, onMount }) {
  const root = $('#modalRoot');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-h"><h2>${title}</h2><button class="btn ghost sm" data-close aria-label="Fechar">✕</button></div>
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
  root.appendChild(bg);
  const close = () => { bg.remove(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const m = bg.querySelector('.modal');
  if (onMount) onMount(m, close);
  setTimeout(() => (m.querySelector('[autofocus]') || m.querySelector('input,select,textarea,button:not([data-close])'))?.focus(), 30);
  return { el: m, close };
}
const modalOpen = () => !!$('#modalRoot').children.length;
function confirmBox(msg, okLabel = 'Confirmar') {
  return new Promise((resolve) => {
    let done = false;
    const { close } = openModal({
      title: 'Confirmar',
      body: `<p style="margin:0">${msg}</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn pri" id="cfOk">${okLabel}</button>`,
      onMount: (m, cl) => {
        m.querySelector('#cfOk').onclick = () => { done = true; cl(); resolve(true); };
        const obs = new MutationObserver(() => { if (!m.isConnected) { obs.disconnect(); if (!done) resolve(false); } });
        obs.observe($('#modalRoot'), { childList: true });
      },
    });
    return close;
  });
}
function viewPhoto(url) {
  const v = document.createElement('div'); v.className = 'viewer';
  v.innerHTML = `<img src="${esc(url)}" alt="Foto do documento">`;
  v.onclick = () => v.remove(); document.body.appendChild(v);
}

// ================= componentes =================
// seletor de vários colaboradores
function pickerHTML(id, sel = [], ro = false) {
  if (ro) return `<div class="picker">${sel.length ? sel.map((n) => `<span class="chip ro">${esc(n)}</span>`).join('') : '<span class="muted small">—</span>'}</div>`;
  return `<div class="picker" data-picker="${id}">${sel.map((n) => `<span class="chip" data-v="${esc(n)}">${esc(n)}<button type="button" aria-label="Remover ${esc(n)}">×</button></span>`).join('')}
    <input list="dlColab" placeholder="Digite o nome e tecle Enter" aria-label="Adicionar colaborador"></div>`;
}
function colabDatalist() {
  return `<datalist id="dlColab">${colabAtivos().map((c) => `<option value="${esc(c.nome)}">${esc([c.cargo, c.turno].filter(Boolean).join(' – '))}</option>`).join('')}</datalist>`;
}
function bindPickers(root) {
  $$('[data-picker]', root).forEach((p) => {
    const inp = p.querySelector('input');
    const add = () => {
      const v = norm(inp.value); if (!v) return;
      const c = colabAtivos().find((x) => norm(x.nome) === v) || colabAtivos().find((x) => norm(x.nome).includes(v));
      if (!c) { toast('Colaborador não encontrado na lista de ativos', true); return; }
      if ($$('.chip', p).some((ch) => ch.dataset.v === c.nome)) { inp.value = ''; return; }
      const ch = document.createElement('span'); ch.className = 'chip'; ch.dataset.v = c.nome;
      ch.innerHTML = `${esc(c.nome)}<button type="button" aria-label="Remover">×</button>`;
      p.insertBefore(ch, inp); inp.value = '';
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    inp.addEventListener('change', () => { if (colabAtivos().some((c) => c.nome === inp.value)) add(); });
    p.addEventListener('click', (e) => { if (e.target.matches('.chip button')) e.target.parentElement.remove(); else inp.focus(); });
  });
}
const pickerVal = (root, id) => $$(`[data-picker="${id}"] .chip`, root).map((c) => c.dataset.v);

// erros de separação
function errosHTML(teveErro, erros = [], ro = false) {
  const linhas = (erros.length ? erros : [{}]).map((e) => errRow(e, ro)).join('');
  return `<div class="yn" data-yn>
      <button type="button" class="btn sm y ${teveErro === true ? 'on' : ''}" data-v="1" ${ro ? 'disabled' : ''}>Sim</button>
      <button type="button" class="btn sm n ${teveErro === false ? 'on' : ''}" data-v="0" ${ro ? 'disabled' : ''}>Não</button>
    </div>
    <div data-errs style="display:${teveErro ? 'flex' : 'none'};flex-direction:column;gap:8px">${linhas}
      ${ro ? '' : '<div><button type="button" class="btn sm" data-adderr>+ Adicionar outro erro</button></div>'}</div>`;
}
function errRow(e = {}, ro = false) {
  const opts = errosAtivos();
  if (e.tipoId && !opts.some((o) => o.id === e.tipoId)) opts.push({ id: e.tipoId, nome: e.nome });
  return `<div class="err-row" data-err>
    <label class="f">Tipo de erro<select class="in" data-k="tipo" ${ro ? 'disabled' : ''}><option value="">Selecione…</option>${opts.map((o) => `<option value="${o.id}" ${o.id === e.tipoId ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></label>
    <label class="f">Qtd.<input class="in" type="number" min="1" step="1" data-k="qtd" value="${esc(e.qtd ?? '')}" ${ro ? 'readonly' : ''}></label>
    <label class="f">Observação<input class="in" data-k="obs" value="${esc(e.obs ?? '')}" ${ro ? 'readonly' : ''}></label>
    ${ro ? '<span></span>' : '<button type="button" class="btn sm ghost danger" data-delerr aria-label="Remover erro">✕</button>'}</div>`;
}
function bindErros(root) {
  const yn = $('[data-yn]', root); if (!yn) return;
  yn.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', yn).forEach((x) => x.classList.toggle('on', x === b));
    $('[data-errs]', root).style.display = b.dataset.v === '1' ? 'flex' : 'none';
  });
  root.addEventListener('click', (e) => {
    if (e.target.matches('[data-adderr]')) e.target.parentElement.insertAdjacentHTML('beforebegin', errRow());
    if (e.target.matches('[data-delerr]')) e.target.closest('[data-err]').remove();
  });
}
function errosVal(root) {
  const on = $('[data-yn] button.on', root);
  const teveErro = on ? on.dataset.v === '1' : null;
  const erros = teveErro ? $$('[data-err]', root).map((r) => {
    const id = $('[data-k=tipo]', r).value; if (!id) return null;
    return { tipoId: id, nome: S.boot.erros.find((x) => x.id === id)?.nome || '', qtd: Number($('[data-k=qtd]', r).value) || 1, obs: $('[data-k=obs]', r).value.trim() };
  }).filter(Boolean) : [];
  return { teveErro, erros };
}

// fotos
function fotosHTML(fotos = [], ro = false) {
  return `<div class="photos" data-photos>${fotos.map((f) => phItem(f, ro)).join('')}
    ${ro ? '' : `<label class="ph-add"><input type="file" accept="image/*" capture="environment" multiple hidden data-file>+ Foto<br>(câmera ou arquivo)</label>`}</div>`;
}
const phItem = (f, ro) => `<div class="ph" data-url="${esc(f.url)}" data-em="${esc(f.em || '')}"><img src="${esc(f.url)}" alt="Foto anexada">${ro ? '' : '<button type="button" aria-label="Remover foto">×</button>'}</div>`;
function compress(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600; let { width: w, height: h } = img;
      if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(u);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => reject(new Error('Não foi possível ler a imagem'));
    img.src = u;
  });
}
function bindFotos(root, ctx) {
  const box = $('[data-photos]', root); if (!box) return;
  box.addEventListener('click', (e) => {
    if (e.target.matches('.ph button')) { e.target.parentElement.remove(); return; }
    if (e.target.matches('.ph img')) viewPhoto(e.target.src);
  });
  const inp = $('[data-file]', box);
  inp?.addEventListener('change', async () => {
    for (const file of inp.files) {
      const ph = document.createElement('div'); ph.className = 'ph loading';
      box.insertBefore(ph, inp.parentElement);
      try {
        const dataUrl = await compress(file);
        ph.innerHTML = `<img src="${dataUrl}" alt="">`;
        const r = await api('foto', { dataUrl, tipo: ctx.tipo, data: ctx.data, rotaId: ctx.id });
        ph.outerHTML = phItem(r, false);
      } catch (e) { ph.remove(); toast(e.message, true); }
    }
    inp.value = '';
  });
}
const fotosVal = (root) => $$('[data-photos] .ph:not(.loading)', root).map((p) => ({ url: p.dataset.url, em: p.dataset.em || new Date().toISOString() }));
const fotosEnviando = (root) => $$('[data-photos] .ph.loading', root).length > 0;

function docaOptions(sel, tipoRota) {
  const carregando = new Set((S.cache.painel?.carregando || []).map((c) => c.posicaoId));
  const docas = S.boot.posicoes.filter((p) => p.ativo && p.tipo === 'DOCA').sort((a, b) => a.ordem - b.ordem);
  return `<option value="">Selecione a doca…</option>${docas.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>Doca ${esc(p.nome)}${tipoRota === 'VD' && carregando.has(p.id) && p.id !== sel ? ' (em carregamento)' : ''}</option>`).join('')}`;
}

// ================= navegação =================
const VIEWS = { painel: viewPainel, vd: () => viewExped('VD'), vet: () => viewExped('VET'), upload: viewUpload, historico: viewHistorico, cadastros: viewCadastros };
function route() {
  const v = (location.hash.replace('#/', '') || 'painel').split('?')[0];
  S.view = VIEWS[v] ? v : 'painel';
  $$('.rail a').forEach((a) => a.classList.toggle('on', a.dataset.view === S.view));
  render();
}
async function render() {
  try { await VIEWS[S.view](); } catch (e) { $('#main').innerHTML = `<div class="empty"><b>Não foi possível carregar</b>${esc(e.message)}</div>`; }
}
function updateUser() {
  const u = S.boot.user;
  $('#userLabel').textContent = u ? u.nome.split(' ')[0] : 'Entrar';
  $('#btnUser').title = u ? `${u.nome} (${{ lider: 'Líder', coordenador: 'Coordenador', admin: 'Administrador' }[u.role]}) — clique para sair` : 'Entrar com usuário e senha';
}
function avisos() {
  const a = S.boot.avisos || {}; const out = [];
  if (a.memoria) out.push('Modo de teste: banco de dados não configurado. Configure o Upstash Redis na Vercel para gravar os dados.');
  if (a.senhaPadrao) out.push('O administrador está usando a senha padrão. Defina a variável ADMIN_PASSWORD na Vercel.');
  if (a.semBlob && can('admin')) out.push('Armazenamento de fotos (Vercel Blob) não configurado: as fotos estão sendo gravadas dentro do banco.');
  return out.map((t) => `<div class="notice">${esc(t)}</div>`).join('');
}
function loginModal() {
  if (S.boot.user) {
    confirmBox(`Sair do usuário <b>${esc(S.boot.user.nome)}</b>?`, 'Sair').then(async (ok) => {
      if (!ok) return;
      try { await api('logout'); } catch { /* ignora */ }
      S.token = null; lsSet('exp_token', null); await boot(); toast('Você saiu');
    });
    return;
  }
  openModal({
    title: 'Entrar',
    body: `<p class="small" style="margin:0;color:var(--ink-2)">Líderes, coordenadores e administrador. A operação usa o app sem login.</p>
      <form id="fLogin" class="grid2"><label class="f span2">Usuário<input class="in" name="u" autocomplete="username" autofocus required></label>
      <label class="f span2">Senha<input class="in" name="p" type="password" autocomplete="current-password" required></label>
      <button class="btn pri span2" type="submit">Entrar</button></form>`,
    onMount: (m, close) => {
      $('#fLogin', m).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const r = await run(() => api('login', { usuario: f.u.value, senha: f.p.value }));
        S.token = r.token; lsSet('exp_token', r.token); close(); await boot(); toast(`Bem-vindo, ${r.user.nome}`);
      };
    },
  });
}
function needLogin(minRole, what) {
  return `<div class="card empty"><b>Acesso restrito</b>${esc(what)} é liberado para ${minRole === 'lider' ? 'líder, coordenador e administrador' : minRole === 'coordenador' ? 'coordenador e administrador' : 'o administrador'}.<div style="margin-top:14px"><button class="btn pri" onclick="loginModal()">Entrar</button></div></div>`;
}

// ================= PAINEL DE STAGES E DOCAS =================
async function viewPainel() {
  const main = $('#main');
  if (!S.cache.painel) main.innerHTML = '<div class="spin">Carregando…</div>';
  const p = await api('painel');
  S.cache.painel = p; S.boot.posicoes = p.posicoes;
  const f = S.filtros.painel;
  const hoje = hojeLocal();
  const alertaMs = (S.boot.settings?.alertaStageHoras || 12) * 3600000;
  const agora = Date.now();
  const itens = p.posicoes.filter((x) => x.ativo).sort((a, b) => a.ordem - b.ordem).map((pos) => {
    const res = p.reservas.filter((r) => r.posicaoId === pos.id).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    const car = p.carregando.filter((c) => c.posicaoId === pos.id);
    const sit = car.length ? 'carr' : res.length ? 'ocup' : 'livre';
    const desde = res[0]?.criadoEm;
    const alerta = desde && agora - new Date(desde).getTime() > alertaMs;
    return { pos, res, car, sit, desde, alerta };
  });
  const cnt = (t, s) => itens.filter((i) => (t === 'TODOS' || i.pos.tipo === t) && (!s || i.sit === s)).length;
  const q = norm(f.q);
  const vis = itens.filter((i) => (f.tipo === 'TODOS' || i.pos.tipo === f.tipo)
    && (f.sit === 'TODOS' || i.sit === f.sit || (f.sit === 'alerta' && i.alerta))
    && (!q || norm(i.pos.nome).includes(q) || i.res.some((r) => norm(`${r.rota} ${r.transportadora} ${r.motorista}`).includes(q)) || i.car.some((c) => norm(`${c.rota} ${c.transportadora} ${c.motorista}`).includes(q))));

  const tile = (i) => {
    const lbl = { livre: 'Livre', ocup: 'Ocupado', carr: 'Em carregamento' }[i.sit];
    const lis = [
      ...i.car.map((c) => `<li><span class="tag" style="background:var(--carr-bg);color:var(--carr)">Carregando</span><b>Rota ${esc(c.rota)}</b><span class="t">${esc(c.transportadora || '')}</span></li>`),
      ...i.res.slice(0, 4).map((r) => `<li><b>Rota ${esc(r.rota)}</b><span class="t">${esc(r.transportadora)}</span>${r.data > hoje ? `<span class="tag fut">${fmtData(r.data).slice(0, 5)}</span>` : ''}${!r.rotaId ? '<span class="tag pre">Pré</span>' : ''}</li>`),
      i.res.length > 4 ? `<li class="t">+ ${i.res.length - 4} rota(s)</li>` : '',
    ].join('');
    return `<button class="tile ${i.sit}" data-pos="${i.pos.id}" type="button">
      <div class="head"><div><div class="num">${esc(i.pos.nome)}</div><div class="kind">${i.pos.tipo === 'DOCA' ? 'Doca' : 'Stage'}</div></div><span class="st ${i.sit}">${lbl}</span></div>
      ${lis ? `<ul>${lis}</ul>` : ''}
      ${i.desde ? `<div class="since ${i.alerta ? 'alert' : ''}">${i.alerta ? '⚠ ' : ''}Ocupado há ${duracao(agora - new Date(i.desde).getTime())}</div>` : i.car.length ? `<div class="since">Carregando há ${duracao(agora - new Date(i.car[0].desde).getTime())}</div>` : ''}
    </button>`;
  };
  const grupo = (tipo, nome) => {
    const g = vis.filter((i) => i.pos.tipo === tipo);
    if (!g.length) return '';
    return `<div class="group-h"><h2>${nome}</h2><span>${cnt(tipo, 'livre')} livres de ${cnt(tipo)}</span></div><div class="tiles">${g.map(tile).join('')}</div>`;
  };
  const nAlerta = itens.filter((i) => i.alerta).length;
  main.innerHTML = `${avisos()}
    <div class="topbar"><h1>Stages e docas</h1><span class="grow"></span>
      <div class="legend"><span><i style="background:var(--livre)"></i>Livre</span><span><i style="background:var(--ocup)"></i>Ocupado</span><span><i style="background:var(--carr)"></i>Em carregamento</span></div>
    </div>
    <div class="kpis">
      <div class="kpi livre"><b>${cnt('TODOS', 'livre')}</b><span>Livres</span></div>
      <div class="kpi ocup"><b>${cnt('TODOS', 'ocup')}</b><span>Ocupados</span></div>
      <div class="kpi carr"><b>${cnt('TODOS', 'carr')}</b><span>Em carregamento</span></div>
      <div class="kpi"><b>${cnt('DOCA', 'livre')}/${cnt('DOCA')}</b><span>Docas livres</span></div>
      <div class="kpi"><b>${cnt('STAGE', 'livre')}/${cnt('STAGE')}</b><span>Stages livres</span></div>
      <div class="kpi warn"><b>${nAlerta}</b><span>Ocupados há mais de ${S.boot.settings?.alertaStageHoras || 12}h</span></div>
    </div>
    <div class="filters">
      <div class="seg" data-f="tipo">${['TODOS', 'DOCA', 'STAGE'].map((t) => `<button class="${f.tipo === t ? 'on' : ''}" data-v="${t}">${{ TODOS: 'Todos', DOCA: 'Docas', STAGE: 'Stages' }[t]}</button>`).join('')}</div>
      <div class="seg" data-f="sit">${[['TODOS', 'Todas'], ['livre', 'Livres'], ['ocup', 'Ocupados'], ['carr', 'Carregando'], ['alerta', 'Com alerta']].map(([v, l]) => `<button class="${f.sit === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
      <input class="in search" type="search" placeholder="Buscar stage, doca, rota ou transportadora" value="${esc(f.q)}" id="pQ">
    </div>
    ${grupo('DOCA', 'Docas')}${grupo('STAGE', 'Stages')}
    ${vis.length ? '' : '<div class="card empty"><b>Nada encontrado</b>Ajuste os filtros ou a busca.</div>'}`;
  $$('.seg[data-f]', main).forEach((s) => s.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; f[s.dataset.f] = b.dataset.v; viewPainel();
  }));
  const qi = $('#pQ', main);
  qi.addEventListener('input', () => { f.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { viewPainel().then(() => { const n = $('#pQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); });
  $$('.tile', main).forEach((t) => t.addEventListener('click', () => posModal(t.dataset.pos)));
}

async function posModal(posId) {
  const pos = S.boot.posicoes.find((p) => p.id === posId);
  const p = S.cache.painel;
  const res = p.reservas.filter((r) => r.posicaoId === posId).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const car = p.carregando.filter((c) => c.posicaoId === posId);
  const hoje = hojeLocal();
  let reservaveis = [];
  try { reservaveis = await api('rotasReservaveis'); } catch (e) { toast(e.message, true); }
  const transps = [...new Set(reservaveis.map((r) => r.transportadora))].sort();
  const resHTML = res.length ? res.map((r) => `<div class="res-item">
      <div class="rota">${esc(r.rota)}</div>
      <div class="grow"><b>${esc(r.transportadora)}</b> ${!r.rotaId ? '<span class="tag pre">Pré-reserva</span>' : ''} ${r.data > hoje ? '<span class="tag fut">Expedição futura</span>' : ''}
        <div class="small">Expedição ${fmtData(r.data)}${r.rotaInfo?.motorista || r.motorista ? ' · ' + esc(r.rotaInfo?.motorista || r.motorista) : ''}${r.rotaInfo ? ' · ' + fmtPeso(r.rotaInfo.peso) + ' kg' : ''}</div>
        <div class="small">Reservado ${fmtDH(r.criadoEm)} por ${esc(r.criadoPor)}${r.obs ? ' · ' + esc(r.obs) : ''}</div></div>
      ${r.rotaInfo ? `<span class="st ${ST_CLASS[r.rotaInfo.status]}">${ST_LABEL[r.rotaInfo.status]}</span>` : ''}
      ${can('lider') ? `<button class="btn sm danger" data-lib="${r.id}">Liberar</button>` : ''}
    </div>`).join('') : '<p class="small" style="margin:0;color:var(--ink-2)">Nenhuma rota reservada aqui.</p>';
  const carHTML = car.map((c) => `<div class="res-item" style="border-color:var(--carr)"><div class="rota" style="color:var(--carr)">${esc(c.rota)}</div><div class="grow"><b>Em carregamento</b> · ${esc(c.transportadora || '')}<div class="small">${esc(c.motorista || '')} · chegada ${fmtDH(c.desde)}</div></div></div>`).join('');

  const listaRotas = (filtro = '') => {
    const q = norm(filtro);
    const arr = reservaveis.filter((r) => !q || norm(`${r.rota} ${r.transportadora} ${r.motorista}`).includes(q));
    if (!arr.length) return '<div class="empty" style="padding:20px">Nenhuma rota pendente encontrada. Use a pré-reserva se o arquivo do dia ainda não foi enviado.</div>';
    let dia = ''; let out = '';
    arr.forEach((r) => {
      if (r.data !== dia) { dia = r.data; out += `<div class="pick-day">Expedição ${fmtData(dia)}${dia === hoje ? ' (hoje)' : ''}</div>`; }
      out += `<div class="pick-item" data-rid="${r.id}" data-d="${r.data}" tabindex="0"><span class="rota">${esc(r.rota)}</span><span><b>${esc(r.transportadora)}</b><br><span class="small">${esc(r.motorista)} · ${fmtPeso(r.peso)} kg</span></span>${r.posicaoId ? `<span class="tag">Em ${esc(posLabel(r.posicaoId))}</span>` : ''}</div>`;
    });
    return out;
  };
  openModal({
    title: `${pos.tipo === 'DOCA' ? 'Doca' : 'Stage'} ${esc(pos.nome)}`,
    wide: true,
    body: `${carHTML}<div class="sec-t">Rotas reservadas</div>${resHTML}
      <div class="sec-t">Reservar rota</div>
      <div class="tabs" style="margin-bottom:0"><button class="on" data-rt="sis">Rota do arquivo</button><button data-rt="pre">Pré-reserva (arquivo ainda não enviado)</button></div>
      <div data-pane="sis"><input class="in" type="search" placeholder="Buscar rota, transportadora ou motorista" id="rsQ" style="margin:10px 0"><div class="pick-list" id="rsList">${listaRotas()}</div></div>
      <div data-pane="pre" hidden><div class="grid3" style="margin-top:10px">
        <label class="f">Data da expedição<input class="in" type="date" id="prD" value="${addDias(hoje, 1)}"></label>
        <label class="f">Rota<input class="in" id="prR" inputmode="numeric"></label>
        <label class="f">Transportadora<input class="in" id="prT" list="dlTr"><datalist id="dlTr">${transps.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label></div>
        <p class="small" style="color:var(--ink-2);margin:8px 0 0">Quando o arquivo dessa data for enviado, a rota é vinculada automaticamente pela combinação rota + transportadora.</p></div>
      <label class="f">Observação (opcional)<input class="in" id="rsObs"></label>`,
    foot: `<button class="btn" data-close>Fechar</button><button class="btn pri" id="rsOk">Reservar</button>`,
    onMount: (m, close) => {
      let sel = null; let aba = 'sis';
      $$('[data-rt]', m).forEach((b) => b.onclick = () => {
        aba = b.dataset.rt; $$('[data-rt]', m).forEach((x) => x.classList.toggle('on', x === b));
        $$('[data-pane]', m).forEach((x) => { x.hidden = x.dataset.pane !== aba; });
      });
      const bindList = () => $$('.pick-item', m).forEach((it) => {
        const pick = () => { sel = { id: it.dataset.rid, data: it.dataset.d }; $$('.pick-item', m).forEach((x) => x.classList.toggle('sel', x === it)); };
        it.onclick = pick; it.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
      });
      bindList();
      $('#rsQ', m).oninput = (e) => { $('#rsList', m).innerHTML = listaRotas(e.target.value); sel = null; bindList(); };
      $$('[data-lib]', m).forEach((b) => b.onclick = () => liberarModal(b.dataset.lib, close));
      $('#rsOk', m).onclick = async () => {
        const obs = $('#rsObs', m).value.trim();
        let body;
        if (aba === 'sis') { if (!sel) return toast('Selecione uma rota na lista', true); body = { posicaoId: posId, rotaRef: sel, obs }; } else {
          body = { posicaoId: posId, pre: { data: $('#prD', m).value, rota: $('#prR', m).value, transportadora: $('#prT', m).value }, obs };
        }
        let r = await run(() => api('reservar', body));
        if (r.conflito) {
          const ok = await confirmBox(`Essa rota já está alocada em <b>${esc(r.posicaoAtual)}</b>. Uma rota ocupa só um stage/doca. Deseja <b>mover</b> para ${esc(pos.nome)}?`, 'Mover rota');
          if (!ok) return;
          r = await run(() => api('reservar', { ...body, mover: true }));
        }
        close(); toast(r.vinculada ? 'Pré-reserva criada e já vinculada à rota do arquivo' : 'Rota reservada'); viewPainel();
      };
    },
  });
}
function liberarModal(resId, closeParent) {
  openModal({
    title: 'Liberar manualmente',
    body: `<p style="margin:0">A liberação manual fica registrada com seu usuário. Use para carga cancelada, remanejada ou erro de reserva.</p>
      <label class="f">Motivo<select class="in" id="lbM"><option>Carga cancelada</option><option>Carga remanejada</option><option>Reserva feita por engano</option><option>Outro</option></select></label>
      <label class="f">Detalhe (opcional)<input class="in" id="lbD"></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn pri" id="lbOk">Liberar</button>',
    onMount: (m, close) => {
      $('#lbOk', m).onclick = async () => {
        const motivo = [$('#lbM', m).value, $('#lbD', m).value.trim()].filter(Boolean).join(' – ');
        await run(() => api('liberar', { reservaId: resId, motivo }), 'Stage/doca liberado');
        close(); closeParent?.(); viewPainel();
      };
    },
  });
}

// ================= EXPEDIÇÃO VD / VET =================
async function viewExped(tipo) {
  const k = tipo.toLowerCase();
  const data = S.data[k] || (S.data[k] = hojeLocal());
  const main = $('#main');
  const f = S.filtros[k];
  if (!S.cache[k] || S.cache[k].data !== data) main.innerHTML = '<div class="spin">Carregando…</div>';
  const [r] = await Promise.all([api('rotasDia', { tipo, data }), tipo === 'VD' && !S.cache.painel ? api('painel').then((p) => { S.cache.painel = p; }) : null]);
  S.cache[k] = { data, rotas: r.rotas, alocacao: r.alocacao };
  if (tipo === 'VET' && S.vetAba === 'indicadores') return viewIndicadores(main);
  const rotas = r.rotas.sort(byRota);
  const transps = [...new Set(rotas.map((x) => x.transportadora))].sort();
  const q = norm(f.q);
  const vis = rotas.filter((x) => (!f.st || x.status === f.st || (f.st === 'atrasada' && atrasada(x))) && (!f.tr || x.transportadora === f.tr)
    && (!q || norm(`${x.rota} ${x.motorista} ${x.transportadora}`).includes(q)));
  const c = (s) => rotas.filter((x) => x.status === s).length;
  const nAtr = rotas.filter(atrasada).length;
  const st0 = tipo === 'VD' ? 'nao_expedido' : 'pendente';
  const peso = rotas.reduce((a, x) => a + (x.peso || 0), 0);
  const pesoExp = rotas.filter((x) => x.status === 'expedido').reduce((a, x) => a + (x.peso || 0), 0);

  const acoes = (x) => `${x.status === st0 ? `<button class="btn sm go" data-a="cheg" data-id="${x.id}" title="Registrar chegada do veículo">Chegada</button>` : ''}
    ${x.status === 'em_carregamento' ? `<button class="btn sm ok" data-a="said" data-id="${x.id}" title="Registrar saída do veículo">Saída</button>` : ''}
    <button class="btn sm" data-a="det" data-id="${x.id}">Detalhes</button>`;
  const stCell = (x) => `<span class="st ${ST_CLASS[x.status]}">${ST_LABEL[x.status]}</span>${atrasada(x) ? ' <span class="st warn">Atrasada</span>' : ''}`;
  const pessoas = (arr) => (arr?.length ? `<span class="small">${esc(arr.map((n) => n.split(' ')[0]).join(', '))}</span>` : '<span class="muted">—</span>');
  const linhas = vis.map((x) => (tipo === 'VD' ? `<tr class="${atrasada(x) ? 'late' : ''}">
      <td data-l="Rota"><span class="rota">${esc(x.rota)}</span></td>
      <td data-l="Transportadora"><b>${esc(x.transportadora)}</b></td>
      <td data-l="Motorista" class="clip full" title="${esc(x.motorista)}">${esc(x.motorista)}</td>
      <td data-l="Peso (kg)" class="num-r">${fmtPeso(x.peso)}</td>
      <td data-l="Stage / doca alocado">${r.alocacao[x.id] ? `<span class="tag">${esc(posLabel(r.alocacao[x.id]))}</span>` : '<span class="muted">—</span>'}</td>
      <td data-l="Previsto">${x.previsto || '<span class="muted">—</span>'}</td>
      <td data-l="Chegada">${fmtHora(x.chegada) || '<span class="muted">—</span>'}</td>
      <td data-l="Saída">${fmtHora(x.saida) || '<span class="muted">—</span>'}</td>
      <td data-l="Doca expedição">${x.doca ? esc(posNome(x.doca)) : '<span class="muted">—</span>'}</td>
      <td data-l="Responsável">${pessoas(x.responsaveis)}</td>
      <td data-l="Status">${stCell(x)}</td>
      <td class="full"><div class="acts">${acoes(x)}</div></td></tr>`
    : `<tr>
      <td data-l="Rota"><span class="rota">${esc(x.rota)}</span></td>
      <td data-l="Transportadora"><b>${esc(x.transportadora)}</b></td>
      <td data-l="Motorista" class="clip full" title="${esc(x.motorista)}">${esc(x.motorista)}</td>
      <td data-l="Peso (kg)" class="num-r">${fmtPeso(x.peso)}</td>
      <td data-l="Separação">${pessoas(x.separadores)}</td>
      <td data-l="Conferência">${pessoas(x.conferentes)}</td>
      <td data-l="Erro separação">${x.teveErro === true ? `<span class="st ocup">Sim · ${x.erros.reduce((a, e) => a + (e.qtd || 0), 0)}</span>` : x.teveErro === false ? '<span class="st livre">Não</span>' : '<span class="muted">—</span>'}</td>
      <td data-l="Chegada">${fmtHora(x.chegada) || '<span class="muted">—</span>'}</td>
      <td data-l="Saída">${fmtHora(x.saida) || '<span class="muted">—</span>'}</td>
      <td data-l="Doca">${x.doca ? esc(posNome(x.doca)) : '<span class="muted">—</span>'}</td>
      <td data-l="Status">${stCell(x)}</td>
      <td class="full"><div class="acts">${acoes(x)}</div></td></tr>`)).join('');
  const head = tipo === 'VD'
    ? '<th>Rota</th><th>Transportadora</th><th>Motorista</th><th class="num-r">Peso (kg)</th><th>Stage/doca</th><th>Previsto</th><th>Chegada</th><th>Saída</th><th>Doca exp.</th><th>Responsável</th><th>Status</th><th></th>'
    : '<th>Rota</th><th>Transportadora</th><th>Motorista</th><th class="num-r">Peso (kg)</th><th>Separação</th><th>Conferência</th><th>Erro</th><th>Chegada</th><th>Saída</th><th>Doca</th><th>Status</th><th></th>';
  main.innerHTML = `${avisos()}
    <div class="topbar"><h1>${tipo === 'VD' ? 'Expedição Venda Direta' : 'Expedição Vet Criador'}</h1>
      <div class="datebox"><button id="dPrev" aria-label="Dia anterior">‹</button><input type="date" id="dSel" value="${data}" aria-label="Data da expedição"><button id="dNext" aria-label="Próximo dia">›</button></div>
      ${data !== hojeLocal() ? '<button class="btn sm" id="dHoje">Hoje</button>' : ''}
      <span class="grow"></span>
      ${tipo === 'VET' ? `<div class="seg"><button class="on">Rotas</button><button id="abaInd">Indicadores de erro</button></div>` : ''}
      <button class="btn pri" id="btnAdd">+ Incluir rota</button></div>
    <div class="kpis">
      <div class="kpi"><b>${rotas.length}</b><span>Rotas</span></div>
      <div class="kpi"><b>${fmtPesoT(peso)}</b><span>Peso total (kg)</span></div>
      <div class="kpi"><b>${c(st0)}</b><span>${ST_LABEL[st0]}</span></div>
      <div class="kpi carr"><b>${c('em_carregamento')}</b><span>Em carregamento</span></div>
      <div class="kpi livre"><b>${c('expedido')}</b><span>Expedidas · ${fmtPesoT(pesoExp)} kg</span></div>
      ${tipo === 'VD' ? `<div class="kpi warn"><b>${nAtr}</b><span>Atrasadas</span></div>` : `<div class="kpi ocup"><b>${rotas.filter((x) => x.teveErro).length}</b><span>Com erro de separação</span></div>`}
    </div>
    <div class="filters">
      <select class="in" id="fSt"><option value="">Todos os status</option>${(tipo === 'VD' ? ['nao_expedido', 'em_carregamento', 'expedido', 'atrasada'] : ['pendente', 'em_carregamento', 'expedido']).map((s) => `<option value="${s}" ${f.st === s ? 'selected' : ''}>${ST_LABEL[s] || 'Atrasadas'}</option>`).join('')}</select>
      <select class="in" id="fTr"><option value="">Todas as transportadoras</option>${transps.map((t) => `<option ${f.tr === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <input class="in search" type="search" id="fQ" placeholder="Buscar rota ou motorista" value="${esc(f.q)}">
    </div>
    ${rotas.length ? `<div class="tbl-wrap"><table class="tbl cards"><thead><tr>${head}</tr></thead><tbody>${linhas || `<tr><td colspan="12" class="empty">Nenhuma rota com esses filtros.</td></tr>`}</tbody></table></div>`
    : `<div class="card empty"><b>Nenhuma rota em ${fmtData(data)}</b>Envie o arquivo do dia em <a href="#/upload">Arquivo do dia</a> ou inclua uma rota manualmente.</div>`}`;
  $('#dSel').onchange = (e) => { S.data[k] = e.target.value; render(); };
  $('#dPrev').onclick = () => { S.data[k] = addDias(data, -1); render(); };
  $('#dNext').onclick = () => { S.data[k] = addDias(data, 1); render(); };
  $('#dHoje')?.addEventListener('click', () => { S.data[k] = hojeLocal(); render(); });
  $('#abaInd')?.addEventListener('click', () => { S.vetAba = 'indicadores'; render(); });
  $('#fSt').onchange = (e) => { f.st = e.target.value; render(); };
  $('#fTr').onchange = (e) => { f.tr = e.target.value; render(); };
  const qi = $('#fQ'); qi.oninput = () => { f.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => render().then(() => { const n = $('#fQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 300); };
  $('#btnAdd').onclick = () => incluirModal(tipo, data);
  main.querySelector('tbody')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const x = rotas.find((y) => y.id === b.dataset.id);
    if (b.dataset.a === 'cheg') chegadaModal(x);
    if (b.dataset.a === 'said') saidaModal(x);
    if (b.dataset.a === 'det') rotaModal(x);
  });
}

function chegadaModal(x) {
  openModal({
    title: `Chegada · Rota ${esc(x.rota)}`,
    body: `<p style="margin:0"><b>${esc(x.transportadora)}</b> · ${esc(x.motorista)} · ${fmtPeso(x.peso)} kg</p>
      <div class="grid2"><label class="f">Horário de chegada<input class="in" type="datetime-local" id="chH" value="${toLocalInput()}"></label>
      <label class="f">Doca da expedição<select class="in" id="chD">${docaOptions(x.doca, x.tipo)}</select></label></div>
      ${x.tipo === 'VD' ? '<p class="small" style="margin:0;color:var(--ink-2)">A doca escolhida aparece como "Em carregamento" no painel até a saída ser registrada.</p>' : ''}`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn go" id="chOk">Registrar chegada</button>`,
    onMount: (m, close) => {
      $('#chOk', m).onclick = async () => {
        await run(() => api('rotaChegada', { tipo: x.tipo, data: x.data, id: x.id, horario: fromLocalInput($('#chH', m).value), doca: $('#chD', m).value }), 'Chegada registrada · em carregamento');
        S.cache.painel = null; close(); render();
      };
    },
  });
}

function saidaModal(x) {
  const doc = x.tipo === 'VD' ? 'espelho' : 'romaneio de carga';
  const camposVET = `<label class="f">Separador(es)${pickerHTML('sep', x.separadores)}</label>
      <label class="f">Conferente(s)${pickerHTML('conf', x.conferentes)}</label>
      <label class="f">Expedidor(es)${pickerHTML('exp', x.expedidores)}</label>
      <div class="f" style="font-size:13px;font-weight:600;color:var(--ink-2)">Teve erro no processo de separação?</div>${errosHTML(x.teveErro, x.erros)}`;
  openModal({
    title: `Saída · Rota ${esc(x.rota)}`,
    wide: true,
    body: `${colabDatalist()}<p style="margin:0"><b>${esc(x.transportadora)}</b> · ${esc(x.motorista)} · ${fmtPeso(x.peso)} kg${x.chegada ? ` · chegada ${fmtHora(x.chegada)}` : ''}</p>
      <div class="grid2"><label class="f">Horário de saída<input class="in" type="datetime-local" id="saH" value="${toLocalInput()}"></label>
      <label class="f">Doca da expedição<select class="in" id="saD">${docaOptions(x.doca, x.tipo)}</select></label></div>
      ${x.tipo === 'VD' ? `<label class="f">Responsável(is) pela expedição${pickerHTML('resp', x.responsaveis)}</label>` : camposVET}
      <div class="sec-t">Foto do ${doc} assinado <span style="color:var(--ocup)">*</span></div>${fotosHTML(x.fotos)}
      <label class="f">Observação<textarea class="in" id="saO">${esc(x.obs)}</textarea></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn ok" id="saOk">Registrar saída</button>`,
    onMount: (m, close) => {
      bindPickers(m); bindErros(m); bindFotos(m, x);
      $('#saOk', m).onclick = async () => {
        if (fotosEnviando(m)) return toast('Aguarde o envio das fotos', true);
        const fotos = fotosVal(m);
        if (!fotos.length) return toast(`Anexe ao menos uma foto do ${doc} assinado`, true);
        const extra = { doca: $('#saD', m).value || null, obs: $('#saO', m).value.trim() };
        if (x.tipo === 'VD') extra.responsaveis = pickerVal(m, 'resp');
        else Object.assign(extra, { separadores: pickerVal(m, 'sep'), conferentes: pickerVal(m, 'conf'), expedidores: pickerVal(m, 'exp'), ...errosVal(m) });
        if (extra.teveErro && !extra.erros.length) return toast('Informe qual foi o erro de separação', true);
        const r = await run(() => api('rotaSaida', { tipo: x.tipo, data: x.data, id: x.id, horario: fromLocalInput($('#saH', m).value), fotos, extra }));
        S.cache.painel = null; close();
        toast(r.liberadas ? `Rota expedida · ${r.liberadas} stage/doca liberado automaticamente` : 'Rota expedida');
        render();
      };
    },
  });
}

function rotaModal(x, onSaved) {
  const travada = x.status === 'expedido' && !can('admin');
  const baseRO = travada || !can('lider');
  const ro = travada;
  const camposVD = `<div class="grid3">
      <label class="f">Horário previsto<input class="in" type="time" id="rmPrev" value="${esc(x.previsto || '')}" ${ro ? 'readonly' : ''}></label>
      <label class="f">Doca da expedição<select class="in" id="rmDoca" ${ro ? 'disabled' : ''}>${docaOptions(x.doca, x.tipo)}</select></label>
      <label class="f">Stage / doca alocado<input class="in" readonly value="${esc(posLabel(S.cache.vd?.alocacao?.[x.id]) || '—')}"></label></div>
      <label class="f">Responsável(is) pela expedição${pickerHTML('resp', x.responsaveis, ro)}</label>`;
  const camposVET = `<label class="f">Doca da expedição<select class="in" id="rmDoca" ${ro ? 'disabled' : ''}>${docaOptions(x.doca, x.tipo)}</select></label>
      <label class="f">Separador(es)${pickerHTML('sep', x.separadores, ro)}</label>
      <label class="f">Conferente(s)${pickerHTML('conf', x.conferentes, ro)}</label>
      <label class="f">Expedidor(es)${pickerHTML('exp', x.expedidores, ro)}</label>
      <div class="f" style="font-size:13px;font-weight:600;color:var(--ink-2)">Teve erro no processo de separação?</div>${errosHTML(x.teveErro, x.erros, ro)}`;
  openModal({
    title: `Rota ${esc(x.rota)} · ${x.tipo}`,
    wide: true,
    body: `${colabDatalist()}${travada ? '<div class="notice info">Rota expedida: somente o administrador pode alterar.</div>' : ''}
      <div class="grid3">
        <label class="f">Data da expedição<input class="in" readonly value="${fmtData(x.data)}"></label>
        <label class="f">Rota<input class="in" id="rmRota" value="${esc(x.rota)}" ${baseRO ? 'readonly' : ''}></label>
        <label class="f">Status<select class="in" id="rmSt" ${!can('lider') || ro ? 'disabled' : ''}>${(x.tipo === 'VD' ? ['nao_expedido', 'em_carregamento', 'expedido'] : ['pendente', 'em_carregamento', 'expedido']).map((s) => `<option value="${s}" ${x.status === s ? 'selected' : ''}>${ST_LABEL[s]}</option>`).join('')}</select></label>
        <label class="f">Transportadora<input class="in" id="rmTr" value="${esc(x.transportadora)}" ${baseRO ? 'readonly' : ''}></label>
        <label class="f">Motorista<input class="in" id="rmMot" value="${esc(x.motorista)}" ${baseRO ? 'readonly' : ''}></label>
        <label class="f">Peso (kg)<input class="in" id="rmPeso" value="${fmtPeso(x.peso)}" ${baseRO ? 'readonly' : ''}></label>
        <label class="f">Chegada<input class="in" type="datetime-local" id="rmCh" value="${x.chegada ? toLocalInput(x.chegada) : ''}" ${ro ? 'readonly' : ''}></label>
        <label class="f">Saída<input class="in" type="datetime-local" id="rmSa" value="${x.saida ? toLocalInput(x.saida) : ''}" ${ro ? 'readonly' : ''}></label>
        <label class="f">Origem<input class="in" readonly value="${x.origem === 'manual' ? 'Incluída manualmente' : 'Arquivo do dia'}"></label>
      </div>
      ${x.tipo === 'VD' ? camposVD : camposVET}
      <div class="sec-t">Foto do ${x.tipo === 'VD' ? 'espelho' : 'romaneio'} assinado</div>${fotosHTML(x.fotos, ro)}
      <label class="f">Observação<textarea class="in" id="rmObs" ${ro ? 'readonly' : ''}>${esc(x.obs)}</textarea></label>
      <details><summary class="small" style="cursor:pointer;color:var(--ink-2)">Histórico de alterações (${(x.log || []).length})</summary><div class="logs">${(x.log || []).map((l) => `<div>${fmtDHfull(l.em)} · <b>${esc(l.por)}</b> · ${esc(l.acao)}</div>`).join('')}</div></details>`,
    foot: `${can('coordenador') ? '<button class="btn danger left" id="rmDel">Excluir rota</button>' : ''}<button class="btn" data-close>Fechar</button>${ro ? '' : '<button class="btn pri" id="rmOk">Salvar alterações</button>'}`,
    onMount: (m, close) => {
      bindPickers(m); bindErros(m); bindFotos(m, x);
      $('#rmDel', m)?.addEventListener('click', async () => {
        if (!(await confirmBox(`Excluir a rota <b>${esc(x.rota)}</b> (${esc(x.transportadora)}) de ${fmtData(x.data)}? Reservas de stage vinculadas serão liberadas.`, 'Excluir'))) return;
        await run(() => api('rotaExcluir', { tipo: x.tipo, data: x.data, id: x.id }), 'Rota excluída');
        S.cache.painel = null; close(); onSaved ? onSaved() : render();
      });
      $('#rmOk', m)?.addEventListener('click', async () => {
        if (fotosEnviando(m)) return toast('Aguarde o envio das fotos', true);
        const patch = { obs: $('#rmObs', m).value.trim(), fotos: fotosVal(m), doca: $('#rmDoca', m).value || null, chegada: fromLocalInput($('#rmCh', m).value), saida: fromLocalInput($('#rmSa', m).value) };
        if (x.tipo === 'VD') Object.assign(patch, { previsto: $('#rmPrev', m).value, responsaveis: pickerVal(m, 'resp') });
        else Object.assign(patch, { separadores: pickerVal(m, 'sep'), conferentes: pickerVal(m, 'conf'), expedidores: pickerVal(m, 'exp'), ...errosVal(m) });
        if (patch.teveErro && !patch.erros.length) return toast('Informe qual foi o erro de separação', true);
        if (!baseRO) Object.assign(patch, { rota: $('#rmRota', m).value, transportadora: $('#rmTr', m).value, motorista: $('#rmMot', m).value, peso: parsePeso($('#rmPeso', m).value) });
        const st = $('#rmSt', m).value;
        if (can('lider') && st !== x.status) patch.status = st;
        await run(() => api('rotaAtualizar', { tipo: x.tipo, data: x.data, id: x.id, patch }), 'Alterações salvas');
        S.cache.painel = null; close(); onSaved ? onSaved() : render();
      });
    },
  });
}

function incluirModal(tipo, data) {
  const transps = [...new Set((S.cache[tipo.toLowerCase()]?.rotas || []).map((r) => r.transportadora))].sort();
  openModal({
    title: `Incluir rota ${tipo}`,
    body: `<form id="fInc" class="grid2">
      <label class="f">Data da expedição<input class="in" type="date" name="data" value="${data}" required></label>
      <label class="f">Rota<input class="in" name="rota" required autofocus></label>
      <label class="f">Transportadora<input class="in" name="transportadora" list="dlTrI" required><datalist id="dlTrI">${transps.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <label class="f">Motorista<input class="in" name="motorista" required></label>
      <label class="f">Peso (kg)<input class="in" name="peso" inputmode="decimal" placeholder="Ex.: 4.584,796"></label>
      ${tipo === 'VD' ? '<label class="f">Horário previsto (opcional)<input class="in" type="time" name="previsto"></label>' : '<span></span>'}
      <div class="span2 row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Cancelar</button><button class="btn pri" type="submit">Incluir rota</button></div></form>`,
    onMount: (m, close) => {
      $('#fInc', m).onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        const rota = { data: f.data.value, rota: f.rota.value.trim(), transportadora: f.transportadora.value.trim().toUpperCase(), motorista: f.motorista.value.trim().toUpperCase(), peso: parsePeso(f.peso.value), previsto: f.previsto?.value || '' };
        const r = await run(() => api('rotaIncluir', { tipo, rota }));
        close(); toast(r.vinculadas ? 'Rota incluída e vinculada à pré-reserva' : 'Rota incluída'); render();
      };
    },
  });
}

// ----- indicadores de erro VET -----
async function viewIndicadores(main) {
  const de = S.indDe || addDias(hojeLocal(), -30); const ate = S.indAte || hojeLocal();
  const rotas = await api('rotasPeriodo', { tipo: 'VET', de, ate });
  const agg = (campo) => {
    const m = {};
    rotas.forEach((r) => (r[campo] || []).forEach((n) => {
      const a = m[n] ||= { nome: n, rotas: 0, comErro: 0, qtd: 0 };
      a.rotas++; if (r.teveErro) { a.comErro++; a.qtd += (r.erros || []).reduce((s, e) => s + (e.qtd || 0), 0); }
    }));
    return Object.values(m).sort((a, b) => b.qtd - a.qtd || b.comErro - a.comErro || a.nome.localeCompare(b.nome));
  };
  const porTipo = {};
  rotas.forEach((r) => (r.erros || []).forEach((e) => { porTipo[e.nome] = (porTipo[e.nome] || 0) + (e.qtd || 0); }));
  const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);
  const maxT = Math.max(1, ...tipos.map((t) => t[1]));
  const comErro = rotas.filter((r) => r.teveErro).length;
  const tab = (titulo, arr) => `<div class="card"><h3>${titulo}</h3>${arr.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Colaborador</th><th class="num-r">Rotas</th><th class="num-r">Rotas com erro</th><th class="num-r">% com erro</th><th class="num-r">Qtd. de erros</th></tr></thead><tbody>
    ${arr.map((a) => `<tr><td>${esc(a.nome)}</td><td class="num-r">${a.rotas}</td><td class="num-r">${a.comErro}</td><td class="num-r">${a.rotas ? Math.round((a.comErro / a.rotas) * 100) : 0}%</td><td class="num-r"><b>${a.qtd}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="small" style="color:var(--ink-2)">Sem dados no período.</p>'}</div>`;
  main.innerHTML = `<div class="topbar"><h1>Expedição Vet Criador</h1><span class="grow"></span>
      <div class="seg"><button id="abaRot">Rotas</button><button class="on">Indicadores de erro</button></div></div>
    <div class="filters"><label class="f">De<input class="in" type="date" id="iDe" value="${de}"></label><label class="f">Até<input class="in" type="date" id="iAte" value="${ate}"></label></div>
    <div class="kpis"><div class="kpi"><b>${rotas.length}</b><span>Rotas no período</span></div>
      <div class="kpi ocup"><b>${comErro}</b><span>Rotas com erro</span></div>
      <div class="kpi"><b>${rotas.length ? ((comErro / rotas.length) * 100).toFixed(1).replace('.', ',') : 0}%</b><span>Índice de erro</span></div>
      <div class="kpi ocup"><b>${tipos.reduce((s, t) => s + t[1], 0)}</b><span>Qtd. total de erros</span></div></div>
    <div class="card"><h3>Erros por tipo</h3>${tipos.length ? tipos.map(([n, q]) => `<div style="display:grid;grid-template-columns:160px 1fr 50px;gap:10px;align-items:center;margin:6px 0"><span>${esc(n)}</span><span style="background:#F0F1F4;border-radius:4px;height:14px"><span style="display:block;height:100%;width:${(q / maxT) * 100}%;background:var(--ocup);border-radius:4px"></span></span><b class="num-r">${q}</b></div>`).join('') : '<p class="small" style="color:var(--ink-2)">Nenhum erro registrado no período.</p>'}</div>
    ${tab('Por separador', agg('separadores'))}${tab('Por conferente', agg('conferentes'))}`;
  $('#abaRot').onclick = () => { S.vetAba = 'rotas'; render(); };
  $('#iDe').onchange = (e) => { S.indDe = e.target.value; render(); };
  $('#iAte').onchange = (e) => { S.indAte = e.target.value; render(); };
}

// ================= ARQUIVO DO DIA =================
function lerPlanilha(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const wb = XLSX.read(fr.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }));
      } catch (e) { reject(new Error('Não foi possível ler o arquivo. Use .xlsx, .xls ou .csv')); }
    };
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    fr.readAsArrayBuffer(file);
  });
}
function lerData(v) {
  if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600000); return d.toISOString().slice(0, 10); }
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000) + 12 * 3600000); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? m[0] : null;
}
function lerHora(v) {
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number' && v < 1) { const t = Math.round(v * 1440); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
  const m = /(\d{1,2}):(\d{2})/.exec(String(v)); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}
function mapLinhas(json) {
  const out = []; const erros = [];
  json.forEach((row, i) => {
    const r = {};
    for (const [k, v] of Object.entries(row)) {
      const h = norm(k);
      if (h === 'DATA' || h.startsWith('DATA ')) r.data = lerData(v);
      else if (h.startsWith('MOTORISTA')) r.motorista = String(v).trim();
      else if (h.startsWith('TRANSPORTADORA')) r.transportadora = String(v).trim().toUpperCase();
      else if (h === 'ROTA' || h.startsWith('ROTA')) r.rota = String(v).trim();
      else if (h.startsWith('PESO')) r.peso = parsePeso(v);
      else if (h.includes('PREVISTO')) r.previsto = lerHora(v);
    }
    if (!r.rota && !r.motorista) return;
    if (!r.data) { erros.push(`Linha ${i + 2}: data inválida`); return; }
    out.push(r);
  });
  return { linhas: out, erros };
}

async function viewUpload() {
  const main = $('#main');
  if (!can('lider')) { main.innerHTML = `<div class="topbar"><h1>Arquivo do dia</h1></div>${needLogin('lider', 'O envio do arquivo do dia')}`; return; }
  main.innerHTML = `${avisos()}<div class="topbar"><h1>Arquivo do dia</h1></div>
    <div class="card"><h3>Enviar arquivo de rotas</h3>
      <p class="help">Colunas lidas: Data, Rota, Motorista, Transportadora e Peso. Se o arquivo tiver uma coluna "Horário previsto", ela também é lida. Reenviar o mesmo dia acrescenta só as rotas novas.</p>
      <div class="row" style="margin-bottom:12px"><div class="seg" id="upT"><button data-v="VD" class="${S.upTipo === 'VD' ? 'on' : ''}">Venda Direta (VD)</button><button data-v="VET" class="${S.upTipo === 'VET' ? 'on' : ''}">Vet Criador (VET)</button></div>
      <label class="btn pri"><input type="file" id="upF" accept=".xlsx,.xls,.csv" hidden>Escolher arquivo…</label></div>
      <div id="upPrev"></div></div>`;
  $('#upT').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.upTipo = b.dataset.v; viewUpload(); };
  $('#upF').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const prev = $('#upPrev'); prev.innerHTML = '<div class="spin">Lendo arquivo…</div>';
    try {
      const { linhas, erros } = mapLinhas(await lerPlanilha(file));
      if (!linhas.length) throw new Error('Nenhuma rota encontrada. Confira se a primeira linha tem os títulos Data, Motorista, Transportadora, Rota e Peso.');
      const datas = [...new Set(linhas.map((l) => l.data))];
      const exist = await api('rotasDatas', { tipo: S.upTipo, datas });
      previewUpload(prev, S.upTipo, file.name, linhas, erros, exist);
    } catch (err) { prev.innerHTML = `<div class="notice">${esc(err.message)}</div>`; }
    e.target.value = '';
  };
}

function previewUpload(box, tipo, nome, linhas, errosLeitura, exist) {
  const novas = []; const iguais = []; const alteradas = [];
  const usados = new Set();
  const vistas = new Set();
  linhas.forEach((l) => {
    const ex = exist[l.data] || [];
    const k = chave(l);
    if (vistas.has(l.data + k)) return; vistas.add(l.data + k);
    const ig = ex.find((e) => chave(e) === k);
    if (ig) {
      usados.add(ig.id);
      if (Math.abs((ig.peso || 0) - (l.peso || 0)) > 0.0005) alteradas.push({ l, e: ig }); else iguais.push(l);
      return;
    }
    const alt = ex.find((e) => !usados.has(e.id) && chaveRT(e) === chaveRT(l) && !linhas.some((o) => o !== l && chave(o) === chave(e)));
    if (alt) { usados.add(alt.id); alteradas.push({ l, e: alt }); return; }
    novas.push(l);
  });
  const peso = linhas.reduce((s, l) => s + (l.peso || 0), 0);
  const tbl = (arr, cols) => `<div class="tbl-wrap" style="max-height:340px"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${arr}</tbody></table></div>`;
  box.innerHTML = `<div class="notice info"><b>${esc(nome)}</b> · ${tipo} · ${linhas.length} rotas · ${[...new Set(linhas.map((l) => fmtData(l.data)))].join(', ')} · ${fmtPeso(peso)} kg</div>
    ${errosLeitura.length ? `<div class="notice">${errosLeitura.map(esc).join('<br>')}</div>` : ''}
    <div class="kpis"><div class="kpi livre"><b>${novas.length}</b><span>Rotas novas</span></div><div class="kpi warn"><b>${alteradas.length}</b><span>Com alteração</span></div><div class="kpi"><b>${iguais.length}</b><span>Já cadastradas (ignoradas)</span></div></div>
    ${alteradas.length ? `<div class="sec-t" style="margin:14px 0 8px">Rotas que já existem com motorista ou peso diferente</div>
      ${tbl(alteradas.map((a, i) => `<tr><td><span class="rota">${esc(a.l.rota)}</span></td><td>${esc(a.l.transportadora)}</td>
        <td class="small">${esc(a.e.motorista)}<br>${fmtPeso(a.e.peso)} kg</td><td class="small"><b>${esc(a.l.motorista)}</b><br><b>${fmtPeso(a.l.peso)} kg</b></td>
        <td><select class="in" data-alt="${i}"><option value="upd">Atualizar a existente</option><option value="new">Criar como nova rota</option><option value="skip">Ignorar</option></select></td></tr>`).join(''), ['Rota', 'Transportadora', 'No sistema', 'No arquivo', 'O que fazer'])}` : ''}
    ${novas.length ? `<div class="sec-t" style="margin:14px 0 8px">Rotas novas</div>${tbl(novas.sort(byRota).map((l) => `<tr><td>${fmtData(l.data)}</td><td><span class="rota">${esc(l.rota)}</span></td><td>${esc(l.transportadora)}</td><td>${esc(l.motorista)}</td><td class="num-r">${fmtPeso(l.peso)}</td>${tipo === 'VD' ? `<td>${l.previsto || '—'}</td>` : ''}</tr>`).join(''), ['Data', 'Rota', 'Transportadora', 'Motorista', 'Peso (kg)', ...(tipo === 'VD' ? ['Previsto'] : [])])}` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:14px">${novas.length || alteradas.length ? '<button class="btn pri" id="upOk">Gravar rotas</button>' : '<span class="small">Nada novo para gravar neste arquivo.</span>'}</div>`;
  $('#upOk', box)?.addEventListener('click', async () => {
    const payload = { tipo, novas: [...novas], atualizar: [] };
    $$('[data-alt]', box).forEach((s) => {
      const a = alteradas[+s.dataset.alt];
      if (s.value === 'upd') payload.atualizar.push({ data: a.e.data, id: a.e.id, motorista: a.l.motorista, peso: a.l.peso, previsto: a.l.previsto });
      if (s.value === 'new') payload.novas.push({ ...a.l, forcarNova: true });
    });
    const r = await run(() => api('importar', payload));
    S.cache = {};
    box.innerHTML = `<div class="notice info" style="font-size:15px"><b>Arquivo gravado.</b> ${r.criadas} rota(s) nova(s), ${r.atualizadas} atualizada(s), ${r.ignoradas} ignorada(s)${r.vinculadas ? `, ${r.vinculadas} pré-reserva(s) vinculada(s) automaticamente` : ''}.
      <div class="row" style="margin-top:10px"><a class="btn sm" href="#/${tipo.toLowerCase()}" onclick="S.data['${tipo.toLowerCase()}']='${linhas[0].data}'">Abrir expedição ${tipo} de ${fmtData(linhas[0].data)}</a></div></div>`;
  });
}

// ================= HISTÓRICO =================
async function viewHistorico() {
  const h = S.hist; h.de ||= addDias(hojeLocal(), -7); h.ate ||= hojeLocal();
  const main = $('#main');
  main.innerHTML = `${avisos()}<div class="topbar"><h1>Histórico</h1><span class="grow"></span>
      <button class="btn" id="hXls">Exportar Excel</button><button class="btn" id="hPdf">Exportar PDF</button></div>
    <div class="tabs">${[['VD', 'Expedição VD'], ['VET', 'Expedição VET'], ['RES', 'Stages e docas']].map(([v, l]) => `<button data-v="${v}" class="${h.aba === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="filters"><label class="f">De<input class="in" type="date" id="hDe" value="${h.de}"></label><label class="f">Até<input class="in" type="date" id="hAte" value="${h.ate}"></label>
      <span id="hExtra" class="row"></span></div><div id="hBody"><div class="spin">Carregando…</div></div>`;
  $$('.tabs button', main).forEach((b) => b.onclick = () => { h.aba = b.dataset.v; h.st = ''; h.tr = ''; viewHistorico(); });
  $('#hDe').onchange = (e) => { h.de = e.target.value; viewHistorico(); };
  $('#hAte').onchange = (e) => { h.ate = e.target.value; viewHistorico(); };
  let dados; let colunas; let linhas;
  if (h.aba === 'RES') {
    dados = await api('historicoReservas', { de: h.de, ate: h.ate });
    colunas = ['Stage/doca', 'Rota', 'Transportadora', 'Motorista', 'Data expedição', 'Reservado em', 'Reservado por', 'Liberado em', 'Liberado por', 'Motivo', 'Tempo ocupado'];
    linhas = () => dados.filter((r) => !h.q || norm(`${posNome(r.posicaoId)} ${r.rota} ${r.transportadora} ${r.motorista}`).includes(norm(h.q))).map((r) => [posLabel(r.posicaoId), r.rota, r.transportadora, r.motorista || '', fmtData(r.data), fmtDHfull(r.criadoEm), r.criadoPor, r.liberadoEm ? fmtDHfull(r.liberadoEm) : 'Ocupado', r.liberadoPor || '', r.motivo || '', duracao((r.liberadoEm ? new Date(r.liberadoEm) : new Date()) - new Date(r.criadoEm))]);
    $('#hExtra').innerHTML = `<label class="f">Busca<input class="in" type="search" id="hQ" placeholder="Stage, rota ou transportadora" value="${esc(h.q)}"></label>`;
  } else {
    dados = (await api('rotasPeriodo', { tipo: h.aba, de: h.de, ate: h.ate })).sort((a, b) => a.data.localeCompare(b.data) || byRota(a, b));
    const transps = [...new Set(dados.map((r) => r.transportadora))].sort();
    $('#hExtra').innerHTML = `<label class="f">Status<select class="in" id="hSt"><option value="">Todos os status</option>${(h.aba === 'VD' ? ['nao_expedido', 'em_carregamento', 'expedido'] : ['pendente', 'em_carregamento', 'expedido']).map((s) => `<option value="${s}" ${h.st === s ? 'selected' : ''}>${ST_LABEL[s]}</option>`).join('')}</select></label>
      <label class="f">Transportadora<select class="in" id="hTr"><option value="">Todas</option>${transps.map((t) => `<option ${h.tr === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="f">Busca<input class="in" type="search" id="hQ" placeholder="Rota ou motorista" value="${esc(h.q)}"></label>`;
    $('#hSt').onchange = (e) => { h.st = e.target.value; desenha(); };
    $('#hTr').onchange = (e) => { h.tr = e.target.value; desenha(); };
    const filtra = () => dados.filter((r) => (!h.st || r.status === h.st) && (!h.tr || r.transportadora === h.tr) && (!h.q || norm(`${r.rota} ${r.motorista} ${r.transportadora}`).includes(norm(h.q))));
    const fotosTxt = (r) => (r.fotos || []).map((f) => (f.url.startsWith('data:') ? '(foto local)' : f.url)).join(' ');
    if (h.aba === 'VD') {
      colunas = ['Data', 'Rota', 'Motorista', 'Transportadora', 'Peso (kg)', 'Horário previsto', 'Chegada', 'Saída', 'Doca expedição', 'Responsável', 'Status', 'Fotos'];
      linhas = () => filtra().map((r) => [fmtData(r.data), r.rota, r.motorista, r.transportadora, fmtPeso(r.peso), r.previsto || '', fmtDHfull(r.chegada), fmtDHfull(r.saida), posNome(r.doca), (r.responsaveis || []).join(', '), ST_LABEL[r.status], fotosTxt(r)]);
    } else {
      colunas = ['Data', 'Rota', 'Motorista', 'Transportadora', 'Peso (kg)', 'Separador', 'Conferente', 'Expedidor', 'Teve erro', 'Erros', 'Doca', 'Chegada', 'Saída', 'Status', 'Fotos'];
      linhas = () => filtra().map((r) => [fmtData(r.data), r.rota, r.motorista, r.transportadora, fmtPeso(r.peso), (r.separadores || []).join(', '), (r.conferentes || []).join(', '), (r.expedidores || []).join(', '), r.teveErro === true ? 'Sim' : r.teveErro === false ? 'Não' : '', (r.erros || []).map((e) => `${e.nome} (${e.qtd})${e.obs ? ': ' + e.obs : ''}`).join('; '), posNome(r.doca), fmtDHfull(r.chegada), fmtDHfull(r.saida), ST_LABEL[r.status], fotosTxt(r)]);
    }
    h._filtra = filtra;
  }
  const qi = $('#hQ'); qi.oninput = () => { h.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(desenha, 250); };
  function desenha() {
    const ls = linhas();
    const vis = colunas.map((c, i) => (c === 'Fotos' ? -1 : i)).filter((i) => i >= 0);
    $('#hBody').innerHTML = ls.length ? `<p class="small" style="color:var(--ink-2);margin:0 0 8px">${ls.length} registro(s)</p><div class="tbl-wrap"><table class="tbl"><thead><tr>${vis.map((i) => `<th>${colunas[i]}</th>`).join('')}${h.aba !== 'RES' ? '<th>Fotos</th>' : ''}</tr></thead><tbody>
      ${ls.map((l, n) => `<tr data-n="${n}" style="${h.aba !== 'RES' ? 'cursor:pointer' : ''}">${vis.map((i) => `<td class="${colunas[i] === 'Rota' ? 'rota' : colunas[i].startsWith('Peso') ? 'num-r' : 'small'}">${esc(l[i])}</td>`).join('')}${h.aba !== 'RES' ? `<td class="small">${(h._filtra()[n].fotos || []).length || '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : '<div class="card empty"><b>Nenhum registro no período</b>Ajuste as datas ou os filtros.</div>';
    if (h.aba !== 'RES') $$('#hBody tbody tr').forEach((tr) => tr.onclick = () => rotaModal(h._filtra()[+tr.dataset.n], () => viewHistorico()));
  }
  desenha();
  const nomeArq = `${h.aba === 'RES' ? 'Stages_Docas' : 'Expedicao_' + h.aba}_${h.de}_a_${h.ate}`;
  $('#hXls').onclick = () => {
    const ws = XLSX.utils.aoa_to_sheet([colunas, ...linhas()]);
    ws['!cols'] = colunas.map((c) => ({ wch: Math.max(10, c.length + 2) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Histórico'); XLSX.writeFile(wb, nomeArq + '.xlsx');
  };
  $('#hPdf').onclick = () => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const cols = colunas.filter((c) => c !== 'Fotos'); const idx = cols.map((c) => colunas.indexOf(c));
    doc.setFontSize(14); doc.text(`${{ VD: 'Expedição Venda Direta', VET: 'Expedição Vet Criador', RES: 'Stages e docas' }[h.aba]} · ${fmtData(h.de)} a ${fmtData(h.ate)}`, 30, 32);
    doc.setFontSize(8); doc.text(`CD Barueri · gerado em ${new Date().toLocaleString('pt-BR')}`, 30, 46);
    doc.autoTable({ head: [cols], body: linhas().map((l) => idx.map((i) => l[i])), startY: 56, styles: { fontSize: 7, cellPadding: 3 }, headStyles: { fillColor: [28, 39, 64] }, margin: { left: 30, right: 30 } });
    doc.save(nomeArq + '.pdf');
  };
}

// ================= CADASTROS =================
async function viewCadastros() {
  const main = $('#main');
  if (!can('coordenador')) { main.innerHTML = `<div class="topbar"><h1>Cadastros</h1></div>${needLogin('coordenador', 'A área de cadastros')}`; return; }
  const abas = [['posicoes', 'Stages e docas'], ['colab', 'Colaboradores'], ['erros', 'Tipos de erro'], ['alertas', 'Alertas'], ...(can('admin') ? [['users', 'Usuários']] : [])];
  main.innerHTML = `${avisos()}<div class="topbar"><h1>Cadastros</h1></div>
    <div class="tabs">${abas.map(([v, l]) => `<button data-v="${v}" class="${S.cad === v ? 'on' : ''}">${l}</button>`).join('')}</div><div id="cadB"></div>`;
  $$('.tabs button', main).forEach((b) => b.onclick = () => { S.cad = b.dataset.v; viewCadastros(); });
  const box = $('#cadB');
  const recarregar = async () => { const b = await api('bootstrap'); Object.assign(S.boot, b); viewCadastros(); };

  if (S.cad === 'posicoes') {
    const lista = [...S.boot.posicoes].sort((a, b) => (a.tipo > b.tipo ? 1 : a.tipo < b.tipo ? -1 : a.ordem - b.ordem));
    box.innerHTML = `<div class="card"><h3>Incluir stage ou doca</h3><form id="fPos" class="row">
        <select class="in" name="tipo" style="width:auto"><option value="DOCA">Doca</option><option value="STAGE">Stage</option></select>
        <input class="in" name="nome" placeholder="Nome (ex.: 17 - E ou 75)" style="width:220px" required><button class="btn pri">Incluir</button></form></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nome</th><th>Tipo</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((p) => `<tr><td class="rota">${esc(p.nome)}</td><td>${p.tipo === 'DOCA' ? 'Doca' : 'Stage'}</td><td><span class="st ${p.ativo ? 'livre' : 'mute'}">${p.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><div class="acts"><button class="btn sm" data-ren="${p.id}">Renomear</button><button class="btn sm" data-tog="${p.id}">${p.ativo ? 'Inativar' : 'Ativar'}</button></div></td></tr>`).join('')}</tbody></table></div>`;
    $('#fPos').onsubmit = async (e) => { e.preventDefault(); await run(() => api('posicaoSalvar', { posicao: { nome: e.target.nome.value, tipo: e.target.tipo.value, ativo: true } }), 'Incluído'); S.cache.painel = null; recarregar(); };
    box.addEventListener('click', async (e) => {
      const t = e.target.dataset.tog; const r = e.target.dataset.ren;
      if (t) { const p = lista.find((x) => x.id === t); await run(() => api('posicaoSalvar', { posicao: { ...p, ativo: !p.ativo } }), p.ativo ? 'Inativado' : 'Ativado'); S.cache.painel = null; recarregar(); }
      if (r) {
        const p = lista.find((x) => x.id === r);
        openModal({ title: 'Renomear', body: `<label class="f">Nome<input class="in" id="rnN" value="${esc(p.nome)}"></label>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn pri" id="rnOk">Salvar</button>',
          onMount: (m, close) => { $('#rnOk', m).onclick = async () => { await run(() => api('posicaoSalvar', { posicao: { ...p, nome: $('#rnN', m).value } }), 'Salvo'); close(); recarregar(); }; } });
      }
    });
  }

  if (S.cad === 'colab') {
    const q = norm(S.colQ || '');
    const lista = [...S.boot.colaboradores].sort((a, b) => a.nome.localeCompare(b.nome)).filter((c) => !q || norm(`${c.nome} ${c.cargo} ${c.turno}`).includes(q));
    box.innerHTML = `<div class="grid2"><div class="card"><h3>Incluir colaborador</h3><form id="fCol" class="grid2">
        <label class="f span2">Nome<input class="in" name="nome" required></label><label class="f">Cargo<input class="in" name="cargo" list="dlCargo"></label>
        <label class="f">Turno<select class="in" name="turno"><option>1º Turno</option><option>2º Turno</option><option>3º Turno</option></select></label>
        <datalist id="dlCargo">${[...new Set(S.boot.colaboradores.map((c) => c.cargo).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="span2"><button class="btn pri">Incluir</button></div></form></div>
      <div class="card"><h3>Importar lista</h3><p class="help">Planilha com as colunas NOME, CARGO e TURNO. Quem já existe é atualizado; quem é novo é incluído.</p>
        <label class="row small" style="margin-bottom:10px"><input type="checkbox" id="colInat"> Inativar quem não estiver na planilha</label>
        <label class="btn"><input type="file" id="colF" accept=".xlsx,.xls,.csv" hidden>Escolher planilha…</label></div></div>
      <div class="filters"><input class="in search" type="search" id="colQ" placeholder="Buscar colaborador, cargo ou turno" value="${esc(S.colQ || '')}">
        <span class="small">${S.boot.colaboradores.filter((c) => c.ativo).length} ativos · ${S.boot.colaboradores.filter((c) => !c.ativo).length} inativos</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nome</th><th>Cargo</th><th>Turno</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((c) => `<tr><td>${esc(c.nome)}</td><td class="small">${esc(c.cargo)}</td><td class="small">${esc(c.turno)}</td><td><span class="st ${c.ativo ? 'livre' : 'mute'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><div class="acts"><button class="btn sm" data-ed="${c.id}">Editar</button><button class="btn sm" data-tog="${c.id}">${c.ativo ? 'Inativar' : 'Ativar'}</button></div></td></tr>`).join('')}</tbody></table></div>`;
    $('#fCol').onsubmit = async (e) => { e.preventDefault(); const f = e.target; await run(() => api('colabSalvar', { colab: { nome: f.nome.value, cargo: f.cargo.value, turno: f.turno.value } }), 'Colaborador incluído'); recarregar(); };
    const ci = $('#colQ'); ci.oninput = () => { S.colQ = ci.value; clearTimeout(ci._t); ci._t = setTimeout(() => viewCadastros().then(() => { const n = $('#colQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 300); };
    $('#colF').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const json = await lerPlanilha(file).catch((err) => { toast(err.message, true); return []; });
      const lista2 = json.map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) { const h = norm(k); if (h.startsWith('NOME')) o.nome = String(v).trim(); else if (h.startsWith('CARGO') || h.startsWith('FUNCAO')) o.cargo = String(v).trim(); else if (h.startsWith('TURNO')) o.turno = String(v).trim().replace(/°\s*TURNO/i, 'º Turno'); } return o; }).filter((o) => o.nome);
      if (!lista2.length) return toast('Nenhum nome encontrado. A planilha precisa da coluna NOME.', true);
      const r = await run(() => api('colabImportar', { lista: lista2, inativarAusentes: $('#colInat').checked }));
      toast(`${r.novos} novo(s), ${r.atualizados} atualizado(s)${r.inativados ? `, ${r.inativados} inativado(s)` : ''}`); recarregar();
    };
    box.addEventListener('click', async (e) => {
      const id = e.target.dataset.tog || e.target.dataset.ed; if (!id) return;
      const c = S.boot.colaboradores.find((x) => x.id === id);
      if (e.target.dataset.tog) { await run(() => api('colabSalvar', { colab: { ...c, ativo: !c.ativo } }), c.ativo ? 'Inativado' : 'Ativado'); recarregar(); return; }
      openModal({ title: 'Editar colaborador', body: `<div class="grid2"><label class="f span2">Nome<input class="in" id="ecN" value="${esc(c.nome)}"></label><label class="f">Cargo<input class="in" id="ecC" value="${esc(c.cargo)}"></label><label class="f">Turno<input class="in" id="ecT" value="${esc(c.turno)}"></label></div>`,
        foot: '<button class="btn" data-close>Cancelar</button><button class="btn pri" id="ecOk">Salvar</button>',
        onMount: (m, close) => { $('#ecOk', m).onclick = async () => { await run(() => api('colabSalvar', { colab: { ...c, nome: $('#ecN', m).value, cargo: $('#ecC', m).value, turno: $('#ecT', m).value } }), 'Salvo'); close(); recarregar(); }; } });
    });
  }

  if (S.cad === 'erros') {
    const lista = [...S.boot.erros].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    box.innerHTML = `<div class="card"><h3>Incluir tipo de erro</h3><form id="fErr" class="row"><input class="in" name="nome" placeholder="Ex.: Embalagem violada" style="width:280px" required><button class="btn pri">Incluir</button></form></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tipo de erro</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((e) => `<tr><td>${esc(e.nome)}</td><td><span class="st ${e.ativo ? 'livre' : 'mute'}">${e.ativo ? 'Ativo' : 'Inativo'}</span></td><td><div class="acts"><button class="btn sm" data-ren="${e.id}">Renomear</button><button class="btn sm" data-tog="${e.id}">${e.ativo ? 'Desativar' : 'Ativar'}</button></div></td></tr>`).join('')}</tbody></table></div>`;
    $('#fErr').onsubmit = async (e) => { e.preventDefault(); await run(() => api('erroSalvar', { erro: { nome: e.target.nome.value } }), 'Tipo de erro incluído'); recarregar(); };
    box.addEventListener('click', async (ev) => {
      const id = ev.target.dataset.tog || ev.target.dataset.ren; if (!id) return;
      const er = lista.find((x) => x.id === id);
      if (ev.target.dataset.tog) { await run(() => api('erroSalvar', { erro: { ...er, ativo: !er.ativo } })); recarregar(); return; }
      openModal({ title: 'Renomear tipo de erro', body: `<label class="f">Nome<input class="in" id="reN" value="${esc(er.nome)}"></label>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn pri" id="reOk">Salvar</button>',
        onMount: (m, close) => { $('#reOk', m).onclick = async () => { await run(() => api('erroSalvar', { erro: { ...er, nome: $('#reN', m).value } }), 'Salvo'); close(); recarregar(); }; } });
    });
  }

  if (S.cad === 'alertas') {
    const s = S.boot.settings || {};
    box.innerHTML = `<div class="card" style="max-width:560px"><h3>Alertas</h3><form id="fSet" class="grid2">
      <label class="f">Alertar stage/doca ocupado há mais de (horas)<input class="in" type="number" min="1" name="h" value="${s.alertaStageHoras ?? 12}"></label>
      <label class="f">Tolerância para rota VD atrasada (minutos após o previsto)<input class="in" type="number" min="0" name="t" value="${s.toleranciaAtrasoMin ?? 15}"></label>
      <div class="span2"><button class="btn pri">Salvar alertas</button></div></form></div>`;
    $('#fSet').onsubmit = async (e) => { e.preventDefault(); await run(() => api('settingsSalvar', { settings: { alertaStageHoras: e.target.h.value, toleranciaAtrasoMin: e.target.t.value } }), 'Alertas salvos'); recarregar(); };
  }

  if (S.cad === 'users') {
    const us = await api('usuarios');
    const form = (u = {}) => `<form id="fUser" class="grid2">
      <label class="f">Usuário (login)<input class="in" name="username" value="${esc(u.username || '')}" ${u.username ? 'readonly' : ''} required autocomplete="off"></label>
      <label class="f">Nome<input class="in" name="nome" value="${esc(u.nome || '')}" required></label>
      <label class="f">Perfil<select class="in" name="role"><option value="lider" ${u.role === 'lider' ? 'selected' : ''}>Líder</option><option value="coordenador" ${u.role === 'coordenador' ? 'selected' : ''}>Coordenador</option></select></label>
      <label class="f">${u.username ? 'Nova senha (deixe em branco para manter)' : 'Senha'}<input class="in" name="senha" type="password" autocomplete="new-password" ${u.username ? '' : 'required'}></label>
      <label class="row small"><input type="checkbox" name="ativo" ${u.ativo === false ? '' : 'checked'}> Acesso ativo</label>
      <div class="span2"><button class="btn pri">${u.username ? 'Salvar usuário' : 'Criar usuário'}</button></div></form>`;
    box.innerHTML = `<div class="card"><h3>Novo usuário</h3><p class="help">Líder: envia arquivo, edita rotas e libera stages. Coordenador: tudo do líder e mais os cadastros. Edição de rota expedida é exclusiva do administrador.</p>${form()}</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Situação</th><th></th></tr></thead><tbody>
      ${us.length ? us.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.nome)}</td><td>${esc(u.perfil)}</td><td><span class="st ${u.ativo ? 'livre' : 'mute'}">${u.ativo ? 'Ativo' : 'Bloqueado'}</span></td><td><div class="acts"><button class="btn sm" data-ed="${esc(u.username)}">Editar</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Nenhum usuário criado ainda.</td></tr>'}</tbody></table></div>`;
    const bindForm = (root, close) => {
      $('#fUser', root).onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        await run(() => api('usuarioSalvar', { usuario: { username: f.username.value, nome: f.nome.value, role: f.role.value, senha: f.senha.value, ativo: f.ativo.checked } }), 'Usuário salvo');
        close?.(); viewCadastros();
      };
    };
    bindForm(box);
    box.addEventListener('click', (e) => {
      const u = us.find((x) => x.username === e.target.dataset.ed); if (!u) return;
      openModal({ title: 'Editar usuário', body: form(u), onMount: (m, close) => bindForm(m, close) });
    });
  }
}

// ================= início =================
async function boot() {
  try {
    S.boot = await api('bootstrap');
  } catch (e) {
    if (S.token) { S.token = null; lsSet('exp_token', null); return boot(); }
    $('#main').innerHTML = `<div class="empty"><b>Sem conexão com o servidor</b>${esc(e.message)}</div>`; return;
  }
  if (S.token && !S.boot.user) { S.token = null; lsSet('exp_token', null); }
  updateUser(); route();
}
$('#btnUser').onclick = loginModal;
window.addEventListener('hashchange', route);
setInterval(() => { if (!modalOpen() && document.visibilityState === 'visible' && ['painel', 'vd', 'vet'].includes(S.view) && !document.activeElement?.matches('input,select')) render(); }, 30000);
boot();
