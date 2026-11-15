/* Se carga en <head>, antes de pintar: oculta el contenido hasta el primer pintado de panel.js
   (asi no salta al llenarse). Sin JavaScript no se oculta nada; si la carga se cuelga, a los
   10 s se muestra igualmente. */
(function (d) {
  d.documentElement.classList.add('js');
  setTimeout(function () { d.documentElement.classList.add('cargado'); }, 10000);
})(document);
