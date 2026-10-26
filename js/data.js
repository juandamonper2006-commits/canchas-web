/* =========================================================
   CanchApp - Capa de datos y motor de reservas
   ---------------------------------------------------------
   Simula el backend del sistema (base de datos + motor de
   reservas + tareas programadas tipo Celery/Redis) usando
   localStorage. Lo comparten el portal del jugador y el
   panel del administrador, así un cambio en uno se ve en el otro.
   ========================================================= */

const DB_KEY = 'canchapp_db_v1';
const SESSION_KEY = 'canchapp_session';

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

/* ---------------- Datos semilla ---------------- */
function rng(seed) { // mulberry32: aleatorio reproducible
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seed() {
  const t = today();
  const now = Date.now();
  const R = rng(20261026);
  const pick = arr => arr[Math.floor(R() * arr.length)];

  const db = {
    version: 1,
    reglas: {
      abonoPct: 30,
      minutosLiberacion: 15,
      recordatorio24: true,
      recordatorio2: true,
      canalWhatsapp: true,
      canalEmail: true,
      cancelacionHoras: 24,
      reembolsoPct: 50,
      nocheDesde: 18,
      alertasMantenimiento: true,
      liberacionAutomatica: true,
    },
    sedes: [
      { id: 's1', nombre: 'Sede Norte', direccion: 'Calle 170 #20-15, Bogotá', telefono: '601 555 0101' },
      { id: 's2', nombre: 'Sede Centro', direccion: 'Cra 7 #32-10, Bogotá', telefono: '601 555 0202' },
      { id: 's3', nombre: 'Sede Sur', direccion: 'Av. Boyacá #58-20 Sur, Bogotá', telefono: '601 555 0303' },
    ],
    canchas: [
      { id: 'c1', sedeId: 's1', nombre: 'Cancha 1', tipo: 'F7', precioDia: 100000, precioNoche: 120000, apertura: 8, cierre: 23, rating: 4.8, votos: 64, activa: true, mantenimiento: false, servicios: ['parqueadero', 'agua', 'balon', 'luz'], descripcion: 'Cancha sintética cómoda y bien iluminada, ideal para un partido entre amigos o para entrenar. Reserva con un abono del 30 % y paga el saldo en la sede.' },
      { id: 'c2', sedeId: 's1', nombre: 'Cancha 2', tipo: 'F5', precioDia: 75000, precioNoche: 90000, apertura: 8, cierre: 23, rating: 4.6, votos: 41, activa: true, mantenimiento: false, servicios: ['parqueadero', 'agua', 'luz'], descripcion: 'Cancha de fútbol 5 con grama de última generación y malla perimetral completa.' },
      { id: 'c3', sedeId: 's2', nombre: 'Cancha 1', tipo: 'F8', precioDia: 95000, precioNoche: 110000, apertura: 7, cierre: 22, rating: 4.7, votos: 52, activa: true, mantenimiento: false, servicios: ['agua', 'balon', 'luz', 'camerino'], descripcion: 'La cancha más grande de la sede, perfecta para fútbol 8 con camerinos y duchas.' },
      { id: 'c4', sedeId: 's2', nombre: 'Cancha 2', tipo: 'F5', precioDia: 70000, precioNoche: 85000, apertura: 7, cierre: 22, rating: 4.5, votos: 30, activa: true, mantenimiento: false, servicios: ['agua', 'luz', 'cafeteria'], descripcion: 'Cancha techada de fútbol 5, se juega aunque llueva.' },
      { id: 'c5', sedeId: 's3', nombre: 'Cancha 1', tipo: 'F5', precioDia: 65000, precioNoche: 80000, apertura: 8, cierre: 22, rating: 4.4, votos: 22, activa: true, mantenimiento: false, servicios: ['parqueadero', 'luz'], descripcion: 'Cancha económica de fútbol 5 en el sur de la ciudad.' },
      { id: 'c6', sedeId: 's3', nombre: 'Cancha 2', tipo: 'F7', precioDia: 95000, precioNoche: 115000, apertura: 8, cierre: 22, rating: 4.6, votos: 35, activa: true, mantenimiento: false, servicios: ['parqueadero', 'agua', 'balon', 'luz', 'camerino'], descripcion: 'Fútbol 7 con tribuna para acompañantes y parqueadero amplio.' },
    ],
    usuarios: [
      { id: 'u1', nombre: 'Admin Canchas', email: 'admin@canchas.com', password: 'admin123', rol: 'admin', telefono: '300 000 0000', activo: true },
      { id: 'u2', nombre: 'Andrés Martínez', email: 'andres@correo.com', password: '1234', rol: 'jugador', telefono: '310 555 1234', grupo: 'Los Parceros FC', integrantes: 12, activo: true },
      { id: 'u3', nombre: 'Dilan González', email: 'dilan@correo.com', password: '1234', rol: 'jugador', telefono: '311 555 2222', grupo: 'Dilan & amigos', integrantes: 10, activo: true },
      { id: 'u4', nombre: 'Laura Pérez', email: 'laura@correo.com', password: '1234', rol: 'jugador', telefono: '312 555 3333', activo: true },
      { id: 'u5', nombre: 'Carlos Ruiz', email: 'carlos@correo.com', password: '1234', rol: 'jugador', telefono: '313 555 4444', activo: true },
      { id: 'u6', nombre: 'Camila Torres', email: 'camila@correo.com', password: '1234', rol: 'jugador', telefono: '314 555 5555', activo: true },
      { id: 'u7', nombre: 'Recepción Norte', email: 'recepcion@canchas.com', password: 'recep123', rol: 'recepcion', telefono: '300 111 2222', activo: true },
    ],
    reservas: [],
    pagos: [],
    listaEspera: [],
    notificaciones: [],
    favoritas: { u2: ['c1', 'c3'], u3: ['c2'] },
    cierres: [],
    log: [],
    metodosGuardados: { u2: ['nequi'] },
  };

  const metodos = ['nequi', 'daviplata', 'tarjeta', 'pse'];
  const precio = (c, h) => h >= db.reglas.nocheDesde ? c.precioNoche : c.precioDia;

  function add(r) {
    const c = db.canchas.find(x => x.id === r.canchaId);
    const total = precio(c, r.hora) * r.duracion;
    const abono = Math.round(total * db.reglas.abonoPct / 100 / 100) * 100;
    const res = Object.assign({
      id: uid('r'), codigo: genCodigo(), duracion: 1, total, abono, saldo: total - abono,
      abonoPagado: true, saldoPagado: false, asistenciaConfirmada: false, calificacion: 0,
      origen: 'app', recordatorios: { r24: false, r2: false }, creadoEn: now - 86400000 * 3, metodo: pick(metodos),
    }, r);
    res.total = precio(c, res.hora) * res.duracion;
    res.abono = Math.round(res.total * db.reglas.abonoPct / 100 / 100) * 100;
    res.saldo = res.total - res.abono;
    db.reservas.push(res);
    if (res.abonoPagado) db.pagos.push({ id: uid('p'), reservaId: res.id, monto: res.abono, tipo: 'abono', metodo: res.metodo, fecha: res.pagoFecha || addDays(res.fecha, -1), ts: res.creadoEn, validado: r.validado !== false });
    if (res.saldoPagado) db.pagos.push({ id: uid('p'), reservaId: res.id, monto: res.saldo, tipo: 'saldo', metodo: R() > .5 ? 'efectivo' : pick(metodos), fecha: res.fecha, ts: startTs(res), validado: true });
    return res;
  }
  const libre = (canchaId, fecha, hora, dur) => !db.reservas.some(r => r.canchaId === canchaId && r.fecha === fecha && ['pendiente_pago', 'confirmada', 'en_curso', 'finalizada'].includes(r.estado) && hora < r.hora + r.duracion && r.hora < hora + dur);

  // --- Reservas fijas del jugador demo (como en el video) ---
  add({ usuarioId: 'u2', canchaId: 'c1', fecha: t, hora: 21, duracion: 1, estado: 'confirmada', metodo: 'nequi', asistenciaConfirmada: true });
  const sab = (() => { let d = t; for (let i = 1; i <= 7; i++) { d = addDays(t, i); if (parseYmd(d).getDay() === 6) return d; } return addDays(t, 5); })();
  add({ usuarioId: 'u2', canchaId: 'c3', fecha: sab, hora: 20, duracion: 1, estado: 'confirmada', metodo: 'nequi' });
  add({ usuarioId: 'u2', canchaId: 'c4', fecha: addDays(t, -36), hora: 19, duracion: 1, estado: 'finalizada', saldoPagado: true, calificacion: 5, metodo: 'nequi' });
  add({ usuarioId: 'u2', canchaId: 'c1', fecha: addDays(t, -7), hora: 21, duracion: 1, estado: 'finalizada', saldoPagado: true, metodo: 'nequi' });
  add({ usuarioId: 'u2', canchaId: 'c1', fecha: addDays(t, -14), hora: 21, duracion: 1, estado: 'finalizada', saldoPagado: true, calificacion: 4, metodo: 'nequi' });

  // --- Historial de los últimos 30 días (para reportes) ---
  for (let d = -30; d <= -1; d++) {
    const fecha = addDays(t, d);
    const dow = parseYmd(fecha).getDay();
    const n = (dow === 5 || dow === 6 ? 24 : dow === 0 ? 16 : 12) + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) {
      const c = pick(db.canchas);
      const hora = R() < .65 ? 17 + Math.floor(R() * 5) : c.apertura + Math.floor(R() * 9);
      const dur = R() < .8 ? 1 : 2;
      if (hora + dur > c.cierre || !libre(c.id, fecha, hora, dur)) continue;
      const cancel = R() < .06;
      add({ usuarioId: pick(['u3', 'u4', 'u5', 'u6']), canchaId: c.id, fecha, hora, duracion: dur, estado: cancel ? 'cancelada' : 'finalizada', saldoPagado: !cancel, abonoPagado: true, calificacion: !cancel && R() < .4 ? 4 + Math.round(R()) : 0, creadoEn: parseYmd(fecha).getTime() - 86400000 });
    }
  }

  // --- Agenda de hoy ---
  const hNow = new Date().getHours();
  const hoyPlan = [
    { c: 'c1', h: 18, u: 'u3' }, { c: 'c1', h: 19, u: 'u4' }, { c: 'c1', h: 20, u: 'u5' },
    { c: 'c2', h: 17, u: 'u6' }, { c: 'c2', h: 19, u: 'u3', dur: 2 }, { c: 'c2', h: 10, u: 'u5' },
    { c: 'c3', h: 18, u: 'u4' }, { c: 'c3', h: 20, u: 'u6' }, { c: 'c4', h: 19, u: 'u5' },
    { c: 'c5', h: 20, u: 'u3' }, { c: 'c6', h: 19, u: 'u4' }, { c: 'c6', h: 9, u: 'u6' },
  ];
  hoyPlan.forEach((p, i) => {
    const dur = p.dur || 1;
    let estado = 'confirmada', saldoPagado = false;
    if (p.h + dur <= hNow) { estado = 'finalizada'; saldoPagado = true; }
    else if (p.h <= hNow) { estado = 'en_curso'; saldoPagado = true; }
    add({ usuarioId: p.u, canchaId: p.c, fecha: t, hora: p.h, duracion: dur, estado, saldoPagado, pagoFecha: t, creadoEn: now - 3600000 * (i + 2), validado: i % 4 !== 0 });
  });
  // Reserva pendiente de abono (bloqueo temporal activo)
  add({ usuarioId: 'u5', canchaId: 'c4', fecha: t, hora: 21, duracion: 1, estado: 'pendiente_pago', abonoPagado: false, creadoEn: now - 4 * 60000, venceEn: now + 11 * 60000 });
  // Franja liberada por falta de abono (para demostrar "Reactivar")
  add({ usuarioId: 'u6', canchaId: 'c3', fecha: t, hora: 21, duracion: 1, estado: 'liberada', abonoPagado: false, creadoEn: now - 50 * 60000, venceEn: now - 35 * 60000, liberadaEn: now - 35 * 60000 });

  // --- Próximos días ---
  for (let d = 1; d <= 6; d++) {
    const fecha = addDays(t, d);
    const n = 4 + Math.floor(R() * 5);
    for (let i = 0; i < n; i++) {
      const c = pick(db.canchas);
      const hora = 17 + Math.floor(R() * 5);
      if (hora + 1 > c.cierre || !libre(c.id, fecha, hora, 1)) continue;
      add({ usuarioId: pick(['u3', 'u4', 'u5', 'u6']), canchaId: c.id, fecha, hora, duracion: 1, estado: 'confirmada', pagoFecha: t, creadoEn: now - 3600000 * (i + 1), validado: R() > .25 });
    }
  }

  // Lista de espera
  db.listaEspera.push(
    { id: uid('w'), usuarioId: 'u4', canchaId: 'c1', fecha: t, hora: 19, creadoEn: now - 7200000, notificado: false },
    { id: uid('w'), usuarioId: 'u2', canchaId: 'c1', fecha: t, hora: 20, creadoEn: now - 5400000, notificado: false },
    { id: uid('w'), usuarioId: 'u3', canchaId: 'c1', fecha: t, hora: 20, creadoEn: now - 1800000, notificado: false },
  );

  db.notificaciones.push(
    { id: uid('n'), usuarioId: 'u2', texto: '✅ Reserva confirmada en Sede Norte · Cancha 1 para hoy a las 9 pm.', ts: now - 86400000, leida: true },
    { id: uid('n'), usuarioId: 'u2', texto: '⏰ Recordatorio: hoy juegas a las 9 pm en Sede Norte · Cancha 1. ¿Confirmas asistencia?', ts: now - 3600000, leida: false },
  );
  db.log.push({ ts: now, msg: 'Base de datos inicializada con datos de ejemplo.' });
  return db;
}

