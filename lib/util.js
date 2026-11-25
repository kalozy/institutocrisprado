import { waitUntil } from '@vercel/functions';

export const TZ = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

/** Data/hora local de São Paulo no formato "AAAA-MM-DD HH:MM:SS" (ordenável como texto). */
export function nowLocal(d = new Date()) { return fmt.format(d).replace('T', ' '); }
export function today() { return nowLocal().slice(0, 10); }
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function isYmd(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

export function str(v, max = 255) {
  if (v === null || v === undefined || typeof v === 'object') return '';
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
export function isHttpUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return false;
  try { new URL(u); return true; } catch { return false; }
}
export function num(v) {
  let s = String(v ?? '').replace(/R\$|\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- HTTP ---------- */
export function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  return Object.fromEntries(new URL(req.url, 'http://local').searchParams);
}

function parse(s) {
  if (!s) return {};
  try { const j = JSON.parse(s); return j && typeof j === 'object' ? j : {}; } catch { /* formulário */ }
  return Object.fromEntries(new URLSearchParams(s));
}

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') return parse(req.body);
    if (Buffer.isBuffer(req.body)) return parse(req.body.toString('utf8'));
    if (typeof req.body === 'object') return req.body;
  }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 65536) break; chunks.push(c); }
  return parse(Buffer.concat(chunks).toString('utf8'));
}

export function send(res, code, data, headers = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function header(req, name) {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : (v || '');
}

export function clientIp(req) {
  for (const h of ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']) {
    const v = header(req, h);
    if (v) { const ip = v.split(',')[0].trim(); if (ip) return ip.slice(0, 64); }
  }
  return (req.socket && req.socket.remoteAddress) || '';
}
export function userAgent(req) { return str(header(req, 'user-agent'), 500); }
export function isHttps(req) { return header(req, 'x-forwarded-proto') === 'https' || !!(req.socket && req.socket.encrypted); }
export function siteOrigin(req) { return (isHttps(req) ? 'https://' : 'http://') + (header(req, 'x-forwarded-host') || header(req, 'host')); }

/** Aceita só chamadas vindas do próprio site. */
export function sameOrigin(req) {
  const host = (header(req, 'x-forwarded-host') || header(req, 'host')).toLowerCase().replace(/:\d+$/, '');
  const src = header(req, 'origin') || header(req, 'referer');
  if (!src || src === 'null') return true; // alguns navegadores dentro de apps não enviam
  try { return new URL(src).hostname.toLowerCase() === host; } catch { return false; }
}

/** Continua um trabalho depois de responder (envio para a Meta). */
export function background(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error('[bg]', e && e.message));
  try { waitUntil(p); } catch { /* fora do Vercel o Node continua rodando */ }
  return p;
}
