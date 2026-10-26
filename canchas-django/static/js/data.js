/* =========================================================
   CanchApp - Capa de datos del frontend
   ---------------------------------------------------------
   Habla con el servidor Django (API JSON). Toda la información
   se guarda en la base de datos SQLite del servidor.

   - Store.db   : copia en memoria del "estado" que envía /api/estado/
   - accion()   : ejecuta una acción en el servidor (reservar, pagar...)
                  y actualiza Store.db con la respuesta.
   - Motor      : funciones del motor de reservas (llaman a la API).
   Las validaciones definitivas (conflictos, permisos, políticas)
   las hace siempre el servidor.
   ========================================================= */

/* ---------------- Utilidades de fecha y formato ---------------- */
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);

function fmtFecha(s, { corto = false } = {}) {
  const t = today();
  if (s === t) return 'Hoy';
  if (s === addDays(t, 1)) return 'Mañana';
  if (s === addDays(t, -1)) return 'Ayer';
  const d = parseYmd(s);
  return corto ? `${DIAS[d.getDay()]} ${d.getDate()}` : `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
}
function fmtFechaLarga(s) {
  const d = parseYmd(s);
  return `${DIAS_LARGO[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtHora(h) {
  const hh = Math.floor(h), mm = Math.round((h % 1) * 60);
  const suf = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${pad(mm)} ${suf}` : `${h12} ${suf}`;
}
const fmtRango = (h, dur) => `${fmtHora(h)} – ${fmtHora(h + dur)}`;
const fmtDur = d => d === 1 ? '1 hora' : (d % 1 ? `${d} h` : `${d} horas`);
const fmtCOP = n => '$' + Math.round(n || 0).toLocaleString('es-CO');
const fmtTs = ts => { const d = new Date(ts); return `${fmtFecha(ymd(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startTs = r => parseYmd(r.fecha).getTime() + r.hora * 3600000;
const endTs = r => startTs(r) + r.duracion * 3600000;
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
const genCodigo = () => 'CA-' + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(Math.random() * 90 + 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ESTADOS = {
  pendiente_pago: 'Pendiente de abono',
  confirmada: 'Confirmada',
  en_curso: 'En curso',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  liberada: 'Liberada',
};
const badge = estado => `<span class="badge b-${estado}">${ESTADOS[estado] || estado}</span>`;

const METODOS = {
  nequi: { label: 'Nequi', ico: '📱' },
  daviplata: { label: 'Daviplata', ico: '💳' },
  tarjeta: { label: 'Tarjeta', ico: '💳' },
  pse: { label: 'PSE', ico: '🏦' },
  efectivo: { label: 'Efectivo (caja)', ico: '💵' },
};
const TIPOS = { F5: { label: 'Fútbol 5', ico: '⚽' }, F7: { label: 'Fútbol 7', ico: '🥅' }, F8: { label: 'Fútbol 8', ico: '🏟️' } };
const SERVICIOS = {
  parqueadero: { label: 'Parqueadero', ico: '🚗' },
  agua: { label: 'Agua', ico: '💧' },
  balon: { label: 'Balón', ico: '⚽' },
  luz: { label: 'Luz nocturna', ico: '💡' },
  camerino: { label: 'Camerinos', ico: '🚿' },
  cafeteria: { label: 'Cafetería', ico: '☕' },
};


/* ---------------- Conexión con el servidor ---------------- */
function getCookie(nombre) {
  const m = document.cookie.match('(^|;)\\s*' + nombre + '\\s*=\\s*([^;]+)');
  return m ? decodeURIComponent(m.pop()) : '';
}
const SIN_SERVIDOR = 'No hay conexión con el servidor. ¿Está corriendo "python manage.py runserver"?';

async function apiFetch(url, opciones = {}) {
  let res;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...opciones,
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken'), ...(opciones.headers || {}) },
    });
  } catch (e) {
    return { ok: false, error: SIN_SERVIDOR };
  }
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, error: `Error del servidor (${res.status}).` }; }
  if (res.status === 401 && location.pathname !== '/') { location.href = '/'; }
  return data;
}

/** Ejecuta una acción del sistema en el servidor y actualiza el estado local */
async function accion(nombre, datos = {}) {
  const d = await apiFetch(`/api/accion/${nombre}/`, { method: 'POST', body: JSON.stringify(datos) });
  if (d.relogin) { location.href = '/'; return d; }
  if (d.estado) Store.set(d.estado);
  return d;
}

/* ---------------- Estado en memoria ---------------- */
const Store = (() => {
  let db = null;
  const oyentes = [];
  return {
    get db() { return db; },
    set(estado) { db = estado; oyentes.forEach(fn => fn(db)); },
    onChange(fn) { oyentes.push(fn); },
    /** Vuelve a pedir el estado al servidor (el servidor aplica antes las reglas automáticas) */
    async sync() {
      const d = await apiFetch('/api/estado/');
      if (d.ok) this.set(d.estado);
      return d.ok;
    },
  };
})();

/* ---------------- Sesión ---------------- */
const Auth = {
  async login(email, password) {
    return apiFetch('/api/login/', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  async register(datos) {
    return apiFetch('/api/registro/', { method: 'POST', body: JSON.stringify(datos) });
  },
  async logout() {
    await apiFetch('/api/logout/', { method: 'POST' });
    location.href = '/';
  },
  /** Carga el estado; si no hay sesión o el rol no corresponde, redirige */
  async require(roles) {
    const d = await apiFetch('/api/estado/');
    if (!d.ok) {
      if (d.error === SIN_SERVIDOR) document.body.innerHTML = `<div class="empty"><div class="big">🔌</div>${SIN_SERVIDOR}</div>`;
      else location.href = '/';
      return null;
    }
    Store.set(d.estado);
    const yo = d.estado.yo;
    if (!roles.includes(yo.rol)) { location.href = yo.rol === 'jugador' ? '/jugador/' : '/panel/'; return null; }
    return yo;
  },
  paginaDe: rol => rol === 'jugador' ? '/jugador/' : '/panel/',
};

/* ---------------- Consultas ---------------- */
const getCancha = id => Store.db.canchas.find(c => c.id === id);
const getSede = id => Store.db.sedes.find(s => s.id === id);
const getUser = id => Store.db.usuarios.find(u => u.id === id);
const getReserva = id => Store.db.reservas.find(r => r.id === id);
const nombreCancha = c => { c = typeof c === 'string' ? getCancha(c) : c; return c ? `${getSede(c.sedeId)?.nombre || ''} · ${c.nombre}` : '—'; };
const clienteReserva = r => r.nombreCliente || getUser(r.usuarioId)?.nombre || '—';
const precioHora = (c, h) => h >= Store.db.reglas.nocheDesde ? c.precioNoche : c.precioDia;
function calcular(c, hora, dur) {
  const total = precioHora(c, hora) * dur;
  const abono = Math.round(total * Store.db.reglas.abonoPct / 100 / 100) * 100;
  return { total, abono, saldo: total - abono };
}
function bloquea(r) {
  if (r.estado === 'pendiente_pago') return r.venceEn > Date.now();
  return ['confirmada', 'en_curso', 'finalizada'].includes(r.estado);
}
function conflicto(canchaId, fecha, hora, dur, excludeId) {
  return Store.db.reservas.find(r => r.id !== excludeId && r.canchaId === canchaId && r.fecha === fecha && bloquea(r) && hora < r.hora + r.duracion && r.hora < hora + dur) || null;
}
function horasCancha(c) { const hs = []; for (let h = c.apertura; h < c.cierre; h++) hs.push(h); return hs; }
function estadoFranja(c, fecha, hora, dur = 1) {
  if (hora + dur > c.cierre) return { libre: false, motivo: 'Cierre' };
  const ts = parseYmd(fecha).getTime() + hora * 3600000;
  if (ts < Date.now()) return { libre: false, motivo: 'Pasada' };
  if (c.mantenimiento) return { libre: false, motivo: 'Mantenimiento' };
  const r = conflicto(c.id, fecha, hora, dur);
  if (r) return { libre: false, motivo: r.estado === 'pendiente_pago' ? 'En proceso' : 'Ocupado', reserva: r };
  return { libre: true };
}
const reservasDeUsuario = uidv => Store.db.reservas.filter(r => r.usuarioId === uidv).sort((a, b) => startTs(a) - startTs(b));
const misFavoritas = uidv => (Store.db.favoritas[uidv] || []);
/** Marca/desmarca favorita. Responde de inmediato y guarda en el servidor en segundo plano. */
function toggleFavorita(uidv, canchaId) {
  const f = Store.db.favoritas[uidv] = Store.db.favoritas[uidv] || [];
  const i = f.indexOf(canchaId);
  if (i >= 0) f.splice(i, 1); else f.push(canchaId);
  accion('favorita', { canchaId }).then(d => { if (!d.ok) toast(d.error, 'err'); });
  return i < 0;
}

/* ---------------- Motor de reservas (cliente de la API) ---------------- */
const res = d => d.ok ? d : { error: d.error || 'Ocurrió un error.' };
const Motor = {
  // --- Acciones (se ejecutan y validan en el servidor) ---
  async bloquear(usuarioId, canchaId, fecha, hora, duracion) {
    const d = res(await accion('bloquear', { canchaId, fecha, hora, duracion }));
    return d.error ? d : { reserva: getReserva(d.reservaId) };
  },
  async soltar(id) { return res(await accion('soltar', { id })); },
  async pagarAbono(id, metodo, guardarMetodo = false) {
    const d = res(await accion('pagarAbono', { id, metodo, guardarMetodo }));
    return d.error ? d : { reserva: getReserva(id) };
  },
  async pagarSaldo(id, metodo) { return res(await accion('pagarSaldo', { id, metodo })); },
  async cancelar(id) { return res(await accion('cancelar', { id })); },
  async reprogramar(id, fecha, hora) { return res(await accion('reprogramar', { id, fecha, hora })); },
  async confirmarAsistencia(id) { return res(await accion('confirmarAsistencia', { id })); },
  async calificar(id, estrellas) { return res(await accion('calificar', { id, estrellas })); },
  async unirseEspera(usuarioId, canchaId, fecha, hora) { return res(await accion('unirseEspera', { canchaId, fecha, hora })); },
  async checkIn(codigo) {
    const d = res(await accion('checkIn', { codigo }));
    return d.error ? d : { reserva: getReserva(d.reservaId) };
  },
  async finalizar(id) { return res(await accion('finalizar', { id })); },
  async validarPago(id) { return res(await accion('validarPago', { id })); },
  async reactivar(id, cambios = {}) { return res(await accion('reactivar', { id, ...cambios })); },
  async crearManual(datos) {
    const d = res(await accion('crearManual', datos));
    return d.error ? d : { reserva: getReserva(d.reservaId) || { codigo: d.codigo } };
  },
  async avisarEspera(canchaId, fecha, hora) { return res(await accion('notificarEspera', { canchaId, fecha, hora })); },
  async cerrarCaja(fecha) { return res(await accion('cerrarCaja', { fecha })); },
  async ejecutarTareas() { return res(await accion('ejecutarTareas')); },

  // --- Cálculos de solo lectura (para mostrar en pantalla) ---
  politica(r) {
    const horas = (startTs(r) - Date.now()) / 3600000;
    const R = Store.db.reglas;
    const pct = horas >= R.cancelacionHoras ? 100 : R.reembolsoPct;
    return { horas, pct, reembolso: r.abonoPagado ? Math.round(r.abono * pct / 100) : 0 };
  },

  resumenCaja(fecha) {
    const pagos = Store.db.pagos.filter(p => p.fecha === fecha);
    const porMetodo = {};
    pagos.forEach(p => { porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + p.monto; });
    const total = pagos.reduce((s, p) => s + p.monto, 0);
    const pendientes = pagos.filter(p => !p.validado);
    return { pagos, porMetodo, total, pendientes, cerrado: Store.db.cierres.find(c => c.fecha === fecha) };
  },

  reporte(desde, hasta, sedeId) {
    const canchas = Store.db.canchas.filter(c => !sedeId || c.sedeId === sedeId);
    const ids = new Set(canchas.map(c => c.id));
    const dias = [];
    for (let d = desde; d <= hasta; d = addDays(d, 1)) dias.push(d);
    const porDia = dias.map(fecha => {
      const rs = Store.db.reservas.filter(r => r.fecha === fecha && ids.has(r.canchaId) && ['confirmada', 'en_curso', 'finalizada'].includes(r.estado));
      const horas = rs.reduce((s, r) => s + r.duracion, 0);
      const disp = canchas.reduce((s, c) => s + (c.cierre - c.apertura), 0);
      const ingresos = Store.db.pagos.filter(p => p.fecha === fecha && ids.has(getReserva(p.reservaId)?.canchaId)).reduce((s, p) => s + p.monto, 0);
      return { fecha, reservas: rs.length, horas, disp, ocupacion: disp ? Math.round(horas / disp * 100) : 0, ingresos };
    });
    const porCancha = canchas.map(c => {
      const rs = Store.db.reservas.filter(r => r.canchaId === c.id && r.fecha >= desde && r.fecha <= hasta && ['confirmada', 'en_curso', 'finalizada'].includes(r.estado));
      const horas = rs.reduce((s, r) => s + r.duracion, 0);
      const disp = (c.cierre - c.apertura) * dias.length;
      const ingresos = Store.db.pagos.filter(p => p.fecha >= desde && p.fecha <= hasta && getReserva(p.reservaId)?.canchaId === c.id).reduce((s, p) => s + p.monto, 0);
      const canceladas = Store.db.reservas.filter(r => r.canchaId === c.id && r.fecha >= desde && r.fecha <= hasta && r.estado === 'cancelada').length;
      const liberadas = Store.db.reservas.filter(r => r.canchaId === c.id && r.fecha >= desde && r.fecha <= hasta && r.estado === 'liberada').length;
      return { cancha: c, reservas: rs.length, horas, ocupacion: disp ? Math.round(horas / disp * 100) : 0, ingresos, canceladas, liberadas };
    });
    const porHora = {};
    Store.db.reservas.filter(r => ids.has(r.canchaId) && r.fecha >= desde && r.fecha <= hasta && ['confirmada', 'en_curso', 'finalizada'].includes(r.estado))
      .forEach(r => { porHora[r.hora] = (porHora[r.hora] || 0) + 1; });
    return { dias, porDia, porCancha, porHora };
  },
};

/* ---------------- UI compartida ---------------- */
function toast(msg, type = '') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3200);
}

function openModal(html, { wide = false, onClose } = {}) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back'; back.id = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('click', e => { if (e.target === back) { closeModal(); onClose && onClose(); } });
  document.body.appendChild(back);
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { closeModal(); onClose && onClose(); }));
  return back.querySelector('.modal');
}
function closeModal() { document.getElementById('modal-back')?.remove(); }

