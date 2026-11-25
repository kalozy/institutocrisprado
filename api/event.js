/*
 * POST /api/event — eventos das páginas (rolagem, cliques, vídeo, oferta, formulário, checkout, contato).
 * Soma no funil do painel e repassa para a CAPI com o mesmo event_id do Pixel.
 */
import { readBody, send, str, isHttpUrl, clientIp, userAgent, sameOrigin, siteOrigin, background } from '../lib/util.js';
import { incEvent, settingsFor, getLead, hit } from '../lib/store.js';
import { BROWSER_EVENTS, enabled, userData, customData, event, sendCapi } from '../lib/meta.js';
import { getProduct } from '../lib/products.js';
import { rateKey } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false });
  if (!sameOrigin(req)) return send(res, 403, { ok: false });
  try {
    const b = await readBody(req);
    const pid = str(b.p, 60);
    const name = str(b.name, 40);
    if (!getProduct(pid) || !Object.prototype.hasOwnProperty.call(BROWSER_EVENTS, name)) return send(res, 400, { ok: false });
    const ip = clientIp(req);
    if (await hit(rateKey('ev', ip), 600) > 400) return send(res, 429, { ok: false });

    const counter = BROWSER_EVENTS[name];
    const tasks = [];
    if (counter && Number(b.u) === 1) tasks.push(incEvent(pid, counter));
    const s = await settingsFor(pid);
    if (enabled(s)) {
      tasks.push((async () => {
        const vid = str(b.vid, 64);
        let lead = null;
        const leadId = Number(b.lead) || 0;
        if (leadId > 0 && vid) { const l = await getLead(leadId); if (l && l.vid === vid) lead = l; }
        const id = /^[\w.-]{6,80}$/.test(String(b.id || '')) ? String(b.id) : 'cp.' + Date.now().toString(36);
        const url = isHttpUrl(str(b.url, 1000)) ? str(b.url, 1000) : siteOrigin(req) + '/';
        const ctx = { ip, ua: userAgent(req), fbp: str(b.fbp, 200), fbc: str(b.fbc, 500), vid };
        await sendCapi(s, [event(name, id, url, userData(ctx, lead), customData(b.data))]);
      })());
    }
    send(res, 200, { ok: true });
    background(Promise.all(tasks));
  } catch (e) {
    console.error('[event]', e.message);
    if (!res.headersSent) send(res, 500, { ok: false });
  }
}
