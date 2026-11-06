// API única do app de Expedição VD / VET — todas as ações chegam via POST /api { action, ... }
import crypto from 'node:crypto';
import { put } from '@vercel/blob';
import {
  getJSON, setJSON, hGet, hSet, hSetMany, hDel, hAll, sAdd, sMembers, del, usingMemory,
} from '../lib/store.js';
import { POSICOES, COLABORADORES } from '../lib/seed-data.js';

// ---------- utilidades ----------
const LEVEL = { operacao: 0, lider: 1, coordenador: 2, admin: 3 };
const ROLE_LABEL = { lider: 'Líder', coordenador: 'Coordenador', admin: 'Administrador' };
const ERROS_PADRAO = ['Produto trocado', 'Falta', 'Sobra', 'Avaria', 'Lote / validade'];
const STATUS = {
  VD: ['nao_expedido', 'em_carregamento', 'expedido'],
  VET: ['pendente', 'em_carregamento', 'expedido'],
};

const uid = (p = '') => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const nowISO = () => new Date().toISOString();
export const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();
const normRota = (r) => { const s = norm(r); return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s; };
const chaveRota = (r) => `${normRota(r.rota)}|${norm(r.transportadora)}|${norm(r.motorista)}`;
const chaveRotaTransp = (r) => `${normRota(r.rota)}|${norm(r.transportadora)}`;
export function parsePeso(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isData = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const kRotas = (tipo, data) => `rotas:${tipo}:${data}`;
const hashSenha = (senha, salt) => crypto.scryptSync(String(senha), salt, 32).toString('hex');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };
const need = (user, role) => { if (LEVEL[user.role] < LEVEL[role]) fail('Você não tem permissão para esta ação. Faça login com um usuário autorizado.', 403); };
const checkTipo = (t) => { if (!['VD', 'VET'].includes(t)) fail('Tipo inválido'); return t; };

function log(rota, user, acao) {
  rota.log = [{ em: nowISO(), por: user.nome, acao }, ...(rota.log || [])].slice(0, 40);
}

// ---------- seed inicial ----------
async function ensureSeed() {
  if (await getJSON('cfg:seeded')) return;
  const pos = {};
  POSICOES.forEach((p) => { pos[p.id] = p; });
  await hSetMany('cfg:posicoes', pos);
  const col = {};
  COLABORADORES.forEach((c, i) => { const id = 'C' + (i + 1); col[id] = { id, ...c, ativo: true }; });
  await hSetMany('cfg:colab', col);
  const er = {};
  ERROS_PADRAO.forEach((nome, i) => { const id = 'E' + (i + 1); er[id] = { id, nome, ativo: true, ordem: i }; });
  await hSetMany('cfg:erros', er);
  await setJSON('cfg:settings', { alertaStageHoras: 12, toleranciaAtrasoMin: 15 });
  await setJSON('cfg:seeded', { em: nowISO() });
}

// ---------- autenticação ----------
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'premierpet';

async function getUser(req) {
  const auth = req.headers.authorization || '';
  const tk = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (tk) {
    const s = await getJSON('sess:' + tk);
    if (s) return { ...s, token: tk };
  }
  return { username: null, nome: 'Operação', role: 'operacao' };
}

// ---------- rotas ----------
async function rotasDoDia(tipo, data) { return hAll(kRotas(tipo, data)); }
async function getRota(tipo, data, id) {
  const r = await hGet(kRotas(tipo, data), id);
  if (!r) fail('Rota não encontrada', 404);
  return r;
}
async function saveRota(r) {
  r.atualizadoEm = nowISO();
  await hSet(kRotas(r.tipo, r.data), r.id, r);
  await sAdd(`datas:${r.tipo}`, r.data);
}
function novaRota(tipo, src, origem, user) {
  const base = {
    id: uid('R'), tipo, data: src.data,
    rota: String(src.rota ?? '').trim(),
    motorista: String(src.motorista ?? '').trim(),
    transportadora: String(src.transportadora ?? '').trim(),
    peso: parsePeso(src.peso),
    status: STATUS[tipo][0],
    chegada: null, saida: null, doca: null, fotos: [], obs: '',
    origem, criadoEm: nowISO(), criadoPor: user.nome, log: [],
  };
  if (tipo === 'VD') Object.assign(base, { previsto: src.previsto || '', responsaveis: [] });
  else Object.assign(base, { separadores: [], conferentes: [], expedidores: [], teveErro: null, erros: [] });
  log(base, user, origem === 'arquivo' ? 'Importada do arquivo' : 'Incluída manualmente');
  return base;
}

