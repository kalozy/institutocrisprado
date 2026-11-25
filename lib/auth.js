/**
 * Login do painel (senha única em ADMIN_PASSWORD) com cookie assinado por APP_SECRET.
 */
import crypto from 'node:crypto';
import { header, isHttps } from './util.js';

const COOKIE = 'cp_admin';
const TTL = 12 * 60 * 60 * 1000;

export function configured() {
  return !!process.env.ADMIN_PASSWORD && (process.env.APP_SECRET || '').length >= 16;
}
const secret = () => process.env.APP_SECRET || '';
const pwTag = () => crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD || '').digest('hex');
const mac = (data) => crypto.createHmac('sha256', secret() + '|' + pwTag()).update(data).digest('base64url');

function cookies(req) {
  const out = {};
  for (const part of header(req, 'cookie').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function session(req) {
  if (!configured()) return null;
  const token = cookies(req)[COOKIE];
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = mac(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function checkPassword(pw) {
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD || '').digest();
  return configured() && crypto.timingSafeEqual(a, b);
}

export function startSession(req, res) {
  const payload = { exp: Date.now() + TTL, csrf: crypto.randomBytes(16).toString('hex') };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${data}.${mac(data)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}${isHttps(req) ? '; Secure' : ''}`);
  return payload;
}

export function endSession(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}

export function webhookKey() {
  return crypto.createHmac('sha256', secret()).update('webhook').digest('hex').slice(0, 32);
}

export function rateKey(bucket, ip) {
  return bucket + ':' + crypto.createHmac('sha256', secret() || 'cp').update(ip || '').digest('hex').slice(0, 24);
}
