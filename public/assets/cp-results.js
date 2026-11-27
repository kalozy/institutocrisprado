/*!
 * Galeria de resultados: carrossel com arrastar/setas, ampliação em tela cheia,
 * abas (Rosto/Lábios) e eventos da Meta (ViewResults, OpenResult).
 */
(function () {
  'use strict';
  var galleries = [].slice.call(document.querySelectorAll('.rs'));
  if (!galleries.length) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function track(name, data) { if (window.CP && window.CP.send) window.CP.send(name, data); }
  var ARROW_L = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>';
  var ARROW_R = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>';
  var CLOSE = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>';

  /* ---------- ampliação ---------- */
  var dlg = document.createElement('dialog');
  dlg.className = 'rs-dlg';
  dlg.setAttribute('aria-label', 'Resultado ampliado');
  dlg.innerHTML = '<div class="rs-dlg__in"><button type="button" class="rs-dlg__x" aria-label="Fechar">' + CLOSE + '</button>' +
    '<figure class="rs-dlg__fig"><img alt=""><figcaption class="rs-dlg__cap"></figcaption></figure>' +
    '<div class="rs-dlg__bar"><button type="button" class="rs-dlg__prev" aria-label="Resultado anterior">' + ARROW_L + '</button><span class="rs-dlg__count" aria-live="polite"></span><button type="button" class="rs-dlg__next" aria-label="Próximo resultado">' + ARROW_R + '</button></div></div>';
  document.body.appendChild(dlg);
  if (typeof dlg.showModal !== 'function') { dlg.showModal = function () { dlg.setAttribute('open', ''); }; dlg.close = function () { dlg.removeAttribute('open'); dlg.dispatchEvent(new Event('close')); }; }
  var dImg = dlg.querySelector('img'), dCap = dlg.querySelector('.rs-dlg__cap'), dCount = dlg.querySelector('.rs-dlg__count');
  var cur = { items: [], i: 0, back: null };
  function show(i) {
    var n = cur.items.length; cur.i = (i + n) % n;
    var b = cur.items[cur.i], img = b.querySelector('img');
    dImg.src = b.getAttribute('data-full') || img.currentSrc || img.src;
    dImg.alt = img.alt;
    dCap.textContent = b.getAttribute('data-cap') || '';
    dCount.textContent = (cur.i + 1) + ' de ' + n;
  }
  function openAt(items, i, gallery, btn) {
    cur.items = items; cur.back = btn; show(i);
    dlg.showModal(); document.documentElement.classList.add('rs-lock');
    dlg.querySelector('.rs-dlg__x').focus();
    track('OpenResult', { gallery: gallery, index: i + 1 });
  }
  dlg.addEventListener('close', function () { document.documentElement.classList.remove('rs-lock'); if (cur.back) cur.back.focus(); });
  dlg.querySelector('.rs-dlg__x').addEventListener('click', function () { dlg.close(); });
  dlg.querySelector('.rs-dlg__prev').addEventListener('click', function () { show(cur.i - 1); });
  dlg.querySelector('.rs-dlg__next').addEventListener('click', function () { show(cur.i + 1); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.classList.contains('rs-dlg__in') || e.target.classList.contains('rs-dlg__fig')) dlg.close(); });
  dlg.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') show(cur.i - 1); else if (e.key === 'ArrowRight') show(cur.i + 1); });
  var sx = null;
  dlg.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
  dlg.addEventListener('touchend', function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 45) show(cur.i + (dx < 0 ? 1 : -1)); sx = null; }, { passive: true });

  /* ---------- carrosséis ---------- */
  galleries.forEach(function (g) {
    var name = g.getAttribute('data-gallery') || 'resultados';
    var tr = g.querySelector('.rs__track');
    var btns = [].slice.call(g.querySelectorAll('.rs__btn'));
    var prev = g.querySelector('.rs__prev'), next = g.querySelector('.rs__next'), count = g.querySelector('.rs__count');
    function step() {
      var it = g.querySelector('.rs__item'); if (!it) return 300;
      var gap = parseFloat(getComputedStyle(tr).columnGap) || 16;
      return it.getBoundingClientRect().width + gap;
    }
    function update() {
      var max = tr.scrollWidth - tr.clientWidth;
      var atEnd = tr.scrollLeft >= max - 4;
      if (prev) prev.disabled = tr.scrollLeft <= 4;
      if (next) next.disabled = atEnd;
      if (count) {
        var first = Math.min(btns.length, Math.round(tr.scrollLeft / step()) + 1);
        count.textContent = (atEnd && max > 4 ? btns.length : first) + ' / ' + btns.length;
      }
    }
    g._rsUpdate = update;
    if (prev) prev.addEventListener('click', function () { tr.scrollBy({ left: -step(), behavior: reduce ? 'auto' : 'smooth' }); });
    if (next) next.addEventListener('click', function () { tr.scrollBy({ left: step(), behavior: reduce ? 'auto' : 'smooth' }); });
    var t = null;
    tr.addEventListener('scroll', function () { if (t) return; t = requestAnimationFrame(function () { t = null; update(); }); }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    btns.forEach(function (b, i) { b.addEventListener('click', function () { openAt(btns, i, name, b); }); });
    update();
    if ('IntersectionObserver' in window) {
      var seen = false;
      new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting && !seen) { seen = true; track('ViewResults', { gallery: name }); } }); }, { threshold: .4 }).observe(tr);
    }
  });

  /* ---------- abas (página principal) ---------- */
  var tabs = [].slice.call(document.querySelectorAll('[data-rs-tab]'));
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var target = tab.getAttribute('data-rs-tab');
      tabs.forEach(function (o) { var on = o === tab; o.setAttribute('aria-selected', on ? 'true' : 'false'); o.tabIndex = on ? 0 : -1; });
      galleries.forEach(function (g) {
        if (!g.hasAttribute('data-tabbed')) return;
        var on = g.getAttribute('data-gallery') === target;
        g.hidden = !on;
        if (on) { g.querySelector('.rs__track').scrollLeft = 0; g._rsUpdate(); }
      });
    });
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = tabs.indexOf(tab), j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].focus(); tabs[j].click();
    });
  });
})();
