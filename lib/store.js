import { q } from './db.js';
import { nowLocal, today, addDays } from './util.js';
import { getProduct } from './products.js';

export const STATUSES = ['parcial', 'novo', 'contatado', 'comprou', 'perdido'];
export const LEAD_FIELDS = [
  'name', 'email', 'phone', 'status', 'notes', 'submissions',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid',
  'fbp', 'fbc', 'vid', 'referrer', 'landing', 'ip', 'ua',
  'created_at', 'submitted_at', 'updated_at', 'paid_at', 'paid_value'
];
/** Atribuição de primeiro toque: não é sobrescrita depois. */
const FIRST_TOUCH = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'referrer', 'landing'];

function norm(r) {
  if (!r) return null;
  return { ...r, id: Number(r.id), submissions: Number(r.submissions), paid_value: Number(r.paid_value) };
}

/* ---------- configurações ---------- */
export const GLOBAL_DEFAULTS = {
  pixel_id: '', capi_enabled: '1', capi_token: '', capi_test_code: '', capi_purchase: '0', notify_sound: '1'
};
export const PRODUCT_DEFAULTS = {
  checkout_url: '', price: '', price_from: '', installments: '', promo_text: '', deadline: '',
  pass_utm: '1', pass_lead: '0', pixel_id: '', capi_token: '',
  wa_template: 'Oi, {primeiro_nome}! Tudo bem? Aqui é da equipe da Dra. Cris Prado. Vi que você se interessou pelo {curso} e queria saber se ficou alguma dúvida para finalizar sua inscrição.'
};

