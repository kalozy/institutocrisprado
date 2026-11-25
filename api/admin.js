/* /api/admin?action=… — painel de leads (login, métricas, leads, exportação, configurações). */
import { readBody, send, query, str, num, isHttpUrl, isYmd, today, addDays, clientIp, userAgent, siteOrigin, nowLocal } from '../lib/util.js';
import { configured, session, checkPassword, startSession, endSession, webhookKey, rateKey } from '../lib/auth.js';
import * as store from '../lib/store.js';
import { enabled, event, userData, sendCapi, GRAPH_VERSION } from '../lib/meta.js';
import { PRODUCTS, getProduct } from '../lib/products.js';
import { databaseLabel } from '../lib/db.js';

const PRODUCT_LIST = Object.values(PRODUCTS).map(({ id, name, kind, path }) => ({ id, name, kind, path }));
const mask = (t) => (t ? '•'.repeat(12) + String(t).slice(-4) : '');

function filters(qs) {
  return {
    product: getProduct(String(qs.p || '')) ? String(qs.p) : '',
    q: str(qs.q, 120), status: str(qs.status, 20), source: str(qs.source, 120), campaign: str(qs.campaign, 200),
    from: isYmd(qs.from) ? qs.from : '', to: isYmd(qs.to) ? qs.to : ''
  };
}
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmula no Excel
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const fmtPhone = (d) => (!d ? '' : d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`);

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const qs = query(req);
  const action = String(qs.action || '');
  const post = req.method === 'POST';
  try {
    if (action === 'me') {
      const s = session(req);
      const missing = [];
      if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
      if ((process.env.APP_SECRET || '').length < 16) missing.push('APP_SECRET');
      const db = databaseLabel();
      return send(res, 200, { ok: true, configured: configured(), database: db !== 'não conectado', missing, logged: !!s, csrf: s ? s.csrf : '', products: PRODUCT_LIST });
    }
    if (action === 'login' && post) {
      if (!configured()) return send(res, 503, { ok: false, error: 'Defina ADMIN_PASSWORD e APP_SECRET nas variáveis de ambiente do Vercel.' });
      if (await store.hit(rateKey('login', clientIp(req)), 900) > 8) return send(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' });
      const b = await readBody(req);
      if (!checkPassword(b.password)) { await new Promise((r) => setTimeout(r, 600)); return send(res, 401, { ok: false, error: 'Senha incorreta.' }); }
      const p = startSession(req, res);
      return send(res, 200, { ok: true, csrf: p.csrf });
    }
    if (action === 'logout') { endSession(req, res); return send(res, 200, { ok: true }); }

    const sess = session(req);
    if (!sess) return send(res, 401, { ok: false, error: 'login' });
    if (post && req.headers['x-csrf'] !== sess.csrf) return send(res, 403, { ok: false, error: 'csrf' });

    switch (action) {
      case 'stats': {
        const pid = getProduct(String(qs.p || '')) ? String(qs.p) : '';
        let to = isYmd(qs.to) ? qs.to : today();
        let from = isYmd(qs.from) ? qs.from : addDays(to, -29);
        if (from > to) [from, to] = [to, from];
        if (addDays(from, 400) < to) from = addDays(to, -400);
        const st = await store.stats(pid, from, to);
        const s = await store.settingsFor(pid || 'start-lips');
        let last = null; try { last = JSON.parse(s.capi_last || 'null'); } catch { /* vazio */ }
        st.capi = { enabled: enabled(s), pixel: !!String(s.pixel_id).trim(), last, test_mode: !!String(s.capi_test_code).trim() };
        if (pid && getProduct(pid).kind === 'course') st.checkout_ok = isHttpUrl(s.checkout_url);
        else if (!pid) {
          const missing = [];
          for (const p of Object.values(PRODUCTS)) if (p.kind === 'course' && !isHttpUrl((await store.settingsFor(p.id)).checkout_url)) missing.push(p.name);
          st.checkout_missing = missing;
        }
        return send(res, 200, { ok: true, ...st });
      }
      case 'leads': {
        const page = Math.max(1, Number(qs.page) || 1);
        const per = Math.min(200, Math.max(10, Number(qs.per) || 50));
        const f = filters(qs);
        const r = await store.listLeads(f, page, per);
        return send(res, 200, {
          ok: true, items: r.items, total: r.total, page, pages: Math.max(1, Math.ceil(r.total / per)),
          sources: await store.distinctValues('utm_source', f.product), campaigns: await store.distinctValues('utm_campaign', f.product)
        });
      }
      case 'poll': {
        const now = nowLocal();
        const since = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(qs.since || '')) ? String(qs.since) : '';
        const items = since ? (await store.listLeads({ since, product: filters(qs).product }, 1, 20)).items : [];
        return send(res, 200, { ok: true, now, items });
      }
      case 'update': {
        if (!post) return send(res, 405, { ok: false });
        const b = await readBody(req);
        const lead = await store.getLead(Number(b.id) || 0);
        if (!lead) return send(res, 404, { ok: false, error: 'Lead não encontrado.' });
        const upd = { updated_at: nowLocal() };
        if (b.status !== undefined) {
          if (!store.STATUSES.includes(b.status)) return send(res, 422, { ok: false, error: 'Status inválido.' });
          upd.status = b.status;
          if (b.status === 'comprou' && !lead.paid_at) { upd.paid_at = nowLocal(); upd.paid_value = num((await store.settingsFor(lead.product)).price); }
          if (b.status !== 'comprou' && lead.paid_at) { upd.paid_at = ''; upd.paid_value = 0; }
        }
        if (b.notes !== undefined) upd.notes = String(b.notes).slice(0, 2000);
        return send(res, 200, { ok: true, lead: await store.updateLead(lead.id, upd) });
      }
      case 'delete': {
        if (!post) return send(res, 405, { ok: false });
        const b = await readBody(req);
        await store.deleteLead(Number(b.id) || 0);
        return send(res, 200, { ok: true });
      }
      case 'export': {
        const f = filters(qs);
        const rows = await store.allLeads(f);
        const cols = [['id', 'ID'], ['product', 'Curso'], ['created_at', 'Criado em'], ['submitted_at', 'Enviado em'], ['status', 'Status'], ['name', 'Nome'], ['email', 'E-mail'], ['phone', 'WhatsApp'],
          ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'utm_campaign'], ['utm_content', 'utm_content'], ['utm_term', 'utm_term'],
          ['submissions', 'Envios'], ['paid_at', 'Pago em'], ['paid_value', 'Valor pago'], ['notes', 'Observações'], ['landing', 'Página'], ['referrer', 'Referência']];
        const lines = [cols.map((c) => c[1]).join(';')];
        for (const r of rows) lines.push(cols.map(([k]) => csvCell(k === 'phone' ? fmtPhone(r.phone) : k === 'product' ? (getProduct(r.product) || {}).name || r.product : r[k])).join(';'));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="leads-${f.product || 'todos'}-${today()}.csv"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.end('﻿' + lines.join('\r\n'));
      }
      case 'settings': {
        const scope = String(qs.scope || 'global');
        const prod = scope === 'global' ? null : getProduct(scope);
        if (scope !== 'global' && !prod) return send(res, 400, { ok: false, error: 'escopo inválido' });
        if (post) {
          const b = await readBody(req);
          const save = {};
          const bool = (k) => { save[k] = b[k] ? '1' : '0'; };
          const token = (k) => { const t = String(b[k] ?? '').trim(); if (!t) save[k] = ''; else if (!t.includes('•')) save[k] = t.replace(/\s+/g, '').slice(0, 600); };
          if (!prod) {
            save.pixel_id = String(b.pixel_id || '').replace(/\D/g, '').slice(0, 30);
            token('capi_token');
            save.capi_test_code = str(b.capi_test_code, 40);
            ['capi_enabled', 'capi_purchase', 'notify_sound'].forEach(bool);
          } else {
            const co = str(b.checkout_url, 1000);
            if (co && !isHttpUrl(co)) return send(res, 422, { ok: false, error: 'O link do checkout precisa começar com https://' });
            save.checkout_url = co;
            for (const k of ['price', 'price_from']) { const n = num(b[k]); save[k] = n > 0 ? String(Math.round(n * 100) / 100) : ''; }
            save.installments = str(b.installments, 80);
            save.promo_text = str(b.promo_text, 120);
            save.deadline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.deadline || '')) ? b.deadline : '';
            save.wa_template = str(b.wa_template, 1000);
            save.pixel_id = String(b.pixel_id || '').replace(/\D/g, '').slice(0, 30);
            token('capi_token');
            ['pass_utm', 'pass_lead'].forEach(bool);
          }
          await store.saveSettings(scope, save);
        }
        const raw = { ...(prod ? { ...store.PRODUCT_DEFAULTS, ...prod.defaults } : store.GLOBAL_DEFAULTS), ...(await store.getSettings(scope)) };
        const settings = { ...raw };
        delete settings.capi_last; delete settings.capi_last_error;
        settings.capi_token = mask(raw.capi_token);
        if (prod && !String(settings.wa_template || '').trim()) settings.wa_template = store.PRODUCT_DEFAULTS.wa_template;
        const g = await store.getSettings('global');
        let last = null, lastErr = null;
        try { last = JSON.parse(g.capi_last || 'null'); lastErr = JSON.parse(g.capi_last_error || 'null'); } catch { /* vazio */ }
        return send(res, 200, {
          ok: true, scope, settings,
          info: {
            graph: GRAPH_VERSION, node: process.version, webhook_key: webhookKey(), capi_last: last, capi_last_error: lastErr,
            database: databaseLabel()
          }
        });
      }
      case 'capi_test': {
        if (!post) return send(res, 405, { ok: false });
        const pid = getProduct(String(qs.p || '')) ? String(qs.p) : 'instituto';
        const s = await store.settingsFor(pid);
        if (!enabled(s)) return send(res, 200, { ok: false, message: 'Preencha o Pixel ID e o token da CAPI e deixe a CAPI ativada.' });
        const r = await sendCapi(s, [event('PageView', 'test.' + Date.now().toString(36), siteOrigin(req) + getProduct(pid).path, userData({ ip: clientIp(req), ua: userAgent(req) }))]);
        return send(res, 200, { ...r, test_mode: !!String(s.capi_test_code).trim() });
      }
      default:
        return send(res, 400, { ok: false, error: 'ação desconhecida' });
    }
  } catch (e) {
    console.error('[admin]', e.message);
    if (!res.headersSent) send(res, 500, { ok: false, error: 'Erro no servidor: ' + e.message });
  }
}
