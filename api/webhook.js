/*
 * POST /api/webhook?key=CHAVE&p=curso — pagamento aprovado (Cartpag, Cartpix ou qualquer checkout).
 * Procura e-mail/telefone no corpo (JSON ou formulário), marca o lead como "Comprou"
 * e, se ativado no painel, envia Purchase para a CAPI. A URL completa aparece no painel.
 */
import crypto from 'node:crypto';
import { readBody, send, query, str, num, isHttpUrl, nowLocal, siteOrigin, background } from '../lib/util.js';
import { findLead, saveLead, updateLead, settingsFor } from '../lib/store.js';
import { enabled, userData, event, sendCapi } from '../lib/meta.js';
import { getProduct } from '../lib/products.js';
import { webhookKey, configured } from '../lib/auth.js';

function flat(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = (prefix ? prefix + '.' + k : String(k)).toLowerCase();
    if (v && typeof v === 'object') flat(v, key, out); else if (v !== null && v !== undefined) out[key] = String(v);
  }
  return out;
}
const GOOD = ['paid', 'approved', 'aprovado', 'aprovada', 'pago', 'paga', 'completed', 'complete', 'succeeded', 'confirmed', 'confirmado', 'purchase', 'concluido', 'concluida'];
const BAD = ['unpaid', 'not', 'refused', 'recusado', 'canceled', 'cancelled', 'cancelado', 'refunded', 'reembolsado', 'chargeback', 'failed', 'pending', 'pendente', 'waiting', 'aguardando', 'expired', 'expirado', 'created'];

export default async function handler(req, res) {
  const qs = query(req);
  const key = String(qs.key || '');
  const expected = configured() ? webhookKey() : '';
  if (!expected || key.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))) return send(res, 403, { ok: false, error: 'chave inválida' });
  if (req.method !== 'POST') return send(res, 200, { ok: true, message: 'Webhook do Instituto Cris Prado ativo. Envie um POST.' });
  try {
    const pid = str(qs.p, 60);
    const prod = pid ? getProduct(pid) : null;
    if (pid && (!prod || prod.kind !== 'course')) return send(res, 400, { ok: false, error: 'curso desconhecido em ?p=' });
    const f = flat(await readBody(req));

    let email = '', phone = '', value = null, status = null, name = '';
    for (const [k, v] of Object.entries(f)) {
      const leaf = k.split('.').pop();
      if (!email && leaf.includes('email') && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim())) email = v.trim().toLowerCase();
      if (!phone && /phone|telefone|celular|whatsapp|mobile|fone/.test(leaf)) {
        let d = v.replace(/\D/g, ''); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
        if (/^[1-9][1-9]\d{8,9}$/.test(d)) phone = d;
      }
      if (value === null && ['value', 'total', 'amount', 'price', 'valor', 'total_price', 'amount_paid'].includes(leaf) && num(v) > 0) value = num(v);
      if (!name && ['name', 'nome', 'full_name', 'customer_name'].includes(leaf) && v.trim()) name = str(v, 120);
    }
    for (const p of ['status', 'payment_status', 'event', 'data.status', 'order.status', 'payment.status', 'transaction.status', 'sale.status', 'charge.status', 'data.payment_status']) {
      if (f[p] && f[p].trim()) { status = f[p].trim().toLowerCase(); break; }
    }
    if (qs.status) status = String(qs.status).toLowerCase();
    if (status) {
      const t = status.split(/[._\s:-]+/);
      if (!(t.some((x) => GOOD.includes(x)) && !t.some((x) => BAD.includes(x)))) return send(res, 200, { ok: true, ignored: true, reason: 'status não é de pagamento aprovado: ' + status });
    }
    if (!email && !phone) return send(res, 422, { ok: false, error: 'e-mail ou telefone não encontrado no corpo' });

    let lead = (email && await findLead(pid, 'email', email)) || (phone && await findLead(pid, 'phone', phone)) || null;
    const product = lead ? lead.product : pid;
    if (!product) return send(res, 422, { ok: false, error: 'comprador não encontrado; inclua &p=curso na URL do webhook' });
    const s = await settingsFor(product);
    const price = num(s.price);
    if (value === null || value <= 0) value = price;
    else if (value >= 1000 && price > 0 && Math.abs(value / 100 - price) < price * 0.6) value = value / 100; // centavos

    const now = nowLocal();
    let already = false;
    if (lead) {
      already = !!lead.paid_at;
      const upd = { status: 'comprou', updated_at: now, paid_value: value };
      if (!already) upd.paid_at = now;
      if (!lead.email && email) upd.email = email;
      if (!lead.phone && phone) upd.phone = phone;
      lead = await updateLead(lead.id, upd);
    } else {
      // Comprador que não passou pelo formulário: entra como compra, sem contar como lead da página.
      const r = await saveLead(product, { name, email, phone, referrer: 'webhook' }, true);
      lead = await updateLead(r.lead.id, { status: 'comprou', paid_at: now, paid_value: value });
    }
    send(res, 200, { ok: true, lead_id: lead.id, product, already_paid: already });

    if (!already && s.capi_purchase === '1' && enabled(s)) {
      const p = getProduct(product);
      const url = isHttpUrl(lead.landing) ? lead.landing : siteOrigin(req) + p.path;
      background(sendCapi(s, [event('Purchase', 'purchase.' + lead.id, url,
        userData({ ip: lead.ip, ua: lead.ua, fbp: lead.fbp, fbc: lead.fbc, vid: lead.vid }, lead),
        { value: Math.round(value * 100) / 100, currency: 'BRL', content_name: p.name, content_ids: [p.id], content_type: 'product', num_items: 1 })]));
    }
  } catch (e) {
    console.error('[webhook]', e.message);
    if (!res.headersSent) send(res, 500, { ok: false, error: 'erro interno' });
  }
}