/* ---------------- Store ---------------- */
const Store = (() => {
  let db = null;
  function load() {
    try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { db = null; }
    if (!db || !db.version) { db = seed(); save(); }
    return db;
  }
  function save() { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* almacenamiento no disponible */ } }
  function reset() { db = seed(); save(); }
  load();
  return { get db() { return db; }, load, save, reset };
})();

/* ---------------- Sesión ---------------- */
const Auth = {
  login(email, password) {
    const u = Store.db.usuarios.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase() && x.password === password && x.activo !== false);
    if (u) { try { localStorage.setItem(SESSION_KEY, u.id); } catch (e) {} }
    return u || null;
  },
  register({ nombre, email, password, telefono }) {
    if (Store.db.usuarios.some(x => x.email.toLowerCase() === email.toLowerCase())) return { error: 'Ya existe una cuenta con ese correo.' };
    const u = { id: uid('u'), nombre, email, password, telefono: telefono || '', rol: 'jugador', activo: true };
    Store.db.usuarios.push(u); Store.save();
    try { localStorage.setItem(SESSION_KEY, u.id); } catch (e) {}
    notify(u.id, `👋 ¡Bienvenido a CanchApp, ${nombre.split(' ')[0]}! Reserva tu primera cancha.`);
    return { user: u };
  },
  current() {
    let id = null; try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
    return Store.db.usuarios.find(u => u.id === id) || null;
  },
  logout() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} location.href = 'index.html'; },
  require(roles) {
    const u = this.current();
    if (!u || !roles.includes(u.rol)) { location.href = 'index.html'; return null; }
    return u;
  },
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
function toggleFavorita(uidv, canchaId) {
  const f = Store.db.favoritas[uidv] = Store.db.favoritas[uidv] || [];
  const i = f.indexOf(canchaId);
  if (i >= 0) f.splice(i, 1); else f.push(canchaId);
  Store.save();
  return i < 0;
}