// vincula pré-reservas às rotas do dia (somente VD)
async function vincularPreReservas(data, user) {
  const ativas = await hAll('res:ativas');
  const pend = Object.values(ativas).filter((r) => !r.rotaId && r.data === data);
  if (!pend.length) return 0;
  const rotas = Object.values(await rotasDoDia('VD', data)).filter((r) => r.status !== 'expedido');
  const jaVinculadas = new Set(Object.values(ativas).filter((r) => r.rotaId).map((r) => r.rotaId));
  let n = 0;
  for (const res of pend.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))) {
    const alvo = rotas.find((r) => !jaVinculadas.has(r.id) && chaveRotaTransp(r) === chaveRotaTransp(res));
    if (alvo) {
      res.rotaId = alvo.id; res.motorista = alvo.motorista; res.vinculadoEm = nowISO();
      jaVinculadas.add(alvo.id);
      await hSet('res:ativas', res.id, res);
      n++;
    }
  }
  return n;
}

async function liberarReserva(res, user, motivo, automatico = false) {
  res.liberadoEm = nowISO();
  res.liberadoPor = automatico ? 'Automático' : user.nome;
  res.motivo = motivo;
  await hSet(`res:hist:${res.liberadoEm.slice(0, 7)}`, res.id, res);
  await hDel('res:ativas', res.id);
}

async function liberarPorRota(rotaId, user, motivo) {
  const ativas = await hAll('res:ativas');
  const lista = Object.values(ativas).filter((r) => r.rotaId === rotaId);
  for (const r of lista) await liberarReserva(r, user, motivo, true);
  return lista.length;
}

async function setCarregando(r) {
  if (r.tipo !== 'VD') return;
  if (r.status === 'em_carregamento' && r.doca) {
    await hSet('vd:carregando', r.id, { rotaId: r.id, data: r.data, posicaoId: r.doca, desde: r.chegada || nowISO() });
  } else {
    await hDel('vd:carregando', r.id);
  }
}

async function aposExpedir(r, user) {
  if (r.tipo !== 'VD') return 0;
  await hDel('vd:carregando', r.id);
  return liberarPorRota(r.id, user, 'Rota expedida');
}

