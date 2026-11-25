/* GET /api/settings?p=produto — configurações públicas da página (nunca expõe o token da CAPI). */
import { query, send, num, isHttpUrl } from '../lib/util.js';
import { settingsFor } from '../lib/store.js';
import { getProduct } from '../lib/products.js';

export default async function handler(req, res) {
  const pid = String(query(req).p || 'instituto');
  if (!getProduct(pid)) return send(res, 404, { error: 'página desconhecida' });
  try {
    const s = await settingsFor(pid);
    const dl = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.deadline) ? Date.parse(s.deadline + ':00-03:00') : 0;
    send(res, 200, {
      pixelId: String(s.pixel_id).replace(/\D/g, ''),
      checkoutUrl: isHttpUrl(s.checkout_url) ? s.checkout_url : '',
      passUtm: s.pass_utm === '1',
      passLead: s.pass_lead === '1',
      price: num(s.price),
      priceFrom: num(s.price_from),
      installments: s.installments,
      promoText: s.promo_text,
      deadline: dl || 0
    });
  } catch (e) {
    console.error('[settings]', e.message);
    send(res, 200, {}); // a página segue funcionando com os valores padrão
  }
}
