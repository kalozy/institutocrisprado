/*
 * POST /api/lead — salva o lead (nome, e-mail, WhatsApp + origem) e devolve o link do checkout.
 * partial=1: preencheu e-mail ou WhatsApp e ainda não enviou (lead parcial).
 * No primeiro envio completo, manda Lead para a CAPI com o mesmo event_id do Pixel.
 */
import { readBody, send, str, isHttpUrl, clientIp, userAgent, sameOrigin, siteOrigin, background } from '../lib/util.js';
import { saveLead, settingsFor, hit } from '../lib/store.js';
import { enabled, userData, event, sendCapi } from '../lib/meta.js';
import { getProduct } from '../lib/products.js';
import { rateKey } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false });
  if (!sameOrigin(req)) return send(res, 403, { ok: false });
  let checkout = '';
  try {
    const b = await readBody(req);
    const pid = str(b.p, 60);
    const prod = getProduct(pid);
    if (!prod || prod.kind !== 'course') return send(res, 400, { ok: false, error: 'curso desconhecido' });
    const partial = Number(b.partial) === 1;
    const s = await settingsFor(pid);
    checkout = isHttpUrl(s.checkout_url) ? s.checkout_url : '';

    if (str(b.company)) return send(res, 200, { ok: true, id: 0, first: false, redirect: checkout }); // robô
    const ip = clientIp(req);
    if (await hit(rateKey(partial ? 'partial' : 'lead', ip), 600) > (partial ? 60 : 20)) return send(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.', redirect: checkout });

    const name = str(b.name, 120).replace(/\s+/g, ' ');
    let email = str(b.email, 160).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) email = '';
    let phone = String(b.phone || '').replace(/\D/g, '');
    if (phone.length >= 12 && phone.startsWith('55')) phone = phone.slice(2);
    if (!/^[1-9][1-9]\d{8,9}$/.test(phone)) phone = '';

    const errors = {};
    if (!partial) {
      if (name.split(' ').filter(Boolean).length < 2) errors.name = 'Digite nome e sobrenome.';
      if (!email) errors.email = 'E-mail inválido.';
      if (!phone) errors.phone = 'WhatsApp inválido.';
    } else if (!email && !phone) errors.contact = 'Informe e-mail ou WhatsApp.';
    if (Object.keys(errors).length) return send(res, 422, { ok: false, errors, redirect: partial ? '' : checkout });

    const a = b.attr && typeof b.attr === 'object' ? b.attr : {};
    const vid = str(b.vid, 64), fbp = str(b.fbp, 200), fbc = str(b.fbc, 500), url = str(b.url, 1000);
    const row = {
      name, email, phone, vid, fbp, fbc,
      utm_source: str(a.utm_source, 300), utm_medium: str(a.utm_medium, 300), utm_campaign: str(a.utm_campaign, 300),
      utm_content: str(a.utm_content, 300), utm_term: str(a.utm_term, 300), fbclid: str(a.fbclid, 300),
      referrer: str(b.ref, 500), landing: url, ip, ua: userAgent(req)
    };
    const { lead, first } = await saveLead(pid, row, partial, Number(b.lead) || 0);
    const resp = { ok: true, id: lead.id, first };
    if (!partial) resp.redirect = checkout;
    send(res, 200, resp);

    if (!partial && first && enabled(s)) {
      const id = /^[\w.-]{6,80}$/.test(String(b.event_id || '')) ? String(b.event_id) : 'lead.' + lead.id;
      background(sendCapi(s, [event('Lead', id, isHttpUrl(url) ? url : siteOrigin(req) + prod.path,
        userData({ ip, ua: userAgent(req), fbp, fbc, vid }, lead),
        { content_name: prod.name, content_category: prod.category || '', lead_position: str(b.pos, 30) })]));
    }
  } catch (e) {
    console.error('[lead]', e.message);
    if (!res.headersSent) send(res, 500, { ok: false, error: 'Falha ao salvar', redirect: checkout });
  }
}