// ---------- handlers ----------
const actions = {
  async bootstrap(b, user) {
    const [posicoes, colab, erros, settings] = await Promise.all([
      hAll('cfg:posicoes'), hAll('cfg:colab'), hAll('cfg:erros'), getJSON('cfg:settings'),
    ]);
    return {
      posicoes: Object.values(posicoes), colaboradores: Object.values(colab), erros: Object.values(erros),
      settings, hoje: hojeSP(),
      user: user.username ? { username: user.username, nome: user.nome, role: user.role } : null,
      avisos: {
        memoria: usingMemory,
        senhaPadrao: user.role === 'admin' && !process.env.ADMIN_PASSWORD,
        semBlob: !process.env.BLOB_READ_WRITE_TOKEN,
      },
    };
  },

  async login({ usuario, senha }) {
    const u = String(usuario || '').trim().toLowerCase();
    let sess = null;
    if (u === ADMIN_USER && senha === ADMIN_PASS) sess = { username: ADMIN_USER, nome: 'Administrador', role: 'admin' };
    else {
      const rec = await hGet('cfg:users', u);
      if (rec && rec.ativo !== false && hashSenha(senha, rec.salt) === rec.hash) sess = { username: u, nome: rec.nome, role: rec.role };
    }
    if (!sess) fail('Usuário ou senha inválidos', 401);
    const token = crypto.randomBytes(24).toString('hex');
    await setJSON('sess:' + token, sess, { ex: 60 * 60 * 24 * 7 });
    return { token, user: sess };
  },
  async logout(b, user) { if (user.token) await del('sess:' + user.token); return { ok: true }; },

  // ----- painel de stages e docas -----
  async painel() {
    const [posicoes, ativas, carregando] = await Promise.all([hAll('cfg:posicoes'), hAll('res:ativas'), hAll('vd:carregando')]);
    const datas = new Set([...Object.values(ativas).filter((r) => r.rotaId).map((r) => r.data), ...Object.values(carregando).map((c) => c.data)]);
    const cache = {};
    for (const d of datas) cache[d] = await rotasDoDia('VD', d);
    const reservas = Object.values(ativas).map((r) => {
      const rota = r.rotaId ? cache[r.data]?.[r.rotaId] : null;
      return { ...r, rotaInfo: rota ? { status: rota.status, motorista: rota.motorista, peso: rota.peso, rota: rota.rota, transportadora: rota.transportadora } : null };
    });
    const carr = Object.values(carregando).map((c) => {
      const rota = cache[c.data]?.[c.rotaId];
      return { ...c, rota: rota?.rota, transportadora: rota?.transportadora, motorista: rota?.motorista, peso: rota?.peso };
    });
    return { posicoes: Object.values(posicoes), reservas, carregando: carr, agora: nowISO() };
  },

  // rotas VD que podem receber reserva (não expedidas, últimos 10 dias + futuras)
  async rotasReservaveis() {
    const datas = (await sMembers('datas:VD')).filter((d) => d >= addDias(hojeSP(), -10)).sort();
    const ativas = Object.values(await hAll('res:ativas'));
    const alocada = Object.fromEntries(ativas.filter((r) => r.rotaId).map((r) => [r.rotaId, r.posicaoId]));
    const out = [];
    for (const d of datas) {
      Object.values(await rotasDoDia('VD', d)).forEach((r) => {
        if (r.status !== 'expedido') out.push({ id: r.id, data: r.data, rota: r.rota, transportadora: r.transportadora, motorista: r.motorista, peso: r.peso, posicaoId: alocada[r.id] || null });
      });
    }
    return out.sort((a, b) => a.data.localeCompare(b.data) || (parseInt(a.rota, 10) || 0) - (parseInt(b.rota, 10) || 0));
  },

  async reservar({ posicaoId, rotaRef, pre, mover, obs }, user) {
    const pos = await hGet('cfg:posicoes', posicaoId);
    if (!pos || !pos.ativo) fail('Stage/doca inválido ou inativo');
    const ativas = Object.values(await hAll('res:ativas'));
    const res = { id: uid('X'), posicaoId, criadoEm: nowISO(), criadoPor: user.nome, obs: obs || '' };
    if (rotaRef) {
      const r = await getRota('VD', rotaRef.data, rotaRef.id);
      if (r.status === 'expedido') fail('Esta rota já foi expedida');
      const existente = ativas.find((x) => x.rotaId === r.id);
      if (existente) {
        if (existente.posicaoId === posicaoId) fail('Esta rota já está alocada neste stage/doca');
        if (!mover) {
          const p = await hGet('cfg:posicoes', existente.posicaoId);
          return { conflito: true, posicaoAtual: p?.nome || existente.posicaoId };
        }
        await liberarReserva(existente, user, `Remanejada para ${pos.tipo === 'DOCA' ? 'doca' : 'stage'} ${pos.nome}`);
      }
      Object.assign(res, { data: r.data, rota: r.rota, transportadora: r.transportadora, motorista: r.motorista, rotaId: r.id });
    } else if (pre) {
      if (!isData(pre.data) || !String(pre.rota || '').trim() || !String(pre.transportadora || '').trim()) fail('Informe data, rota e transportadora');
      Object.assign(res, { data: pre.data, rota: String(pre.rota).trim(), transportadora: String(pre.transportadora).trim().toUpperCase(), motorista: '', rotaId: null, pre: true });
    } else fail('Informe a rota');
    await hSet('res:ativas', res.id, res);
    let vinculada = false;
    if (!res.rotaId) vinculada = (await vincularPreReservas(res.data, user)) > 0;
    return { ok: true, reserva: res, vinculada };
  },

  async liberar({ reservaId, motivo }, user) {
    need(user, 'lider');
    const res = await hGet('res:ativas', reservaId);
    if (!res) fail('Reserva não encontrada (talvez já liberada)', 404);
    if (!String(motivo || '').trim()) fail('Informe o motivo da liberação');
    await liberarReserva(res, user, `Liberação manual: ${motivo}`);
    return { ok: true };
  },

  async historicoReservas({ de, ate }) {
    if (!isData(de) || !isData(ate)) fail('Período inválido');
    const meses = new Set();
    for (let d = de; d <= ate; d = addDias(d, 1)) meses.add(d.slice(0, 7));
    const out = [];
    for (const m of meses) Object.values(await hAll(`res:hist:${m}`)).forEach((r) => { const d = r.liberadoEm.slice(0, 10); if (d >= de && d <= addDias(ate, 1)) out.push(r); });
    Object.values(await hAll('res:ativas')).forEach((r) => out.push(r));
    return out.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  },

  // ----- rotas -----
  async rotasDia({ tipo, data }) {
    checkTipo(tipo); if (!isData(data)) fail('Data inválida');
    const rotas = Object.values(await rotasDoDia(tipo, data));
    let alocacao = {};
    if (tipo === 'VD') {
      Object.values(await hAll('res:ativas')).forEach((r) => { if (r.rotaId) alocacao[r.rotaId] = r.posicaoId; });
    }
    return { rotas, alocacao };
  },

  async rotasPeriodo({ tipo, de, ate }) {
    checkTipo(tipo); if (!isData(de) || !isData(ate)) fail('Período inválido');
    const datas = (await sMembers(`datas:${tipo}`)).filter((d) => d >= de && d <= ate).sort();
    const out = [];
    for (const d of datas) out.push(...Object.values(await rotasDoDia(tipo, d)));
    return out;
  },

  async rotasDatas({ tipo, datas }) {
    checkTipo(tipo);
    const out = {};
    for (const d of (datas || []).filter(isData)) out[d] = Object.values(await rotasDoDia(tipo, d));
    return out;
  },

  async importar({ tipo, novas = [], atualizar = [] }, user) {
    checkTipo(tipo); need(user, 'lider');
    const porData = {};
    novas.forEach((n) => { if (isData(n.data)) (porData[n.data] ||= []).push(n); });
    atualizar.forEach((a) => { if (isData(a.data)) porData[a.data] ||= []; });
    let criadas = 0; let atualizadas = 0; let ignoradas = 0;
    for (const [data, lista] of Object.entries(porData)) {
      const existentes = await rotasDoDia(tipo, data);
      const chaves = new Set(Object.values(existentes).map(chaveRota));
      const novasObj = {};
      for (const n of lista) {
        if (!String(n.rota || '').trim()) { ignoradas++; continue; }
        if (!n.forcarNova && chaves.has(chaveRota(n))) { ignoradas++; continue; }
        const r = novaRota(tipo, { ...n, data }, 'arquivo', user);
        novasObj[r.id] = r; chaves.add(chaveRota(r)); criadas++;
      }
      for (const a of atualizar.filter((x) => x.data === data)) {
        const r = existentes[a.id];
        if (!r) continue;
        const antes = `${r.motorista} / ${r.peso}`;
        r.motorista = String(a.motorista ?? r.motorista).trim();
        r.peso = parsePeso(a.peso ?? r.peso);
        if (a.previsto && tipo === 'VD') r.previsto = a.previsto;
        log(r, user, `Atualizada pelo arquivo (antes: ${antes})`);
        r.atualizadoEm = nowISO();
        novasObj[r.id] = r; atualizadas++;
      }
      await hSetMany(kRotas(tipo, data), novasObj);
      await sAdd(`datas:${tipo}`, data);
    }
    let vinculadas = 0;
    if (tipo === 'VD') for (const d of Object.keys(porData)) vinculadas += await vincularPreReservas(d, user);
    return { criadas, atualizadas, ignoradas, vinculadas };
  },

  async rotaIncluir({ tipo, rota }, user) {
    checkTipo(tipo);
    if (!isData(rota?.data) || !String(rota.rota || '').trim()) fail('Informe a data e o número da rota');
    const existentes = Object.values(await rotasDoDia(tipo, rota.data));
    if (existentes.some((r) => chaveRota(r) === chaveRota(rota))) fail('Já existe uma rota com mesma data, número, transportadora e motorista');
    const r = novaRota(tipo, rota, 'manual', user);
    if (tipo === 'VD' && rota.previsto) r.previsto = rota.previsto;
    await saveRota(r);
    const vinculadas = tipo === 'VD' ? await vincularPreReservas(r.data, user) : 0;
    return { rota: r, vinculadas };
  },

  async rotaAtualizar({ tipo, data, id, patch = {} }, user) {
    checkTipo(tipo);
    const r = await getRota(tipo, data, id);
    if (r.status === 'expedido') need(user, 'admin');
    const operacionais = tipo === 'VD'
      ? ['previsto', 'responsaveis', 'doca', 'obs', 'chegada', 'saida', 'fotos']
      : ['separadores', 'conferentes', 'expedidores', 'teveErro', 'erros', 'doca', 'obs', 'chegada', 'saida', 'fotos'];
    const base = ['rota', 'motorista', 'transportadora', 'peso'];
    const mudou = [];
    for (const [k, v] of Object.entries(patch)) {
      if (operacionais.includes(k)) { r[k] = v; mudou.push(k); } else if (base.includes(k)) {
        need(user, 'lider');
        r[k] = k === 'peso' ? parsePeso(v) : String(v ?? '').trim(); mudou.push(k);
      } else if (k === 'status') {
        need(user, 'lider');
        if (!STATUS[tipo].includes(v)) fail('Status inválido');
        if (v === 'expedido' && !(r.fotos || []).length && !(patch.fotos || []).length) fail('Para marcar como expedido é preciso anexar ao menos uma foto');
        r.status = v; mudou.push('status');
        if (v === 'expedido' && !r.saida) r.saida = nowISO();
        if (v !== 'expedido' && !patch.saida) r.saida = null;
      }
    }
    if (r.teveErro === false) r.erros = [];
    log(r, user, `Editou: ${mudou.join(', ') || 'nada'}`);
    await saveRota(r);
    if (r.status === 'expedido') await aposExpedir(r, user); else await setCarregando(r);
    return { rota: r };
  },

  async rotaChegada({ tipo, data, id, horario, doca }, user) {
    checkTipo(tipo);
    const r = await getRota(tipo, data, id);
    if (r.status === 'expedido') fail('Rota já expedida');
    r.chegada = horario || nowISO();
    if (doca !== undefined) r.doca = doca || null;
    r.status = 'em_carregamento';
    log(r, user, 'Registrou chegada do veículo');
    await saveRota(r); await setCarregando(r);
    return { rota: r };
  },

  async rotaSaida({ tipo, data, id, horario, fotos = [], extra = {} }, user) {
    checkTipo(tipo);
    const r = await getRota(tipo, data, id);
    if (r.status === 'expedido') fail('Rota já expedida');
    const todas = Array.isArray(fotos) && fotos.length ? fotos : (r.fotos || []);
    if (!todas.length) fail('Anexe ao menos uma foto do ' + (tipo === 'VD' ? 'espelho' : 'romaneio') + ' assinado');
    const permitidos = tipo === 'VD' ? ['responsaveis', 'doca', 'obs'] : ['separadores', 'conferentes', 'expedidores', 'teveErro', 'erros', 'doca', 'obs'];
    for (const k of permitidos) if (extra[k] !== undefined) r[k] = extra[k];
    if (r.teveErro === false) r.erros = [];
    r.fotos = todas; r.saida = horario || nowISO(); r.status = 'expedido';
    log(r, user, 'Registrou saída / expedição');
    await saveRota(r);
    const liberadas = await aposExpedir(r, user);
    return { rota: r, liberadas };
  },

  async rotaExcluir({ tipo, data, id }, user) {
    checkTipo(tipo); need(user, 'coordenador');
    await getRota(tipo, data, id);
    await hDel(kRotas(tipo, data), id);
    if (tipo === 'VD') { await hDel('vd:carregando', id); await liberarPorRota(id, user, 'Rota excluída'); }
    return { ok: true };
  },

  async foto({ dataUrl, tipo, data, rotaId }) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) fail('Imagem inválida');
    if (!process.env.BLOB_READ_WRITE_TOKEN) return { url: dataUrl, em: nowISO() }; // modo local
    const buf = Buffer.from(m[2], 'base64');
    const ext = m[1].split('/')[1] === 'png' ? 'png' : 'jpg';
    const blob = await put(`expedicao/${tipo}/${data}/${rotaId}-${Date.now()}.${ext}`, buf, { access: 'public', contentType: m[1], addRandomSuffix: true });
    return { url: blob.url, em: nowISO() };
  },

  // ----- cadastros -----
  async posicaoSalvar({ posicao }, user) {
    need(user, 'coordenador');
    const nome = String(posicao?.nome || '').trim().toUpperCase();
    const tipo = posicao?.tipo === 'STAGE' ? 'STAGE' : 'DOCA';
    if (!nome) fail('Informe o nome');
    const todas = Object.values(await hAll('cfg:posicoes'));
    if (todas.some((p) => p.id !== posicao.id && norm(p.nome) === norm(nome) && p.tipo === tipo)) fail('Já existe um ' + tipo.toLowerCase() + ' com esse nome');
    const atual = posicao.id ? todas.find((p) => p.id === posicao.id) : null;
    if (atual && atual.ativo && posicao.ativo === false) {
      const ocup = Object.values(await hAll('res:ativas')).some((r) => r.posicaoId === atual.id);
      if (ocup) fail('Este stage/doca está ocupado. Libere antes de inativar.');
    }
    const num = parseInt(nome, 10) || 0;
    const lado = /E$/.test(nome) ? 1 : /D$/.test(nome) ? 2 : 0;
    const p = { ...(atual || { id: uid('P') }), nome, tipo, ativo: posicao.ativo !== false, ordem: num * 10 + lado };
    await hSet('cfg:posicoes', p.id, p);
    return { posicao: p };
  },

  async colabSalvar({ colab }, user) {
    need(user, 'coordenador');
    const nome = norm(colab?.nome);
    if (!nome) fail('Informe o nome');
    const todos = Object.values(await hAll('cfg:colab'));
    if (todos.some((c) => c.id !== colab.id && norm(c.nome) === nome)) fail('Já existe um colaborador com esse nome');
    const atual = colab.id ? todos.find((c) => c.id === colab.id) : null;
    const c = { ...(atual || { id: uid('C') }), nome: String(colab.nome).trim().replace(/\s+/g, ' ').toUpperCase(), cargo: colab.cargo || '', turno: colab.turno || '', ativo: colab.ativo !== false };
    await hSet('cfg:colab', c.id, c);
    return { colab: c };
  },

  async colabImportar({ lista = [], inativarAusentes = false }, user) {
    need(user, 'coordenador');
    const todos = await hAll('cfg:colab');
    const porNome = Object.fromEntries(Object.values(todos).map((c) => [norm(c.nome), c]));
    const vistos = new Set(); let novos = 0; let atualizados = 0; let inativados = 0;
    const upd = {};
    for (const it of lista) {
      const n = norm(it.nome); if (!n || vistos.has(n)) continue; vistos.add(n);
      const ex = porNome[n];
      if (ex) { upd[ex.id] = { ...ex, cargo: it.cargo || ex.cargo, turno: it.turno || ex.turno, ativo: true }; atualizados++; } else {
        const c = { id: uid('C'), nome: String(it.nome).trim().replace(/\s+/g, ' ').toUpperCase(), cargo: it.cargo || '', turno: it.turno || '', ativo: true };
        upd[c.id] = c; novos++;
      }
    }
    if (inativarAusentes) Object.values(todos).forEach((c) => { if (!vistos.has(norm(c.nome)) && c.ativo) { upd[c.id] = { ...c, ativo: false }; inativados++; } });
    await hSetMany('cfg:colab', upd);
    return { novos, atualizados, inativados };
  },

  async erroSalvar({ erro }, user) {
    need(user, 'coordenador');
    const nome = String(erro?.nome || '').trim();
    if (!nome) fail('Informe o nome do erro');
    const todos = Object.values(await hAll('cfg:erros'));
    if (todos.some((e) => e.id !== erro.id && norm(e.nome) === norm(nome))) fail('Esse tipo de erro já existe');
    const atual = erro.id ? todos.find((e) => e.id === erro.id) : null;
    const e = { ...(atual || { id: uid('E'), ordem: todos.length }), nome, ativo: erro.ativo !== false };
    await hSet('cfg:erros', e.id, e);
    return { erro: e };
  },

  async settingsSalvar({ settings }, user) {
    need(user, 'coordenador');
    const s = { alertaStageHoras: Math.max(1, Number(settings?.alertaStageHoras) || 12), toleranciaAtrasoMin: Math.max(0, Number(settings?.toleranciaAtrasoMin) || 0) };
    await setJSON('cfg:settings', s);
    return { settings: s };
  },

  async usuarios(b, user) {
    need(user, 'admin');
    return Object.values(await hAll('cfg:users')).map(({ salt, hash, ...u }) => u);
  },
  async usuarioSalvar({ usuario }, user) {
    need(user, 'admin');
    const username = String(usuario?.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) fail('Usuário deve ter de 3 a 30 caracteres (letras, números, ponto, hífen)');
    if (username === ADMIN_USER) fail('Esse nome de usuário é reservado');
    if (!['lider', 'coordenador'].includes(usuario.role)) fail('Perfil inválido');
    const atual = await hGet('cfg:users', username);
    if (!atual && !usuario.senha) fail('Informe a senha');
    const rec = { ...(atual || {}), username, nome: String(usuario.nome || username).trim(), role: usuario.role, ativo: usuario.ativo !== false, perfil: ROLE_LABEL[usuario.role] };
    if (usuario.senha) { if (String(usuario.senha).length < 4) fail('A senha precisa ter ao menos 4 caracteres'); rec.salt = crypto.randomBytes(8).toString('hex'); rec.hash = hashSenha(usuario.senha, rec.salt); }
    await hSet('cfg:users', username, rec);
    return { ok: true };
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fn = actions[body.action];
    if (!fn) fail('Ação desconhecida', 404);
    await ensureSeed();
    const user = await getUser(req);
    const out = await fn(body, user);
    return res.status(200).json(out ?? { ok: true });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    return res.status(status).json({ error: e.message || 'Erro interno' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