function confirmar(titulo, texto, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    const m = openModal(`
      <h3>${titulo}</h3><p class="muted">${texto}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="no">Volver</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="si">${ok}</button>
      </div>`, { onClose: () => resolve(false) });
    m.querySelector('[data-act=no]').onclick = () => { closeModal(); resolve(false); };
    m.querySelector('[data-act=si]').onclick = () => { closeModal(); resolve(true); };
  });
}

function renderQR(el, text, size = 180) {
  el.innerHTML = '';
  if (window.QRCode) {
    new QRCode(el, { text, width: size, height: size, colorDark: '#1d1b2b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } else {
    el.innerHTML = `<div style="width:${size}px;height:${size}px;border:2px dashed #ccc;border-radius:12px;display:grid;place-items:center;color:#999;font-size:12px;padding:10px">QR no disponible sin internet.<br>Muestra el código.</div>`;
  }
}

function descargar(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + contenido], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* Íconos SVG simples (trazo) */
const I = (() => {
  const s = p => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  return {
    home: s('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    pin: s('<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    heart: s('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
    user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    search: s('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    bell: s('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
    out: s('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
    grid: s('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    cal: s('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    cash: s('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
    building: s('<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4"/>'),
    gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    list: s('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    chart: s('<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>'),
    help: s('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'),
    menu: s('<path d="M3 6h18M3 12h18M3 18h18"/>'),
    qr: s('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
    back: s('<path d="m15 18-6-6 6-6"/>'),
    bolt: s('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  };
})();
