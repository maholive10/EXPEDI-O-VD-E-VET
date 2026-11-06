// Camada de dados: Upstash Redis em produção, memória (ou arquivo) em desenvolvimento local.
import { Redis } from '@upstash/redis';
import fs from 'node:fs';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

function memoryStore() {
  const file = process.env.LOCAL_DB_FILE;
  let db = {};
  if (file && fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const save = () => { if (file) fs.writeFileSync(file, JSON.stringify(db)); };
  const exp = {};
  const alive = (k) => !(exp[k] && exp[k] < Date.now());
  return {
    async get(k) { return alive(k) ? (db[k] ?? null) : null; },
    async set(k, v, opt) { db[k] = v; if (opt?.ex) exp[k] = Date.now() + opt.ex * 1000; save(); return 'OK'; },
    async del(k) { delete db[k]; save(); return 1; },
    async hget(k, f) { return db[k]?.[f] ?? null; },
    async hset(k, obj) { db[k] = { ...(db[k] || {}), ...obj }; save(); return 1; },
    async hdel(k, ...fs_) { if (db[k]) fs_.forEach((f) => delete db[k][f]); save(); return 1; },
    // mesmo formato do Upstash: [campo, valor, campo, valor, ...]
    async hgetall(k) { const h = db[k]; return h && Object.keys(h).length ? Object.entries(h).flat() : null; },
    async sadd(k, ...m) { db[k] = [...new Set([...(db[k] || []), ...m])]; save(); return 1; },
    async smembers(k) { return db[k] || []; },
  };
}

export const redis = url && token
  ? new Redis({ url, token, automaticDeserialization: false })
  : memoryStore();

export const usingMemory = !(url && token);

const parse = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

export async function getJSON(k) { return parse(await redis.get(k)); }
export async function setJSON(k, v, opt) { return redis.set(k, JSON.stringify(v), opt); }
export async function hGet(k, f) { return parse(await redis.hget(k, f)); }
export async function hSet(k, f, v) { return redis.hset(k, { [f]: JSON.stringify(v) }); }
export async function hSetMany(k, obj) {
  const entries = Object.entries(obj);
  if (!entries.length) return;
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = Object.fromEntries(entries.slice(i, i + 200).map(([f, v]) => [f, JSON.stringify(v)]));
    await redis.hset(k, chunk);
  }
}
export async function hDel(k, f) { return redis.hdel(k, f); }
export async function hAll(k) {
  const h = await redis.hgetall(k);
  if (!h) return {};
  const out = {};
  // O Upstash (sem desserialização automática) devolve [campo, valor, campo, valor, ...]
  if (Array.isArray(h)) {
    for (let i = 0; i < h.length; i += 2) out[h[i]] = parse(h[i + 1]);
    return out;
  }
  for (const [f, v] of Object.entries(h)) out[f] = parse(v);
  return out;
}
export async function sAdd(k, ...m) { return redis.sadd(k, ...m); }
export async function sMembers(k) { return (await redis.smembers(k)) || []; }
export async function del(k) { return redis.del(k); }
