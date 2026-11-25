/**
 * API de Conversões da Meta (CAPI). Mesmo event_id do Pixel → a Meta deduplica.
 */
import crypto from 'node:crypto';
import { saveSettings } from './store.js';
import { nowLocal } from './util.js';

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';

/** Eventos aceitos do navegador → contador do funil no painel (null = só Meta). */
export const BROWSER_EVENTS = {
  PageView: 'visit', ViewContent: null,
  Scroll25: 'scroll25', Scroll50: 'scroll50', Scroll75: 'scroll75', Scroll90: 'scroll90',
  TimeOnPage30: 'time30', TimeOnPage60: 'time60', TimeOnPage120: 'time120',
  ViewOffer: 'offer', ClickCTA: 'cta', FAQOpen: 'faq', FormStart: 'form_start',
  VideoSoundOn: 'video_sound', Video50: 'video50', VideoComplete: 'video_complete',
  InitiateCheckout: 'checkout',
  Contact: 'contact', ClickCourse: 'course_click', ClickInstagram: 'instagram'
};

export function enabled(s) {
  return s.capi_enabled === '1' && String(s.pixel_id || '').trim() !== '' && String(s.capi_token || '').trim() !== '';
}

const h = (v) => crypto.createHash('sha256').update(v).digest('hex');
const normName = (v) => String(v || '').trim().toLowerCase().replace(/[^\p{L}]/gu, '');

/** user_data: IP, navegador, cookies da Meta, external_id e, com lead, e-mail/telefone/nome com hash SHA-256. */
export function userData(ctx, lead = null) {
  const pick = (k) => (ctx[k] ? String(ctx[k]) : (lead && lead[k] ? String(lead[k]) : ''));
  const ud = {};
  if (ctx.ip) ud.client_ip_address = ctx.ip;
  if (ctx.ua) ud.client_user_agent = ctx.ua;
  const fbp = pick('fbp'), fbc = pick('fbc'), vid = pick('vid');
  if (/^fb\.\d\.\d+\.[\w-]+$/.test(fbp)) ud.fbp = fbp;
  if (/^fb\.\d\.\d+\..+$/.test(fbc)) ud.fbc = fbc;
  if (vid) ud.external_id = [h(vid)];
  if (lead) {
    const email = String(lead.email || '').trim().toLowerCase();
    if (email) ud.em = [h(email)];
    const phone = String(lead.phone || '').replace(/\D/g, '');
    if (phone) ud.ph = [h(phone.length <= 11 ? '55' + phone : phone)];
    const parts = String(lead.name || '').trim().split(/\s+/).filter(Boolean);
    const fn = normName(parts[0]), ln = parts.length > 1 ? normName(parts[parts.length - 1]) : '';
    if (fn) ud.fn = [h(fn)];
    if (ln) ud.ln = [h(ln)];
    ud.country = [h('br')];
  }
  return ud;
}

/** Limpa custom_data vindo do navegador. */
export function customData(data) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (!/^[a-z_]{1,32}$/.test(k)) continue;
    if (['value', 'percent', 'seconds', 'num_items'].includes(k)) { if (v !== '' && Number.isFinite(Number(v))) out[k] = Number(v); continue; }
    if (k === 'currency') { if (/^[A-Z]{3}$/.test(String(v))) out[k] = String(v); continue; }
    if (k === 'content_ids') { if (Array.isArray(v)) out[k] = v.slice(0, 5).map((x) => String(x).slice(0, 60)); continue; }
    if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = String(v).slice(0, 120);
  }
  return out;
}

export function event(name, eventId, url, ud, custom = {}, time = null) {
  const e = { event_name: name, event_time: time || Math.floor(Date.now() / 1000), event_id: eventId, action_source: 'website', event_source_url: url, user_data: ud };
  if (Object.keys(custom).length) e.custom_data = custom;
  return e;
}

/** Envia para a Meta e guarda o último resultado para o diagnóstico do painel. */
export async function sendCapi(s, events, { save = true } = {}) {
  if (!enabled(s)) return { ok: false, skipped: true, message: 'CAPI desativada ou sem token.' };
  const payload = { data: events };
  const test = String(s.capi_test_code || '').trim();
  if (test) payload.test_event_code = test;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(String(s.pixel_id).trim())}/events?access_token=${encodeURIComponent(String(s.capi_token).trim())}`;
  let status = 0, json = null, err = '';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
    clearTimeout(t);
    status = r.status;
    json = await r.json().catch(() => null);
  } catch (e) { err = e.message || 'falha de rede'; }
  const ok = status >= 200 && status < 300 && json && json.events_received !== undefined;
  const message = ok ? `Recebido pela Meta (${json.events_received})` : (err || (json && json.error && (json.error.error_user_msg || json.error.message)) || `HTTP ${status}`);
  const result = { ok, status, message, event: events[0] ? events[0].event_name : '', product: s.product || '', at: nowLocal(), fbtrace_id: (json && (json.fbtrace_id || (json.error && json.error.fbtrace_id))) || '' };
  if (save) {
    try {
      const v = { capi_last: JSON.stringify(result) };
      if (!ok) v.capi_last_error = v.capi_last;
      await saveSettings('global', v);
    } catch { /* diagnóstico é opcional */ }
  }
  return result;
}
