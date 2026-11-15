/* Panel del decisor. Dos capas:
 *  - Funciones puras que convierten estado.json en HTML (texto) y en series de los graficos.
 *    No tocan el DOM: se prueban con node (tests/js/panel_test.js).
 *  - Pegamento del navegador (al final): carga estado.json cada 60 s, precio en directo por el
 *    WebSocket publico del exchange, grafico de velas, hoja de detalle, pestanas y vidrio.
 * Sin datos inventados: si falta una fuente, se muestra un estado vacio que dice que falta y
 * por que (estado.faltan). Todo texto del JSON se escapa antes de pintarlo. */
(function (root) {
  'use strict';

  var CONTROL = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]+', 'g');
  var FRESCO_MIN = 30, AMBAR_MIN = 90;
  var PERIODOS = [['1M', 31], ['3M', 92], ['6M', 183], ['1A', 366], ['Todo', null]];
  var SENALES = { comprar: 'Comprar', mantener: 'Mantener', reducir: 'Reducir', fuera: 'Fuera', sindato: 'Sin dato' };
  var NOMBRES_CARTERA = { regla: 'A · regla', ejecutable: 'B · ejecutable', comprar_mantener: 'Comprar y mantener' };
  var COLOR_CARTERA = { ejecutable: '#3550F0', regla: '#7A8494', comprar_mantener: '#B0B7C3' };
  var OBJETIVO_VOL = 0.40, BANDA = 0.20, MINIMO_ORDEN = 10;
  var POLITICA = { drawdown_backtest: -0.37, limite: -0.5 };
  var REPO_DECISIONES = 'https://github.com/miguellopezt/agente-trading/issues/new';

  var ICONOS = {
    ok: '<path d="M4 8.5l3 3 5-6" />', aviso: '<path d="M8 3v6M8 12v.5" />', alerta: '<path d="M4 4l8 8M12 4l-8 8" />',
    vacio: '<path d="M3.5 8h9" />', sindato: '<path d="M3.5 8h9" />',
    comprar: '<path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" />', compra: '<path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" />',
    reducir: '<path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" />', venta: '<path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" />',
    mantener: '<path d="M3.5 6.5h9M3.5 9.5h9" />', fuera: '<circle cx="8" cy="8" r="4.5" /><path d="M5 11l6-6" />',
    hecho: '<path d="M4 8.5l3 3 5-6" />', pendiente: '<circle cx="8" cy="8" r="4.5" />',
    trabajando: '<path d="M8 4v4l2.5 1.5" /><circle cx="8" cy="8" r="5" />', esperando: '<path d="M5.5 4v8M10.5 4v8" />',
    bloqueado: '<rect x="4" y="7" width="8" height="5.5" rx="1.5" /><path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" />',
    parado: '<rect x="4.5" y="4.5" width="7" height="7" rx="1" />', lista: '<path d="M4 8.5l3 3 5-6" />',
    revision: '<circle cx="8" cy="8" r="4.5" /><path d="M8 5.5V8l1.5 1" />', cambios: '<path d="M4 4l8 8M12 4l-8 8" />',
    ejecutada: '<path d="M4 8.5l3 3 5-6" />', plan: '<circle cx="8" cy="8" r="4.5" />',
    descartada: '<path d="M4 4l8 8M12 4l-8 8" />', demo: '<circle cx="8" cy="8" r="4.5" />', real: '<path d="M4 8.5l3 3 5-6" />',
    stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1" />',
    info: '<circle cx="8" cy="8" r="5.5" /><path d="M8 7.5V11M8 5.2v.2" />',
    externo: '<path d="M9 3.5h3.5V7M12.5 3.5L7 9M11 9.5v3H3.5V5h3" />'
  };

  function icono(nombre) {
    return '<svg class="icono" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONOS[nombre] || ICONOS.info) + '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function esNum(v) { return typeof v === 'number' && isFinite(v); }
  /* Redondea y quita el cero negativo: -0,0 % no existe. */
  function redondo(v, d) {
    var f = Math.pow(10, d), r = Math.round(v * f) / f;
    return r === 0 ? 0 : r;
  }
  function fmt(v, d) {
    if (!esNum(v)) return '—';
    return redondo(v, d).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function usd(v, d) { return esNum(v) ? fmt(v, d == null ? 2 : d) + ' $' : '—'; }
  function pct(v, d) { return esNum(v) ? fmt(v * 100, d == null ? 1 : d) + ' %' : '—'; }
  function pctFirmado(v, d) {
    if (!esNum(v)) return '—';
    d = d == null ? 1 : d;
    var r = redondo(v * 100, d);
    return (r > 0 ? '+' : '') + fmt(r, d) + ' %';
  }
  function pp(v, d) {
    if (!esNum(v)) return '—';
    d = d == null ? 2 : d;
    var r = redondo(v * 100, d);
    return (r > 0 ? '+' : '') + fmt(r, d) + ' pp';
  }
  function signo(v, d) {
    if (!esNum(v)) return 'cero';
    var r = redondo(v * 100, d == null ? 2 : d);
    return r > 0 ? 'pos' : (r < 0 ? 'neg' : 'cero');
  }
  function compacto(v) {
    if (!esNum(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return fmt(v / 1e9, 2) + ' mil M';
    if (a >= 1e6) return fmt(v / 1e6, 2) + ' M';
    if (a >= 1e3) return fmt(v / 1e3, 1) + ' mil';
    return fmt(v, 0);
  }
  function fecha(iso) {
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function hace(iso, ahora) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '—';
    var min = Math.max(0, Math.round(((ahora || Date.now()) - t) / 60000));
    if (min < 1) return 'ahora';
    if (min < 60) return 'hace ' + min + ' min';
    if (min < 1440) return 'hace ' + Math.floor(min / 60) + ' h';
    return 'hace ' + Math.floor(min / 1440) + ' d';
  }
  function mayus(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function chip(estado, texto) {
    return '<span class="chip" data-estado="' + esc(estado) + '">' + icono(estado) + '<span>' + esc(texto) + '</span></span>';
  }
  function vacio(titulo, motivo) {
    return '<div class="vacio" role="status">' + icono('info') + '<div><b>' + esc(titulo) + '</b>' + esc(motivo) + '</div></div>';
  }
  function faltaDe(e, campo, titulo, porDefecto) {
    return vacio(titulo, (e && e.faltan && e.faltan[campo]) || porDefecto);
  }
  function info(clave) {
    var f = FUNDAMENTOS[clave];
    if (!f) return '';
    return '<button type="button" class="info" data-fundamento="' + esc(clave) + '" aria-label="Qué es: ' + esc(f.titulo) + '">i</button>';
  }

  /* --- Fundamentos: que significa cada cifra y de donde sale ----------------------------------------- */

  var FUNDAMENTOS = {
    regla: { titulo: 'La regla', texto: [
      'La cartera invierte en dos criptomonedas solo cuando su precio de cierre diario está por encima de su media de 200 días (filtro de tendencia).',
      'El tamaño de cada posición se ajusta a su volatilidad: tamaño = mín(1; 0,40 / volatilidad anual). Con más volatilidad, menos exposición.',
      'Se decide una vez al día con el cierre del día anterior (00:00 UTC). La regla está congelada hasta las revisiones de diciembre y marzo: no se cambia tras ver pérdidas.'] },
    tendencia: { titulo: 'Filtro de tendencia', texto: [
      'Compara el último cierre diario con la media de los 200 cierres anteriores. Por encima: se puede invertir. Por debajo: objetivo cero.',
      'Evita la mayor parte de las caídas largas a cambio de entrar tarde en las subidas.'] },
    ma200: { titulo: 'Media de 200 días', texto: [
      'Media aritmética de los últimos 200 cierres diarios (UTC). Es la línea que decide el filtro de tendencia.'] },
    volatilidad: { titulo: 'Volatilidad', texto: [
      'Volatilidad anual estimada con una media exponencial de 30 días de los rendimientos diarios, multiplicada por √365.',
      'Es la entrada del tamaño de la posición: un activo con un 80 % de volatilidad recibe la mitad de exposición que uno con un 40 %.'] },
    tamano: { titulo: 'Tamaño y objetivo', texto: [
      'Objetivo = tendencia (0 o 1) × mín(1; 0,40 / volatilidad). Es la fracción de la cartera que debería estar en ese activo.'] },
    banda: { titulo: 'Banda y orden mínima', texto: [
      'La cartera B solo opera si la exposición actual se separa más de un 20 % de su objetivo, y nunca con órdenes de menos de 10 USD.',
      'Así reduce operaciones y costes frente a la cartera A, que reequilibra cada día sin banda.'] },
    cagr: { titulo: 'CAGR', texto: [
      'Rentabilidad anual compuesta: el crecimiento anual constante que llevaría del valor inicial al actual.',
      'Con menos de 90 días de historia no se calcula: anualizar un periodo tan corto da cifras engañosas.'] },
    sharpe: { titulo: 'Sharpe', texto: [
      'Rendimiento medio diario dividido por su desviación típica, anualizado con √365. Mide rentabilidad por unidad de riesgo total.'] },
    sortino: { titulo: 'Sortino', texto: [
      'Como el Sharpe, pero solo penaliza la volatilidad de los días negativos: no castiga las subidas fuertes.'] },
    caida: { titulo: 'Caída máxima', texto: [
      'La mayor pérdida desde un máximo anterior hasta un mínimo posterior. El backtest de la regla llegó a −37 %; comprar y mantener, a −80 %.',
      'Si la caída supera el −50 % se revisa la cartera (sin dejar de operar).'] },
    exposicion: { titulo: 'Exposición', texto: [
      'Parte de la cartera invertida en criptomonedas; el resto es efectivo. La exposición media histórica de la regla es de un 34 %.'] },
    backtest: { titulo: 'Referencia del backtest', texto: [
      'Resultados de la misma regla con datos desde el 6-mar-2018, con costes del 0,15 % por lado.',
      'La ventaja esperada es de riesgo, no de rentabilidad: en mercados alcistas fuertes rinde menos que comprar y mantener.'] },
    costes: { titulo: 'Costes', texto: [
      'La simulación descuenta un 0,15 % por lado en cada orden. En la cuenta demo la comisión es la que cobra el exchange.',
      'El deslizamiento (diferencia entre el precio esperado y el obtenido) solo existe con órdenes reales.'] },
    demo: { titulo: 'Cuenta demo', texto: [
      'Réplica de la cartera B en el modo de demostración del exchange: órdenes reales contra un libro simulado, sin dinero real.',
      'Cada día se concilia con B: la diferencia de rentabilidad debería ser casi nula.'] },
    sombra: { titulo: 'Simulación en la sombra', texto: [
      'La cartera B calculada con los precios del exchange donde se ejecutaría con dinero real, para medir cuánto cambia el resultado al cambiar de mercado.'] },
    llamadas: { titulo: 'Estado de las llamadas', texto: [
      'Cada proceso de datos registra cuándo empieza, cuándo acaba y si terminó bien. Aquí se ve la última ejecución correcta, cuánto duró y los fallos de las últimas 24 h.',
      'El límite de peticiones de las API no se registra todavía.'] },
    derivados: { titulo: 'Derivados', texto: [
      'Financiación: pago periódico entre posiciones largas y cortas en contratos perpetuos; positiva = los largos pagan.',
      'Interés abierto: número de contratos abiertos. No forman parte de la regla: son contexto.'] },
    velas: { titulo: 'Velas diarias', texto: [
      'Cada vela resume un día UTC: apertura, máximo, mínimo y cierre. Verde si cerró por encima de la apertura. Debajo, el volumen negociado.',
      'Las flechas marcan las órdenes de la cartera B. Pellizca o usa la rueda para acercar.'] },
    decisiones: { titulo: 'Tus decisiones', texto: [
      'El sistema no ejecuta nada con dinero real ni cambia de rumbo sin tu permiso. Al pulsar una opción se abre tu respuesta lista para enviar en el repositorio privado del proyecto; los agentes la leen de ahí.'] },
    limite: { titulo: 'Límite de revisión', texto: [
      'Una caída de más del 50 % desde el máximo obliga a revisar la cartera. No es una parada: las pérdidas dentro del rango del backtest no son motivo para parar.'] }
  };

  /* --- Formatos de estado.json ------------------------------------------------------------------------- */

  var FALTA_ANTERIOR = 'El formato de datos actual no incluye esta información; llegará con el exportador nuevo.';

  function senalDe(objetivo, actual) {
    if (!(objetivo > 0)) return actual > 0.005 ? 'reducir' : 'fuera';
    if (actual > objetivo * (1 + BANDA)) return 'reducir';
    if (actual < objetivo * (1 - BANDA)) return 'comprar';
    return 'mantener';
  }

  function normalizar(e) {
    if (!e || typeof e !== 'object') return null;
    if (e.__normal) return e;
    if (e.carteras && e.actualizado) { e.__normal = true; return e; }
    if (!e.simulacion && !e.generado) return e;
    var s = e.simulacion || {}, faltan = {};
    var carteras = ['ejecutable', 'regla', 'comprar_mantener'].filter(function (id) { return s[id]; }).map(function (id) {
      var c = s[id], f = (c.serie && c.serie.fecha) || [], v = (c.serie && c.serie.valor_usd) || [];
      return { id: id, nombre: NOMBRES_CARTERA[id], inicial: c.capital_usd,
        serie: [[c.inicio, c.capital_usd]].concat(f.map(function (d, i) { return [d, v[i]]; })) };
    });
    if (!carteras.length) faltan.carteras = FALTA_ANTERIOR;
    var pares = (e.senal && e.senal.pares) || {}, posicion = (s.ejecutable && s.ejecutable.posicion) || {};
    var activos = Object.keys(pares).sort().map(function (par) {
      var p = pares[par], vivo = (e.pares && e.pares[par]) || {}, pos = posicion[par];
      var base = par.replace(/USD[A-Z]?$/, '');
      var actual = pos && esNum(pos.peso) ? pos.peso : null;
      return { simbolo: base, nombre: base, precio: esNum(vivo.precio) ? vivo.precio : p.cierre,
        cambio24h: esNum(vivo.var_24h) ? vivo.var_24h / 100 : null, ma200: p.media_200, vol: p.vol_ewma,
        objetivo: p.objetivo, actual: actual, senal: actual == null ? 'sindato' : senalDe(p.objetivo, actual),
        serie: [], ma200_serie: [] };
    });
    if (!activos.length) faltan.activos = FALTA_ANTERIOR; else faltan.velas = FALTA_ANTERIOR;
    ['ordenes', 'agentes', 'ramas', 'llamadas', 'derivados', 'demo', 'fusiones', 'estudios'].forEach(function (k) { faltan[k] = FALTA_ANTERIOR; });
    faltan.sombra = 'La simulación en la sombra aún no tiene datos.';
    var b = carteras.filter(function (c) { return c.id === 'ejecutable'; })[0], dd = null;
    if (b && b.serie.length > 1) { var cs = caida(unicas(b.serie)); dd = cs[cs.length - 1][1]; }
    faltan.riesgo = 'La volatilidad de la cartera llegará con el exportador nuevo.';
    var cal = (e.calidad && e.calidad.comprobaciones) || null;
    return { __normal: true, actualizado: e.generado, modo: null, stop: null, carteras: carteras, activos: activos, ordenes: [],
      riesgo: { drawdown: dd, drawdown_backtest: POLITICA.drawdown_backtest, limite: POLITICA.limite, vol_cartera: null },
      agentes: [], ramas: [], decisiones: [], hitos: [], velas: {}, llamadas: [], derivados: [], demo: null, sombra: null,
      pendientes_usuario: [], fusiones: [], estudios: null, referencia_backtest: null,
      salud: { timers_ok: null, timers_total: null, calidad_ok: cal ? cal.filter(function (x) { return x.ok; }).length : null,
        calidad_total: cal ? cal.length : null, disco: null },
      faltan: faltan, formato: 'anterior' };
  }

  function completar(e, extras) {
    if (!e || !extras) return e;
    var faltan = e.faltan || (e.faltan = {});
    if (!(e.decisiones && e.decisiones.length) && Array.isArray(extras.decisiones)) {
      e.decisiones = extras.decisiones.filter(function (d) { return d && d.id && Array.isArray(d.opciones) && d.opciones.length; });
      if (e.decisiones.length) delete faltan.decisiones;
    }
    if (!(e.hitos && e.hitos.length) && Array.isArray(extras.hitos)) {
      e.hitos = extras.hitos.slice();
      if (e.hitos.length) delete faltan.hitos;
    }
    return e;
  }

  /* --- Calculos ----------------------------------------------------------------------------------------- */

  function unicas(serie) {
    var m = {};
    (serie || []).forEach(function (p) { if (p && typeof p[0] === 'string' && esNum(p[1])) m[p[0].slice(0, 10)] = p[1]; });
    return Object.keys(m).sort().map(function (t) { return [t, m[t]]; });
  }
  function caida(serie) {
    var pico = -Infinity;
    return serie.map(function (p) { pico = Math.max(pico, p[1]); return [p[0], pico > 0 ? p[1] / pico - 1 : 0]; });
  }
  function ultimo(serie) { return serie && serie.length ? serie[serie.length - 1][1] : null; }

  /* Mismas formulas que el exportador (panel_estado.metricas): por si el estado no las trae. */
  function metricas(serie) {
    var v = unicas(serie).map(function (p) { return p[1]; }).filter(function (x) { return x > 0; });
    var out = { dias: Math.max(0, v.length - 1), cagr: null, sharpe: null, sortino: null, caida_maxima: null, volatilidad: null };
    if (v.length < 3) return out;
    var r = [], i;
    for (i = 1; i < v.length; i++) r.push(v[i] / v[i - 1] - 1);
    var m = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
    var sd = Math.sqrt(r.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (r.length - 1));
    var sdAbajo = Math.sqrt(r.reduce(function (a, b) { return a + Math.pow(Math.min(0, b), 2); }, 0) / r.length);
    var pico = v[0], dd = 0;
    v.forEach(function (x) { pico = Math.max(pico, x); dd = Math.min(dd, x / pico - 1); });
    out.caida_maxima = dd; out.volatilidad = sd * Math.sqrt(365);
    out.sharpe = sd > 0 ? m / sd * Math.sqrt(365) : null;
    out.sortino = sdAbajo > 0 ? m / sdAbajo * Math.sqrt(365) : null;
    if (r.length >= 90) out.cagr = Math.pow(v[v.length - 1] / v[0], 365 / r.length) - 1;
    return out;
  }

  function mediaMovil(cierres, n) {
    var out = [], suma = 0, i;
    for (i = 0; i < cierres.length; i++) {
      suma += cierres[i][1];
      if (i >= n) suma -= cierres[i - n][1];
      if (i >= n - 1) out.push([cierres[i][0], suma / n]);
    }
    return out;
  }

  /* Desglose de la inferencia de un activo, con las cifras que usa la regla. */
  function inferencia(a) {
    var tendencia = esNum(a.objetivo) ? a.objetivo > 0 : (esNum(a.precio) && esNum(a.ma200) ? a.precio > a.ma200 : null);
    var tam = esNum(a.vol) && a.vol > 0 ? Math.min(1, OBJETIVO_VOL / a.vol) : null;
    var objetivo = esNum(a.objetivo) ? a.objetivo : (tendencia == null || tam == null ? null : (tendencia ? tam : 0));
    var banda = esNum(objetivo) ? [objetivo * (1 - BANDA), objetivo * (1 + BANDA)] : null;
    var dist = esNum(a.precio) && esNum(a.ma200) && a.ma200 ? a.precio / a.ma200 - 1 : null;
    return { tendencia: tendencia, tamano: tam, objetivo: objetivo, banda: banda, distancia: dist,
      senal: a.senal || (a.actual == null ? 'sindato' : senalDe(objetivo, a.actual)) };
  }


  function sparkline(valores, ancho, alto) {
    var v = valores.filter(esNum);
    if (v.length < 2) return '';
    var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), rango = mx - mn || 1;
    var pts = v.map(function (x, i) {
      return (i * ancho / (v.length - 1)).toFixed(1) + ',' + (alto - 2 - (x - mn) / rango * (alto - 4)).toFixed(1);
    });
    var sube = v[v.length - 1] >= v[0];
    return '<svg class="mini" viewBox="0 0 ' + ancho + ' ' + alto + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline fill="none" stroke="' + (sube ? '#12B76A' : '#F04438') + '" stroke-width="1.6" stroke-linejoin="round" ' +
      'vector-effect="non-scaling-stroke" points="' + pts.join(' ') + '" /></svg>';
  }

  function cierresDe(e, a) {
    var v = (e.velas && e.velas[a.simbolo]) || [];
    if (v.length) return v.map(function (x) { return [x[0], x[4]]; });
    return unicas(a.serie || []);
  }

  /* --- Cabecera ------------------------------------------------------------------------------------------ */

  function frescura(actualizado, ahora) {
    var t = Date.parse(actualizado);
    if (isNaN(t)) return { min: null, estado: 'vacio', texto: 'Sin fecha de actualización' };
    var min = Math.max(0, (ahora - t) / 60000);
    return { min: min, estado: min < FRESCO_MIN ? 'ok' : (min < AMBAR_MIN ? 'aviso' : 'alerta'), texto: 'Dato ' + hace(actualizado, ahora) };
  }

  function estadoSalud(s) {
    if (!s || (s.timers_total == null && s.calidad_total == null)) return 'vacio';
    var malo = false, mal = false;
    if (s.timers_total) { if (s.timers_ok / s.timers_total < 0.8) malo = true; else if (s.timers_ok < s.timers_total) mal = true; }
    if (s.calidad_total) { if (s.calidad_total - s.calidad_ok > 1) malo = true; else if (s.calidad_ok < s.calidad_total) mal = true; }
    if (esNum(s.disco)) { if (s.disco >= 90) malo = true; else if (s.disco >= 85) mal = true; }
    return malo ? 'alerta' : (mal ? 'aviso' : 'ok');
  }

  function renderCabecera(e, ahora) {
    if (!e) return '<h1>Panel del agente</h1><div class="chips">' + chip('vacio', 'Sin estado') + '</div>';
    var f = frescura(e.actualizado, ahora), s = e.salud || {}, partes = [];
    if (s.timers_total != null) partes.push('procesos ' + s.timers_ok + '/' + s.timers_total);
    if (s.calidad_total != null) partes.push('calidad ' + s.calidad_ok + '/' + s.calidad_total);
    if (esNum(s.disco)) partes.push('disco ' + s.disco + ' %');
    var modo = e.modo === 'demo' ? chip('demo', 'Demo') : (e.modo === 'real' ? chip('real', 'Real') : chip('vacio', 'Modo sin dato'));
    var stop = e.stop === true ? chip('stop', 'STOP') : (e.stop === false ? chip('ok', 'Operando') : chip('vacio', 'STOP sin dato'));
    return '<h1>Panel del agente</h1><div class="chips">' + modo + stop +
      '<span data-key="frescura">' + chip(f.estado, f.texto) + '</span>' +
      chip(estadoSalud(s), partes.length ? partes.join(' · ') : 'Salud sin datos') + '</div>';
  }

  /* --- 1. Te espera ----------------------------------------------------------------------------------------- */

  function textoDecision(id, opcion) {
    var t = ('DECISION ' + id + ': ' + opcion).replace(CONTROL, ' ');
    return t.replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  function enlaceDecision(d, opcion) {
    var titulo = textoDecision(d.id, opcion);
    var cuerpo = 'Decisión: ' + titulo + '\n\nPregunta: ' + String(d.pregunta || '').replace(CONTROL, ' ').slice(0, 300);
    return REPO_DECISIONES + '?labels=decision&title=' + encodeURIComponent(titulo) + '&body=' + encodeURIComponent(cuerpo);
  }

  function renderEspera(e) {
    if (!e) return vacio('Sin datos', 'No se pudo leer el estado.');
    var dec = e.decisiones || [], pend = e.pendientes_usuario || [];
    var listas = (e.ramas || []).filter(function (r) { return r.estado === 'lista'; });
    if (!dec.length && !pend.length && !listas.length) {
      return vacio('Nada espera tu decisión', (e.faltan && e.faltan.decisiones) || 'No hay decisiones abiertas ni tareas tuyas pendientes.');
    }
    var h = '';
    if (dec.length) {
      h += '<ul class="lista">' + dec.map(function (d) {
        return '<li class="decision" data-key="dec-' + esc(d.id) + '"><p class="p">' + esc(d.pregunta) + '</p>' +
          '<p class="ctx">' + esc(d.contexto) + '</p><div class="opciones">' +
          (d.opciones || []).map(function (o) {
            var rec = d.recomendada === o;
            return '<a class="boton" href="' + esc(enlaceDecision(d, o)) + '" target="_blank" rel="noopener noreferrer" ' +
              'data-recomendada="' + rec + '" data-estado-boton="reposo">' +
              '<span class="etq">' + esc(o) + '</span>' + (rec ? '<span class="tag">recomendada</span>' : '') + icono('externo') +
              '<span class="oculto-visual"> (abre tu respuesta para enviarla)</span></a>';
          }).join('') + '</div></li>';
      }).join('') + '</ul>';
    }
    if (pend.length) {
      h += '<div class="sub" style="margin:14px 0 2px">Tareas que solo puedes hacer tú</div>' + pend.map(function (p, i) {
        return '<div class="fila" data-key="pend-' + i + '"><span class="izq">' + esc(p.texto) + '</span><span class="sub">' +
          (p.fecha ? fecha(p.fecha) : '') + '</span></div>';
      }).join('');
    }
    if (listas.length) {
      // resumen por tipo: el detalle de cada cambio esta en «Proyecto»
      var tipos = {};
      listas.forEach(function (r) { tipos[r.nombre] = (tipos[r.nombre] || 0) + 1; });
      h += '<div class="fila" data-key="aprobadas"><span class="izq">Cambios aprobados por fusionar: ' +
        Object.keys(tipos).sort().map(function (t) { return esc(t) + ' ' + tipos[t]; }).join(' · ') +
        '</span><span class="num fuerte">' + listas.length + '</span></div>';
    }
    return h;
  }

  /* --- 2. Estado de las llamadas ---------------------------------------------------------------------------- */

  function renderLlamadas(e, ahora) {
    var l = e && e.llamadas;
    if (!l || !l.length) return faltaDe(e, 'llamadas', 'Sin estado de las llamadas', 'No hay ejecuciones registradas.');
    var etq = { ok: 'Bien', aviso: 'Con fallos', alerta: 'Falló' };
    return '<div class="tabla"><table><thead><tr><th>Fuente</th><th>Estado</th><th>Última correcta</th>' +
      '<th class="der">Duración</th><th class="der">Fallos 24 h</th></tr></thead><tbody>' + l.map(function (x) {
        return '<tr data-key="ll-' + esc(x.fuente) + '"><td>' + esc(x.fuente) + '</td><td>' + chip(x.estado, etq[x.estado] || x.estado) +
          '</td><td>' + (x.ultima_ok ? hace(x.ultima_ok, ahora) : '—') + '</td><td class="der">' +
          (esNum(x.duracion_s) ? fmt(x.duracion_s, x.duracion_s < 10 ? 1 : 0) + ' s' : '—') + '</td><td class="der">' +
          fmt(x.errores_24h, 0) + ' / ' + fmt(x.ejecuciones_24h, 0) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="sub" style="margin-top:8px">Límite de peticiones: no se registra todavía.</p>';
  }

  /* --- 3. Mercado ------------------------------------------------------------------------------------------- */

  function renderMercado(e) {
    if (!e || !e.activos || !e.activos.length) return faltaDe(e, 'activos', 'Sin mercado', 'No hay activos en el estado.');
    var der = {};
    (e.derivados || []).forEach(function (d) { der[d.simbolo] = d; });
    return '<div class="activos">' + e.activos.map(function (a) {
      var inf = inferencia(a), d = der[a.simbolo], cierres = cierresDe(e, a).slice(-30);
      return '<article class="activo" data-key="mer-' + esc(a.simbolo) + '"><div class="cab"><h3 class="fuerte">' + esc(a.nombre) +
        '</h3><span class="directo" data-directo="' + esc(a.simbolo) + '" data-estado="vacio"><span class="punto"></span>' +
        '<span class="t">Cierre del estado</span></span></div>' +
        '<div class="cab"><span class="precio num" data-precio="' + esc(a.simbolo) + '">' + usd(a.precio) + '</span>' +
        '<span class="delta num ' + signo(a.cambio24h) + '" data-var="' + esc(a.simbolo) + '">' + pctFirmado(a.cambio24h, 2) + '</span>' +
        '<span class="sub">24 h</span></div>' + sparkline(cierres.map(function (c) { return c[1]; }), 300, 44) +
        '<dl class="datos"><div><dt>Frente a la media de 200 d ' + info('ma200') + '</dt><dd class="num ' + signo(inf.distancia, 1) + '">' +
        pctFirmado(inf.distancia, 1) + '</dd></div><div><dt>Volatilidad anual ' + info('volatilidad') + '</dt><dd class="num">' + pct(a.vol, 0) +
        '</dd></div><div><dt>Financiación ' + info('derivados') + '</dt><dd class="num">' + (d ? pctFirmado(d.financiacion, 4) : '—') +
        '</dd></div><div><dt>Interés abierto</dt><dd class="num">' + (d ? compacto(d.interes_abierto) : '—') + '</dd></div></dl></article>';
    }).join('') + '</div>' + (e.derivados && e.derivados.length ? '' :
      '<p class="sub" style="margin-top:10px">' + esc((e.faltan && e.faltan.derivados) || 'Sin datos de derivados.') + '</p>');
  }

  /* --- 4. Inferencia ----------------------------------------------------------------------------------------- */

  function renderInferencia(e) {
    if (!e || !e.activos || !e.activos.length) return faltaDe(e, 'activos', 'Sin inferencia', 'No hay señal en el estado.');
    return '<div class="activos">' + e.activos.map(function (a) {
      var inf = inferencia(a), escala = Math.max(inf.objetivo || 0, a.actual || 0, 0.25) * 1.25;
      var p = esNum(a.actual) ? Math.min(a.actual / escala, 1) : 0, o = esNum(inf.objetivo) ? Math.min(inf.objetivo / escala, 1) : 0;
      var accion = { comprar: 'comprar hasta el objetivo', reducir: 'vender hasta el objetivo', mantener: 'dentro de la banda: no se opera',
        fuera: 'sin tendencia: fuera del mercado', sindato: 'falta la exposición actual' }[inf.senal] || '';
      return '<article class="activo" data-key="inf-' + esc(a.simbolo) + '" data-estado="' + esc(inf.senal) + '">' +
        '<div class="cab"><h3 class="fuerte">' + esc(a.nombre) + '</h3></div>' +
        '<div class="senal">' + icono(inf.senal) + '<span>' + esc(SENALES[inf.senal] || inf.senal) + '</span></div>' +
        '<p class="sub">' + esc(mayus(accion)) + '</p>' +
        '<div class="sub" style="margin:12px 0 6px">Exposición actual (barra) y objetivo (marca) ' + info('banda') + '</div>' +
        '<div class="barra" role="img" aria-label="Actual ' + pct(a.actual) + ', objetivo ' + pct(inf.objetivo) + '">' +
        '<i style="--p:' + p.toFixed(4) + '"></i><b style="--o:' + o.toFixed(4) + '"></b></div>' +
        '<dl class="datos"><div><dt>Tendencia ' + info('tendencia') + '</dt><dd>' +
        (inf.tendencia == null ? '—' : (inf.tendencia ? 'Sí: por encima de la media' : 'No: por debajo de la media')) + '</dd></div>' +
        '<div><dt>Tamaño ' + info('tamano') + '</dt><dd class="num">' + pct(inf.tamano, 0) + '</dd></div>' +
        '<div><dt>Objetivo</dt><dd class="num">' + pct(inf.objetivo, 1) + '</dd></div>' +
        '<div><dt>Actual</dt><dd class="num">' + pct(a.actual, 1) + '</dd></div></dl>' +
        '<p class="formula">Objetivo = <span class="num">' + (inf.tendencia ? '1' : '0') + '</span> × mín(1; 0,40 / <span class="num">' +
        pct(a.vol, 0) + '</span>) = <span class="num">' + pct(inf.objetivo, 1) + '</span>' +
        (inf.banda ? ' · banda <span class="num">' + pct(inf.banda[0], 1) + ' – ' + pct(inf.banda[1], 1) + '</span>' : '') + '</p></article>';
    }).join('') + '</div>';
  }

  /* --- 5. Carteras -------------------------------------------------------------------------------------------- */

  function filaMetrica(nombre, valor, clave, ref) {
    return '<div><dt>' + esc(nombre) + ' ' + info(clave) + '</dt><dd class="num">' + valor +
      (ref ? '<span class="sub"> · backtest ' + ref + '</span>' : '') + '</dd></div>';
  }

  function renderCarteras(e) {
    if (!e || !e.carteras || !e.carteras.length) return faltaDe(e, 'carteras', 'Sin carteras', 'No hay carteras en el estado.');
    var por = {}, ref = e.referencia_backtest || {};
    e.carteras.forEach(function (c) { por[c.id] = c; });
    var b = por.ejecutable, vb = b ? ultimo(b.serie) : null;
    return '<div class="activos">' + ['ejecutable', 'regla', 'comprar_mantener'].filter(function (id) { return por[id]; }).map(function (id) {
      var c = por[id], v = ultimo(c.serie), r = esNum(v) && c.inicial ? v / c.inicial - 1 : null;
      var m = c.metricas || metricas(c.serie), rf = ref[id] || {}, cmp = '';
      if (id !== 'ejecutable' && esNum(vb) && esNum(v) && b.inicial && c.inicial) {
        var d = (vb / b.inicial - 1) - (v / c.inicial - 1);
        cmp = '<p class="sub">B frente a esta: <span class="delta ' + signo(d) + '">' + pp(d) + '</span></p>';
      }
      return '<article class="cartera' + (id === 'ejecutable' ? ' b' : '') + '" data-key="car-' + esc(id) + '">' +
        '<div class="cab"><h3 class="fuerte">' + esc(c.nombre || NOMBRES_CARTERA[id]) + '</h3></div>' +
        '<div class="valor num">' + usd(v) + '</div><p class="sub">Inicial ' + usd(c.inicial) + ' · <span class="delta ' + signo(r) + '">' +
        pctFirmado(r, 2) + '</span> · ' + fmt(m.dias, 0) + ' días</p>' + cmp +
        '<dl class="datos">' +
        filaMetrica('CAGR', m.cagr == null ? '— (menos de 90 días)' : pct(m.cagr, 1), 'cagr', esNum(rf.cagr) ? pct(rf.cagr, 1) : '') +
        filaMetrica('Sharpe', fmt(m.sharpe, 2), 'sharpe', esNum(rf.sharpe) ? fmt(rf.sharpe, 2) : '') +
        filaMetrica('Sortino', fmt(m.sortino, 2), 'sortino', '') +
        filaMetrica('Caída máxima', pct(m.caida_maxima, 1), 'caida', esNum(rf.caida_maxima) ? pct(rf.caida_maxima, 0) : '') +
        '</dl></article>';
    }).join('') + '</div>';
  }

  function renderDemo(e) {
    var d = e && e.demo;
    if (!d) return faltaDe(e, 'demo', 'Sin cuenta demo', 'El ejecutor demo aún no tiene datos.');
    var c = (d.conciliacion || []).slice(-7).reverse(), u = c[0];
    return '<div class="cab"><span class="valor num">' + pctFirmado(d.rentabilidad, 2) + '</span><span class="sub">rentabilidad desde el inicio</span></div>' +
      (u ? '<p class="sub">Diferencia con B el ' + fecha(u.fecha) + ': <span class="delta ' + signo(u.diferencia) + '">' + pp(u.diferencia) + '</span></p>' : '') +
      (c.length ? '<div class="tabla" style="margin-top:8px"><table><thead><tr><th>Día</th><th class="der">Demo</th><th class="der">B</th>' +
        '<th class="der">Diferencia</th></tr></thead><tbody>' + c.map(function (x) {
          return '<tr data-key="conc-' + esc(x.fecha) + '"><td>' + fecha(x.fecha) + '</td><td class="der">' + pctFirmado(x.rent_demo, 2) +
            '</td><td class="der">' + pctFirmado(x.rent_b, 2) + '</td><td class="der delta ' + signo(x.diferencia) + '">' + pp(x.diferencia) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '');
  }

  function renderSombra(e) {
    var s = e && e.sombra;
    if (!s) return faltaDe(e, 'sombra', 'Sin simulación en la sombra', 'Aún no hay datos.');
    return '<div class="cab"><span class="valor num">' + usd(s.valor) + '</span></div>';
  }

  /* --- 6. Ordenes ---------------------------------------------------------------------------------------------- */

  function ordenesOrdenadas(e) {
    return ((e && e.ordenes) || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : (a.fecha > b.fecha ? -1 : 0); });
  }

  function renderOrdenes(e) {
    var os = ordenesOrdenadas(e);
    if (!os.length) return faltaDe(e, 'ordenes', 'Sin órdenes', 'No hay órdenes registradas.');
    return '<div class="tabla"><table><thead><tr><th>Fecha</th><th>Activo</th><th>Lado</th><th class="der">Importe</th>' +
      '<th class="der">Precio</th><th class="der">Comisión</th><th>Estado</th></tr></thead><tbody>' + os.map(function (o, i) {
        var compra = o.lado === 'compra';
        return '<tr class="fila-click" tabindex="0" data-orden="' + i + '" title="Ver el detalle de la orden"><td>' + fecha(o.fecha) + '</td><td>' + esc(o.activo) + '</td><td>' +
          chip(compra ? 'compra' : 'venta', compra ? 'Compra' : 'Venta') + '</td><td class="der">' + usd(o.importe) + '</td><td class="der">' +
          usd(o.precio) + '</td><td class="der">' + usd(o.comision, 2) + '</td><td>' + chip(o.estado, mayus(o.estado)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function detalleOrden(o) {
    var compra = o.lado === 'compra';
    return '<h2 id="hoja-titulo">' + (compra ? 'Compra' : 'Venta') + ' de ' + esc(o.activo) + '</h2>' +
      '<p class="sub" style="margin-bottom:12px">' + fecha(o.fecha) + ' · ' + chip(o.estado, mayus(o.estado)) + '</p>' +
      '<div class="texto"><dl><dt>Motivo</dt><dd>' + esc(o.motivo) + '</dd><dt>Precio</dt><dd class="num">' + usd(o.precio) + '</dd>' +
      '<dt>Importe</dt><dd class="num">' + usd(o.importe) + '</dd><dt>Comisión ' + info('costes') + '</dt><dd class="num">' + usd(o.comision, 4) + '</dd>' +
      '<dt>Deslizamiento</dt><dd class="num">' + (esNum(o.deslizamiento) ? pctFirmado(o.deslizamiento, 3) : 'solo con órdenes reales') + '</dd>' +
      '<dt>Exposición antes</dt><dd class="num">' + pct(o.exposicion_antes) + '</dd>' +
      '<dt>Exposición después</dt><dd class="num">' + pct(o.exposicion_despues) + '</dd></dl></div>';
  }

  /* --- 7. Riesgo ------------------------------------------------------------------------------------------------- */

  function renderRiesgo(e) {
    if (!e || !e.riesgo) return faltaDe(e, 'riesgo', 'Sin riesgo', 'No hay datos de riesgo.');
    var r = e.riesgo, lim = Math.abs(r.limite || 0.5);
    var dd = esNum(r.drawdown) ? Math.min(Math.abs(r.drawdown) / lim, 1) : 0;
    var bt = esNum(r.drawdown_backtest) ? Math.min(Math.abs(r.drawdown_backtest) / lim, 1) : 0;
    var estado = !esNum(r.drawdown) ? 'vacio' : (Math.abs(r.drawdown) >= lim ? 'alerta' : (Math.abs(r.drawdown) >= lim * 0.7 ? 'aviso' : 'ok'));
    var exp = (e.activos || []).reduce(function (s, a) { return esNum(a.actual) ? s + a.actual : s; }, 0);
    return '<div class="medidor" data-estado="' + estado + '"><div class="cab"><span>Caída desde el máximo (B) ' + info('caida') + '</span>' +
      '<span class="num fuerte">' + pctFirmado(r.drawdown, 1) + '</span></div>' +
      '<div class="barra" role="img" aria-label="Caída actual frente al límite"><i style="--p:' + dd.toFixed(4) +
      ';background:var(--e, var(--acento))"></i><b style="--o:' + bt.toFixed(4) + '"></b></div>' +
      '<p class="sub">Marca: caída del backtest ' + pctFirmado(r.drawdown_backtest, 0) + ' · límite de revisión ' + pctFirmado(r.limite, 0) +
      ' ' + info('limite') + '</p></div>' +
      '<div class="fila"><span>Volatilidad de la cartera (anual)</span><span class="num fuerte">' + pct(r.vol_cartera, 0) + '</span></div>' +
      '<div class="fila"><span>Exposición total ' + info('exposicion') + '</span><span class="num fuerte">' +
      ((e.activos || []).some(function (a) { return esNum(a.actual); }) ? pct(exp, 1) : '—') + '</span></div>' +
      (e.faltan && e.faltan.riesgo ? '<p class="sub" style="margin-top:8px">' + esc(e.faltan.riesgo) + '</p>' : '');
  }

  /* --- 8. Proyecto ------------------------------------------------------------------------------------------------- */

  function renderProyecto(e, ahora) {
    if (!e) return vacio('Sin datos', 'No se pudo leer el estado.');
    var h = '<div class="sub" style="margin-bottom:4px">Agentes</div>';
    h += (e.agentes && e.agentes.length) ? e.agentes.map(function (a) {
      return '<div class="fila" data-key="ag-' + esc(a.rol) + '"><div class="izq"><span class="fuerte">' + esc(mayus(a.rol)) +
        '</span>' + (a.modelo ? ' <span class="sub">' + esc(a.modelo) + '</span>' : '') + '<div class="sub">' + esc(a.tarea || 'Sin tarea registrada') +
        '</div></div><div style="text-align:right">' + chip(a.estado, mayus(a.estado)) + '<div class="sub">' +
        (a.desde ? hace(a.desde, ahora) : '—') + '</div></div></div>';
    }).join('') : faltaDe(e, 'agentes', 'Sin agentes', 'No hay datos de los agentes.');
    var etq = { lista: 'Aprobada', revision: 'En revisión', cambios: 'Cambios pedidos' };
    h += '<div class="sub" style="margin:16px 0 4px">Cambios en curso</div>';
    h += (e.ramas && e.ramas.length) ? e.ramas.map(function (r, i) {
      return '<div class="fila" data-key="ra-' + i + '"><span class="izq">' + esc(r.nombre) + ' <span class="mono sub">' + esc(r.commit) +
        '</span></span>' + chip(r.estado, etq[r.estado] || r.estado) + '</div>';
    }).join('') : faltaDe(e, 'ramas', 'Sin cambios en curso', 'Todo lo aprobado está fusionado.');
    if (e.fusiones && e.fusiones.length) {
      h += '<div class="sub" style="margin:16px 0 4px">Últimas fusiones</div>' + e.fusiones.slice().reverse().slice(0, 5).map(function (f, i) {
        return '<div class="fila" data-key="fu-' + i + '"><span class="izq">' + esc(f.rama) + ' <span class="mono sub">' + esc(f.commit) +
          '</span></span><span class="sub">' + esc(f.fecha) + '</span></div>';
      }).join('');
    }
    var es = e.estudios;
    if (es && es.por_estado) {
      h += '<div class="sub" style="margin:16px 0 4px">Investigación</div><div class="fila"><span>Estudios cerrados / preregistrados / en borrador</span>' +
        '<span class="num fuerte">' + fmt(es.por_estado.cerrado, 0) + ' / ' + fmt(es.por_estado.preregistrado, 0) + ' / ' +
        fmt(es.por_estado.borrador, 0) + '</span></div><div class="fila"><span>Configuraciones probadas en total (N)</span><span class="num fuerte">' +
        fmt(es.intentos, 0) + '</span></div>';
    }
    return h;
  }

  function renderHitos(e, ahora) {
    if (!e || !e.hitos || !e.hitos.length) return faltaDe(e, 'hitos', 'Sin hitos', 'No hay hitos en el estado.');
    return '<ul class="hitos">' + e.hitos.map(function (h) {
      var dias = Math.ceil((Date.parse(h.fecha + 'T00:00:00Z') - ahora) / 86400000);
      var cuando = h.estado === 'hecho' ? 'hecho' : (dias > 0 ? 'en ' + dias + ' días' : (dias === 0 ? 'hoy' : 'vencido'));
      return '<li data-estado="' + esc(h.estado) + '" data-key="hi-' + esc(h.fecha) + '"><div class="fuerte">' + esc(h.nombre) +
        '</div><div class="sub">' + fecha(h.fecha) + ' · ' + cuando + '</div></li>';
    }).join('') + '</ul>';
  }

  /* --- 9. Fundamentos ------------------------------------------------------------------------------------------------ */

  function renderFundamentos() {
    return '<div class="capas">' + ['regla', 'tendencia', 'volatilidad', 'tamano', 'banda', 'costes', 'backtest', 'caida', 'demo', 'sombra', 'decisiones']
      .map(function (k) { return '<button type="button" class="capa" data-fundamento="' + k + '">' + esc(FUNDAMENTOS[k].titulo) + '</button>'; }).join('') +
      '</div><p class="sub" style="margin-top:12px">' + esc(FUNDAMENTOS.backtest.texto[1]) + '</p>';
  }

  function detalleFundamento(clave) {
    var f = FUNDAMENTOS[clave];
    if (!f) return '';
    return '<h2 id="hoja-titulo">' + esc(f.titulo) + '</h2><div class="texto">' + f.texto.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';
  }

  function renderTodo(e, ahora) {
    ahora = ahora || Date.now();
    e = normalizar(e);
    return { cabecera: renderCabecera(e, ahora), espera: renderEspera(e), llamadas: renderLlamadas(e, ahora), mercado: renderMercado(e),
      inferencia: renderInferencia(e), carteras: renderCarteras(e), demo: renderDemo(e), sombra: renderSombra(e), ordenes: renderOrdenes(e),
      riesgo: renderRiesgo(e), proyecto: renderProyecto(e, ahora), hitos: renderHitos(e, ahora), fundamentos: renderFundamentos() };
  }

  /* --- Series de los graficos (puras) ------------------------------------------------------------------------------------- */

  function recorte(serie, periodo) {
    var dias = (PERIODOS.filter(function (p) { return p[0] === periodo; })[0] || [])[1];
    if (!dias || !serie.length) return serie;
    var fin = Date.parse(serie[serie.length - 1][0].slice(0, 10) + 'T00:00:00Z');
    var corte = new Date(fin - dias * 86400000).toISOString().slice(0, 10);
    return serie.filter(function (p) { return p[0] >= corte; });
  }
  function puntos(serie) { return unicas(serie).map(function (p) { return { time: p[0], value: p[1] }; }); }

  function marcador(o) {
    var compra = o.lado === 'compra';
    return { time: o.fecha, position: compra ? 'belowBar' : 'aboveBar', shape: compra ? 'arrowUp' : 'arrowDown',
      color: compra ? '#12B76A' : '#F04438', text: compra ? 'C' : 'V', orden: o };
  }

  /* vista: 'carteras' o el simbolo de un activo. Todo el historico: el periodo es un zoom (rango visible). */
  function seriesGrafico(e, vista, capas) {
    capas = capas || {};
    var out = { tipo: vista === 'carteras' ? 'lineas' : 'velas', lineas: [], velas: [], volumen: [], ma200: [], marcadores: [],
      caida: null, exposicion: null, aviso: null };
    e = normalizar(e);
    if (!e) { out.aviso = 'Sin estado.'; return out; }
    var ops = e.ordenes || [];
    if (vista === 'carteras') {
      var cs = e.carteras || [];
      if (!cs.length) { out.aviso = (e.faltan && e.faltan.carteras) || 'Sin carteras.'; return out; }
      cs.forEach(function (c) {
        out.lineas.push({ id: c.id, nombre: c.nombre || NOMBRES_CARTERA[c.id], color: COLOR_CARTERA[c.id] || '#7A8494',
          grosor: c.id === 'ejecutable' ? 2 : 1.5, dash: c.id === 'comprar_mantener', datos: puntos(c.serie) });
      });
      var b = cs.filter(function (c) { return c.id === 'ejecutable'; })[0] || cs[0];
      if (capas.dd) out.caida = puntos(caida(unicas(b.serie)));
      if (capas.exp && b.exposicion_serie) out.exposicion = puntos(b.exposicion_serie);
      if (capas.ops) {
        var dias = {};
        unicas(b.serie).forEach(function (p) { dias[p[0]] = true; });
        ops.forEach(function (o) { if (dias[o.fecha]) out.marcadores.push(marcador(o)); });
      }
    } else {
      var a = (e.activos || []).filter(function (x) { return x.simbolo === vista; })[0];
      if (!a) { out.aviso = 'Activo sin datos.'; return out; }
      var v = (e.velas && e.velas[a.simbolo]) || [];
      if (!v.length) { out.aviso = (e.faltan && (e.faltan.velas || e.faltan.activos)) || 'Sin velas para este activo.'; return out; }
      out.velas = v.map(function (x) { return { time: x[0], open: x[1], high: x[2], low: x[3], close: x[4] }; });
      if (capas.vol !== false) {
        out.volumen = v.map(function (x) {
          return { time: x[0], value: x[5], color: x[4] >= x[1] ? 'rgba(18,183,106,0.45)' : 'rgba(240,68,56,0.45)' };
        });
      }
      if (capas.ma) {
        var cierres = v.map(function (x) { return [x[0], x[4]]; });
        var desdeVelas = mediaMovil(cierres, 200);
        out.ma200 = puntos(desdeVelas.length ? desdeVelas : (a.ma200_serie || []));
      }
      if (capas.ops) {
        var hay = {};
        v.forEach(function (x) { hay[x[0]] = true; });
        ops.filter(function (o) { return o.activo === a.simbolo && hay[o.fecha]; }).forEach(function (o) { out.marcadores.push(marcador(o)); });
      }
    }
    out.marcadores.sort(function (x, y) { return x.time < y.time ? -1 : (x.time > y.time ? 1 : 0); });
    return out;
  }

  function rangoVisible(datos, periodo) {
    if (!datos.length) return null;
    var serie = datos.map(function (d) { return [d.time, 0]; }), r = recorte(serie, periodo);
    return { from: r[0][0], to: serie[serie.length - 1][0] };
  }

  var Panel = {
    esc: esc, fmt: fmt, pct: pct, pctFirmado: pctFirmado, pp: pp, usd: usd, frescura: frescura, estadoSalud: estadoSalud,
    recorte: recorte, caida: caida, normalizar: normalizar, completar: completar, unicas: unicas, senalDe: senalDe,
    metricas: metricas, mediaMovil: mediaMovil, inferencia: inferencia, sparkline: sparkline,
    textoDecision: textoDecision, enlaceDecision: enlaceDecision, renderTodo: renderTodo, renderEspera: renderEspera,
    renderMercado: renderMercado, renderInferencia: renderInferencia, renderCarteras: renderCarteras, renderLlamadas: renderLlamadas,
    renderDemo: renderDemo, renderSombra: renderSombra, renderOrdenes: renderOrdenes, renderRiesgo: renderRiesgo,
    renderProyecto: renderProyecto, renderHitos: renderHitos, seriesGrafico: seriesGrafico, rangoVisible: rangoVisible,
    detalleOrden: detalleOrden, detalleFundamento: detalleFundamento, ordenesOrdenadas: ordenesOrdenadas, vacio: vacio,
    FUNDAMENTOS: FUNDAMENTOS, PERIODOS: PERIODOS, SENALES: SENALES
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = Panel; return; }
  root.Panel = Panel;

  /* ======================== Pegamento del navegador ======================== */
  var doc = root.document;
  if (!doc) return;

  var URL_ESTADO = 'https://raw.githubusercontent.com/miguellopezt/agente-panel/datos/estado.json';
  var URL_DIRECTO = 'wss://ws.bitstamp.net';
  var RECARGA_MS = 60 * 1000;
  var ui = { estado: null, vista: 'carteras', periodo: '3M', capas: { ma: true, ops: true, vol: true, dd: false, exp: false }, tab: 'hoy' };
  var grafico = null, vidrios = [], ultimoRefresco = 0;
  var reducido = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  /* Igualacion minima del DOM: conserva los nodos para que las transiciones se animen al cambiar un dato. */
  function igualar(a, b) {
    var na = a.childNodes, nb = b.childNodes, i;
    for (i = 0; i < nb.length; i++) {
      var x = na[i], y = nb[i];
      if (!x) { a.appendChild(y.cloneNode(true)); continue; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y.cloneNode(true), x); continue; }
      if (x.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
      if (x.nodeType !== 1) continue;
      Array.prototype.forEach.call(y.attributes, function (at) { if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value); });
      Array.prototype.slice.call(x.attributes).forEach(function (at) { if (!y.hasAttribute(at.name)) x.removeAttribute(at.name); });
      igualar(x, y);
    }
    while (a.childNodes.length > nb.length) a.removeChild(a.lastChild);
  }
  function pintar(el, html) {
    if (!el) return;
    var t = doc.createElement(el.tagName);
    t.innerHTML = html;
    igualar(el, t);
  }

  function destello(el, sube) {
    if (!el || reducido) return;
    el.classList.remove('sube', 'baja');
    void el.offsetWidth;
    el.classList.add(sube ? 'sube' : 'baja');
    root.setTimeout(function () { el.classList.remove('sube', 'baja'); }, 350);
  }

  function posicionarIndicador(seg) {
    var ind = $('.ind', seg), activo = $('[aria-pressed="true"]', seg);
    if (!ind || !activo) return;
    ind.style.setProperty('--x', activo.offsetLeft - 3 + 'px');
    ind.style.setProperty('--w', activo.offsetWidth + 'px');
  }

  function renderControles() {
    var e = ui.estado;
    var vistas = [['carteras', 'Carteras']].concat(((e && e.activos) || []).map(function (a) { return [a.simbolo, a.nombre]; }));
    if (!vistas.some(function (v) { return v[0] === ui.vista; })) ui.vista = 'carteras';
    var seg = function (id, lista, attr, actual) {
      var el = $(id);
      el.innerHTML = '<span class="ind" aria-hidden="true"></span>' + lista.map(function (v) {
        return '<button type="button" ' + attr + '="' + esc(v[0]) + '" aria-pressed="' + (actual === v[0]) + '">' + esc(v[1]) + '</button>';
      }).join('');
      posicionarIndicador(el);
    };
    seg('#vistas', vistas, 'data-vista', ui.vista);
    seg('#periodos', PERIODOS.map(function (p) { return [p[0], p[0]]; }), 'data-periodo', ui.periodo);
    var activo = ui.vista !== 'carteras';
    var defs = activo ? [['ma', 'Media de 200 días'], ['ops', 'Órdenes'], ['vol', 'Volumen']]
      : [['ops', 'Órdenes'], ['dd', 'Caída desde máximos'], ['exp', 'Exposición']];
    $('#capas').innerHTML = defs.map(function (d) {
      return '<button type="button" class="capa" data-capa="' + d[0] + '" aria-pressed="' + (ui.capas[d[0]] !== false && !!ui.capas[d[0]]) + '">' + d[1] + '</button>';
    }).join('');
  }

  /* --- Grafico (TradingView Lightweight Charts 5, version fijada en vendor/) ------------------------------------------------------- */

  function variable(n) { return getComputedStyle(doc.documentElement).getPropertyValue(n).trim(); }

  function opcionesTema() {
    return {
      localization: { locale: 'es-ES', priceFormatter: function (v) { return fmt(v, Math.abs(v) < 10 ? 4 : 2); } },
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: variable('--texto-2'),
        fontFamily: variable('--fuente') || 'sans-serif', attributionLogo: true, panes: { separatorColor: variable('--borde') } },
      grid: { vertLines: { visible: false }, horzLines: { color: variable('--borde') } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, rightOffset: 3 },
      crosshair: { mode: 0, vertLine: { color: variable('--texto-2'), labelBackgroundColor: variable('--texto') },
        horzLine: { color: variable('--texto-2'), labelBackgroundColor: variable('--texto') } },
      // zoom con pellizco y rueda; en el movil el arrastre vertical sigue desplazando la pagina
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true }
    };
  }

  function dibujar() {
    var LW = root.LightweightCharts, cont = $('#grafico');
    if (!LW) { cont.textContent = 'No se pudo cargar la librería del gráfico.'; return; }
    if (grafico) { grafico.chart.remove(); grafico = null; }
    var d = seriesGrafico(ui.estado, ui.vista, ui.capas), aviso = $('#aviso-grafico');
    aviso.hidden = !d.aviso;
    aviso.innerHTML = d.aviso ? vacio('Sin gráfico', d.aviso) : '';
    cont.hidden = !!d.aviso;
    $('#leyenda').innerHTML = '';
    if (d.aviso) return;
    var chart = LW.createChart(cont, Object.assign({ autoSize: true }, opcionesTema()));
    var g = { chart: chart, series: [], principal: null, marcadores: d.marcadores, d: d };
    var sinEtiqueta = { priceLineVisible: false, lastValueVisible: false };
    var leyenda = [];
    if (d.tipo === 'velas') {
      g.principal = chart.addSeries(LW.CandlestickSeries, { upColor: '#12B76A', downColor: '#F04438', borderVisible: false,
        wickUpColor: '#12B76A', wickDownColor: '#F04438', priceLineVisible: false });
      g.principal.setData(d.velas);
      g.series.push({ s: g.principal, nombre: 'Cierre', tipo: 'vela' });
      if (d.ma200.length) {
        var ma = chart.addSeries(LW.LineSeries, Object.assign({ color: '#F79009', lineWidth: 1.5, crosshairMarkerVisible: false }, sinEtiqueta));
        ma.setData(d.ma200); g.series.push({ s: ma, nombre: 'Media 200 d' });
        leyenda.push(['#F79009', 'Media de 200 días']);
      }
      if (d.volumen.length) {
        var vol = chart.addSeries(LW.HistogramSeries, Object.assign({ priceFormat: { type: 'volume' } }, sinEtiqueta), 1);
        vol.setData(d.volumen); g.series.push({ s: vol, nombre: 'Volumen', tipo: 'volumen' });
        chart.panes()[1] && chart.panes()[1].setHeight(Math.round(cont.clientHeight * 0.22));
      }
    } else {
      d.lineas.forEach(function (l) {
        var s = chart.addSeries(LW.LineSeries, Object.assign({ color: l.color, lineWidth: l.grosor, lineStyle: l.dash ? 2 : 0 }, sinEtiqueta));
        s.setData(l.datos);
        if (!g.principal || l.id === 'ejecutable') g.principal = s;
        g.series.push({ s: s, nombre: l.nombre, tipo: 'usd' });
        leyenda.push([l.color, l.nombre]);
      });
      var panel = 1;
      if (d.caida && d.caida.length) {
        var dd = chart.addSeries(LW.AreaSeries, Object.assign({ lineColor: '#F04438', topColor: 'rgba(240,68,56,0.04)',
          bottomColor: 'rgba(240,68,56,0.22)', lineWidth: 1, invertFilledArea: true }, sinEtiqueta), panel++);
        dd.setData(d.caida); g.series.push({ s: dd, nombre: 'Caída', tipo: 'pct' });
      }
      if (d.exposicion && d.exposicion.length) {
        var ex = chart.addSeries(LW.AreaSeries, Object.assign({ lineColor: '#3550F0', topColor: 'rgba(53,80,240,0.2)',
          bottomColor: 'rgba(53,80,240,0.02)', lineWidth: 1 }, sinEtiqueta), panel++);
        ex.setData(d.exposicion); g.series.push({ s: ex, nombre: 'Exposición', tipo: 'pct' });
      }
      chart.panes().slice(1).forEach(function (p) { p.setHeight(Math.round(cont.clientHeight * 0.18)); });
    }
    if (g.principal && d.marcadores.length && LW.createSeriesMarkers) {
      LW.createSeriesMarkers(g.principal, d.marcadores.map(function (m) {
        return { time: m.time, position: m.position, shape: m.shape, color: m.color, text: m.text };
      }));
      leyenda.push(['#12B76A', 'C compra'], ['#F04438', 'V venta (toca la fecha para el detalle)']);
    }
    $('#leyenda').innerHTML = leyenda.map(function (l) { return '<span><i style="background:' + esc(l[0]) + '"></i>' + esc(l[1]) + '</span>'; }).join('');
    chart.subscribeCrosshairMove(function (p) { moverTooltip(g, p); });
    chart.subscribeClick(function (p) {
      var t = p && typeof p.time === 'string' ? p.time : null;
      var m = t && g.marcadores.filter(function (x) { return x.time === t; })[0];
      if (m) abrirHoja(detalleOrden(m.orden));
    });
    grafico = g;
    aplicarPeriodo();
  }

  function aplicarPeriodo() {
    if (!grafico) return;
    var d = grafico.d, base = d.tipo === 'velas' ? d.velas : (d.lineas[0] ? d.lineas[0].datos : []);
    var r = rangoVisible(base, ui.periodo);
    if (r) grafico.chart.timeScale().setVisibleRange(r);
  }

  function moverTooltip(g, p) {
    var tt = $('#tooltip'), marco = tt.parentNode;
    if (!p || !p.point || !p.time || p.point.x < 0 || p.point.y < 0) { tt.classList.remove('visible'); return; }
    var filas = '';
    g.series.forEach(function (x) {
      var v = p.seriesData.get(x.s);
      if (!v) return;
      var texto = x.tipo === 'vela' ? 'A ' + fmt(v.open, 2) + ' · M ' + fmt(v.high, 2) + ' · m ' + fmt(v.low, 2) + ' · C ' + fmt(v.close, 2)
        : (x.tipo === 'volumen' ? compacto(v.value) : (x.tipo === 'pct' ? pct(v.value, 1) : fmt(v.value, 2)));
      filas += '<div class="t"><span>' + esc(x.nombre) + '</span><span class="num fuerte">' + texto + '</span></div>';
    });
    if (!filas) { tt.classList.remove('visible'); return; }
    tt.innerHTML = '<div class="sub">' + fecha(p.time) + '</div>' + filas;
    var x = p.point.x + 14, y = p.point.y + 14, w = tt.offsetWidth, h = tt.offsetHeight;
    if (x + w > marco.clientWidth) x = p.point.x - w - 14;
    if (y + h > marco.clientHeight) y = p.point.y - h - 14;
    tt.style.transform = 'translate(' + Math.max(0, x) + 'px,' + Math.max(0, y) + 'px)';
    tt.classList.add('visible');
  }

  /* --- Precio en directo (WebSocket publico, sin claves) ---------------------------------------------------------------------------- */

  var ws = null, wsEspera = 2000, wsUltimo = {};
  function conectarDirecto() {
    var e = ui.estado;
    if (!e || !e.activos || !e.activos.length || !root.WebSocket || doc.hidden) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try { ws = new root.WebSocket(URL_DIRECTO); } catch (x) { return; }
    ws.onopen = function () {
      wsEspera = 2000;
      e.activos.forEach(function (a) {
        ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: 'live_trades_' + a.simbolo.toLowerCase() + 'usd' } }));
      });
    };
    ws.onmessage = function (m) {
      var j; try { j = JSON.parse(m.data); } catch (x) { return; }
      if (!j || j.event !== 'trade' || !j.data || !esNum(j.data.price)) return;
      var sim = String(j.channel || '').replace('live_trades_', '').replace(/usd$/, '').toUpperCase();
      var ahora = Date.now();
      if (wsUltimo[sim] && ahora - wsUltimo[sim].t < 1000) { wsUltimo[sim].pendiente = j.data.price; return; }
      precioVivo(sim, j.data.price, ahora);
    };
    ws.onclose = function () {
      marcarDirecto(false);
      if (!doc.hidden) root.setTimeout(conectarDirecto, wsEspera);
      wsEspera = Math.min(wsEspera * 2, 60000);
    };
    ws.onerror = function () { try { ws.close(); } catch (x) { /* ya cerrado */ } };
  }
  function marcarDirecto(vivo, sim) {
    $$('[data-directo]').forEach(function (el) {
      if (sim && el.getAttribute('data-directo') !== sim) return;
      el.setAttribute('data-estado', vivo ? 'ok' : 'vacio');
      // el directo es de otro mercado que las velas y la variacion de 24 h: se dice en el rotulo
      $('.t', el).textContent = vivo ? 'En directo · otro mercado' : 'Cierre del estado';
    });
  }
  function precioVivo(sim, precio, ahora) {
    var a = ((ui.estado && ui.estado.activos) || []).filter(function (x) { return x.simbolo === sim; })[0];
    if (!a) return;
    var previo = wsUltimo[sim] && wsUltimo[sim].p;
    wsUltimo[sim] = { p: precio, t: ahora };
    // solo el precio: la variacion de 24 h sigue siendo la del estado (mismo mercado que las velas);
    // dividir el directo por la referencia de otro mercado mezclaria dos fuentes
    var el = $('[data-precio="' + sim + '"]');
    if (el) { el.textContent = usd(precio); if (previo && previo !== precio) destello(el, precio > previo); }
    marcarDirecto(true, sim);
  }
  root.setInterval(function () {
    Object.keys(wsUltimo).forEach(function (s) {
      var u = wsUltimo[s];
      if (u.pendiente != null) { var p = u.pendiente; u.pendiente = null; precioVivo(s, p, Date.now()); }
    });
  }, 1000);

  /* --- Vidrio: liquid-glass-js en la cabecera y la barra inferior; si no, desenfoque de CSS ---------------------------------------------------- */

  function vidrioPosible() {
    var mm = function (q) { return root.matchMedia && root.matchMedia(q).matches; };
    return !!root.LiquidGlass && root.CSS && root.CSS.supports && root.CSS.supports('filter', 'url(#x)') &&
      !mm('(prefers-reduced-transparency: reduce)') && !reducido && (root.navigator.hardwareConcurrency || 2) >= 2 &&
      // el clon de la pagina pesa: en moviles con poca memoria, desenfoque de CSS
      (root.navigator.deviceMemory == null || root.navigator.deviceMemory >= 4);
  }
  function geometria(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: Math.max(1, r.width), h: Math.max(1, r.height) }; }
  function iniciarVidrio() {
    if (!vidrioPosible()) return;
    var fondo = $('#principal');
    $$('.flotante').forEach(function (el) {
      if (el.offsetParent === null && getComputedStyle(el).display === 'none') return;
      var g = geometria(el);
      try {
        // zIndex por debajo de la capa (.flotante, 120): el vidrio queda detras de su contenido
        var v = new root.LiquidGlass({ background: fondo, width: g.w, height: g.h, radius: 0, x: g.x, y: g.y, zIndex: 100,
          draggable: false, scale: 18, depth: 18, chroma: 0.02, edge: 0.3, glow: 0, tint: 0, blur: 2.5 });
        vidrios.push({ v: v, el: el });
        limpiarClones();
      } catch (x) { /* sin vidrio: queda el desenfoque de CSS */ }
    });
    if (vidrios.length) doc.documentElement.classList.add('con-refraccion');
    ultimoRefresco = Date.now();
  }
  /* El vidrio refracta un clon de la pagina: sin ids duplicados, sin foco y fuera del arbol de accesibilidad. */
  function limpiarClones() {
    $$('.lqg-lens, .lqg-glass').forEach(function (el) {
      el.setAttribute('aria-hidden', 'true');
      el.inert = true;
      $$('[id]', el).forEach(function (x) { x.removeAttribute('id'); });
      $$('[aria-labelledby],[data-precio],[data-var],[data-directo]', el).forEach(function (x) {
        ['aria-labelledby', 'data-precio', 'data-var', 'data-directo'].forEach(function (a) { x.removeAttribute(a); });
      });
    });
  }
  function recolocarVidrio() {
    vidrios.forEach(function (x) {
      var g = geometria(x.el);
      x.v.set({ width: g.w, height: g.h }); x.v.moveTo(g.x, g.y);
    });
  }
  function refrescarVidrio() {
    if (!vidrios.length || Date.now() - ultimoRefresco < RECARGA_MS - 1000) return;
    ultimoRefresco = Date.now();
    vidrios.forEach(function (x) { x.v.refresh(); });
    limpiarClones();
  }

  /* --- Hoja inferior (detalle y fundamentos) ------------------------------------------------------------------------------------------------ */

  var ultimoFoco = null;
  function abrirHoja(html) {
    var h = $('#hoja');
    ultimoFoco = doc.activeElement;
    $('#hoja-contenido').innerHTML = html;
    h.classList.add('abierta'); $('#velo').classList.add('abierto');
    h.setAttribute('aria-hidden', 'false');
    fondoInerte(true);                       // dialogo modal: el foco no sale a la pagina de detras
    $('#hoja-cerrar').focus();
  }
  function fondoInerte(si) {
    $$('body > header, body > main, body > nav, body > .saltar').forEach(function (el) { el.inert = si; });
  }
  function cerrarHoja() {
    var h = $('#hoja');
    if (!h.classList.contains('abierta')) return;
    h.classList.remove('abierta'); $('#velo').classList.remove('abierto');
    h.setAttribute('aria-hidden', 'true');
    fondoInerte(false);
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
  }

  /* --- Pestanas del movil --------------------------------------------------------------------------------------------------------------- */

  var TABS = ['hoy', 'grafico', 'carteras', 'proyecto'];
  function ponerTab(t) {
    ui.tab = t; doc.body.setAttribute('data-tab', t);
    $$('.pestana').forEach(function (p) {
      if (p.getAttribute('data-tab') === t) p.setAttribute('aria-current', 'page'); else p.removeAttribute('aria-current');
    });
    $('.navegacion').style.setProperty('--i', String(TABS.indexOf(t)));
    if (t === 'grafico') root.requestAnimationFrame(function () { dibujar(); renderControles(); });
    root.scrollTo(0, 0);
  }
  function cambiarTab(t) {
    if (doc.startViewTransition && !reducido) doc.startViewTransition(function () { ponerTab(t); }); else ponerTab(t);
  }

  /* --- Botones: reposo, cargando, ok ---------------------------------------------------------------------------------------------------------- */

  function estadoBoton(b, estado) { if (b) b.setAttribute('data-estado-boton', estado); }

  /* --- Carga y pintado -------------------------------------------------------------------------------------------------------------------------- */

  function pintarTodo() {
    var previos = {};
    $$('[data-precio]').forEach(function (el) { previos[el.getAttribute('data-precio')] = el.textContent; });
    var r = renderTodo(ui.estado, Date.now());
    Object.keys(r).forEach(function (k) { pintar($('#' + k), r[k]); });
    $$('[data-precio]').forEach(function (el) {
      var s = el.getAttribute('data-precio'), u = wsUltimo[s];
      if (u && Date.now() - u.t < 120000) { el.textContent = usd(u.p); return; }   // el directo manda si es reciente
      if (previos[s] && previos[s] !== el.textContent) destello(el, true);
    });
    var e = ui.estado;
    $('#actualizado-pie').textContent = e && e.actualizado ? 'Estado generado ' + hace(e.actualizado, Date.now()) : 'Sin estado';
    renderControles();
    // con la fuente ya cargada: si se mostrara antes, el cambio de fuente moveria las tarjetas
    (doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve()).then(function () {
      doc.documentElement.classList.add('cargado');
    });
  }

  function cargar() {
    var boton = $('#actualizar');
    estadoBoton(boton, 'cargando');
    // ?estado=<ruta> solo en local: en la pagina publicada se ignora (un enlace trampa no puede cambiar los datos)
    var local = root.location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.location.hostname);
    var url = (local && new URLSearchParams(root.location.search).get('estado')) || URL_ESTADO;
    var pedir = function (f) {
      return root.fetch(f + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    };
    return root.fetch(url + (url.indexOf('?') < 0 ? '?t=' + Date.now() : ''), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        return Promise.all([pedir('decisiones.json'), pedir('hitos.json')]).then(function (x) {
          return completar(normalizar(j), { decisiones: x[0], hitos: x[1] });
        });
      })
      .then(function (j) {
        var cambio = !ui.estado || ui.estado.actualizado !== j.actualizado;
        ui.estado = j;
        pintarTodo();
        if (cambio && (ui.tab === 'grafico' || root.innerWidth > 760)) dibujar();
        conectarDirecto();
        $('#error').hidden = true;
        estadoBoton(boton, 'ok'); root.setTimeout(function () { estadoBoton(boton, 'reposo'); }, 1400);
        if (!vidrios.length) iniciarVidrio(); else if (cambio) refrescarVidrio();
      })
      .catch(function (err) {
        var e = $('#error'); e.hidden = false;
        e.innerHTML = vacio('No se pudo cargar el estado', String((err && err.message) || err));
        if (!ui.estado) pintarTodo();
        estadoBoton(boton, 'reposo');
      });
  }

  function iniciar() {
    doc.addEventListener('click', function (ev) {
      var t = ev.target.closest('button,[data-orden]');
      if (!t) return;
      if (t.hasAttribute('data-fundamento')) return abrirHoja(detalleFundamento(t.getAttribute('data-fundamento')));
      if (t.hasAttribute('data-periodo')) { ui.periodo = t.getAttribute('data-periodo'); renderControles(); return aplicarPeriodo(); }
      if (t.hasAttribute('data-vista')) { ui.vista = t.getAttribute('data-vista'); renderControles(); return dibujar(); }
      if (t.hasAttribute('data-capa')) {
        var c = t.getAttribute('data-capa'); ui.capas[c] = !(ui.capas[c] !== false && ui.capas[c]); renderControles(); return dibujar();
      }
      if (t.hasAttribute('data-tab')) return cambiarTab(t.getAttribute('data-tab'));
      if (t.hasAttribute('data-orden')) { var o = ordenesOrdenadas(ui.estado)[Number(t.getAttribute('data-orden'))]; if (o) abrirHoja(detalleOrden(o)); return; }
      if (t.id === 'hoja-cerrar') return cerrarHoja();
      if (t.id === 'actualizar') return cargar();
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') cerrarHoja();
      var fila = ev.target.closest && ev.target.closest('[data-orden]');
      if (fila && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); fila.click(); }
      var grupo = ev.target.closest && ev.target.closest('.seg');
      if (grupo && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
        var bs = $$('button', grupo), i = bs.indexOf(ev.target);
        var n = bs[(i + (ev.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length]; n.focus(); n.click();
      }
    });
    $('#velo').addEventListener('click', cerrarHoja);
    var tr = null;
    root.addEventListener('resize', function () {
      root.clearTimeout(tr);
      tr = root.setTimeout(function () { $$('.seg').forEach(posicionarIndicador); recolocarVidrio(); }, 120);
    });
    root.setInterval(function () { if (!doc.hidden) cargar(); }, RECARGA_MS);
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) { if (ws) try { ws.close(); } catch (x) { /* nada */ } } else { cargar(); }
    });
    root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { dibujar(); });
    ponerTab('hoy');
    cargar().then(function () {
      root.requestAnimationFrame(function () { $$('.seg,.navegacion').forEach(function (s) { s.classList.add('listo'); }); });
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(typeof window !== 'undefined' ? window : globalThis);
