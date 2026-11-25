/*!
 * Instituto Cris Prado — comportamento comum das páginas de curso:
 * oferta vinda do painel (preço, campanha, contagem), vídeo, barra fixa, formulário de lead
 * (com lead parcial), ida ao checkout e eventos da Meta. Depende de /assets/cp-track.js.
 */
(function () {
  'use strict';
  var CP = window.CP, PAGE = window.CP_PAGE || {}, S = CP.settings;
  var CUR = 'BRL';
  var NAME = PAGE.productName || PAGE.product;
  var PID = PAGE.product;
  var CAT = PAGE.category || 'Curso';
  var doc = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function price() { return Number(S.price) || Number(PAGE.price) || 0; }
  function brl(n) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function money(d) { var v = price(); if (v > 0) { d.value = v; d.currency = CUR; } return d; }

  /* ---------- oferta (preço, campanha e contagem configurados no painel) ---------- */
  var clockTimer = null;
  function renderOffer() {
    var promoText = S.promoText || '';
    if (promoText) {
      if ($('promo')) { $('promoText').textContent = promoText; $('promo').hidden = false; }
      if ($('cardTag')) { $('cardTag').textContent = promoText; $('cardTag').hidden = false; }
    }
    var v = Number(S.price) || 0;
    var box = $('priceBox');
    if (box && v > 0) {
      var parts = brl(v).split(',');
      var html = '';
      if (Number(S.priceFrom) > v) html += '<p class="from">De <s>R$ ' + brl(S.priceFrom) + '</s> por</p>';
      html += '<p class="price" aria-label="R$ ' + brl(v) + '"><small>R$</small>' + parts[0] + '<small class="cents">,' + parts[1] + '</small></p>';
      if (S.installments) html += '<p class="inst"></p>';
      box.innerHTML = html;
      if (S.installments) box.querySelector('.inst').textContent = S.installments;
    }
    if (v > 0) document.querySelectorAll('[data-price-text]').forEach(function (el) { el.textContent = el.getAttribute('data-price-text').replace('{preco}', 'R$ ' + brl(v)); });
    startClock();
  }
  function startClock() {
    var dl = Number(S.deadline) || 0;
    if (clockTimer || !dl || dl <= Date.now()) return;
    var clocks = document.querySelectorAll('[data-clock]');
    var wraps = document.querySelectorAll('[data-clock-wrap]');
    if (!clocks.length) return;
    function z(n) { return ('0' + n).slice(-2); }
    function tick() {
      var ms = dl - Date.now();
      if (ms <= 0) { clocks.forEach(function (c) { c.hidden = true; }); wraps.forEach(function (w) { w.hidden = true; }); clearInterval(clockTimer); return; }
      var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
      var html = (d ? '<span>' + d + 'd</span>' : '') + '<span>' + z(h) + 'h</span><span>' + z(m) + 'm</span><span>' + z(s) + 's</span>';
      clocks.forEach(function (c) { c.innerHTML = html; c.hidden = false; });
    }
    tick(); wraps.forEach(function (w) { w.hidden = false; });
    clockTimer = setInterval(tick, 1000);
  }
  CP.loaded.then(renderOffer);

  /* ---------- oferta visível e FAQ ---------- */
  var offerEl = document.querySelector('[data-offer-watch]');
  if (offerEl && 'IntersectionObserver' in window) {
    var oSeen = false;
    new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting && !oSeen) { oSeen = true; CP.send('ViewOffer', money({})); } }); }, { threshold: .35 }).observe(offerEl);
  }
  document.querySelectorAll('.faq details').forEach(function (d) {
    d.addEventListener('toggle', function () { if (d.open) CP.send('FAQOpen', { question: d.querySelector('summary').textContent.trim().slice(0, 90) }); });
  });

  /* ---------- vídeo: começa mudo com legenda, botão reinicia com som ---------- */
  var vid = $('vsl'), sBtn = $('soundBtn');
  if (vid && sBtn) {
    var vName = PAGE.video || 'vsl', vLoaded = false, vSound = false, v50 = false, vEnd = false;
    var loadVideo = function () { if (vLoaded) return; vLoaded = true; var s = vid.querySelector('source'); s.src = s.getAttribute('data-src'); vid.load(); };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (e) {
        if (e.isIntersecting) { loadVideo(); var p = vid.play(); if (p && p.catch) p.catch(function () {}); }
        else if (!vid.paused && vid.muted) vid.pause();
      }); }, { rootMargin: '200px 0px', threshold: .25 }).observe(vid);
    } else loadVideo();
    var setSoundUi = function (on) { sBtn.setAttribute('data-state', on ? 'on' : 'off'); sBtn.querySelector('span').textContent = on ? 'Silenciar' : 'Ouvir do início'; };
    sBtn.addEventListener('click', function () {
      loadVideo();
      if (vid.muted) {
        vid.currentTime = 0; vid.muted = false; vid.loop = false; vid.play();
        setSoundUi(true);
        if (!vSound) { vSound = true; CP.send('VideoSoundOn', { video: vName }); }
      } else { vid.muted = true; vid.loop = true; setSoundUi(false); }
    });
    vid.addEventListener('click', function () { if (vid.paused) vid.play(); else vid.pause(); });
    vid.addEventListener('timeupdate', function () {
      if (!vSound || vid.muted || !vid.duration) return;
      var r = vid.currentTime / vid.duration;
      if (r >= .5 && !v50) { v50 = true; CP.send('Video50', { video: vName }); }
      if (r >= .95 && !vEnd) { vEnd = true; CP.send('VideoComplete', { video: vName }); }
    });
    vid.addEventListener('ended', function () { vid.muted = true; vid.loop = true; vid.play(); setSoundUi(false); });
  }

  /* ---------- fotos reais dos modelos (data-photo) ---------- */
  document.querySelectorAll('[data-photo]').forEach(function (f) {
    var src = f.getAttribute('data-photo'); if (!src) return;
    var img = new Image(); img.alt = (f.querySelector('b') || {}).textContent || ''; img.loading = 'lazy'; img.decoding = 'async';
    img.onload = function () { (f.querySelector('.model__frame') || f).appendChild(img); };
    img.src = src;
  });

  /* ---------- barra fixa (mobile) ---------- */
  var bar = $('bar'), dlg = $('leadDlg');
  if (bar && 'IntersectionObserver' in window) {
    var vis = { hero: true, offer: false, close: false, foot: false };
    var watch = { hero: $('heroCta'), offer: $('offerCta'), close: $('closeCta'), foot: document.querySelector('.foot') };
    var updateBar = function () {
      var on = !vis.hero && !vis.offer && !vis.close && !vis.foot && !dlg.open;
      bar.classList.toggle('is-on', on); bar.setAttribute('aria-hidden', on ? 'false' : 'true');
      bar.querySelector('button').tabIndex = on ? 0 : -1;
    };
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { for (var k in watch) if (watch[k] === e.target) vis[k] = e.isIntersecting || (k === 'hero' && e.boundingClientRect.top > 0); });
      updateBar();
    });
    for (var k in watch) if (watch[k]) io.observe(watch[k]);
    dlg.addEventListener('close', function () { setTimeout(updateBar, 50); });
  }

  /* ---------- formulário de lead ---------- */
  var form = $('leadForm');
  var inName = $('in-name'), inEmail = $('in-email'), inPhone = $('in-phone');
  var btn = $('dlgBtn'), errBox = $('dlgErr'), hint = $('emailHint');
  var openedAt = 0, formStarted = false, lastPos = '', partialSent = '';
  if (typeof dlg.showModal !== 'function') { dlg.showModal = function () { dlg.setAttribute('open', ''); }; dlg.close = function () { dlg.removeAttribute('open'); }; }
  function openLead(pos) {
    lastPos = pos;
    var saved = CP.getLead();
    if (!saved || !saved.email) saved = CP.lastLead(); // já preencheu em outro curso do site
    if (saved && saved.email) { inName.value = saved.name || ''; inEmail.value = saved.email || ''; inPhone.value = maskPhone(saved.phone || ''); }
    openedAt = Date.now();
    errBox.classList.remove('on');
    if (bar) bar.classList.remove('is-on');
    dlg.showModal();
    setTimeout(function () { (saved && saved.email ? btn : inName).focus(); }, 60);
  }
  $('dlgClose').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  document.querySelectorAll('.js-cta').forEach(function (b) {
    b.addEventListener('click', function () {
      var pos = b.getAttribute('data-pos') || 'cta';
      CP.send('ClickCTA', { position: pos, label: b.textContent.trim().slice(0, 60) });
      openLead(pos);
    });
  });

  function digits(s) { return (s || '').replace(/\D/g, ''); }
  function maskPhone(v) {
    var d = digits(v);
    if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
    d = d.slice(0, 11);
    if (!d.length) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function phoneDigits() { var d = digits(inPhone.value); if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2); return d; }
  function validName() { var p = inName.value.trim().split(/\s+/).filter(Boolean); return p.length >= 2 && p[0].length >= 2; }
  function validEmail() { return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(inEmail.value.trim()); }
  function validPhone() { var d = phoneDigits(); if (d.length !== 10 && d.length !== 11) return false; if (d[0] === '0' || d[1] === '0') return false; if (d.length === 11 && d[2] !== '9') return false; return true; }
  function mark(id, ok) { $(id).classList.toggle('bad', !ok); }
  var TYPO = { 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.com.br': 'gmail.com', 'gnail.com': 'gmail.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'yahooo.com': 'yahoo.com', 'yaho.com.br': 'yahoo.com.br', 'icloud.co': 'icloud.com', 'iclod.com': 'icloud.com' };
  function checkTypo() {
    var v = inEmail.value.trim().toLowerCase(), at = v.lastIndexOf('@');
    if (at < 1) { hint.classList.remove('on'); return; }
    var fix = TYPO[v.slice(at + 1)];
    if (fix) {
      hint.innerHTML = 'Você quis dizer <button type="button"></button>?';
      hint.querySelector('button').textContent = v.slice(0, at) + '@' + fix;
      hint.classList.add('on');
      hint.querySelector('button').onclick = function () { inEmail.value = v.slice(0, at) + '@' + fix; hint.classList.remove('on'); mark('f-email', true); savePartial(); inPhone.focus(); };
    } else hint.classList.remove('on');
  }
  inPhone.addEventListener('input', function () { inPhone.value = maskPhone(inPhone.value); if (validPhone()) mark('f-phone', true); });
  inEmail.addEventListener('input', function () { if (validEmail()) mark('f-email', true); });
  inName.addEventListener('input', function () { if (validName()) mark('f-name', true); });
  inName.addEventListener('blur', function () { if (inName.value.trim()) mark('f-name', validName()); savePartial(); });
  inEmail.addEventListener('blur', function () { if (inEmail.value.trim()) mark('f-email', validEmail()); checkTypo(); savePartial(); });
  inPhone.addEventListener('blur', function () { if (inPhone.value.trim()) mark('f-phone', validPhone()); savePartial(); });
  [inName, inEmail, inPhone].forEach(function (el) { el.addEventListener('focus', function () { if (!formStarted) { formStarted = true; CP.send('FormStart', { position: lastPos }); } }); });

  function payload(partial) {
    var saved = CP.getLead();
    return {
      p: PID,
      name: inName.value.trim(), email: inEmail.value.trim().toLowerCase(), phone: validPhone() ? phoneDigits() : '',
      partial: partial ? 1 : 0, lead: (saved && saved.id) || 0, vid: CP.vid, fbp: CP.cookie('_fbp'), fbc: CP.cookie('_fbc'),
      attr: CP.attr, url: location.href, ref: document.referrer, pos: lastPos,
      company: $('in-company').value, t: Date.now() - openedAt
    };
  }
  /* Lead parcial: salva quem preencheu e-mail ou WhatsApp válido, mesmo sem enviar */
  function savePartial() {
    if (!validEmail() && !validPhone()) return;
    var p = payload(true);
    if (!validEmail()) p.email = '';
    var sig = p.name + '|' + p.email + '|' + p.phone;
    if (sig === partialSent) return;
    partialSent = sig;
    fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), keepalive: true, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.id) { var s = CP.getLead() || {}; s.id = j.id; CP.setLead(s); } })
      .catch(function () {});
  }
  function buildCheckout(base) {
    var u, saved = CP.getLead();
    try { u = new URL(base, location.href); } catch (e) { return base; }
    if (S.passUtm) Object.keys(CP.attr).forEach(function (k) { if (!u.searchParams.has(k)) u.searchParams.set(k, CP.attr[k]); });
    if (S.passLead && saved) { u.searchParams.set('name', saved.name || ''); u.searchParams.set('email', saved.email || ''); u.searchParams.set('phone', saved.phone || ''); }
    return u.toString();
  }
  function setBusy(b) { btn.setAttribute('aria-busy', b ? 'true' : 'false'); btn.querySelector('.lbl').textContent = b ? 'Abrindo o pagamento…' : 'Ir para o pagamento'; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errBox.classList.remove('on');
    var okN = validName(), okE = validEmail(), okP = validPhone();
    mark('f-name', okN); mark('f-email', okE); mark('f-phone', okP);
    if (!okN) { inName.focus(); return; }
    if (!okE) { inEmail.focus(); return; }
    if (!okP) { inPhone.focus(); return; }
    setBusy(true);
    var leadEvent = CP.eventId();
    var p = payload(false); p.event_id = leadEvent;
    var prev = CP.getLead();
    CP.setLead({ id: (prev && prev.id) || 0, name: p.name, email: p.email, phone: p.phone, ts: Date.now() });
    var req = fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    Promise.race([req, wait(4500)]).then(function (res) {
      if (res && res.id) { var s = CP.getLead(); s.id = res.id; CP.setLead(s); }
      CP.refreshMatching();
      if (!res || res.first !== false) CP.send('Lead', { content_name: NAME, content_category: CAT }, { id: leadEvent, pixelOnly: true });
      return Promise.race([CP.loaded, wait(1500)]).then(function () { return res; });
    }).then(function (res) {
      var base = (res && res.redirect) || S.checkoutUrl;
      if (!base) { setBusy(false); errBox.textContent = 'O link de pagamento ainda não foi configurado. Defina-o no painel em Configurações.'; errBox.classList.add('on'); return; }
      CP.send('InitiateCheckout', money({ content_name: NAME, content_ids: [PID], content_type: 'product', num_items: 1 }));
      setTimeout(function () { location.href = buildCheckout(base); }, 250);
    });
  });

  /* ---------- privacidade ---------- */
  var priv = $('privDlg');
  if (priv) {
    if (typeof priv.showModal !== 'function') { priv.showModal = function () { priv.setAttribute('open', ''); }; priv.close = function () { priv.removeAttribute('open'); }; }
    document.querySelectorAll('.js-priv').forEach(function (b) { b.addEventListener('click', function () { priv.showModal(); }); });
    priv.querySelector('[data-close]').addEventListener('click', function () { priv.close(); });
    priv.addEventListener('click', function (e) { if (e.target === priv) priv.close(); });
  }

  requestAnimationFrame(function () { doc.classList.add('is-ready'); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) setBusy(false); });
})();
