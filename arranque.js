/* Se carga en <head>, antes de pintar: oculta el contenido hasta el primer pintado de panel.js
   (asi no salta al llenarse). Sin JavaScript no se oculta nada; si la carga se cuelga, a los
   10 s se muestra igualmente.
   La paleta es «Arena» (elegida el 18-nov-2026). ?paleta=0|1|3 muestra una de las alternativas
   (panel.css, [data-paleta]) para comparar; theme-color sigue al fondo de la paleta para que
   la barra del navegador lo iguale. */
(function (d, w) {
  d.documentElement.classList.add('js');
  setTimeout(function () { d.documentElement.classList.add('cargado'); }, 10000);
  var p = null;
  try { p = new URLSearchParams(w.location.search).get('paleta'); } catch (x) { /* sin URLSearchParams */ }
  var FONDOS = { '0': ['#E9EDF3', '#06080C'], '1': ['#EEF1F5', '#161B22'], '3': ['#EEEEF8', '#15152B'] };
  if (!p || !FONDOS[p]) return;
  d.documentElement.setAttribute('data-paleta', p);
  var metas = d.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) {
    metas[i].setAttribute('content', FONDOS[p][/dark/.test(metas[i].getAttribute('media') || '') ? 1 : 0]);
  }
})(document, window);
