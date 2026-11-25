/*!
 * Instituto Cris Prado — rastreamento Meta (Pixel + API de Conversões)
 * Usado em todas as páginas. Cada evento sai do navegador (Pixel) e do servidor (/api/event → CAPI)
 * com o mesmo event_id, para a Meta deduplicar.
 *
 * Configure a página antes de carregar este arquivo:
 *   window.CP_PAGE = { product: 'start-lips', viewContent: { content_name: 'Start Lips', ... } };
 */
(function () {
  'use strict';
  var PAGE = window.CP_PAGE || {};
  var P = PAGE.product || 'instituto';
  var API = '/api/';
  var STD = { PageView: 1, ViewContent: 1, Lead: 1, InitiateCheckout: 1, Contact: 1, Schedule: 1, Purchase: 1 };

  /* ---------- util ---------- */
  function rnd(n) { var a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function getCookie(n) { var m = document.cookie.match('(?:^|; )' + n.replace(/[.$?*|{}()\[\]\\\/+^]/g, '\\$&') + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : ''; }
  function setCookie(n, v, days) { var d = new Date(Date.now() + days * 864e5); document.cookie = n + '=' + encodeURIComponent(v) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : ''); }
  function ss(k, v) { k = 'cp_' + k; try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function ls(k, v) { k = 'cp_' + k; try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function eventId() { return 'cp.' + Date.now().toString(36) + '.' + rnd(6); }

  /* ---------- visitante + cookies da Meta (criados já no carregamento, para a CAPI) ---------- */
  var VID = getCookie('cp_vid') || ls('vid') || rnd(16);
  setCookie('cp_vid', VID, 365); ls('vid', VID);
  var qs = new URLSearchParams(location.search);
  (function () {
    var now = Date.now();
    if (!getCookie('_fbp')) setCookie('_fbp', 'fb.1.' + now + '.' + (Math.floor(Math.random() * 9e9) + 1e9), 90);
    var fbclid = qs.get('fbclid');
    if (fbclid) { var cur = getCookie('_fbc'); if (!cur || cur.split('.').slice(3).join('.') !== fbclid) setCookie('_fbc', 'fb.1.' + now + '.' + fbclid, 90); }
  })();

  /* ---------- atribuição (vale para o site todo: entrou pela home e foi ao curso, mantém a campanha) ---------- */
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid', 'ttclid', 'src', 'sck'];
  var attr = {};
  try { attr = JSON.parse(ss('attr') || ls('attr') || '{}') || {}; } catch (e) { attr = {}; }
  if (KEYS.some(function (k) { return qs.get(k); })) {
    attr = {};
    KEYS.forEach(function (k) { var v = qs.get(k); if (v) attr[k] = v.slice(0, 300); });
    ls('attr', JSON.stringify(attr));
  }
  ss('attr', JSON.stringify(attr));

  /* ---------- lead salvo neste navegador (por curso) ---------- */
  function getLead() { try { return JSON.parse(ls('lead_' + P) || 'null'); } catch (e) { return null; } }
  function setLead(l) { ls('lead_' + P, l ? JSON.stringify(l) : null); if (l && l.email) ls('lead_last', JSON.stringify({ name: l.name, email: l.email, phone: l.phone })); }
  function lastLead() { try { return JSON.parse(ls('lead_last') || 'null'); } catch (e) { return null; } }
  function userData() {
    var l = getLead();
    if (!l || !l.email) { try { l = JSON.parse(ls('lead_last') || 'null'); } catch (e) { l = null; } }
    if (!l || !l.email) return { external_id: VID };
    var parts = (l.name || '').trim().toLowerCase().split(/\s+/);
    return { em: (l.email || '').toLowerCase(), ph: l.phone ? '55' + l.phone : '', fn: parts[0] || '', ln: parts.length > 1 ? parts[parts.length - 1] : '', country: 'br', external_id: VID };
  }

  /* ---------- configurações vindas do painel ---------- */
  var S = { pixelId: '', checkoutUrl: '', passUtm: true, passLead: false, price: 0, priceFrom: 0, installments: '', promoText: '', deadline: 0 };
  var loaded = fetch(API + 'settings?p=' + encodeURIComponent(P), { cache: 'no-store', credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) { if (j && typeof j === 'object') for (var k in j) if (Object.prototype.hasOwnProperty.call(j, k)) S[k] = j[k]; })
    .catch(function () {})
    .then(function () { initPixel(); return S; });
  var ready = Promise.race([loaded, wait(2500)]).then(function () { return S; });

  /* ---------- Pixel ---------- */
  var pxQueue = [], pxReady = false;
  function initPixel() {
    if (pxReady || !S.pixelId) return;
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', S.pixelId, userData());
    pxReady = true;
    pxQueue.forEach(function (a) { window.fbq.apply(null, a); });
    pxQueue = [];
  }
  function px() { var a = Array.prototype.slice.call(arguments); if (pxReady) window.fbq.apply(null, a); else pxQueue.push(a); }
  function refreshMatching() { if (pxReady && S.pixelId) window.fbq('init', S.pixelId, userData()); }

  /* ---------- envio: Pixel + servidor com o mesmo ID ---------- */
  var sent = {};
  try { sent = JSON.parse(ss('sent_' + P) || '{}') || {}; } catch (e) {}
  function beacon(path, body) {
    var json = JSON.stringify(body);
    try { if (navigator.sendBeacon && navigator.sendBeacon(API + path, new Blob([json], { type: 'text/plain;charset=UTF-8' }))) return; } catch (e) {}
    try { fetch(API + path, { method: 'POST', body: json, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true, credentials: 'same-origin' }).catch(function () {}); } catch (e) {}
  }
  function send(name, data, opts) {
    opts = opts || {}; data = data || {};
    var id = opts.id || eventId();
    if (!opts.serverOnly) { if (STD[name]) px('track', name, data, { eventID: id }); else px('trackCustom', name, data, { eventID: id }); }
    if (opts.pixelOnly) return id;
    var unique = !sent[name];
    sent[name] = 1; ss('sent_' + P, JSON.stringify(sent));
    var lead = getLead();
    beacon('event', { p: P, name: name, id: id, data: data, u: unique ? 1 : 0, url: location.href, ref: document.referrer, vid: VID, lead: (lead && lead.id) || 0, fbp: getCookie('_fbp'), fbc: getCookie('_fbc'), attr: attr });
    return id;
  }

  /* ---------- eventos automáticos ---------- */
  ready.then(function () {
    initPixel();
    send('PageView');
    if (PAGE.viewContent) {
      var vc = typeof PAGE.viewContent === 'function' ? PAGE.viewContent(S) : PAGE.viewContent;
      send('ViewContent', vc);
    }
  });

  var marks = [25, 50, 75, 90], hit = {};
  function onScroll() {
    var h = document.documentElement.scrollHeight - window.innerHeight; if (h <= 0) return;
    var p = Math.round((window.scrollY / h) * 100);
    for (var i = 0; i < marks.length; i++) { var m = marks[i]; if (p >= m && !hit[m]) { hit[m] = 1; send('Scroll' + m, { percent: m }); } }
    if (hit[90]) window.removeEventListener('scroll', onScroll);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  var active = 0, tFired = {};
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    active++;
    [30, 60, 120].forEach(function (s) { if (active >= s && !tFired[s]) { tFired[s] = 1; send('TimeOnPage' + s, { seconds: s }); } });
  }, 1000);

  window.CP = {
    product: P, settings: S, ready: ready, loaded: loaded, send: send, eventId: eventId, vid: VID, attr: attr,
    cookie: getCookie, getLead: getLead, setLead: setLead, lastLead: lastLead, userData: userData,
    refreshMatching: refreshMatching, pixel: px, isPixelReady: function () { return pxReady && !!S.pixelId; }
  };
})();
