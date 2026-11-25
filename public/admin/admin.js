/* Painel do Instituto Cris Prado: leads, funil, campanhas e configurações. */
(function () {
  'use strict';
  var STATUS = { parcial: 'Parcial', novo: 'Novo', contatado: 'Em contato', comprou: 'Comprou', perdido: 'Não comprou' };
  var S = { csrf: '', products: [], prod: '', tab: 'visao', from: '', to: '', page: 1, leads: [], cfg: {}, global: null, info: null, stats: null, showTable: false, since: '', newCount: 0 };
  var seen = {};

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function brl(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function pct(a, b) { if (!b) return '0%'; var p = a / b * 100; return (p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1).replace('.', ',')) + '%'; }
  function ymd(d) { var z = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
  function dt(s) { if (!s) return ''; var p = s.split(/[- :]/); return p[2] + '/' + p[1] + '/' + p[0] + ' ' + p[3] + ':' + p[4]; }
  function dm(s) { var p = s.split('-'); return p[2] + '/' + p[1]; }
  function phoneFmt(d) { if (!d) return ''; return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6); }
  function product(id) { return S.products.find(function (p) { return p.id === id; }) || null; }
  function courses() { return S.products.filter(function (p) { return p.kind === 'course'; }); }
  function isSite() { var p = product(S.prod); return !!p && p.kind === 'site'; }

  function api(action, params, body) {
    var u = new URL('/api/admin', location.origin); u.searchParams.set('action', action);
    Object.keys(params || {}).forEach(function (k) { var v = params[k]; if (v !== '' && v != null) u.searchParams.set(k, v); });
    var opt = { credentials: 'same-origin', headers: {} };
    if (body) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.headers['X-CSRF'] = S.csrf; opt.body = JSON.stringify(body); }
    return fetch(u, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && action !== 'login') { showLogin(); throw new Error('Sessão expirada. Entre de novo.'); }
        if (!r.ok && !j.message) throw new Error(j.error || ('Erro ' + r.status));
        return j;
      });
    });
  }
  function toast(title, text) {
    var t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = '<b>' + esc(title) + '</b>' + esc(text);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }

  /* ---------- login ---------- */
  function showLogin(setup) {
    $('#app').hidden = true; $('#loginView').hidden = false;
    $('#setupMsg').hidden = !setup;
    if (setup) $('#setupMsg').textContent = setup;
    setTimeout(function () { $('#pw').focus(); }, 30);
  }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#loginErr'); err.hidden = true;
    api('login', {}, { password: $('#pw').value }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Não foi possível entrar.');
      S.csrf = j.csrf; $('#pw').value = ''; start();
    }).catch(function (e2) { err.textContent = e2.message; err.hidden = false; });
  });
  $('#logout').addEventListener('click', function () { api('logout').finally(function () { location.reload(); }); });

  /* ---------- seleção de página ---------- */
  function fillProducts() {
    var sel = $('#prodSel');
    var opts = '<option value="">Todos os cursos</option>' + courses().map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
    var site = S.products.filter(function (p) { return p.kind === 'site'; });
    opts += site.map(function (p) { return '<option value="' + p.id + '">Página principal</option>'; }).join('');
    sel.innerHTML = opts;
    var saved = ''; try { saved = localStorage.getItem('cp_admin_prod') || ''; } catch (e) {}
    S.prod = (saved === '' || product(saved)) ? saved : '';
    sel.value = S.prod;
    sel.addEventListener('change', function () {
      S.prod = sel.value; try { localStorage.setItem('cp_admin_prod', S.prod); } catch (e) {}
      S.page = 1; ['#f-source', '#f-campaign'].forEach(function (s) { $(s).value = ''; });
      labels(); setTab(S.tab);
    });
    labels();
  }
  function labels() {
    var p = product(S.prod);
    var t = p ? (p.kind === 'site' ? 'Página principal' : p.name) : 'Todos os cursos';
    $('#prodLabel').textContent = t; $('#prodLabel2').textContent = t;
  }

  /* ---------- abas ---------- */
  function setTab(t) {
    if (['visao', 'leads', 'config'].indexOf(t) < 0) t = 'visao';
    S.tab = t;
    $$('.tabs a').forEach(function (a) { if (a.dataset.tab === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'v-' + t); });
    if (t === 'visao') loadStats(); else if (t === 'leads') loadLeads(); else loadSettings();
  }
  window.addEventListener('hashchange', function () { setTab(location.hash.slice(1)); });

  /* ---------- período ---------- */
  function setDays(days) {
    var to = new Date(), from = new Date(); from.setDate(from.getDate() - Math.max(0, days - 1));
    S.from = ymd(from); S.to = ymd(to);
    $('#d-from').value = S.from; $('#d-to').value = S.to;
    $$('#seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)); });
  }
  $$('#seg button').forEach(function (b) { b.addEventListener('click', function () { setDays(Number(b.dataset.days)); loadStats(); }); });
  ['#d-from', '#d-to'].forEach(function (id) { $(id).addEventListener('change', function () {
    S.from = $('#d-from').value || S.from; S.to = $('#d-to').value || S.to;
    $$('#seg button').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    loadStats();
  }); });

  /* ---------- visão geral ---------- */
  function loadStats() {
    return api('stats', { p: S.prod, from: S.from, to: S.to }).then(function (st) { S.stats = st; renderStats(st); })
      .catch(function (e) { toast('Erro', e.message); });
  }
  function tile(k, v, s) { return '<div class="card tile"><div class="k">' + k + '</div><div class="v num">' + v + '</div><div class="s">' + esc(s) + '</div></div>'; }
  function renderStats(st) {
    var ev = st.events || {}, visits = ev.visit || 0, site = isSite();
    var warn = '';
    if (st.checkout_ok === false) warn = '<div class="banner">O link do checkout deste curso ainda não foi definido. Sem ele, quem preenche o formulário não chega ao pagamento. <a href="#config">Definir agora</a></div>';
    if (st.checkout_missing && st.checkout_missing.length) warn = '<div class="banner">Falta o link do checkout em: ' + esc(st.checkout_missing.join(', ')) + '. <a href="#config">Definir agora</a></div>';
    $('#warn').innerHTML = warn;
    var steps, tiles, eng;
    if (site) {
      tiles = [tile('Visitas', fmt(visits), 'Sessões únicas na página principal'), tile('Chamaram no WhatsApp', fmt(ev.contact || 0), pct(ev.contact || 0, visits) + ' das visitas'),
        tile('Clicaram em um curso', fmt(ev.course_click || 0), pct(ev.course_click || 0, visits) + ' das visitas'), tile('Abriram o Instagram', fmt(ev.instagram || 0), pct(ev.instagram || 0, visits) + ' das visitas')];
      steps = [['Visitas', visits], ['Rolaram 50% da página', ev.scroll50 || 0], ['Rolaram 90% da página', ev.scroll90 || 0], ['Chamaram no WhatsApp', ev.contact || 0]];
      eng = [['Rolaram 25%', ev.scroll25], ['Rolaram 75%', ev.scroll75], ['Ficaram 30 s', ev.time30], ['Ficaram 1 min', ev.time60], ['Ficaram 2 min', ev.time120], ['Clicaram em um curso', ev.course_click], ['Abriram o Instagram', ev.instagram]];
      $('#chartTitle').textContent = 'Contatos no WhatsApp por dia';
      $('#chartSub').textContent = 'Cliques no WhatsApp, telefone e e-mail. Passe o mouse para ver as visitas do dia.';
    } else {
      tiles = [tile('Visitas', fmt(visits), 'Sessões únicas nas páginas de curso'), tile('Leads', fmt(st.leads), pct(st.leads, visits) + ' das visitas'),
        tile('Leads parciais', fmt(st.partials), 'Preencheram e não enviaram'), tile('Foram ao checkout', fmt(ev.checkout || 0), pct(ev.checkout || 0, st.leads) + ' dos leads'),
        tile('Compras', fmt(st.purchases), st.purchases ? brl(st.revenue) + ' confirmados' : 'Confirmadas por webhook ou manualmente')];
      steps = [['Visitas', visits], ['Rolaram 50% da página', ev.scroll50 || 0], ['Viram a oferta', ev.offer || 0], ['Clicaram em um botão', ev.cta || 0],
        ['Começaram o formulário', ev.form_start || 0], ['Enviaram (leads)', st.leads], ['Foram ao checkout', ev.checkout || 0], ['Compraram', st.purchases]];
      eng = [['Rolaram 25%', ev.scroll25], ['Rolaram 75%', ev.scroll75], ['Rolaram 90%', ev.scroll90], ['Ficaram 30 s', ev.time30], ['Ficaram 1 min', ev.time60], ['Ficaram 2 min', ev.time120], ['Ativaram o som do vídeo', ev.video_sound], ['Assistiram metade com som', ev.video50], ['Assistiram até o fim', ev.video_complete], ['Abriram uma pergunta', ev.faq]];
      $('#chartTitle').textContent = 'Leads por dia';
      $('#chartSub').textContent = 'Formulários enviados. Passe o mouse para ver visitas, parciais, checkout e compras do dia.';
    }
    $('#tiles').innerHTML = tiles.join('');
    var max = Math.max.apply(null, steps.map(function (s) { return s[1]; }).concat([1]));
    $('#fun').innerHTML = steps.map(function (s) {
      return '<li><span>' + s[0] + '</span><span class="bar" title="' + fmt(s[1]) + '"><i style="width:' + Math.min(100, s[1] / max * 100) + '%"></i></span><span class="n num"><b>' + fmt(s[1]) + '</b> ' + pct(s[1], visits) + '</span></li>';
    }).join('');
    $('#srcCard').hidden = site; $('#campCard').hidden = site;
    if (!site) { renderRank('#sources', st.sources); renderRank('#campaigns', st.campaigns); }
    $('#eng').innerHTML = eng.map(function (e) { return '<dt>' + e[0] + '</dt><dd class="num">' + fmt(e[1] || 0) + '<small>' + pct(e[1] || 0, visits) + '</small></dd>'; }).join('');

    var c = st.capi || {}, last = c.last;
    var lastTxt = last ? (last.ok ? '<span class="pill ok">Último envio aceito</span> ' + esc(last.event) + ' em ' + dt(last.at) : '<span class="pill bad">Último envio com erro</span> ' + esc(last.message || '') + ' (' + dt(last.at) + ')') : '<span class="pill mut">Nenhum envio ainda</span>';
    $('#capiCard').innerHTML = '<h2>Meta Ads</h2><p class="sub">Situação do rastreamento em todas as páginas.</p><dl class="kv"><dt>Pixel</dt><dd>' + (c.pixel ? '<span class="pill ok">Configurado</span>' : '<span class="pill warn">Sem Pixel ID</span>') + '</dd><dt>API de Conversões</dt><dd>' + (c.enabled ? '<span class="pill ok">Ativa</span>' : '<span class="pill warn">Inativa</span>') + (c.test_mode ? ' <span class="pill warn">Modo teste ligado</span>' : '') + '</dd><dt>CAPI</dt><dd style="font-weight:400">' + lastTxt + '</dd></dl>';

    renderChart(st.series || [], site ? 'contact' : 'lead');
    renderTable(st.series || [], site);
  }
  function renderRank(sel, obj) {
    var keys = Object.keys(obj || {});
    if (!keys.length) { $(sel).innerHTML = '<li class="empty">Sem leads no período.</li>'; return; }
    var max = Math.max.apply(null, keys.map(function (k) { return obj[k]; }));
    $(sel).innerHTML = keys.map(function (k) { return '<li><span class="t" title="' + esc(k) + '">' + esc(k) + '</span><span class="num">' + fmt(obj[k]) + '</span><span class="bar"><i style="width:' + (obj[k] / max * 100) + '%"></i></span></li>'; }).join('');
  }

  /* Colunas de uma série só (o título nomeia a série; sem legenda) */
  function niceMax(v) { if (v <= 4) return 4; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function renderChart(series, key) {
    var box = $('#chart'), tip = $('#tip');
    var W = Math.max(300, box.clientWidth), H = 230, L = 34, R = 6, T = 10, B = 26;
    var n = series.length || 1, max = niceMax(Math.max.apply(null, series.map(function (d) { return d[key]; }).concat([0])));
    var band = (W - L - R) / n, bw = Math.max(2, Math.min(24, band - 2)), y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc($('#chartTitle').textContent) + '">';
    for (var i = 0; i <= 4; i++) { var v = max / 4 * i, yy = y(v); svg += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax num" x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmt(Math.round(v * 10) / 10) + '</text>'; }
    var every = Math.ceil(n / Math.max(1, Math.floor((W - L) / 54)));
    series.forEach(function (d, i2) {
      var x = L + band * i2 + (band - bw) / 2, yv = y(d[key]), h = (H - B) - yv, r = Math.min(4, h, bw / 2);
      svg += '<rect class="hit" data-i="' + i2 + '" x="' + (L + band * i2) + '" y="' + T + '" width="' + band + '" height="' + (H - T - B) + '"/>';
      if (d[key] > 0) svg += '<path class="col" data-c="' + i2 + '" d="M' + x + ',' + (H - B) + ' V' + (yv + r) + ' Q' + x + ',' + yv + ' ' + (x + r) + ',' + yv + ' H' + (x + bw - r) + ' Q' + (x + bw) + ',' + yv + ' ' + (x + bw) + ',' + (yv + r) + ' V' + (H - B) + ' Z"/>';
      if ((n - 1 - i2) % every === 0) svg += '<text class="ax" x="' + (L + band * i2 + band / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + dm(d.day) + '</text>';
    });
    svg += '</svg>';
    box.innerHTML = svg; box.appendChild(tip);
    $$('.hit', box).forEach(function (hEl) {
      hEl.addEventListener('mouseenter', function () {
        var d = series[Number(hEl.dataset.i)], bb = hEl.getBoundingClientRect(), cb = box.getBoundingClientRect();
        $$('.col', box).forEach(function (c) { c.classList.toggle('hl', c.dataset.c === hEl.dataset.i); });
        tip.innerHTML = '<b>' + dm(d.day) + '</b>' + (key === 'contact'
          ? '<span>Contatos <b class="num">' + fmt(d.contact) + '</b></span><span>Visitas <span class="num">' + fmt(d.visit) + '</span></span>'
          : '<span>Leads <b class="num">' + fmt(d.lead) + '</b></span><span>Visitas <span class="num">' + fmt(d.visit) + '</span></span><span>Parciais <span class="num">' + fmt(d.partial) + '</span></span><span>Checkout <span class="num">' + fmt(d.checkout) + '</span></span><span>Compras <span class="num">' + fmt(d.purchase) + '</span></span>');
        var left = bb.left - cb.left + bb.width / 2; left = Math.max(80, Math.min(cb.width - 80, left));
        tip.style.left = left + 'px'; tip.style.top = y(d[key]) + 'px'; tip.classList.add('on');
      });
      hEl.addEventListener('mouseleave', function () { tip.classList.remove('on'); $$('.col', box).forEach(function (c) { c.classList.remove('hl'); }); });
    });
  }
  function renderTable(series, site) {
    var head = site ? '<th>Dia</th><th>Visitas</th><th>Contatos</th>' : '<th>Dia</th><th>Visitas</th><th>Leads</th><th>Parciais</th><th>Checkout</th><th>Compras</th>';
    $('#tbl').innerHTML = '<table class="tbl-mini"><thead><tr>' + head + '</tr></thead><tbody>' + series.slice().reverse().map(function (d) {
      return '<tr><td>' + dm(d.day) + '</td><td class="num">' + fmt(d.visit) + '</td>' + (site ? '<td class="num">' + fmt(d.contact) + '</td>' : '<td class="num">' + fmt(d.lead) + '</td><td class="num">' + fmt(d.partial) + '</td><td class="num">' + fmt(d.checkout) + '</td><td class="num">' + fmt(d.purchase) + '</td>') + '</tr>';
    }).join('') + '</tbody></table>';
  }
  $('#tblToggle').addEventListener('click', function () { S.showTable = !S.showTable; $('#tbl').hidden = !S.showTable; this.textContent = S.showTable ? 'Ocultar tabela' : 'Ver tabela'; this.setAttribute('aria-expanded', String(S.showTable)); });
  var rT; window.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(function () { if (S.stats && S.tab === 'visao') renderChart(S.stats.series || [], isSite() ? 'contact' : 'lead'); }, 150); });

  /* ---------- leads ---------- */
  function filters() { return { p: isSite() ? '' : S.prod, q: $('#f-q').value.trim(), status: $('#f-status').value, source: $('#f-source').value, campaign: $('#f-campaign').value, from: $('#f-from').value, to: $('#f-to').value }; }
  function waLink(l) {
    var first = (l.name || '').trim().split(/\s+/)[0] || '';
    first = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
    var cfg = S.cfg[l.product] || {};
    var p = product(l.product);
    var t = cfg.wa_template || 'Oi, {primeiro_nome}!';
    t = t.replace(/\{primeiro_nome\}/g, first).replace(/\{nome\}/g, l.name || '').replace(/\{email\}/g, l.email || '').replace(/\{curso\}/g, p ? p.name : '');
    return 'https://wa.me/55' + l.phone + '?text=' + encodeURIComponent(t);
  }
  function statusSelect(l) {
    return '<select class="st-sel st-' + l.status + '" data-id="' + l.id + '" aria-label="Status de ' + esc(l.name || 'lead') + '">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === l.status ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('') + '</select>';
  }
  function rowHtml(l) {
    var sub = [l.utm_campaign, l.utm_content].filter(Boolean).join(' / ');
    var p = product(l.product);
    return '<tr data-id="' + l.id + '">' +
      '<td class="when num">' + dt(l.submitted_at || l.created_at) + (l.submissions > 1 ? '<small>' + l.submissions + ' envios</small>' : '') + '</td>' +
      '<td class="who"><b>' + esc(l.name || 'Sem nome') + '</b><small>' + esc(l.email) + '</small><small class="num">' + esc(phoneFmt(l.phone)) + '</small>' + (!S.prod && p ? '<span class="prod">' + esc(p.name) + '</span>' : '') + '</td>' +
      '<td class="src">' + esc(l.utm_source || 'direto') + (sub ? '<small title="' + esc(sub) + '">' + esc(sub) + '</small>' : '') + '</td>' +
      '<td>' + statusSelect(l) + '</td>' +
      '<td><div class="acts">' + (l.phone ? '<a class="btn wa" href="' + waLink(l) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '<button type="button" class="btn sm" data-open="' + l.id + '">Detalhes</button></div></td></tr>';
  }
  function ensureCfg() {
    var missing = courses().filter(function (p) { return !S.cfg[p.id]; });
    return Promise.all(missing.map(function (p) { return api('settings', { scope: p.id }).then(function (j) { S.cfg[p.id] = j.settings; }); }));
  }
  function loadLeads(keepPage) {
    if (!keepPage) S.page = 1;
    if (isSite()) {
      $('#rows').innerHTML = '<tr><td colspan="5" class="empty" style="padding:28px 16px">A página principal não tem formulário: os contatos vão direto para o WhatsApp e aparecem como "Chamaram no WhatsApp" na visão geral. Escolha um curso ou "Todos os cursos" para ver os leads.</td></tr>';
      $('#pinfo').textContent = ''; $('#prev').disabled = true; $('#next').disabled = true; return Promise.resolve();
    }
    var f = filters(); f.page = S.page; f.per = 50;
    return ensureCfg().then(function () { return api('leads', f); }).then(function (j) {
      S.leads = j.items;
      fillSelect('#f-source', j.sources, 'Todas as origens', ['direto']);
      fillSelect('#f-campaign', j.campaigns, 'Todas as campanhas', []);
      $('#rows').innerHTML = j.items.length ? j.items.map(rowHtml).join('') : '<tr><td colspan="5" class="empty" style="padding:28px 16px">Nenhum lead com esses filtros. Quando alguém preencher o formulário de um curso, aparece aqui na hora.</td></tr>';
      $('#pinfo').textContent = 'Página ' + j.page + ' de ' + j.pages + ', ' + fmt(j.total) + (j.total === 1 ? ' lead' : ' leads');
      $('#prev').disabled = j.page <= 1; $('#next').disabled = j.page >= j.pages;
      var u = new URL('/api/admin', location.origin); u.searchParams.set('action', 'export');
      Object.keys(f).forEach(function (k) { if (f[k] && k !== 'page' && k !== 'per') u.searchParams.set(k, f[k]); });
      $('#exportBtn').href = u.toString();
    }).catch(function (e) { toast('Erro', e.message); });
  }
  function fillSelect(sel, values, first, extra) {
    var el = $(sel), cur = el.value;
    el.innerHTML = '<option value="">' + first + '</option>' + extra.concat(values || []).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    el.value = cur;
  }
  var qT; $('#f-q').addEventListener('input', function () { clearTimeout(qT); qT = setTimeout(function () { loadLeads(); }, 300); });
  ['#f-status', '#f-source', '#f-campaign', '#f-from', '#f-to'].forEach(function (s) { $(s).addEventListener('change', function () { loadLeads(); }); });
  $('#f-clear').addEventListener('click', function () { ['#f-q', '#f-status', '#f-source', '#f-campaign', '#f-from', '#f-to'].forEach(function (s) { $(s).value = ''; }); loadLeads(); });
  $('#prev').addEventListener('click', function () { S.page--; loadLeads(true); });
  $('#next').addEventListener('click', function () { S.page++; loadLeads(true); });
  $('#rows').addEventListener('change', function (e) {
    var sel = e.target.closest('.st-sel'); if (!sel) return;
    var id = Number(sel.dataset.id), status = sel.value;
    api('update', {}, { id: id, status: status }).then(function (j) {
      var i = S.leads.findIndex(function (l) { return l.id === id; }); if (i >= 0 && j.lead) S.leads[i] = j.lead;
      sel.className = 'st-sel st-' + status; toast('Status atualizado', STATUS[status]);
    }).catch(function (e2) { toast('Erro', e2.message); });
  });
  $('#rows').addEventListener('click', function (e) { var b = e.target.closest('[data-open]'); if (b) openLead(Number(b.dataset.open)); });

  var drawer = $('#drawer');
  function openLead(id) {
    var l = S.leads.find(function (x) { return x.id === id; }); if (!l) return;
    var p = product(l.product);
    var rows = [
      ['Curso', esc(p ? p.name : l.product)],
      ['Status', '<span class="pill st-' + l.status + '">' + STATUS[l.status] + '</span>'],
      ['E-mail', l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' : '—'],
      ['WhatsApp', l.phone ? '<a href="' + waLink(l) + '" target="_blank" rel="noopener">' + esc(phoneFmt(l.phone)) + '</a>' : '—'],
      ['Primeiro contato', dt(l.created_at)], ['Enviou o formulário', l.submitted_at ? dt(l.submitted_at) : 'Ainda não (parcial)'], ['Envios', l.submissions],
      ['Pagamento', l.paid_at ? dt(l.paid_at) + ' (' + brl(l.paid_value) + ')' : '—'],
      ['utm_source', esc(l.utm_source) || '—'], ['utm_medium', esc(l.utm_medium) || '—'], ['utm_campaign', esc(l.utm_campaign) || '—'], ['utm_content', esc(l.utm_content) || '—'], ['utm_term', esc(l.utm_term) || '—'],
      ['Veio de anúncio Meta', l.fbclid || l.fbc ? 'Sim (fbclid)' : 'Não identificado'],
      ['Página', esc(l.landing) || '—'], ['Referência', esc(l.referrer) || '—'], ['IP', esc(l.ip) || '—'], ['Navegador', '<small>' + esc(l.ua) + '</small>']
    ];
    $('#dr').innerHTML = '<div class="dr__top"><div><h2 id="dr-t">' + esc(l.name || 'Sem nome') + '</h2><div style="color:var(--ink3);font-size:12.5px">Lead #' + l.id + '</div></div><button type="button" class="x" data-close aria-label="Fechar">✕</button></div>' +
      (l.phone ? '<a class="btn wa" style="height:40px" href="' + waLink(l) + '" target="_blank" rel="noopener">Chamar no WhatsApp</a>' : '') +
      '<dl>' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>' +
      '<label for="dr-notes" style="font-weight:600;font-size:13.5px;display:block;margin-bottom:6px">Observações</label><textarea id="dr-notes">' + esc(l.notes) + '</textarea>' +
      '<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn pri" id="dr-save">Salvar observações</button><button type="button" class="btn danger" id="dr-del">Excluir lead</button></div>' +
      '<div class="confirm" id="dr-confirm">Excluir este lead do painel? Isso não pode ser desfeito. <div style="margin-top:8px;display:flex;gap:8px"><button type="button" class="btn sm danger" id="dr-yes">Excluir</button><button type="button" class="btn sm" id="dr-no">Cancelar</button></div></div>';
    drawer.showModal();
    $('[data-close]', drawer).onclick = function () { drawer.close(); };
    $('#dr-save').onclick = function () { api('update', {}, { id: id, notes: $('#dr-notes').value }).then(function (j) { l.notes = j.lead.notes; toast('Observações salvas', l.name || ''); }).catch(function (e) { toast('Erro', e.message); }); };
    $('#dr-del').onclick = function () { $('#dr-confirm').classList.add('on'); };
    $('#dr-no').onclick = function () { $('#dr-confirm').classList.remove('on'); };
    $('#dr-yes').onclick = function () { api('delete', {}, { id: id }).then(function () { drawer.close(); toast('Lead excluído', l.name || ''); loadLeads(true); }).catch(function (e) { toast('Erro', e.message); }); };
  }
  drawer.addEventListener('click', function (e) { if (e.target === drawer) drawer.close(); });

  /* ---------- configurações ---------- */
  var COURSE_FIELDS = ['checkout_url', 'price', 'price_from', 'installments', 'promo_text', 'deadline', 'wa_template', 'pixel_id', 'capi_token'];
  var COURSE_BOOLS = ['pass_utm', 'pass_lead'];
  function courseForm(p) {
    var id = p.id;
    return '<form class="fs" data-scope="' + id + '" autocomplete="off">' +
      '<h2>' + esc(p.name) + '</h2><p>Página <a href="' + p.path + '" target="_blank" rel="noopener">' + location.host + p.path + '</a></p>' +
      '<div class="cols"><div class="row"><label for="' + id + '-co">Link do checkout</label><input type="url" id="' + id + '-co" name="checkout_url" placeholder="https://cartpag.com/pay/seu-link"></div>' +
      '<div class="row"><label for="' + id + '-pr">Preço (R$)</label><input type="text" id="' + id + '-pr" name="price" inputmode="decimal" placeholder="147,00"><span class="help">Vai como valor para a Meta. Na página do Transforme também aparece na oferta.</span></div></div>' +
      '<div class="cols"><div class="row"><label for="' + id + '-pf">Preço normal, riscado (opcional)</label><input type="text" id="' + id + '-pf" name="price_from" inputmode="decimal"><span class="help">Só preencha se for o preço real fora da campanha.</span></div>' +
      '<div class="row"><label for="' + id + '-in">Parcelamento (opcional)</label><input type="text" id="' + id + '-in" name="installments" placeholder="ou 12x de R$ 99,70"></div></div>' +
      '<div class="cols"><div class="row"><label for="' + id + '-pt">Faixa da campanha (opcional)</label><input type="text" id="' + id + '-pt" name="promo_text" placeholder="Black Friday: condição especial por tempo limitado"><span class="help">Deixe em branco para esconder.</span></div>' +
      '<div class="row"><label for="' + id + '-dl">Fim da condição (opcional)</label><input type="datetime-local" id="' + id + '-dl" name="deadline"><span class="help">Liga a contagem regressiva real. Horário de Brasília.</span></div></div>' +
      '<label class="chk"><input type="checkbox" name="pass_utm"><div><b>Repassar UTMs e fbclid para o checkout</b><span>Mantém a origem da campanha no checkout.</span></div></label>' +
      '<label class="chk"><input type="checkbox" name="pass_lead"><div><b>Enviar nome, e-mail e telefone na URL do checkout</b><span>Parâmetros name, email, phone. A Meta pode sinalizar dados pessoais em URL; use só se o checkout precisar.</span></div></label>' +
      '<div class="row" style="margin-top:12px"><label for="' + id + '-wa">Mensagem do botão de WhatsApp</label><textarea id="' + id + '-wa" name="wa_template"></textarea><span class="help">Use {primeiro_nome}, {nome}, {email} e {curso}.</span></div>' +
      '<div class="row"><label>Webhook de pagamento aprovado</label><div class="copy"><input type="text" readonly data-hook="' + id + '"><button type="button" class="btn" data-copy="' + id + '">Copiar</button></div><span class="help">Cadastre no checkout deste curso. O lead vira "Comprou" no painel.</span></div>' +
      '<details class="more"><summary>Pixel próprio para este curso (opcional)</summary><div class="cols" style="margin-top:12px"><div class="row"><label for="' + id + '-px">ID do Pixel</label><input type="text" id="' + id + '-px" name="pixel_id" inputmode="numeric"><span class="help">Em branco, usa o Pixel geral.</span></div>' +
      '<div class="row"><label for="' + id + '-tk">Token da CAPI desse Pixel</label><input type="password" id="' + id + '-tk" name="capi_token"></div></div></details>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:14px"><button type="submit" class="btn pri">Salvar ' + esc(p.name) + '</button><span class="help" data-msg style="color:var(--ink3);font-size:12.5px"></span></div>' +
      '</form>';
  }
  function fillForm(form, s) {
    Object.keys(s).forEach(function (k) {
      var el = form.elements[k]; if (!el) return;
      if (el.type === 'checkbox') el.checked = s[k] === '1' || s[k] === true; else el.value = s[k] || '';
    });
  }
  function readForm(form, fields, bools) {
    var b = {};
    fields.forEach(function (k) { if (form.elements[k]) b[k] = form.elements[k].value; });
    bools.forEach(function (k) { b[k] = form.elements[k].checked ? 1 : 0; });
    return b;
  }
  function loadSettings() {
    if (!$('#courseForms').children.length) {
      $('#courseForms').innerHTML = courses().map(courseForm).join('');
      $$('#courseForms form').forEach(function (f) {
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var scope = f.dataset.scope, msg = $('[data-msg]', f);
          msg.textContent = 'Salvando…';
          api('settings', { scope: scope }, readForm(f, COURSE_FIELDS, COURSE_BOOLS)).then(function (j) {
            if (j.ok === false) throw new Error(j.error);
            S.cfg[scope] = j.settings; fillForm(f, j.settings);
            msg.textContent = 'Salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '. A página já usa os novos valores.';
          }).catch(function (e2) { msg.textContent = e2.message; });
        });
      });
      $$('[data-copy]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = $('[data-hook="' + b.dataset.copy + '"]'); i.select();
          (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(function () { toast('Copiado', 'URL do webhook'); }).catch(function () { document.execCommand('copy'); toast('Copiado', 'URL do webhook'); });
        });
      });
    }
    var g = $('#gForm');
    return api('settings', { scope: 'global' }).then(function (j) {
      S.global = j.settings; S.info = j.info; fillForm(g, j.settings);
      var info = j.info, last = info.capi_last, err = info.capi_last_error;
      $('#sys').innerHTML = '<dt>Banco de dados</dt><dd>' + esc(info.database) + '</dd><dt>Node</dt><dd>' + esc(info.node) + '</dd><dt>Graph API</dt><dd>' + esc(info.graph) + '</dd>' +
        '<dt>Último envio CAPI</dt><dd style="font-weight:400">' + (last ? (last.ok ? '<span class="pill ok">Aceito</span> ' : '<span class="pill bad">Erro</span> ') + esc(last.event) + ' em ' + dt(last.at) : '—') + '</dd>' +
        (err ? '<dt>Último erro CAPI</dt><dd style="font-weight:400">' + esc(err.message) + ' (' + dt(err.at) + ')</dd>' : '');
      return Promise.all(courses().map(function (p) {
        return api('settings', { scope: p.id }).then(function (r) {
          S.cfg[p.id] = r.settings;
          var f = $('#courseForms form[data-scope="' + p.id + '"]'); fillForm(f, r.settings);
          $('[data-hook="' + p.id + '"]', f).value = location.origin + '/api/webhook?key=' + info.webhook_key + '&p=' + p.id;
        });
      }));
    }).catch(function (e) { toast('Erro', e.message); });
  }
  $('#gForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var g = $('#gForm');
    $('#gMsg').textContent = 'Salvando…';
    api('settings', { scope: 'global' }, readForm(g, ['pixel_id', 'capi_token', 'capi_test_code'], ['capi_enabled', 'capi_purchase', 'notify_sound'])).then(function (j) {
      if (j.ok === false) throw new Error(j.error);
      S.global = j.settings; fillForm(g, j.settings);
      $('#gMsg').textContent = 'Salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.';
    }).catch(function (e2) { $('#gMsg').textContent = e2.message; });
  });
  $('#capiTest').addEventListener('click', function () {
    var r = $('#capiRes'); r.className = 'result on'; r.textContent = 'Enviando evento de teste…';
    api('capi_test', { p: 'instituto' }, {}).then(function (j) {
      r.className = 'result on ' + (j.ok ? 'ok' : 'bad');
      r.textContent = j.ok ? (j.message + (j.test_mode ? '. Confira em Gerenciador de Eventos > Eventos de teste.' : '. Sem código de teste, o evento entra como PageView real.')) : ('A Meta recusou: ' + (j.message || 'erro desconhecido'));
    }).catch(function (e) { r.className = 'result on bad'; r.textContent = e.message; });
  });

  /* ---------- ao vivo ---------- */
  var baseTitle = document.title, actx = null;
  document.addEventListener('click', function () { if (!actx && (window.AudioContext || window.webkitAudioContext)) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } }, { once: true });
  function beep() {
    if (!actx || (S.global && S.global.notify_sound === '0')) return;
    try { var o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(.18, actx.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + .45); o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + .5); } catch (e) {}
  }
  function poll() {
    api('poll', { since: S.since || '' }).then(function (j) {
      var fresh = (j.items || []).filter(function (l) { var k = l.id + ':' + (l.submitted_at ? 'f' : 'p'); if (seen[k]) return false; seen[k] = 1; return true; });
      if (S.since && fresh.length) {
        fresh.slice(0, 3).forEach(function (l) { var p = product(l.product); toast((l.submitted_at ? 'Novo lead' : 'Lead parcial') + (p ? ' em ' + p.name : ''), l.name || l.email || phoneFmt(l.phone)); });
        beep();
        if (document.hidden) { S.newCount += fresh.length; document.title = '(' + S.newCount + ') ' + baseTitle; }
        if (S.tab === 'visao') loadStats(); else if (S.tab === 'leads' && S.page === 1) loadLeads(true);
      }
      S.since = j.now;
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { S.newCount = 0; document.title = baseTitle; } });

  /* ---------- início ---------- */
  var started = false;
  function start() {
    $('#loginView').hidden = true; $('#app').hidden = false;
    if (started) { setTab(S.tab); return; }
    started = true;
    fillProducts();
    setDays(30);
    setTab(location.hash.slice(1) || 'visao');
    poll(); setInterval(poll, 12000);
  }
  api('me').then(function (j) {
    S.products = j.products || [];
    var steps = [];
    if (j.missing && j.missing.length) steps.push('Crie em Settings > Environment Variables: ' + j.missing.join(' e ') + '.');
    if (j.database === false) steps.push('Conecte o banco: Storage > Neon > Connect Project, marcando Production e Preview.');
    if (steps.length) return showLogin('Falta configurar no Vercel. ' + steps.join(' ') + ' Depois faça Deployments > Redeploy (variáveis novas só valem em um deploy novo).');
    if (!j.logged) return showLogin(false);
    S.csrf = j.csrf; start();
  }).catch(function () { showLogin(false); });
})();