/* ---------------- Notificaciones y log ---------------- */
function notify(usuarioId, texto) {
  if (!usuarioId) return;
  Store.db.notificaciones.push({ id: uid('n'), usuarioId, texto, ts: Date.now(), leida: false });
}
function logTarea(msg) {
  Store.db.log.push({ ts: Date.now(), msg });
  if (Store.db.log.length > 200) Store.db.log.splice(0, Store.db.log.length - 200);
}

/* ---------------- Motor de reservas ---------------- */
const Motor = {
  /** Paso 1 del flujo: bloqueo temporal (soft-lock) de la franja mientras se paga */
  bloquear(usuarioId, canchaId, fecha, hora, duracion) {
    const c = getCancha(canchaId);
    const st = estadoFranja(c, fecha, hora, duracion);
    if (!st.libre) return { error: st.motivo === 'En proceso' ? 'Otro jugador está pagando esta franja en este momento.' : 'La franja ya no está disponible.' };
    const p = calcular(c, hora, duracion);
    const r = {
      id: uid('r'), codigo: genCodigo(), usuarioId, canchaId, fecha, hora, duracion, ...p,
      estado: 'pendiente_pago', abonoPagado: false, saldoPagado: false, asistenciaConfirmada: false, calificacion: 0,
      origen: 'app', recordatorios: { r24: false, r2: false }, creadoEn: Date.now(),
      venceEn: Date.now() + Store.db.reglas.minutosLiberacion * 60000,
    };
    Store.db.reservas.push(r); Store.save();
    return { reserva: r };
  },

  pagarAbono(resId, metodo) {
    const r = getReserva(resId);
    if (!r) return { error: 'Reserva no encontrada.' };
    if (r.estado !== 'pendiente_pago') return { error: 'Esta reserva ya no está pendiente de pago.' };
    if (r.venceEn < Date.now()) { this.liberar(r, 'Plazo de pago vencido'); Store.save(); return { error: 'El tiempo para pagar venció y la franja fue liberada.' }; }
    r.estado = 'confirmada'; r.abonoPagado = true; r.metodo = metodo;
    Store.db.pagos.push({ id: uid('p'), reservaId: r.id, monto: r.abono, tipo: 'abono', metodo, fecha: today(), ts: Date.now(), validado: false });
    notify(r.usuarioId, `✅ ¡Reserva confirmada! ${nombreCancha(r.canchaId)} · ${fmtFecha(r.fecha)} ${fmtHora(r.hora)}. Código ${r.codigo}.`);
    Store.save();
    return { reserva: r };
  },

  pagarSaldo(resId, metodo) {
    const r = getReserva(resId);
    if (!r || r.saldoPagado) return { error: 'No hay saldo pendiente.' };
    r.saldoPagado = true;
    Store.db.pagos.push({ id: uid('p'), reservaId: r.id, monto: r.saldo, tipo: 'saldo', metodo, fecha: today(), ts: Date.now(), validado: metodo === 'efectivo' });
    notify(r.usuarioId, `💰 Pagaste el saldo de ${fmtCOP(r.saldo)} de tu reserva ${r.codigo}.`);
    Store.save();
    return { reserva: r };
  },

  politica(r) {
    const horas = (startTs(r) - Date.now()) / 3600000;
    const R = Store.db.reglas;
    const pct = horas >= R.cancelacionHoras ? 100 : R.reembolsoPct;
    return { horas, pct, reembolso: r.abonoPagado ? Math.round(r.abono * pct / 100) : 0 };
  },

  cancelar(resId, por = 'jugador') {
    const r = getReserva(resId);
    if (!r || !['pendiente_pago', 'confirmada'].includes(r.estado)) return { error: 'No se puede cancelar esta reserva.' };
    const pol = this.politica(r);
    r.estado = 'cancelada'; r.canceladaEn = Date.now(); r.reembolso = pol.reembolso; r.canceladaPor = por;
    if (pol.reembolso > 0) Store.db.pagos.push({ id: uid('p'), reservaId: r.id, monto: -pol.reembolso, tipo: 'reembolso', metodo: r.metodo || 'nequi', fecha: today(), ts: Date.now(), validado: true });
    notify(r.usuarioId, `❌ Reserva ${r.codigo} cancelada. Reembolso: ${fmtCOP(pol.reembolso)} (${pol.pct}%).`);
    this.avisarEspera(r.canchaId, r.fecha, r.hora, r.duracion);
    Store.save();
    return { reserva: r, ...pol };
  },

  reprogramar(resId, fecha, hora) {
    const r = getReserva(resId);
    if (!r || r.estado !== 'confirmada') return { error: 'Solo se pueden reprogramar reservas confirmadas.' };
    const c = getCancha(r.canchaId);
    const ts = parseYmd(fecha).getTime() + hora * 3600000;
    if (ts < Date.now()) return { error: 'Elige una franja futura.' };
    if (hora + r.duracion > c.cierre) return { error: 'La franja pasa del horario de cierre.' };
    if (conflicto(r.canchaId, fecha, hora, r.duracion, r.id)) return { error: 'Esa franja ya está ocupada.' };
    const old = { fecha: r.fecha, hora: r.hora };
    const p = calcular(c, hora, r.duracion);
    r.fecha = fecha; r.hora = hora; r.total = p.total; r.saldo = p.total - r.abono;
    r.recordatorios = { r24: false, r2: false }; r.asistenciaConfirmada = false;
    notify(r.usuarioId, `🔁 Reserva ${r.codigo} reprogramada para ${fmtFecha(fecha)} a las ${fmtHora(hora)}.`);
    this.avisarEspera(r.canchaId, old.fecha, old.hora, r.duracion);
    Store.save();
    return { reserva: r };
  },

  confirmarAsistencia(resId) {
    const r = getReserva(resId); if (!r) return;
    r.asistenciaConfirmada = true; Store.save();
  },

  checkIn(codigoOrId) {
    const q = String(codigoOrId).trim().toUpperCase();
    const r = Store.db.reservas.find(x => x.codigo === q || x.id === codigoOrId);
    if (!r) return { error: 'Código QR no válido. Verifica manualmente la reserva.' };
    if (r.estado !== 'confirmada') return { error: `La reserva está en estado "${ESTADOS[r.estado]}".` };
    if (r.fecha !== today()) return { error: `La reserva es para ${fmtFecha(r.fecha)}, no para hoy.` };
    r.estado = 'en_curso'; r.checkInEn = Date.now();
    logTarea(`Check-in ${r.codigo} · ${nombreCancha(r.canchaId)} ${fmtHora(r.hora)}`);
    Store.save();
    return { reserva: r };
  },

  finalizar(resId) {
    const r = getReserva(resId); if (!r) return;
    r.estado = 'finalizada'; Store.save();
    notify(r.usuarioId, `⭐ ¿Qué tal el partido en ${nombreCancha(r.canchaId)}? Califícalo con un toque.`);
  },

  calificar(resId, estrellas) {
    const r = getReserva(resId); if (!r) return;
    const c = getCancha(r.canchaId);
    if (!r.calificacion) { c.rating = Math.round(((c.rating * c.votos) + estrellas) / (c.votos + 1) * 10) / 10; c.votos++; }
    r.calificacion = estrellas; Store.save();
  },

  validarPago(pagoId) {
    const p = Store.db.pagos.find(x => x.id === pagoId); if (!p) return;
    p.validado = true; Store.save();
  },

  liberar(r, motivo) {
    r.estado = 'liberada'; r.liberadaEn = Date.now();
    notify(r.usuarioId, `⚠️ Tu franja en ${nombreCancha(r.canchaId)} (${fmtFecha(r.fecha)} ${fmtHora(r.hora)}) fue liberada: ${motivo.toLowerCase()}.`);
    logTarea(`Liberada ${r.codigo} · ${nombreCancha(r.canchaId)} ${fmtFecha(r.fecha)} ${fmtHora(r.hora)} (${motivo})`);
    this.avisarEspera(r.canchaId, r.fecha, r.hora, r.duracion);
  },

  /** Pago tardío: el administrador reactiva la reserva con un clic */
  reactivar(resId, metodo = 'nequi') {
    const r = getReserva(resId);
    if (!r || r.estado !== 'liberada') return { error: 'La reserva no está liberada.' };
    if (conflicto(r.canchaId, r.fecha, r.hora, r.duracion, r.id)) return { error: 'La franja ya fue tomada por otra persona. Ofrécele otra franja al jugador.' };
    if (endTs(r) < Date.now()) return { error: 'La franja ya pasó.' };
    r.estado = 'confirmada'; r.abonoPagado = true; r.metodo = metodo; r.reactivadaEn = Date.now();
    Store.db.pagos.push({ id: uid('p'), reservaId: r.id, monto: r.abono, tipo: 'abono', metodo, fecha: today(), ts: Date.now(), validado: true });
    notify(r.usuarioId, `✅ Recibimos tu pago tardío: la reserva ${r.codigo} fue reactivada.`);
    logTarea(`Reactivada ${r.codigo} por pago tardío`);
    Store.save();
    return { reserva: r };
  },

  crearManual({ canchaId, fecha, hora, duracion, nombreCliente, telefono, pagado, metodo }) {
    const c = getCancha(canchaId);
    if (hora + duracion > c.cierre) return { error: 'La reserva pasa del horario de cierre.' };
    if (conflicto(canchaId, fecha, hora, duracion)) return { error: 'La franja está ocupada.' };
    const p = calcular(c, hora, duracion);
    const r = {
      id: uid('r'), codigo: genCodigo(), usuarioId: null, nombreCliente, telefono, canchaId, fecha, hora, duracion, ...p,
      estado: 'confirmada', abonoPagado: !!pagado, saldoPagado: false, asistenciaConfirmada: true, calificacion: 0,
      origen: 'manual', recordatorios: { r24: true, r2: true }, creadoEn: Date.now(), metodo,
    };
    Store.db.reservas.push(r);
    if (pagado) Store.db.pagos.push({ id: uid('p'), reservaId: r.id, monto: r.abono, tipo: 'abono', metodo, fecha: today(), ts: Date.now(), validado: true });
    Store.save();
    return { reserva: r };
  },

  unirseEspera(usuarioId, canchaId, fecha, hora) {
    if (Store.db.listaEspera.some(w => w.usuarioId === usuarioId && w.canchaId === canchaId && w.fecha === fecha && w.hora === hora)) return { error: 'Ya estás en la lista de espera de esta franja.' };
    Store.db.listaEspera.push({ id: uid('w'), usuarioId, canchaId, fecha, hora, creadoEn: Date.now(), notificado: false });
    Store.save();
    return { ok: true };
  },

  /** Avisa al primero de la lista de espera (prioridad por antigüedad) */
  avisarEspera(canchaId, fecha, hora, dur = 1) {
    const cola = Store.db.listaEspera
      .filter(w => w.canchaId === canchaId && w.fecha === fecha && w.hora >= hora && w.hora < hora + dur && !w.notificado)
      .sort((a, b) => a.creadoEn - b.creadoEn);
    if (!cola.length) return null;
    const w = cola[0];
    w.notificado = true; w.notificadoEn = Date.now();
    notify(w.usuarioId, `🔔 ¡Se liberó un cupo! ${nombreCancha(canchaId)} · ${fmtFecha(fecha)} ${fmtHora(w.hora)}. Resérvalo antes de que alguien más lo tome.`);
    logTarea(`Lista de espera: aviso a ${getUser(w.usuarioId)?.nombre} (${nombreCancha(canchaId)} ${fmtHora(w.hora)})`);
    return w;
  },

  /** Tareas programadas (en producción: Celery + Redis). Aquí corren cada 15 s. */
  ejecutarTareas() {
    const now = Date.now(), R = Store.db.reglas;
    let cambios = 0;
    Store.db.reservas.forEach(r => {
      // 1. Liberación automática por falta de abono
      if (r.estado === 'pendiente_pago' && r.venceEn <= now && R.liberacionAutomatica) { this.liberar(r, 'no se pagó el abono a tiempo'); cambios++; }
      // 2. Cierre de reservas cuyo horario ya terminó
      if (['confirmada', 'en_curso'].includes(r.estado) && endTs(r) <= now) { r.estado = 'finalizada'; cambios++; }
      // 3. Recordatorios escalonados 24 h y 2 h antes
      if (r.estado === 'confirmada' && r.usuarioId) {
        const faltan = (startTs(r) - now) / 3600000;
        r.recordatorios = r.recordatorios || {};
        const canal = [R.canalWhatsapp && 'WhatsApp', R.canalEmail && 'correo'].filter(Boolean).join(' y ') || 'app';
        if (R.recordatorio24 && !r.recordatorios.r24 && faltan <= 24 && faltan > 2) {
          r.recordatorios.r24 = true; cambios++;
          notify(r.usuarioId, `⏰ Recordatorio (24 h): ${nombreCancha(r.canchaId)} · ${fmtFecha(r.fecha)} ${fmtHora(r.hora)}. ¿Confirmas asistencia?`);
          logTarea(`Recordatorio 24 h por ${canal} → ${r.codigo}`);
        }
        if (R.recordatorio2 && !r.recordatorios.r2 && faltan <= 2 && faltan > 0) {
          r.recordatorios.r2 = true; r.recordatorios.r24 = true; cambios++;
          notify(r.usuarioId, `⏰ Tu partido empieza en menos de 2 horas (${fmtHora(r.hora)}). Lleva tu QR: ${r.codigo}.`);
          logTarea(`Recordatorio 2 h por ${canal} → ${r.codigo}`);
        }
      }
    });
    if (cambios) Store.save();
    return cambios;
  },

  resumenCaja(fecha) {
    const pagos = Store.db.pagos.filter(p => p.fecha === fecha);
    const porMetodo = {};
    pagos.forEach(p => { porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + p.monto; });
    const total = pagos.reduce((s, p) => s + p.monto, 0);
    const pendientes = pagos.filter(p => !p.validado);
    return { pagos, porMetodo, total, pendientes, cerrado: Store.db.cierres.find(c => c.fecha === fecha) };
  },

  cerrarCaja(fecha, usuario) {
    const res = this.resumenCaja(fecha);
    if (res.cerrado) return { error: 'La caja de ese día ya fue cerrada.' };
    const cierre = { id: uid('k'), fecha, total: res.total, nPagos: res.pagos.length, porMetodo: res.porMetodo, por: usuario.nombre, ts: Date.now() };
    Store.db.cierres.push(cierre); Store.save();
    logTarea(`Cierre de caja ${fecha}: ${fmtCOP(res.total)}`);
    return { cierre };
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
