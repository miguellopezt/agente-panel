/* Panel decisor. Dos capas:
 *  - Funciones puras que convierten estado.json en HTML (texto) y en series del grafico.
 *    No tocan el DOM: se prueban con node (tests/js/panel_test.js).
 *  - Pegamento del navegador (al final): carga estado.json, pinta, grafico, eventos.
 * Sin datos inventados: si falta una fuente, se muestra un estado vacio que dice
 * que falta y por que (estado.faltan). Todo texto del JSON se escapa antes de pintarlo. */
(function (root) {
  'use strict';

  // Caracteres de control y separadores de linea de Unicode (se construye con new RegExp para no
  // poner en el codigo fuente un salto de linea literal).
  var CONTROL = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]+', 'g');
  var FRESCO_MIN = 30, AMBAR_MIN = 90;
  var PERIODOS = [['1M', 31], ['3M', 92], ['6M', 183], ['1A', 366], ['Todo', null]];
  var SENALES = { comprar: 'Comprar', mantener: 'Mantener', reducir: 'Reducir', fuera: 'Fuera', sindato: 'Sin dato' };
  var COLOR_CARTERA = { ejecutable: '#2E5BFF', regla: '#667085', comprar_mantener: '#98A2B3' };

  var ICONOS = {
    ok: '<path d="M4 8.5l3 3 5-6" />',
    aviso: '<path d="M8 3v6M8 12v.5" />',
    alerta: '<path d="M4 4l8 8M12 4l-8 8" />',
    vacio: '<path d="M3.5 8h9" />',
    sindato: '<path d="M3.5 8h9" />',
    comprar: '<path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" />',
    reducir: '<path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" />',
    mantener: '<path d="M3.5 6.5h9M3.5 9.5h9" />',
    fuera: '<circle cx="8" cy="8" r="4.5" /><path d="M5 11l6-6" />',
    hecho: '<path d="M4 8.5l3 3 5-6" />',
    pendiente: '<circle cx="8" cy="8" r="4.5" />',
    trabajando: '<path d="M8 4v4l2.5 1.5" /><circle cx="8" cy="8" r="5" />',
    esperando: '<path d="M5.5 4v8M10.5 4v8" />',
    bloqueado: '<rect x="4" y="7" width="8" height="5.5" rx="1.5" /><path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" />',
    parado: '<rect x="4.5" y="4.5" width="7" height="7" rx="1" />',
    lista: '<path d="M4 8.5l3 3 5-6" />',
    revision: '<circle cx="8" cy="8" r="4.5" /><path d="M8 5.5V8l1.5 1" />',
    cambios: '<path d="M4 4l8 8M12 4l-8 8" />',
    ejecutada: '<path d="M4 8.5l3 3 5-6" />',
    plan: '<circle cx="8" cy="8" r="4.5" />',
    descartada: '<path d="M4 4l8 8M12 4l-8 8" />',
    demo: '<circle cx="8" cy="8" r="4.5" />',
    real: '<path d="M4 8.5l3 3 5-6" />',
    stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1" />',
    info: '<circle cx="8" cy="8" r="5.5" /><path d="M8 7.5V11M8 5.2v.2" />'
  };

  function icono(nombre, extra) {
    return '<svg class="icono" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' +
      (ICONOS[nombre] || ICONOS.info) + '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function esNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, d) {
    if (!esNum(v)) return '—';
    return v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function usd(v, d) { return esNum(v) ? fmt(v, d == null ? 2 : d) + ' $' : '—'; }
  function pct(v, d) { return esNum(v) ? fmt(v * 100, d == null ? 1 : d) + ' %' : '—'; }
  function pctFirmado(v, d) {
    if (!esNum(v)) return '—';
    return (v > 0 ? '+' : '') + fmt(v * 100, d == null ? 1 : d) + ' %';
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

  function chip(estado, texto) {
    return '<span class="chip" data-estado="' + esc(estado) + '">' + icono(estado) + '<span>' +
      esc(texto) + '</span></span>';
  }

  function vacio(titulo, motivo) {
    return '<div class="vacio" data-estado="vacio" role="status">' + icono('info') +
      '<div><b>' + esc(titulo) + '</b>' + esc(motivo) + '</div></div>';
  }

  function faltaDe(e, campo, titulo, porDefecto) {
    var motivo = (e && e.faltan && e.faltan[campo]) || porDefecto;
    return vacio(titulo, motivo);
  }

  /* --- Formatos de estado.json ------------------------------------------------------------------
   * Nuevo (contrato v1): trae `carteras` y `actualizado`; se usa tal cual.
   * Anterior (exportador en produccion): trae `generado` y `simulacion`; se convierte a lo que la
   * pagina entiende con lo que ese formato tiene, y lo que no tiene queda vacio con su motivo
   * (`faltan`), sin inventar nada. */

  var FALTA_ANTERIOR = 'El formato de datos actual no incluye esta información; llegará con el exportador nuevo.';
  var NOMBRES_CARTERA = { regla: 'A · regla', ejecutable: 'B · ejecutable', comprar_mantener: 'Comprar y mantener' };
  // Política del proyecto: caída del backtest y límite a partir del cual se revisa la cartera.
  var POLITICA = { drawdown_backtest: -0.37, limite: -0.5 };

  function senalDe(objetivo, actual) {
    if (!(objetivo > 0)) return actual > 0.005 ? 'reducir' : 'fuera';
    if (actual > objetivo * 1.2) return 'reducir';
    if (actual < objetivo * 0.8) return 'comprar';
    return 'mantener';
  }

  function normalizar(e) {
    if (!e || typeof e !== 'object') return null;
    if (e.carteras && e.actualizado) return e;                 // formato nuevo
    if (!e.simulacion && !e.generado) return e;                // desconocido: se muestra lo que haya
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
        objetivo: p.objetivo, actual: actual,
        // sin la exposicion actual no se sabe si hay que operar: «sin dato», no «mantener»
        senal: actual == null ? 'sindato' : senalDe(p.objetivo, actual),
        serie: [], ma200_serie: [] };
    });
    if (!activos.length) faltan.activos = FALTA_ANTERIOR; else faltan.serie_activos = FALTA_ANTERIOR;
    faltan.ordenes = FALTA_ANTERIOR; faltan.agentes = FALTA_ANTERIOR; faltan.ramas = FALTA_ANTERIOR;
    var b = carteras.filter(function (c) { return c.id === 'ejecutable'; })[0];
    var dd = null;
    if (b && b.serie.length > 1) { var cs = caida(unicas(b.serie)); dd = cs[cs.length - 1][1]; }
    faltan.riesgo = 'La volatilidad de la cartera llegará con el exportador nuevo.';
    var cal = (e.calidad && e.calidad.comprobaciones) || null;
    // El formato anterior no dice el modo ni si hay STOP: no se afirma ninguno de los dos.
    return { actualizado: e.generado, modo: null, stop: null, carteras: carteras, activos: activos, ordenes: [],
      riesgo: { drawdown: dd, drawdown_backtest: POLITICA.drawdown_backtest, limite: POLITICA.limite, vol_cartera: null },
      agentes: [], ramas: [], decisiones: [], hitos: [],
      salud: { timers_ok: null, timers_total: null, calidad_ok: cal ? cal.filter(function (x) { return x.ok; }).length : null,
        calidad_total: cal ? cal.length : null, disco: null },
      faltan: faltan, omitidos: 0, formato: 'anterior' };
  }

  /* Decisiones e hitos estaticos publicados junto a la pagina (decisiones.json, hitos.json): se
     usan solo si el estado no los trae. */
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

  /* --- Cabecera ------------------------------------------------------------------------------ */

  function frescura(actualizado, ahora) {
    var t = Date.parse(actualizado);
    if (isNaN(t)) return { min: null, estado: 'vacio', texto: 'Sin fecha de actualización' };
    var min = Math.max(0, (ahora - t) / 60000);
    var estado = min < FRESCO_MIN ? 'ok' : (min < AMBAR_MIN ? 'aviso' : 'alerta');
    return { min: min, estado: estado, texto: 'Dato ' + hace(actualizado, ahora) };
  }

  function estadoSalud(s) {
    if (!s || (s.timers_total == null && s.calidad_total == null)) return 'vacio';
    var malo = false, mal = false;
    if (s.timers_total) {
      if (s.timers_ok / s.timers_total < 0.8) malo = true; else if (s.timers_ok < s.timers_total) mal = true;
    }
    if (s.calidad_total) {
      if (s.calidad_total - s.calidad_ok > 1) malo = true; else if (s.calidad_ok < s.calidad_total) mal = true;
    }
    if (esNum(s.disco)) { if (s.disco >= 90) malo = true; else if (s.disco >= 85) mal = true; }
    return malo ? 'alerta' : (mal ? 'aviso' : 'ok');
  }

  function renderCabecera(e, ahora) {
    e = normalizar(e);
    if (!e) {
      return '<h1>Panel del agente</h1><div class="grupo">' + chip('vacio', 'Sin estado.json') + '</div>';
    }
    var f = frescura(e.actualizado, ahora);
    var s = e.salud || {};
    var partes = [];
    if (s.timers_total != null) partes.push('timers ' + s.timers_ok + '/' + s.timers_total);
    if (s.calidad_total != null) partes.push('calidad ' + s.calidad_ok + '/' + s.calidad_total);
    if (esNum(s.disco)) partes.push('disco ' + s.disco + ' %');
    var salud = chip(estadoSalud(s), partes.length ? 'Servicios · ' + partes.join(' · ') : 'Servicios sin datos');
    return '<h1>Panel del agente</h1><div class="grupo">' +
      (e.modo === 'demo' ? chip('demo', 'Modo demo') : (e.modo === 'real' ? chip('ok', 'Modo real') :
        (e.modo === 'activo' ? chip('ok', 'Modo activo') : chip('vacio', 'Modo: sin dato')))) +
      (e.stop === true ? chip('alerta', 'STOP activo') : (e.stop === false ? chip('ok', 'Sin STOP') : chip('vacio', 'STOP: sin dato'))) +
      '<span data-key="frescura">' + chip(f.estado, f.texto) + '</span>' + salud + '</div>';
  }

  /* --- Te espera ------------------------------------------------------------------------------ */

  /* Lo que se copia acaba pegado en un terminal de agente: una sola linea, sin saltos ni
     caracteres de control, de longitud acotada. */
  function textoCopia(id, opcion) {
    var t = ('DECISION ' + id + ': ' + opcion).replace(CONTROL, ' ');
    return t.replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  function renderEspera(e) {
    if (!e) return vacio('Sin datos', 'No se pudo leer estado.json.');
    var dec = e.decisiones || [], listas = (e.ramas || []).filter(function (r) { return r.estado === 'lista'; });
    if (!dec.length && !listas.length) {
      var motivo = (e.faltan && (e.faltan.decisiones || e.faltan.ramas)) || '';
      return vacio('Nada espera tu decisión', motivo || 'No hay decisiones abiertas ni ramas aprobadas por fusionar.');
    }
    var h = '';
    if (dec.length) {
      h += '<ul class="lista">' + dec.map(function (d) {
        return '<li class="decision" data-key="dec-' + esc(d.id) + '"><div class="pregunta">' + esc(d.pregunta) + '</div>' +
          '<div class="contexto">' + esc(d.contexto) + '</div><div class="opciones">' +
          (d.opciones || []).map(function (o) {
            var rec = d.recomendada === o;
            var copia = textoCopia(d.id, o);
            return '<button type="button" class="boton" data-copy="' + esc(copia) +
              '" data-recomendada="' + rec + '" data-estado-boton="reposo" aria-label="Copiar: ' +
              esc(copia) + '"><span class="etq">' + esc(o) + '</span>' +
              (rec ? '<span class="tag">recomendada</span>' : '') + '</button>';
          }).join('') + '</div></li>';
      }).join('') + '</ul>';
    }
    if (listas.length) {
      h += '<div class="sub" style="margin:' + (dec.length ? '16px' : '0') + ' 0 4px">Ramas aprobadas por fusionar</div>' +
        listas.map(function (r) {
          return '<div class="fila" data-key="rama-' + esc(r.nombre) + '"><span class="principal mono">' + esc(r.nombre) +
            '</span><span class="mono sub">' + esc(r.commit) + '</span></div>';
        }).join('');
    }
    return h;
  }

  /* --- Carteras ---------------------------------------------------------------------------------- */

  function ultimo(serie) { return serie && serie.length ? serie[serie.length - 1][1] : null; }

  function renderCarteras(e) {
    if (!e || !e.carteras || !e.carteras.length) return faltaDe(e, 'carteras', 'Sin carteras', 'No hay carteras en estado.json.');
    var por = {};
    e.carteras.forEach(function (c) { por[c.id] = c; });
    var orden = ['ejecutable', 'regla', 'comprar_mantener'].filter(function (id) { return por[id]; });
    var b = por.ejecutable, vb = b ? ultimo(b.serie) : null;
    var tarjetas = orden.map(function (id) {
      var c = por[id], v = ultimo(c.serie), r = esNum(v) && c.inicial ? v / c.inicial - 1 : null;
      var cmp = '';
      if (id !== 'ejecutable' && esNum(vb) && esNum(v) && b.inicial && c.inicial) {
        var d = (vb / b.inicial - 1) - (v / c.inicial - 1);
        cmp = '<div class="sub">B frente a esta: <span class="delta ' + (d > 0.0005 ? 'pos' : d < -0.0005 ? 'neg' : 'cero') +
          '">' + (d > 0 ? '+' : '') + fmt(d * 100, 2) + ' pp</span></div>';
      }
      return '<div class="tarjeta cartera' + (id === 'ejecutable' ? ' b' : '') + '" data-key="cartera-' + esc(id) + '">' +
        '<div class="titulo"><span>' + esc(c.nombre) + '</span></div>' +
        '<div class="valor">' + usd(v) + '</div>' +
        '<div class="sub">Inicial ' + usd(c.inicial) + ' · <span class="delta ' + (r > 0.0005 ? 'pos' : r < -0.0005 ? 'neg' : 'cero') +
        '">' + pctFirmado(r, 2) + '</span></div>' + cmp + '</div>';
    });
    return '<div class="carteras">' + tarjetas.join('') + '</div>';
  }

  /* --- Activos ------------------------------------------------------------------------------------- */

  function renderActivos(e) {
    if (!e || !e.activos || !e.activos.length) return faltaDe(e, 'activos', 'Sin activos', 'No hay activos en estado.json.');
    return '<div class="activos">' + e.activos.map(function (a) {
      var escala = Math.max(a.objetivo || 0, a.actual || 0, 0.25) * 1.25;
      var p = esNum(a.actual) ? Math.min(a.actual / escala, 1) : 0;
      var o = esNum(a.objetivo) ? Math.min(a.objetivo / escala, 1) : 0;
      var dist = esNum(a.precio) && esNum(a.ma200) && a.ma200 ? a.precio / a.ma200 - 1 : null;
      return '<div class="tarjeta activo" data-key="activo-' + esc(a.simbolo) + '" data-estado="' + esc(a.senal) + '">' +
        '<div class="titulo"><span>' + esc(a.nombre) + ' · ' + esc(a.simbolo) + '</span>' +
        '<span class="num fuerte">' + usd(a.precio) + ' <span class="delta ' + (a.cambio24h > 0 ? 'pos' : a.cambio24h < 0 ? 'neg' : 'cero') +
        '">' + pctFirmado(a.cambio24h, 2) + '</span></span></div>' +
        '<div class="senal">' + icono(a.senal) + '<span>' + esc(SENALES[a.senal] || a.senal) + '</span></div>' +
        '<div class="sub" style="margin:12px 0 6px">Exposición actual frente a objetivo</div>' +
        '<div class="barra" role="img" aria-label="Actual ' + pct(a.actual) + ', objetivo ' + pct(a.objetivo) + '">' +
        '<i style="--p:' + p.toFixed(4) + '"></i><b style="--o:' + o.toFixed(4) + '"></b></div>' +
        '<dl class="datos"><div><dt>Actual / objetivo</dt><dd class="num">' + pct(a.actual) + ' / ' + pct(a.objetivo) + '</dd></div>' +
        '<div><dt>Volatilidad (anual)</dt><dd class="num">' + pct(a.vol, 0) + '</dd></div>' +
        '<div><dt>Media de 200 días</dt><dd class="num">' + usd(a.ma200) + '</dd></div>' +
        '<div><dt>Precio frente a la media</dt><dd class="num">' + pctFirmado(dist, 1) + '</dd></div></dl></div>';
    }).join('') + '</div>';
  }

  /* --- Ordenes ---------------------------------------------------------------------------------------- */

  function renderOrdenes(e) {
    if (!e || !e.ordenes || !e.ordenes.length) return faltaDe(e, 'ordenes', 'Sin órdenes', 'No hay órdenes registradas.');
    var filas = e.ordenes.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }).map(function (o, i) {
      return '<tr class="fila-click" tabindex="0" role="button" data-orden="' + i + '" data-fecha="' + esc(o.fecha) +
        '" data-activo="' + esc(o.activo) + '" aria-label="Detalle de la orden de ' + esc(o.activo) + ' del ' + esc(o.fecha) + '">' +
        '<td>' + fecha(o.fecha) + '</td><td>' + esc(o.activo) + '</td>' +
        '<td>' + chip(o.lado === 'compra' ? 'compra' : 'venta', o.lado === 'compra' ? 'Compra' : 'Venta') + '</td>' +
        '<td class="der num">' + usd(o.importe) + '</td><td class="der num">' + usd(o.precio) + '</td>' +
        '<td>' + chip(o.estado, o.estado.charAt(0).toUpperCase() + o.estado.slice(1)) + '</td>' +
        '<td class="sub">' + esc(o.motivo) + '</td></tr>';
    }).join('');
    return '<div class="tabla-scroll"><table><thead><tr><th>Fecha</th><th>Activo</th><th>Lado</th>' +
      '<th class="der">Importe</th><th class="der">Precio</th><th>Estado</th><th>Motivo</th></tr></thead><tbody>' +
      filas + '</tbody></table></div>';
  }

  function ordenesOrdenadas(e) {
    return (e.ordenes || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
  }

  /* --- Riesgo ---------------------------------------------------------------------------------------------- */

  function renderRiesgo(e) {
    if (!e || !e.riesgo) return faltaDe(e, 'riesgo', 'Sin riesgo', 'No hay datos de riesgo.');
    var r = e.riesgo, lim = Math.abs(r.limite || 0.5);
    var dd = esNum(r.drawdown) ? Math.min(Math.abs(r.drawdown) / lim, 1) : 0;
    var bt = esNum(r.drawdown_backtest) ? Math.min(Math.abs(r.drawdown_backtest) / lim, 1) : 0;
    var estado = !esNum(r.drawdown) ? 'vacio' : (Math.abs(r.drawdown) >= lim ? 'alerta' : (Math.abs(r.drawdown) >= lim * 0.7 ? 'aviso' : 'ok'));
    var aviso = (e.faltan && e.faltan.riesgo) ? '<div class="sub" style="margin-top:8px">' + esc(e.faltan.riesgo) + '</div>' : '';
    return '<div class="medidor" data-estado="' + estado + '"><div class="cab"><span>Caída desde el máximo (B)</span>' +
      '<span class="num fuerte">' + (esNum(r.drawdown) ? pctFirmado(r.drawdown, 1) : '—') + '</span></div>' +
      '<div class="barra" role="img" aria-label="Caída actual frente al límite"><i style="--p:' + dd.toFixed(4) +
      ';background:var(--e, var(--acento))"></i><b style="--o:' + bt.toFixed(4) + '" title="Caída del backtest"></b></div>' +
      '<div class="sub">Marca: caída del backtest ' + pctFirmado(r.drawdown_backtest, 0) + ' · límite de revisión ' +
      pctFirmado(r.limite, 0) + '</div></div>' +
      '<div class="fila"><span>Volatilidad de la cartera (anual)</span><span class="num fuerte">' + pct(r.vol_cartera, 0) + '</span></div>' + aviso;
  }

  /* --- Equipo ------------------------------------------------------------------------------------------------ */

  function renderAgentes(e) {
    if (!e || !e.agentes || !e.agentes.length) return faltaDe(e, 'agentes', 'Sin agentes', 'No hay datos del buzón.');
    return e.agentes.map(function (a) {
      return '<div class="fila" data-key="agente-' + esc(a.rol) + '"><div class="principal"><span class="fuerte">' +
        esc(a.rol.charAt(0).toUpperCase() + a.rol.slice(1)) + '</span> <span class="sub">' + esc(a.modelo || 'modelo desconocido') +
        '</span><div class="sub" style="overflow:hidden;text-overflow:ellipsis">' + esc(a.tarea || 'Sin tarea registrada') +
        '</div></div><div style="text-align:right">' + chip(a.estado, a.estado.charAt(0).toUpperCase() + a.estado.slice(1)) +
        '<div class="sub">' + (a.desde ? hace(a.desde, root.__ahora) : '—') + '</div></div></div>';
    }).join('');
  }

  function renderRamas(e) {
    if (!e || !e.ramas) return faltaDe(e, 'ramas', 'Sin ramas', 'No hay datos de git.');
    if (!e.ramas.length) {
      if (e.faltan && e.faltan.ramas) return vacio('Sin datos de ramas', e.faltan.ramas);
      return vacio('Sin ramas pendientes', 'Todo lo aprobado está fusionado en master.');
    }
    var etq = { lista: 'Lista', revision: 'En revisión', cambios: 'Cambios pedidos' };
    return e.ramas.map(function (r) {
      return '<div class="fila" data-key="rama2-' + esc(r.nombre) + '"><span class="principal mono">' + esc(r.nombre) +
        '</span><span style="display:flex;gap:10px;align-items:center"><span class="mono sub">' + esc(r.commit) + '</span>' +
        chip(r.estado, etq[r.estado] || r.estado) + '</span></div>';
    }).join('');
  }

  function renderHitos(e, ahora) {
    if (!e || !e.hitos || !e.hitos.length) return faltaDe(e, 'hitos', 'Sin hitos', 'No hay hitos en estado.json.');
    return '<ul class="hitos">' + e.hitos.map(function (h) {
      var dias = Math.ceil((Date.parse(h.fecha + 'T00:00:00Z') - ahora) / 86400000);
      var cuando = h.estado === 'hecho' ? 'hecho' : (dias > 0 ? 'en ' + dias + ' días' : (dias === 0 ? 'hoy' : 'vencido'));
      return '<li data-estado="' + esc(h.estado) + '" data-key="hito-' + esc(h.fecha) + '"><div class="fuerte">' + esc(h.nombre) +
        '</div><div class="sub">' + fecha(h.fecha) + ' · ' + cuando + '</div></li>';
    }).join('') + '</ul>';
  }

  function renderTodo(e, ahora) {
    ahora = ahora || Date.now();
    root.__ahora = ahora;
    e = normalizar(e);
    return {
      cabecera: renderCabecera(e, ahora), espera: renderEspera(e), carteras: renderCarteras(e),
      activos: renderActivos(e), ordenes: renderOrdenes(e), riesgo: renderRiesgo(e),
      agentes: renderAgentes(e), ramas: renderRamas(e), hitos: renderHitos(e, ahora)
    };
  }

  /* --- Series del grafico (puras) ------------------------------------------------------------------------------ */

  function recorte(serie, periodo, hasta) {
    var dias = (PERIODOS.filter(function (p) { return p[0] === periodo; })[0] || [])[1];
    if (!dias || !serie.length) return serie;
    var fin = Date.parse((hasta || serie[serie.length - 1][0]) + 'T00:00:00Z');
    var corte = new Date(fin - dias * 86400000).toISOString().slice(0, 10);
    return serie.filter(function (p) { return p[0] >= corte; });
  }

  function caida(serie) {
    var pico = -Infinity;
    return serie.map(function (p) { pico = Math.max(pico, p[1]); return [p[0], pico > 0 ? p[1] / pico - 1 : 0]; });
  }

  /* Un valor por fecha (el ultimo), ordenado y sin nulos: el grafico exige tiempos estrictamente crecientes. */
  function unicas(serie) {
    var m = {};
    (serie || []).forEach(function (p) { if (p && typeof p[0] === 'string' && esNum(p[1])) m[p[0]] = p[1]; });
    return Object.keys(m).sort().map(function (t) { return [t, m[t]]; });
  }

  function puntos(serie) { return unicas(serie).map(function (p) { return { time: p[0], value: p[1] }; }); }

  /* vista: 'carteras' o el simbolo de un activo. Devuelve lo que el grafico dibuja. */
  function seriesGrafico(e, vista, periodo, capas) {
    capas = capas || {};
    var out = { lineas: [], marcadores: [], caida: null, exposicion: null, aviso: null };
    e = normalizar(e);
    if (!e) { out.aviso = 'Sin estado.json.'; return out; }
    var ops = (e.ordenes || []);
    if (vista === 'carteras') {
      var cs = (e.carteras || []);
      if (!cs.length) { out.aviso = (e.faltan && e.faltan.carteras) || 'Sin carteras.'; return out; }
      cs.forEach(function (c) {
        out.lineas.push({ id: c.id, nombre: c.nombre, color: COLOR_CARTERA[c.id] || '#667085',
          grosor: c.id === 'ejecutable' ? 2 : 1.5, dash: c.id === 'comprar_mantener',
          datos: puntos(recorte(c.serie, periodo)) });
      });
      var b = cs.filter(function (c) { return c.id === 'ejecutable'; })[0] || cs[0];
      if (capas.dd) out.caida = puntos(recorte(caida(unicas(b.serie)), periodo));
      if (capas.exp && b.exposicion_serie) out.exposicion = puntos(recorte(b.exposicion_serie, periodo));
      if (capas.ops) {
        var visibles = {};
        recorte(b.serie, periodo).forEach(function (p) { visibles[p[0]] = true; });
        ops.forEach(function (o) { if (visibles[o.fecha]) out.marcadores.push(marcador(o)); });
      }
    } else {
      var a = (e.activos || []).filter(function (x) { return x.simbolo === vista; })[0];
      if (!a) { out.aviso = 'Activo sin datos.'; return out; }
      if (!a.serie || !a.serie.length) { out.aviso = (e.faltan && (e.faltan.serie_activos || e.faltan.activos)) || 'Sin serie de precios para este activo.'; return out; }
      out.lineas.push({ id: 'precio', nombre: a.nombre + ' · precio', color: '#101828', grosor: 2, dash: false,
        datos: puntos(recorte(a.serie, periodo)), tema: true });
      if (capas.ma) out.lineas.push({ id: 'ma200', nombre: 'Media de 200 días', color: '#F79009', grosor: 1.5, dash: true,
        datos: puntos(recorte(a.ma200_serie || [], periodo)) });
      if (capas.dd) out.caida = puntos(recorte(caida(unicas(a.serie)), periodo));
      if (capas.exp && a.exposicion_serie) out.exposicion = puntos(recorte(a.exposicion_serie, periodo));
      if (capas.ops) {
        var vis = {};
        recorte(a.serie, periodo).forEach(function (p) { vis[p[0]] = true; });
        ops.filter(function (o) { return o.activo === a.simbolo && vis[o.fecha]; })
          .forEach(function (o) { out.marcadores.push(marcador(o)); });
      }
    }
    out.marcadores.sort(function (x, y) { return x.time < y.time ? -1 : 1; });
    return out;
  }

  function marcador(o) {
    var compra = o.lado === 'compra';
    return { time: o.fecha, position: compra ? 'belowBar' : 'aboveBar', shape: compra ? 'arrowUp' : 'arrowDown',
      color: compra ? '#12B76A' : '#F04438', text: (compra ? 'C ' : 'V ') + o.activo, orden: o };
  }

  function contextoOrden(o) {
    var compra = o.lado === 'compra';
    return '<button type="button" class="boton cerrar" data-accion="cerrar-lateral" aria-label="Cerrar">Cerrar</button>' +
      '<div class="sub">' + fecha(o.fecha) + '</div><h2 id="lateral-titulo">' + (compra ? 'Compra' : 'Venta') + ' de ' + esc(o.activo) + '</h2>' +
      '<div style="margin-bottom:14px">' + chip(o.estado, o.estado.charAt(0).toUpperCase() + o.estado.slice(1)) + '</div>' +
      '<dl><dt>Motivo</dt><dd>' + esc(o.motivo) + '</dd><dt>Precio</dt><dd class="num">' + usd(o.precio) + '</dd>' +
      '<dt>Importe</dt><dd class="num">' + usd(o.importe) + '</dd>' +
      '<dt>Exposición antes</dt><dd class="num">' + pct(o.exposicion_antes) + '</dd>' +
      '<dt>Exposición después</dt><dd class="num">' + pct(o.exposicion_despues) + '</dd></dl>';
  }

  var Panel = {
    esc: esc, fmt: fmt, pct: pct, usd: usd, frescura: frescura, estadoSalud: estadoSalud, recorte: recorte, caida: caida,
    normalizar: normalizar, completar: completar, unicas: unicas, senalDe: senalDe,
    textoCopia: textoCopia, renderTodo: renderTodo, renderCabecera: renderCabecera, renderEspera: renderEspera, renderCarteras: renderCarteras,
    renderActivos: renderActivos, renderOrdenes: renderOrdenes, renderRiesgo: renderRiesgo, renderAgentes: renderAgentes,
    renderRamas: renderRamas, renderHitos: renderHitos, seriesGrafico: seriesGrafico, contextoOrden: contextoOrden,
    ordenesOrdenadas: ordenesOrdenadas, vacio: vacio, PERIODOS: PERIODOS, SENALES: SENALES
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = Panel; return; }
  root.Panel = Panel;

  /* ======================== Pegamento del navegador ======================== */
  var doc = root.document;
  if (!doc) return;

  var URL_ESTADO = 'https://raw.githubusercontent.com/miguellopezt/agente-panel/datos/estado.json';
  var ui = { estado: null, vista: 'carteras', periodo: '3M', capas: { ma: true, ops: true, dd: false, exp: false }, tab: 'hoy' };
  var grafico = null;
  var reducido = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  /* Igualacion minima del DOM: conserva los nodos para que las transiciones de color
     y de barra se animen al cambiar un estado, en vez de reemplazarlo todo. */
  function igualar(a, b) {
    var na = a.childNodes, nb = b.childNodes, i;
    for (i = 0; i < nb.length; i++) {
      var x = na[i], y = nb[i];
      if (!x) { a.appendChild(y.cloneNode(true)); continue; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y.cloneNode(true), x); continue; }
      if (x.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
      if (x.nodeType !== 1) continue;
      Array.prototype.forEach.call(y.attributes, function (at) {
        if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
      });
      Array.prototype.slice.call(x.attributes).forEach(function (at) {
        if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
      });
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

  function posicionarIndicador(seg) {
    var ind = $('.indicador', seg), activo = $('[aria-pressed="true"],[aria-selected="true"]', seg);
    if (!ind || !activo) return;
    ind.style.setProperty('--x', activo.offsetLeft + 'px');
    ind.style.setProperty('--w', activo.offsetWidth + 'px');
  }

  function renderPeriodos() {
    var seg = $('#periodos');
    seg.innerHTML = '<span class="indicador" aria-hidden="true"></span>' + PERIODOS.map(function (p) {
      return '<button type="button" data-periodo="' + p[0] + '" aria-pressed="' + (ui.periodo === p[0]) + '">' + p[0] + '</button>';
    }).join('');
    posicionarIndicador(seg);
  }

  function renderVistas() {
    var e = ui.estado, seg = $('#vistas');
    var vistas = [['carteras', 'Carteras']].concat((e && e.activos || []).map(function (a) { return [a.simbolo, a.nombre]; }));
    if (ui.vista !== 'carteras' && !vistas.some(function (v) { return v[0] === ui.vista; })) ui.vista = 'carteras';
    seg.innerHTML = '<span class="indicador" aria-hidden="true"></span>' + vistas.map(function (v) {
      return '<button type="button" data-vista="' + esc(v[0]) + '" aria-pressed="' + (ui.vista === v[0]) + '">' + esc(v[1]) + '</button>';
    }).join('');
    posicionarIndicador(seg);
  }

  function renderCapas() {
    var activo = ui.vista !== 'carteras';
    var defs = [['ma', 'Media de 200 días', activo], ['ops', 'Operaciones', true], ['dd', 'Caída desde máximos', true],
      ['exp', 'Exposición', true]];
    $('#capas').innerHTML = defs.map(function (d) {
      return '<button type="button" class="capa" data-capa="' + d[0] + '" aria-pressed="' + (!!ui.capas[d[0]] && d[2]) +
        '"' + (d[2] ? '' : ' aria-disabled="true" title="Solo con un activo seleccionado"') + '>' + d[1] + '</button>';
    }).join('');
  }

  /* --- Grafico (TradingView Lightweight Charts, version fijada en vendor/) --------------------------------- */

  function variable(n) { return getComputedStyle(doc.documentElement).getPropertyValue(n).trim(); }

  function opcionesTema() {
    return {
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: variable('--texto-2'),
        fontFamily: variable('--fuente') || 'sans-serif', attributionLogo: true },
      grid: { vertLines: { color: variable('--borde') }, horzLines: { color: variable('--borde') } },
      rightPriceScale: { borderColor: variable('--borde') }, timeScale: { borderColor: variable('--borde') },
      crosshair: { mode: 0, vertLine: { color: variable('--texto-2'), labelBackgroundColor: variable('--superficie-2') },
        horzLine: { color: variable('--texto-2'), labelBackgroundColor: variable('--superficie-2') } }
    };
  }

  function rangoDe(grupos, relleno) {
    var mn = Infinity, mx = -Infinity;
    grupos.forEach(function (g) { g.forEach(function (p) { if (p.value < mn) mn = p.value; if (p.value > mx) mx = p.value; }); });
    if (!isFinite(mn)) return null;
    var pad = (mx - mn || Math.abs(mx) || 1) * (relleno || 0.06);
    return { minValue: mn - pad, maxValue: mx + pad };
  }

  function crearGrafico() {
    var cont = $('#grafico');
    if (!root.LightweightCharts) { cont.textContent = 'No se pudo cargar la librería del gráfico.'; return null; }
    var chart = root.LightweightCharts.createChart(cont, Object.assign({ autoSize: true, handleScroll: false, handleScale: false }, opcionesTema()));
    var g = { chart: chart, lineas: {}, marcadores: [], rango: null, dd: null, exp: null, orden: [] };
    g.tooltip = $('#tooltip');
    chart.subscribeCrosshairMove(function (p) { moverTooltip(g, p); });
    chart.subscribeClick(function (p) {
      if (!p.time) return;
      var t = typeof p.time === 'string' ? p.time : null;
      var m = g.marcadores.filter(function (x) { return x.time === t; })[0];
      if (m) abrirLateral(m.orden);
    });
    root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      chart.applyOptions(opcionesTema()); dibujar(false);
    });
    return g;
  }

  function moverTooltip(g, p) {
    var tt = g.tooltip, marco = tt.parentNode;
    if (!p.point || !p.time || p.point.x < 0 || p.point.y < 0) { tt.classList.remove('visible'); return; }
    var filas = '';
    Object.keys(g.lineas).forEach(function (id) {
      var d = p.seriesData.get(g.lineas[id].serie);
      if (d && d.value != null) filas += '<div class="t-fila"><span>' + esc(g.lineas[id].nombre) + '</span><span class="num fuerte">' +
        fmt(d.value, 2) + '</span></div>';
    });
    if (g.dd) { var dd = p.seriesData.get(g.dd); if (dd) filas += '<div class="t-fila"><span>Caída</span><span class="num">' + pctFirmado(dd.value, 1) + '</span></div>'; }
    if (g.exp) { var ex = p.seriesData.get(g.exp); if (ex) filas += '<div class="t-fila"><span>Exposición</span><span class="num">' + pct(ex.value, 1) + '</span></div>'; }
    if (!filas) { tt.classList.remove('visible'); return; }
    tt.innerHTML = '<div class="t-fecha">' + fecha(p.time) + '</div>' + filas;
    var x = p.point.x + 14, y = p.point.y + 14;
    var w = tt.offsetWidth, h = tt.offsetHeight;
    if (x + w > marco.clientWidth) x = p.point.x - w - 14;
    if (y + h > marco.clientHeight) y = p.point.y - h - 14;
    tt.style.transform = 'translate(' + Math.max(0, x) + 'px,' + Math.max(0, y) + 'px)';
    tt.classList.add('visible');
  }

  function colorLinea(l) { return l.tema ? variable('--texto') : l.color; }

  function dibujar(animar) {
    if (!grafico) return;
    var g = grafico, chart = g.chart, d = Panel.seriesGrafico(ui.estado, ui.vista, ui.periodo, ui.capas);
    var aviso = $('#aviso-grafico');
    aviso.hidden = !d.aviso;
    aviso.innerHTML = d.aviso ? Panel.vacio('Sin gráfico', d.aviso) : '';
    // Lineas: se reutilizan las series para que el cambio de periodo o de activo no salte
    var ids = d.lineas.map(function (l) { return l.id; });
    Object.keys(g.lineas).forEach(function (id) {
      if (ids.indexOf(id) < 0) { chart.removeSeries(g.lineas[id].serie); delete g.lineas[id]; }
    });
    var rango = rangoDe(d.lineas.map(function (l) { return l.datos; }));
    g.rango = rango;
    d.lineas.forEach(function (l) {
      var s = g.lineas[l.id];
      if (!s) {
        s = g.lineas[l.id] = { serie: chart.addLineSeries({ lineWidth: l.grosor, priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerRadius: 4, autoscaleInfoProvider: function () { return g.rango ? { priceRange: g.rango } : null; } }) };
      }
      s.nombre = l.nombre;
      s.serie.applyOptions({ color: colorLinea(l), lineWidth: l.grosor, lineStyle: l.dash ? 2 : 0 });
    });
    // Capas secundarias en su propia escala, en la franja inferior
    function capa(clave, datos, opciones, escala) {
      if (g[clave]) { chart.removeSeries(g[clave]); g[clave] = null; }
      if (!datos || !datos.length) return;
      g[clave] = chart.addAreaSeries(Object.assign({ priceScaleId: escala, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false }, opciones));
      chart.priceScale(escala).applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
      g[clave].setData(datos);
    }
    capa('dd', d.caida, { lineColor: '#F04438', topColor: 'rgba(240,68,56,0.18)', bottomColor: 'rgba(240,68,56,0.02)' }, 'dd');
    capa('exp', d.exposicion, { lineColor: '#2E5BFF', topColor: 'rgba(46,91,255,0.16)', bottomColor: 'rgba(46,91,255,0.02)' }, 'exp');

    var primera = d.lineas[0];
    g.marcadores = d.marcadores;
    var cuando = animar && !reducido;
    d.lineas.forEach(function (l) {
      var s = g.lineas[l.id].serie;
      if (cuando) revelar(s, l.datos); else s.setData(l.datos);
    });
    if (primera && g.lineas[primera.id]) {
      g.lineas[primera.id].serie.setMarkers(d.marcadores.map(function (m) {
        return { time: m.time, position: m.position, shape: m.shape, color: m.color, text: m.text };
      }));
    }
    if (primera && primera.datos.length) {
      chart.timeScale().setVisibleRange({ from: primera.datos[0].time, to: primera.datos[primera.datos.length - 1].time });
    }
    renderLeyenda(d);
  }

  /* Entrada progresiva: se descubren los datos en pasos, con la escala ya fijada (sin saltos) */
  function revelar(serie, datos) {
    var n = datos.length, pasos = Math.min(18, n), i = 0;
    function paso() {
      i++;
      var k = Math.max(2, Math.round(n * (1 - Math.pow(1 - i / pasos, 3))));
      serie.setData(datos.slice(0, k));
      if (i < pasos) root.requestAnimationFrame(paso); else serie.setData(datos);
    }
    paso();
  }

  function renderLeyenda(d) {
    $('#leyenda').innerHTML = d.lineas.map(function (l) {
      return '<span><i style="background:' + esc(colorLinea(l)) + '"></i>' + esc(l.nombre) + '</span>';
    }).join('') + (d.marcadores.length ? '<span>▲ compra · ▼ venta (clic en la fecha para ver el detalle)</span>' : '');
  }

  function cambiarGrafico() {
    var cont = $('#grafico');
    if (reducido) { dibujar(false); return; }
    cont.classList.add('cambiando');
    root.requestAnimationFrame(function () { dibujar(false); root.requestAnimationFrame(function () { cont.classList.remove('cambiando'); }); });
  }

  /* --- Panel lateral ------------------------------------------------------------------------------------------ */

  var ultimoFoco = null;
  function abrirLateral(o) {
    var lat = $('#lateral');
    ultimoFoco = doc.activeElement;
    lat.innerHTML = contextoOrden(o);
    lat.classList.add('abierto'); $('#velo').classList.add('abierto');
    lat.setAttribute('aria-hidden', 'false');
    var cerrar = $('.cerrar', lat); if (cerrar) cerrar.focus();
  }
  function cerrarLateral() {
    var lat = $('#lateral');
    lat.classList.remove('abierto'); $('#velo').classList.remove('abierto');
    lat.setAttribute('aria-hidden', 'true');
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
  }

  /* --- Botones: reposo, cargando, ok --------------------------------------------------------------------------------- */

  function estadoBoton(b, estado) { b.setAttribute('data-estado-boton', estado); }
  function copiar(texto) {
    if (root.navigator.clipboard && root.isSecureContext) return root.navigator.clipboard.writeText(texto);
    return new Promise(function (ok, ko) {
      var t = doc.createElement('textarea'); t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
      doc.body.appendChild(t); t.select();
      try { doc.execCommand('copy') ? ok() : ko(new Error('copia no permitida')); } catch (x) { ko(x); } finally { doc.body.removeChild(t); }
    });
  }
  function anunciar(msg) { $('#anuncio').textContent = msg; }
  function alCopiar(b) {
    var etq = $('.etq', b), original = etq.textContent;
    estadoBoton(b, 'cargando'); etq.textContent = 'Copiando…';
    var texto = b.getAttribute('data-copy').replace(CONTROL, ' ');
    copiar(texto).then(function () {
      estadoBoton(b, 'ok'); etq.textContent = 'Copiado';
      anunciar('Copiado: ' + texto);
      root.setTimeout(function () { estadoBoton(b, 'reposo'); etq.textContent = original; }, 1600);
    }, function () {
      estadoBoton(b, 'reposo'); etq.textContent = 'No se pudo copiar';
      root.setTimeout(function () { etq.textContent = original; }, 1800);
    });
  }

  /* --- Pestanas del movil ---------------------------------------------------------------------------------------------- */

  var TABS = ['hoy', 'grafico', 'ordenes', 'equipo'];
  function ponerTab(t) {
    ui.tab = t; doc.body.setAttribute('data-tab', t);
    $$('.pestana').forEach(function (p) { p.setAttribute('aria-selected', String(p.getAttribute('data-tab') === t)); });
    $('.navegacion').style.setProperty('--i', String(TABS.indexOf(t)));
    if (t === 'grafico' && grafico) root.requestAnimationFrame(function () { grafico.chart.timeScale().fitContent(); dibujar(false); });
  }
  function cambiarTab(t) {
    if (doc.startViewTransition && !reducido) doc.startViewTransition(function () { ponerTab(t); });
    else ponerTab(t);
  }

  /* --- Carga y pintado -------------------------------------------------------------------------------------------------------- */

  function pintarTodo() {
    var r = Panel.renderTodo(ui.estado, Date.now());
    pintar($('#cabecera'), r.cabecera); pintar($('#espera'), r.espera); pintar($('#carteras'), r.carteras);
    pintar($('#activos'), r.activos); pintar($('#ordenes'), r.ordenes); pintar($('#riesgo'), r.riesgo);
    pintar($('#agentes'), r.agentes); pintar($('#ramas'), r.ramas); pintar($('#hitos'), r.hitos);
    $('#actualizado-pie').textContent = ui.estado ? 'Estado generado ' + (ui.estado.actualizado || '—') : 'Sin estado.json';
    renderVistas(); renderCapas(); renderPeriodos();
  }

  function cargar(manual) {
    var boton = $('#actualizar');
    if (boton) estadoBoton(boton, 'cargando');
    // ?estado=<ruta> solo para pruebas en local: en la pagina publicada se ignora, para que un
    // enlace trampa no pueda mostrar decisiones ajenas ni hacer copiar texto del atacante.
    var local = root.location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.location.hostname);
    var url = (local && new URLSearchParams(root.location.search).get('estado')) || URL_ESTADO;
    return root.fetch(url + (url.indexOf('?') < 0 ? '?t=' + Date.now() : ''), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        // decisiones.json y hitos.json viven junto a la pagina; si faltan, no pasa nada
        var pedir = function (f) { return root.fetch(f + '?t=' + Date.now(), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
        return Promise.all([pedir('decisiones.json'), pedir('hitos.json')]).then(function (x) {
          return Panel.completar(Panel.normalizar(j), { decisiones: x[0], hitos: x[1] });
        });
      })
      .then(function (j) {
        var primera = !ui.estado;
        ui.estado = j; pintarTodo();
        if (!grafico) grafico = crearGrafico();
        dibujar(primera);
        if (primera && grafico) { var c = $('#grafico'); c.classList.add('entrando'); root.requestAnimationFrame(function () { root.requestAnimationFrame(function () { c.classList.remove('entrando'); }); }); }
        $('#error').hidden = true;
        if (boton) { estadoBoton(boton, 'ok'); root.setTimeout(function () { estadoBoton(boton, 'reposo'); }, 1400); }
      })
      .catch(function (err) {
        var e = $('#error'); e.hidden = false;
        e.innerHTML = Panel.vacio('No se pudo cargar estado.json', String(err && err.message || err));
        if (!ui.estado) pintarTodo();
        if (boton) estadoBoton(boton, 'reposo');
      });
  }

  function iniciar() {
    // Eventos por delegacion
    doc.addEventListener('click', function (ev) {
      var t = ev.target.closest('button,[data-orden],a'); if (!t) return;
      if (t.hasAttribute('data-copy')) return alCopiar(t);
      if (t.hasAttribute('data-periodo')) { ui.periodo = t.getAttribute('data-periodo'); renderPeriodos(); return cambiarGrafico(); }
      if (t.hasAttribute('data-vista')) { ui.vista = t.getAttribute('data-vista'); renderVistas(); renderCapas(); return cambiarGrafico(); }
      if (t.hasAttribute('data-capa') && t.getAttribute('aria-disabled') !== 'true') {
        var c = t.getAttribute('data-capa'); ui.capas[c] = !ui.capas[c]; renderCapas(); return dibujar(false);
      }
      if (t.hasAttribute('data-tab')) return cambiarTab(t.getAttribute('data-tab'));
      if (t.hasAttribute('data-orden')) {
        var o = Panel.ordenesOrdenadas(ui.estado)[Number(t.getAttribute('data-orden'))]; if (o) abrirLateral(o); return;
      }
      if (t.getAttribute('data-accion') === 'cerrar-lateral') return cerrarLateral();
      if (t.id === 'actualizar') return cargar(true);
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') cerrarLateral();
      var fila = ev.target.closest && ev.target.closest('[data-orden]');
      if (fila && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); fila.click(); }
      var grupo = ev.target.closest && ev.target.closest('.seg,.navegacion');
      if (grupo && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
        var bs = $$('button', grupo), i = bs.indexOf(ev.target);
        var n = bs[(i + (ev.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length]; n.focus(); n.click();
      }
    });
    $('#velo').addEventListener('click', cerrarLateral);
    root.addEventListener('resize', function () { $$('.seg').forEach(posicionarIndicador); });
    root.setInterval(function () { if (!doc.hidden) cargar(false); }, 5 * 60 * 1000);
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) pintarTodo(); });
    ponerTab('hoy');
    renderPeriodos(); renderCapas(); renderVistas();
    cargar(false).then(function () {
      root.requestAnimationFrame(function () { $$('.seg,.navegacion').forEach(function (s) { s.classList.add('listo'); }); });
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(typeof window !== 'undefined' ? window : globalThis);