export async function getSettings(scope) {
  const rows = await q('SELECT k, v FROM settings WHERE scope = $1', [scope]);
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

export async function saveSettings(scope, values) {
  const keys = Object.keys(values);
  if (!keys.length) return;
  await q(
    `INSERT INTO settings (scope, k, v) SELECT $1, k, v FROM unnest($2::text[], $3::text[]) AS t(k, v)
     ON CONFLICT (scope, k) DO UPDATE SET v = EXCLUDED.v`,
    [scope, keys, keys.map((k) => String(values[k] ?? ''))]
  );
}

/** Configurações efetivas de uma página: globais + da página (Pixel próprio substitui o global). */
export async function settingsFor(pid) {
  const prod = getProduct(pid);
  const [g, p] = await Promise.all([getSettings('global'), prod ? getSettings(pid) : Promise.resolve({})]);
  const global = { ...GLOBAL_DEFAULTS, ...g };
  const page = { ...PRODUCT_DEFAULTS, ...(prod ? prod.defaults : {}), ...p };
  if (!page.wa_template.trim()) page.wa_template = PRODUCT_DEFAULTS.wa_template;
  const own = page.pixel_id.trim() !== '';
  return {
    ...page,
    product: pid,
    product_name: prod ? prod.name : '',
    pixel_id: own ? page.pixel_id : global.pixel_id,
    capi_token: own && page.capi_token.trim() ? page.capi_token : global.capi_token,
    capi_enabled: global.capi_enabled,
    capi_test_code: global.capi_test_code,
    capi_purchase: global.capi_purchase,
    notify_sound: global.notify_sound,
    capi_last: global.capi_last || '',
    capi_last_error: global.capi_last_error || ''
  };
}

/* ---------- leads ---------- */
export async function getLead(id) {
  return norm((await q('SELECT * FROM leads WHERE id = $1', [id]))[0]);
}

export async function findLead(product, field, value) {
  if (!['email', 'phone', 'vid'].includes(field) || !value) return null;
  const rows = product
    ? await q(`SELECT * FROM leads WHERE product = $1 AND ${field} = $2 ORDER BY id DESC LIMIT 1`, [product, value])
    : await q(`SELECT * FROM leads WHERE ${field} = $1 ORDER BY id DESC LIMIT 1`, [value]);
  return norm(rows[0]);
}

async function insertLead(product, row) {
  const cols = ['product', ...LEAD_FIELDS];
  const vals = [product, ...LEAD_FIELDS.map((c) => row[c] ?? (c === 'submissions' || c === 'paid_value' ? 0 : ''))];
  const ph = cols.map((_, i) => '$' + (i + 1)).join(', ');
  return norm((await q(`INSERT INTO leads (${cols.join(', ')}) VALUES (${ph}) RETURNING *`, vals))[0]);
}

export async function updateLead(id, fields) {
  const keys = Object.keys(fields).filter((k) => LEAD_FIELDS.includes(k));
  if (!keys.length) return getLead(id);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  return norm((await q(`UPDATE leads SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, [...keys.map((k) => fields[k]), id]))[0]);
}

export async function deleteLead(id) { await q('DELETE FROM leads WHERE id = $1', [id]); }

/**
 * Cria ou atualiza um lead. Parcial = preencheu e-mail/WhatsApp mas não enviou.
 * Retorna o lead e first = true no primeiro envio completo dessa pessoa nesse curso.
 */
export async function saveLead(product, input, partial, hintId = 0) {
  const now = nowLocal();
  let existing = null;
  if (hintId > 0) {
    const l = await getLead(hintId);
    if (l && l.product === product && l.vid && l.vid === (input.vid || '')) existing = l;
  }
  if (!existing && input.email) existing = await findLead(product, 'email', input.email);
  if (!existing && input.phone) existing = await findLead(product, 'phone', input.phone);

  if (existing) {
    const upd = {};
    for (const [k, v] of Object.entries(input)) {
      if (!LEAD_FIELDS.includes(k) || v === '' || v === null || v === undefined) continue;
      if (FIRST_TOUCH.includes(k) && existing[k]) continue;
      upd[k] = v;
    }
    let first = false;
    if (!partial) {
      upd.submissions = existing.submissions + 1;
      if (existing.status === 'parcial') upd.status = 'novo';
      if (!existing.submitted_at) { upd.submitted_at = now; first = true; }
    }
    delete upd.created_at;
    upd.updated_at = now;
    return { lead: await updateLead(existing.id, upd), first };
  }

  const row = { ...input, status: partial ? 'parcial' : 'novo', submissions: partial ? 0 : 1, created_at: now, submitted_at: partial ? '' : now, updated_at: now, paid_at: '', paid_value: 0, notes: '' };
  return { lead: await insertLead(product, row), first: !partial };
}

function where(f) {
  const w = []; const p = [];
  const add = (sql, ...vals) => { let s = sql; for (const v of vals) { p.push(v); s = s.replace('?', '$' + p.length); } w.push(s); };
  if (f.product) add('product = ?', f.product);
  if (f.q) {
    const like = '%' + f.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const digits = f.q.replace(/\D/g, '');
    if (digits) add('(name ILIKE ? OR email ILIKE ? OR phone LIKE ?)', like, like, '%' + digits + '%');
    else add('(name ILIKE ? OR email ILIKE ?)', like, like);
  }
  if (f.status && STATUSES.includes(f.status)) add('status = ?', f.status);
  if (f.source) { if (f.source === 'direto') w.push("utm_source = ''"); else add('utm_source = ?', f.source); }
  if (f.campaign) add('utm_campaign = ?', f.campaign);
  if (f.from) add('created_at >= ?', f.from + ' 00:00:00');
  if (f.to) add('created_at <= ?', f.to + ' 23:59:59');
  if (f.since) add('(created_at >= ? OR submitted_at >= ?)', f.since, f.since);
  return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

export async function listLeads(f, page, per) {
  const { sql, params } = where(f);
  const total = Number((await q(`SELECT COUNT(*)::int AS n FROM leads ${sql}`, params))[0].n);
  const off = Math.max(0, (page - 1) * per);
  const items = await q(`SELECT * FROM leads ${sql} ORDER BY GREATEST(created_at, submitted_at) DESC, id DESC LIMIT ${per} OFFSET ${off}`, params);
  return { items: items.map(norm), total };
}

export async function allLeads(f) {
  const { sql, params } = where(f);
  return (await q(`SELECT * FROM leads ${sql} ORDER BY GREATEST(created_at, submitted_at) DESC, id DESC LIMIT 50000`, params)).map(norm);
}

export async function distinctValues(field, product) {
  if (!['utm_source', 'utm_campaign'].includes(field)) return [];
  const rows = product
    ? await q(`SELECT DISTINCT ${field} AS v FROM leads WHERE product = $1 AND ${field} <> '' ORDER BY 1 LIMIT 200`, [product])
    : await q(`SELECT DISTINCT ${field} AS v FROM leads WHERE ${field} <> '' ORDER BY 1 LIMIT 200`);
  return rows.map((r) => r.v);
}

/* ---------- eventos do funil ---------- */
export async function incEvent(product, name) {
  await q(`INSERT INTO events (day, product, name, n) VALUES ($1, $2, $3, 1)
           ON CONFLICT (day, product, name) DO UPDATE SET n = events.n + 1`, [today(), product, name]);
}

async function eventsBetween(product, from, to) {
  const rows = product
    ? await q('SELECT day, name, SUM(n)::int AS n FROM events WHERE product = $1 AND day BETWEEN $2 AND $3 GROUP BY day, name', [product, from, to])
    : await q("SELECT day, name, SUM(n)::int AS n FROM events WHERE product <> 'instituto' AND day BETWEEN $1 AND $2 GROUP BY day, name", [from, to]);
  return rows;
}

/** Funil e série diária entre from e to (AAAA-MM-DD). product vazio = todos os cursos. */
export async function stats(product, from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const blank = () => ({ visit: 0, lead: 0, partial: 0, checkout: 0, purchase: 0, contact: 0 });
  const series = Object.fromEntries(days.map((d) => [d, blank()]));

  const totals = {};
  for (const r of await eventsBetween(product, from, to)) {
    totals[r.name] = (totals[r.name] || 0) + Number(r.n);
    if (series[r.day] && ['visit', 'checkout', 'contact'].includes(r.name)) series[r.day][r.name] += Number(r.n);
  }

  const lo = from + ' 00:00:00', hi = to + ' 23:59:59';
  const rows = await q(
    `SELECT created_at, submitted_at, paid_at, paid_value, status, utm_source, utm_campaign FROM leads
     WHERE ($1 = '' OR product = $1) AND ((created_at BETWEEN $2 AND $3) OR (submitted_at BETWEEN $2 AND $3) OR (paid_at BETWEEN $2 AND $3))`,
    [product || '', lo, hi]
  );
  const sources = {}, campaigns = {}, status = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let leads = 0, partials = 0, purchases = 0, revenue = 0;
  for (const r of rows) {
    const sub = r.submitted_at || '';
    if (sub && sub >= lo && sub <= hi) {
      leads++;
      if (series[sub.slice(0, 10)]) series[sub.slice(0, 10)].lead++;
      const src = r.utm_source || 'direto';
      sources[src] = (sources[src] || 0) + 1;
      if (r.utm_campaign) campaigns[r.utm_campaign] = (campaigns[r.utm_campaign] || 0) + 1;
      if (status[r.status] !== undefined) status[r.status]++;
    } else if (r.status === 'parcial' && r.created_at >= lo && r.created_at <= hi) {
      partials++; status.parcial++;
      if (series[r.created_at.slice(0, 10)]) series[r.created_at.slice(0, 10)].partial++;
    }
    const paid = r.paid_at || '';
    if (paid && paid >= lo && paid <= hi) {
      purchases++; revenue += Number(r.paid_value);
      if (series[paid.slice(0, 10)]) series[paid.slice(0, 10)].purchase++;
    }
  }
  const top = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8));
  return {
    from, to, events: totals, leads, partials, purchases, revenue: Math.round(revenue * 100) / 100,
    series: days.map((d) => ({ day: d, ...series[d] })),
    sources: top(sources), campaigns: top(campaigns), status
  };
}

/* ---------- limite por IP ---------- */
export async function hit(key, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await q(
    `INSERT INTO hits (k, n, reset) VALUES ($1, 1, $2)
     ON CONFLICT (k) DO UPDATE SET
       n = CASE WHEN hits.reset < $3 THEN 1 ELSE hits.n + 1 END,
       reset = CASE WHEN hits.reset < $3 THEN $2 ELSE hits.reset END
     RETURNING n`,
    [key, now + windowSec, now]
  );
  if (Math.random() < 0.01) q('DELETE FROM hits WHERE reset < $1', [now]).catch(() => {});
  return Number(rows[0].n);
}
