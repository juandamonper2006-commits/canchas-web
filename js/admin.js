/* =========================================================
   CanchApp - Panel web del administrador
   Módulos (según el mapa de sitio del documento):
     Dashboard · Agenda · Pagos y caja · Sedes y canchas ·
     Reglas automáticas · Lista de espera · Reportes · Cuenta y soporte
   ========================================================= */

const yo = Auth.require(['admin', 'recepcion']);
const view = document.getElementById('view');
let sedeSel = 's1';
let fechaAgenda = today();
let tabPagos = 'pendientes';

const MODULOS = [
  { key: 'dashboard', label: 'Dashboard', ico: I.grid, fn: dashboard, sub: () => fmtFechaLarga(today()) },
  { key: 'agenda', label: 'Agenda', ico: I.cal, fn: agenda, sub: () => 'Vista diaria por sede' },
  { key: 'pagos', label: 'Pagos y caja', ico: I.cash, fn: pagos, sub: () => 'Validación de pagos, franjas liberadas y cierre del día' },
  { key: 'sedes', label: 'Sedes y canchas', ico: I.building, fn: sedes, sub: () => 'Multisede, canchas, franjas horarias y tarifas', soloAdmin: true },
  { key: 'reglas', label: 'Reglas automáticas', ico: I.bolt, fn: reglas, sub: () => 'Recordatorios, liberación por falta de abono y políticas', soloAdmin: true },
  { key: 'espera', label: 'Lista de espera', ico: I.list, fn: espera, sub: () => 'Cola por franja con prioridad por antigüedad' },
  { key: 'reportes', label: 'Reportes', ico: I.chart, fn: reportes, sub: () => 'Ocupación e ingresos por período', soloAdmin: true },
  { key: 'cuenta', label: 'Cuenta y soporte', ico: I.gear, fn: cuenta, sub: () => 'Usuarios, roles, backup y ayuda' },
];
const permitido = m => !m.soloAdmin || yo.rol === 'admin';

/* ---------------- Navegación ---------------- */
function pintarSide(activa) {
  const pend = Store.db.pagos.filter(p => !p.validado).length;
  const lib = liberadasVigentes().length;
  const esp = Store.db.listaEspera.filter(w => !w.notificado && parseYmd(w.fecha).getTime() + w.hora * 3600000 > Date.now()).length;
  const cnt = { pagos: pend + lib, espera: esp };
  document.getElementById('side-nav').innerHTML =
    `<div class="side-sec">Operación diaria</div>` +
    MODULOS.filter(permitido).map((m, i) => `
      ${m.key === 'sedes' ? '<div class="side-sec">Configuración</div>' : ''}
      ${m.key === 'reportes' ? '<div class="side-sec">Análisis</div>' : ''}
      <a href="#/${m.key}" class="side-link ${m.key === activa ? 'active' : ''}">${m.ico}${m.label}${cnt[m.key] ? `<span class="cnt">${cnt[m.key]}</span>` : ''}</a>`).join('');
  document.getElementById('who').textContent = yo.nombre;
  document.getElementById('who-rol').textContent = yo.rol === 'admin' ? 'Administrador' : 'Recepción';
}
function router() {
  const key = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';
  const m = MODULOS.find(x => x.key === key && permitido(x)) || MODULOS[0];
  document.getElementById('a-title').textContent = m.label;
  document.getElementById('a-sub').textContent = m.sub();
  pintarSide(m.key);
  document.getElementById('sidebar').classList.remove('open');
  m.fn();
}
const refrescar = () => router();

/* ---------------- Utilidades ---------------- */
function selectSede(id = 'sede', conTodas = false) {
  return `<select class="input" id="${id}">
    ${conTodas ? `<option value="">Todas las sedes</option>` : ''}
    ${Store.db.sedes.map(s => `<option value="${s.id}" ${s.id === sedeSel ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}
  </select>`;
}
const liberadasVigentes = () => Store.db.reservas.filter(r => r.estado === 'liberada' && endTs(r) > Date.now()).sort((a, b) => b.liberadaEn - a.liberadaEn);
const reservasDia = (fecha, sedeId) => Store.db.reservas
  .filter(r => r.fecha === fecha && (!sedeId || getCancha(r.canchaId)?.sedeId === sedeId))
  .sort((a, b) => a.hora - b.hora || a.canchaId.localeCompare(b.canchaId));
const activa = r => ['pendiente_pago', 'confirmada', 'en_curso', 'finalizada'].includes(r.estado) && bloquea(r);
function pagoDe(r, tipo = 'abono') { return Store.db.pagos.find(p => p.reservaId === r.id && p.tipo === tipo); }

/* =========================================================
   DASHBOARD
   ========================================================= */
function dashboard() {
  Motor.ejecutarTareas();
  const t = today();
  const hoy = reservasDia(t, sedeSel).filter(activa);
  const caja = Motor.resumenCaja(t);
  const pend = Store.db.pagos.filter(p => !p.validado);
  const libs = liberadasVigentes();
  const canchasSede = Store.db.canchas.filter(c => c.sedeId === sedeSel);
  const disp = canchasSede.reduce((s, c) => s + (c.cierre - c.apertura), 0);
  const ocup = disp ? Math.round(hoy.reduce((s, r) => s + r.duracion, 0) / disp * 100) : 0;
  const mant = Store.db.canchas.filter(c => c.mantenimiento);
  const porVencer = Store.db.reservas.filter(r => r.estado === 'pendiente_pago' && r.venceEn > Date.now());

  view.innerHTML = `
  <div class="toolbar">${selectSede()}<span class="small muted">Las cifras de agenda y ocupación son de la sede seleccionada.</span></div>
  ${mant.length && Store.db.reglas.alertasMantenimiento ? `<div class="alert warn">🛠 <div><b>Alerta de mantenimiento:</b> ${mant.map(nombreCancha).join(', ')} fuera de servicio.</div></div>` : ''}
  ${porVencer.length ? `<div class="alert info">⏳ <div>${porVencer.length} reserva(s) esperando pago del abono. Se liberarán automáticamente al vencer el plazo de ${Store.db.reglas.minutosLiberacion} min.</div></div>` : ''}
  <div class="kpis">
    <div class="kpi accent"><div class="k-label">${I.cal} Reservas hoy</div><div class="k-val">${hoy.length}</div><div class="k-foot">${hoy.filter(r => r.estado === 'en_curso').length} en curso ahora</div></div>
    <div class="kpi dark"><div class="k-label">${I.cash} Ingresos del día</div><div class="k-val">${fmtCOP(caja.total)}</div><div class="k-foot">${caja.pagos.length} movimientos · todas las sedes</div></div>
    <div class="kpi"><div class="k-label">Pagos por validar</div><div class="k-val">${pend.length}</div><div class="k-foot">${fmtCOP(pend.reduce((s, p) => s + p.monto, 0))}</div></div>
    <div class="kpi"><div class="k-label">Franjas liberadas</div><div class="k-val">${libs.length}</div><div class="k-foot">Por falta de abono</div></div>
    <div class="kpi"><div class="k-label">Ocupación hoy</div><div class="k-val">${ocup}%</div><div class="k-foot">${getSede(sedeSel).nombre}</div></div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="between"><h3>Agenda del día · ${esc(getSede(sedeSel).nombre)}</h3><a href="#/agenda" class="small muted">Ver agenda completa →</a></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Hora</th><th>Cancha</th><th>Cliente</th><th>Estado</th><th></th></tr></thead>
        <tbody>${hoy.length ? hoy.map(r => `
          <tr>
            <td class="bold">${fmtRango(r.hora, r.duracion)}</td>
            <td>${esc(getCancha(r.canchaId).nombre)} <span class="tiny muted">${getCancha(r.canchaId).tipo}</span></td>
            <td>${esc(clienteReserva(r))}${r.origen === 'manual' ? ' <span class="badge b-muted">Manual</span>' : ''}</td>
            <td>${badge(r.estado)}</td>
            <td><div class="actions">
              ${r.estado === 'confirmada' ? `<button class="btn btn-primary btn-sm" data-checkin="${r.id}">Marcar en curso</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-ver="${r.id}">Ver</button>
            </div></td>
          </tr>`).join('') : '<tr><td colspan="5" class="muted">Sin reservas para hoy.</td></tr>'}
        </tbody></table></div>
    </div>
    <div>
      <div class="card mb">
        <div class="between"><h3>Pagos pendientes de validar</h3><a href="#/pagos" class="small muted">Ver todos →</a></div>
        ${pend.slice(0, 4).map(p => { const r = getReserva(p.reservaId); return `
          <div class="between" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div><div class="small bold">${esc(clienteReserva(r))} · ${fmtCOP(p.monto)}</div><div class="tiny muted">${METODOS[p.metodo]?.label} · ${esc(nombreCancha(r.canchaId))} · ${fmtFecha(r.fecha)} ${fmtHora(r.hora)}</div></div>
            <button class="btn btn-primary btn-sm" data-validar="${p.id}">Validar</button>
          </div>`; }).join('') || '<p class="small muted">Todo validado ✅</p>'}
      </div>
      <div class="card mb">
        <div class="between"><h3>Franjas liberadas</h3><a href="#/pagos" class="small muted" data-tab="liberadas">Gestionar →</a></div>
        ${libs.slice(0, 3).map(r => `
          <div class="between" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div><div class="small bold">${esc(nombreCancha(r.canchaId))}</div><div class="tiny muted">${fmtFecha(r.fecha)} ${fmtHora(r.hora)} · ${esc(clienteReserva(r))}</div></div>
            <button class="btn btn-dark btn-sm" data-reactivar="${r.id}">Reactivar</button>
          </div>`).join('') || '<p class="small muted">No hay franjas liberadas.</p>'}
      </div>
      <div class="card">
        <h3>Caja del día</h3>
        ${Object.entries(caja.porMetodo).map(([m, v]) => `<div class="between small" style="padding:3px 0"><span>${METODOS[m]?.label || m}</span><b>${fmtCOP(v)}</b></div>`).join('') || '<p class="small muted">Sin movimientos hoy.</p>'}
        <div class="between mt" style="border-top:1px dashed var(--line);padding-top:10px"><b>Total</b><b>${fmtCOP(caja.total)}</b></div>
        <a href="#/pagos" class="btn btn-outline btn-block btn-sm mt" data-tab="cierre">${caja.cerrado ? '✅ Caja cerrada' : 'Ir a cierre de caja'}</a>
      </div>
    </div>
  </div>`;
  document.getElementById('sede').onchange = e => { sedeSel = e.target.value; dashboard(); };
  enlazarAcciones(view, dashboard);
  view.querySelectorAll('[data-tab]').forEach(a => a.addEventListener('click', () => { tabPagos = a.dataset.tab; }));
}

/** Botones comunes: ver, check-in, validar, reactivar */
function enlazarAcciones(root, after) {
  root.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => modalReserva(b.dataset.ver, after));
  root.querySelectorAll('[data-checkin]').forEach(b => b.onclick = () => {
    const r = getReserva(b.dataset.checkin);
    const res = Motor.checkIn(r.codigo);
    toast(res.error || `✅ ${r.codigo} en curso`, res.error ? 'err' : 'ok'); after();
  });
  root.querySelectorAll('[data-validar]').forEach(b => b.onclick = () => { Motor.validarPago(b.dataset.validar); toast('Pago validado ✅', 'ok'); after(); pintarSide(currentKey()); });
  root.querySelectorAll('[data-reactivar]').forEach(b => b.onclick = () => reactivar(b.dataset.reactivar, after));
}
const currentKey = () => (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';

function reactivar(id, after) {
  const res = Motor.reactivar(id);
  if (res.error) { toast(res.error, 'err'); if (/tomada/.test(res.error)) ofrecerOtraFranja(id, after); return; }
  toast('Reserva reactivada y jugador notificado ✅', 'ok'); after(); pintarSide(currentKey());
}

/** Flujo 6 (rama): la franja ya fue tomada → ofrecer otra franja al jugador */
function ofrecerOtraFranja(id, after) {
  const r = getReserva(id); const c = getCancha(r.canchaId);
  const libres = horasCancha(c).filter(h => estadoFranja(c, r.fecha, h, r.duracion).libre);
  const otras = Store.db.canchas.filter(x => x.id !== c.id && x.sedeId === c.sedeId && estadoFranja(x, r.fecha, r.hora, r.duracion).libre);
  const m = openModal(`
    <h3>La franja ya fue tomada</h3>
    <p class="muted small">Ofrece a ${esc(clienteReserva(r))} otra opción el ${fmtFecha(r.fecha)}:</p>
    ${libres.length ? `<p class="small bold">Otras horas en ${esc(nombreCancha(c))}</p><div class="flex" style="flex-wrap:wrap">${libres.map(h => `<button class="chip" data-h="${h}">${fmtHora(h)}</button>`).join('')}</div>` : ''}
    ${otras.length ? `<p class="small bold mt">Misma hora en otra cancha</p><div class="flex" style="flex-wrap:wrap">${otras.map(x => `<button class="chip" data-c="${x.id}">${esc(x.nombre)} (${x.tipo})</button>`).join('')}</div>` : ''}
    ${!libres.length && !otras.length ? '<p class="small muted">No hay alternativas ese día.</p>' : ''}
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cerrar</button></div>`);
  const aplicar = (cambios) => {
    Object.assign(r, cambios);
    const p = calcular(getCancha(r.canchaId), r.hora, r.duracion); Object.assign(r, p);
    const res = Motor.reactivar(r.id);
    closeModal(); toast(res.error || 'Reserva reubicada y reactivada ✅', res.error ? 'err' : 'ok'); after(); pintarSide(currentKey());
  };
  m.querySelectorAll('[data-h]').forEach(b => b.onclick = () => aplicar({ hora: Number(b.dataset.h) }));
  m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => aplicar({ canchaId: b.dataset.c }));
}

/* ---------------- Detalle de reserva (admin) ---------------- */
function modalReserva(id, after = refrescar) {
  const r = getReserva(id); if (!r) return;
  const u = getUser(r.usuarioId);
  const pa = pagoDe(r, 'abono'), ps = pagoDe(r, 'saldo');
  const m = openModal(`
    <div class="between"><h3>Reserva ${r.codigo}</h3>${badge(r.estado)}</div>
    <dl class="kv mt">
      <dt>Cliente</dt><dd>${esc(clienteReserva(r))}</dd>
      <dt>Teléfono</dt><dd>${esc(r.telefono || u?.telefono || '—')}</dd>
      <dt>Cancha</dt><dd>${esc(nombreCancha(r.canchaId))}</dd>
      <dt>Fecha</dt><dd>${fmtFechaLarga(r.fecha)}</dd>
      <dt>Horario</dt><dd>${fmtRango(r.hora, r.duracion)}</dd>
      <dt>Total</dt><dd>${fmtCOP(r.total)}</dd>
      <dt>Abono</dt><dd>${fmtCOP(r.abono)} ${pa ? (pa.validado ? '<span class="badge b-ok">Validado</span>' : '<span class="badge b-warn">Por validar</span>') : '<span class="badge b-muted">Sin pago</span>'}</dd>
      <dt>Saldo</dt><dd>${fmtCOP(r.saldo)} ${ps ? '<span class="badge b-ok">Pagado</span>' : '<span class="badge b-muted">Pendiente</span>'}</dd>
      <dt>Origen</dt><dd>${r.origen === 'manual' ? 'Reserva manual' : 'App del jugador'}</dd>
      ${r.usuarioId ? `<dt>Asistencia</dt><dd>${r.asistenciaConfirmada ? 'Confirmada' : 'Sin confirmar'}</dd>` : ''}
    </dl>
    <div class="modal-actions">
      ${pa && !pa.validado ? `<button class="btn btn-primary" id="m-val">Validar pago</button>` : ''}
      ${r.estado === 'confirmada' && r.fecha === today() ? `<button class="btn btn-primary" id="m-check">Marcar en curso</button>` : ''}
      ${['confirmada', 'en_curso'].includes(r.estado) && !r.saldoPagado ? `<button class="btn btn-dark" id="m-saldo">Cobrar saldo en caja</button>` : ''}
      ${r.estado === 'en_curso' ? `<button class="btn btn-outline" id="m-fin">Finalizar</button>` : ''}
      ${r.estado === 'liberada' ? `<button class="btn btn-dark" id="m-react">Reactivar (pago tardío)</button>` : ''}
      ${['confirmada', 'pendiente_pago'].includes(r.estado) ? `<button class="btn btn-danger" id="m-cancel">Cancelar</button>` : ''}
      <button class="btn btn-ghost" data-close>Cerrar</button>
    </div>`);
  const done = (msg, type = 'ok') => { closeModal(); toast(msg, type); after(); pintarSide(currentKey()); };
  m.querySelector('#m-val')?.addEventListener('click', () => { Motor.validarPago(pa.id); done('Pago validado ✅'); });
  m.querySelector('#m-check')?.addEventListener('click', () => { const x = Motor.checkIn(r.codigo); done(x.error || 'Reserva en curso', x.error ? 'err' : 'ok'); });
  m.querySelector('#m-saldo')?.addEventListener('click', () => { Motor.pagarSaldo(r.id, 'efectivo'); done(`Saldo ${fmtCOP(r.saldo)} registrado en caja`); });
  m.querySelector('#m-fin')?.addEventListener('click', () => { Motor.finalizar(r.id); done('Reserva finalizada'); });
  m.querySelector('#m-react')?.addEventListener('click', () => { closeModal(); reactivar(r.id, after); });
  m.querySelector('#m-cancel')?.addEventListener('click', async () => {
    const ok = await confirmar('Cancelar reserva', `Se aplicará la política de cancelación. ${r.usuarioId ? 'El jugador será notificado.' : ''}`, { ok: 'Cancelar reserva', danger: true });
    if (!ok) return;
    const x = Motor.cancelar(r.id, 'admin'); toast(x.error || 'Reserva cancelada', x.error ? 'err' : ''); after(); pintarSide(currentKey());
  });
}

/* ---------------- Check-in por QR ---------------- */
document.getElementById('btn-checkin').onclick = () => {
  const pendientes = Store.db.reservas.filter(r => r.fecha === today() && r.estado === 'confirmada').sort((a, b) => a.hora - b.hora);
  const m = openModal(`
    <h3>Check-in en la sede</h3>
    <p class="muted small">Escanea o digita el código del comprobante del jugador.</p>
    <div class="flex"><input class="input" id="code" placeholder="Ej: CA-AB1234" style="text-transform:uppercase"><button class="btn btn-primary" id="go">Validar</button></div>
    <div id="res" class="mt"></div>
    <p class="small bold mt">Llegadas esperadas hoy</p>
    <div style="max-height:220px;overflow:auto">${pendientes.map(r => `
      <div class="between" style="padding:7px 0;border-bottom:1px solid var(--line)">
        <div class="small"><b>${fmtHora(r.hora)}</b> · ${esc(nombreCancha(r.canchaId))}<div class="tiny muted">${esc(clienteReserva(r))} · <code>${r.codigo}</code></div></div>
        <button class="btn btn-ghost btn-sm" data-code="${r.codigo}">Usar</button>
      </div>`).join('') || '<p class="small muted">No hay llegadas pendientes.</p>'}</div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cerrar</button></div>`);
  const inp = m.querySelector('#code');
  const validar = () => {
    const res = Motor.checkIn(inp.value);
    m.querySelector('#res').innerHTML = res.error
      ? `<div class="alert err">❌ ${esc(res.error)}</div>`
      : `<div class="alert ok">✅ <div><b>${esc(clienteReserva(res.reserva))}</b> · ${esc(nombreCancha(res.reserva.canchaId))} ${fmtRango(res.reserva.hora, res.reserva.duracion)}<br>Reserva marcada <b>en curso</b>. Saldo por cobrar: ${fmtCOP(res.reserva.saldoPagado ? 0 : res.reserva.saldo)}</div></div>`;
    if (!res.error) { pintarSide(currentKey()); setTimeout(() => { if (['dashboard', 'agenda'].includes(currentKey())) router(); }, 50); }
  };
  m.querySelector('#go').onclick = validar;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') validar(); });
  m.querySelectorAll('[data-code]').forEach(b => b.onclick = () => { inp.value = b.dataset.code; validar(); });
  inp.focus();
};

/* =========================================================
   AGENDA
   ========================================================= */
function agenda() {
  Motor.ejecutarTareas();
  const canchas = Store.db.canchas.filter(c => c.sedeId === sedeSel);
  const hMin = Math.min(...canchas.map(c => c.apertura), 24);
  const hMax = Math.max(...canchas.map(c => c.cierre), 0);
  const rs = reservasDia(fechaAgenda, sedeSel);
  const visibles = rs.filter(r => ['pendiente_pago', 'confirmada', 'en_curso', 'finalizada'].includes(r.estado) && bloquea(r));
  const liberadas = rs.filter(r => r.estado === 'liberada');

  let cells = '';
  if (canchas.length) {
    cells += `<div class="ag-head" style="grid-column:1;grid-row:1">Hora</div>`;
    canchas.forEach((c, j) => cells += `<div class="ag-head" style="grid-column:${j + 2};grid-row:1">${esc(c.nombre)} · ${c.tipo}${c.mantenimiento ? ' 🛠' : ''}</div>`);
    const cubiertas = new Set();
    for (let h = hMin; h < hMax; h++) {
      const row = h - hMin + 2;
      cells += `<div class="ag-cell ag-hour" style="grid-column:1;grid-row:${row}">${fmtHora(h)}</div>`;
      canchas.forEach((c, j) => {
        const col = j + 2;
        if (cubiertas.has(`${c.id}-${h}`)) return;
        const r = visibles.find(x => x.canchaId === c.id && Math.floor(x.hora) === h);
        if (r) {
          const span = Math.ceil(r.hora + r.duracion) - h;
          for (let k = 1; k < span; k++) cubiertas.add(`${c.id}-${h + k}`);
          const pa = pagoDe(r);
          cells += `<div class="ag-cell" style="grid-column:${col};grid-row:${row} / span ${span}">
            <div class="ag-block ${r.estado}" data-ver="${r.id}">${esc(clienteReserva(r))}<small>${fmtRango(r.hora, r.duracion)} · ${ESTADOS[r.estado]}${pa && !pa.validado ? ' · 💳 por validar' : ''}</small></div></div>`;
        } else if (h < c.apertura || h >= c.cierre) {
          cells += `<div class="ag-cell" style="grid-column:${col};grid-row:${row};background:repeating-linear-gradient(45deg,#f3f2ec,#f3f2ec 6px,#ebe9e1 6px,#ebe9e1 12px)"></div>`;
        } else {
          const futura = parseYmd(fechaAgenda).getTime() + h * 3600000 > Date.now() && !c.mantenimiento;
          cells += `<div class="ag-cell ${futura ? 'ag-free' : ''}" style="grid-column:${col};grid-row:${row}" ${futura ? `data-nueva="${c.id}|${h}"` : ''}></div>`;
        }
      });
    }
  }

  view.innerHTML = `
  <div class="toolbar">
    ${selectSede()}
    <button class="btn btn-ghost btn-sm" id="prev">◀</button>
    <input type="date" class="input" id="fecha" value="${fechaAgenda}">
    <button class="btn btn-ghost btn-sm" id="next">▶</button>
    <button class="btn btn-outline btn-sm" id="hoy">Hoy</button>
    <span class="grow"></span>
    <button class="btn btn-primary" id="nueva">+ Crear reserva manual</button>
  </div>
  <div class="small muted mb">${fmtFechaLarga(fechaAgenda)} · ${visibles.length} reservas · haz clic en un espacio libre para reservar</div>
  <div class="table-wrap">
    <div class="agenda" style="grid-template-columns:72px repeat(${canchas.length}, minmax(150px,1fr));grid-auto-rows:minmax(50px,auto)">${cells || '<div class="empty">Esta sede no tiene canchas.</div>'}</div>
  </div>
  <div class="legend">
    <span><i style="background:var(--lime)"></i>Confirmada</span>
    <span><i style="background:var(--warn-50);border:1px dashed var(--warn)"></i>Pendiente de abono (bloqueo temporal)</span>
    <span><i style="background:var(--info-50)"></i>En curso</span>
    <span><i style="background:#ecebe4"></i>Finalizada</span>
  </div>
  ${liberadas.length ? `<div class="card mt"><h3>Franjas liberadas este día</h3>${liberadas.map(r => `
    <div class="between" style="padding:6px 0"><span class="small">${fmtHora(r.hora)} · ${esc(getCancha(r.canchaId).nombre)} · ${esc(clienteReserva(r))}</span>
    <button class="btn btn-dark btn-sm" data-reactivar="${r.id}">Reactivar</button></div>`).join('')}</div>` : ''}`;

  document.getElementById('sede').onchange = e => { sedeSel = e.target.value; agenda(); };
  document.getElementById('fecha').onchange = e => { if (e.target.value) { fechaAgenda = e.target.value; agenda(); } };
  document.getElementById('prev').onclick = () => { fechaAgenda = addDays(fechaAgenda, -1); agenda(); };
  document.getElementById('next').onclick = () => { fechaAgenda = addDays(fechaAgenda, 1); agenda(); };
  document.getElementById('hoy').onclick = () => { fechaAgenda = today(); agenda(); };
  document.getElementById('nueva').onclick = () => modalManual({});
  view.querySelectorAll('[data-nueva]').forEach(c => c.onclick = () => { const [cid, h] = c.dataset.nueva.split('|'); modalManual({ canchaId: cid, hora: Number(h) }); });
  enlazarAcciones(view, agenda);
}

/* ---------------- Reserva manual ---------------- */
function modalManual({ canchaId, hora }) {
  const canchas = Store.db.canchas.filter(c => c.sedeId === sedeSel);
  const st = { canchaId: canchaId || canchas[0]?.id, fecha: fechaAgenda, hora: hora ?? null, dur: 1 };
  const m = openModal(`<h3>Crear reserva manual</h3><p class="muted small">Para clientes que llaman o llegan a la sede.</p><form id="fm"></form>`, { wide: true });
  function pintar() {
    const c = getCancha(st.canchaId);
    const libres = horasCancha(c).filter(h => estadoFranja(c, st.fecha, h, st.dur).libre);
    if (!libres.includes(st.hora)) st.hora = libres[0] ?? null;
    const p = st.hora != null ? calcular(c, st.hora, st.dur) : null;
    m.querySelector('#fm').innerHTML = `
      <div class="row">
        <div class="field"><label>Cancha</label><select class="input" name="cancha">${canchas.map(x => `<option value="${x.id}" ${x.id === st.canchaId ? 'selected' : ''}>${esc(x.nombre)} · ${x.tipo}</option>`).join('')}</select></div>
        <div class="field"><label>Fecha</label><input class="input" type="date" name="fecha" value="${st.fecha}" min="${today()}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Hora</label><select class="input" name="hora">${libres.map(h => `<option value="${h}" ${h === st.hora ? 'selected' : ''}>${fmtHora(h)}</option>`).join('') || '<option value="">Sin franjas libres</option>'}</select></div>
        <div class="field"><label>Duración</label><select class="input" name="dur">${[1, 1.5, 2].map(d => `<option value="${d}" ${d === st.dur ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Nombre del cliente</label><input class="input" name="nombre" required placeholder="Nombre y apellido"></div>
        <div class="field"><label>Teléfono</label><input class="input" name="tel" placeholder="300 000 0000"></div>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" name="pagado" checked> Abono recibido</label>
        <div class="field" style="margin:0"><select class="input" name="metodo">${Object.entries(METODOS).map(([k, v]) => `<option value="${k}" ${k === 'efectivo' ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      </div>
      ${p ? `<div class="summary mt"><div class="line"><span>Total</span><b>${fmtCOP(p.total)}</b></div><div class="line"><span>Abono (${Store.db.reglas.abonoPct}%)</span><span>${fmtCOP(p.abono)}</span></div><div class="line"><span>Saldo</span><span>${fmtCOP(p.saldo)}</span></div></div>` : '<div class="alert warn mt">No hay franjas libres para esa combinación.</div>'}
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" ${p ? '' : 'disabled'}>Crear reserva</button></div>`;
    const f = m.querySelector('#fm');
    f.querySelector('[data-close]').onclick = closeModal;
    f.cancha.onchange = () => { st.canchaId = f.cancha.value; pintar(); };
    f.fecha.onchange = () => { st.fecha = f.fecha.value || today(); pintar(); };
    f.dur.onchange = () => { st.dur = Number(f.dur.value); pintar(); };
    f.hora.onchange = () => { st.hora = Number(f.hora.value); pintar(); };
  }
  pintar();
  m.querySelector('#fm').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const res = Motor.crearManual({ canchaId: st.canchaId, fecha: st.fecha, hora: st.hora, duracion: st.dur, nombreCliente: f.nombre.value.trim(), telefono: f.tel.value.trim(), pagado: f.pagado.checked, metodo: f.metodo.value });
    if (res.error) return toast(res.error, 'err');
    closeModal(); toast(`Reserva ${res.reserva.codigo} creada ✅`, 'ok');
    fechaAgenda = st.fecha; router();
  };
}

/* =========================================================
   PAGOS Y CAJA
   ========================================================= */
function pagos() {
  Motor.ejecutarTareas();
  const pend = Store.db.pagos.filter(p => !p.validado).sort((a, b) => a.ts - b.ts);
  const libs = liberadasVigentes();
  view.innerHTML = `
    <div class="subtabs">
      <button data-t="pendientes" class="${tabPagos === 'pendientes' ? 'active' : ''}">Pagos pendientes (${pend.length})</button>
      <button data-t="liberadas" class="${tabPagos === 'liberadas' ? 'active' : ''}">Franjas liberadas (${libs.length})</button>
      <button data-t="cierre" class="${tabPagos === 'cierre' ? 'active' : ''}">Cierre del día</button>
    </div>
    <div id="sub"></div>`;
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tabPagos = b.dataset.t; pagos(); });
  const sub = document.getElementById('sub');

  if (tabPagos === 'pendientes') {
    sub.innerHTML = `
      <div class="card">
        <div class="between mb"><h3 style="margin:0">Pagos digitales por validar</h3>${pend.length ? '<button class="btn btn-primary btn-sm" id="todos">Validar todos</button>' : ''}</div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Recibido</th><th>Código</th><th>Cliente</th><th>Reserva</th><th>Tipo</th><th>Método</th><th>Monto</th><th></th></tr></thead>
          <tbody>${pend.map(p => { const r = getReserva(p.reservaId); return `<tr>
            <td class="small">${fmtTs(p.ts)}</td><td><code>${r.codigo}</code></td><td>${esc(clienteReserva(r))}</td>
            <td class="small">${esc(nombreCancha(r.canchaId))}<br><span class="muted">${fmtFecha(r.fecha)} ${fmtHora(r.hora)}</span></td>
            <td><span class="badge b-muted">${p.tipo}</span></td><td>${METODOS[p.metodo]?.label || p.metodo}</td><td class="bold">${fmtCOP(p.monto)}</td>
            <td><div class="actions"><button class="btn btn-primary btn-sm" data-validar="${p.id}">Validar</button><button class="btn btn-ghost btn-sm" data-ver="${r.id}">Ver</button></div></td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">No hay pagos pendientes de validar ✅</td></tr>'}
          </tbody></table></div>
      </div>`;
    document.getElementById('todos')?.addEventListener('click', () => { pend.forEach(p => p.validado = true); Store.save(); toast(`${pend.length} pagos validados`, 'ok'); pagos(); pintarSide('pagos'); });
  }

  if (tabPagos === 'liberadas') {
    sub.innerHTML = `
      <div class="alert info">⚙️ <div>El sistema libera automáticamente las reservas sin abono después de <b>${Store.db.reglas.minutosLiberacion} minutos</b> y avisa a la lista de espera. Si el pago llega tarde, reactívala con un clic.</div></div>
      <div class="card"><div class="table-wrap"><table class="tbl">
        <thead><tr><th>Cliente</th><th>Cancha</th><th>Franja</th><th>Liberada</th><th>Estado de la franja</th><th></th></tr></thead>
        <tbody>${libs.map(r => { const tomada = conflicto(r.canchaId, r.fecha, r.hora, r.duracion, r.id); return `<tr>
          <td>${esc(clienteReserva(r))}<div class="tiny muted">${esc(getUser(r.usuarioId)?.telefono || '')}</div></td>
          <td>${esc(nombreCancha(r.canchaId))}</td><td>${fmtFecha(r.fecha)} · ${fmtRango(r.hora, r.duracion)}</td>
          <td class="small">${fmtTs(r.liberadaEn)}</td>
          <td>${tomada ? `<span class="badge b-cancelada">Tomada por ${esc(clienteReserva(tomada))}</span>` : '<span class="badge b-ok">Libre</span>'}</td>
          <td><div class="actions"><button class="btn btn-dark btn-sm" data-reactivar="${r.id}">${tomada ? 'Ofrecer otra franja' : 'Reactivar (1 clic)'}</button></div></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No hay franjas liberadas vigentes.</td></tr>'}
        </tbody></table></div></div>`;
  }

  if (tabPagos === 'cierre') pintarCierre(sub);
  enlazarAcciones(sub, pagos);
}

let fechaCaja = today();
function pintarCierre(sub) {
  const res = Motor.resumenCaja(fechaCaja);
  const tipos = {};
  res.pagos.forEach(p => tipos[p.tipo] = (tipos[p.tipo] || 0) + p.monto);
  sub.innerHTML = `
    <div class="toolbar"><label class="small bold">Fecha</label><input type="date" class="input" id="fcaja" value="${fechaCaja}" max="${today()}"></div>
    ${res.pendientes.length ? `<div class="alert warn">⚠️ <div>Hay <b>${res.pendientes.length} pago(s) sin validar</b> este día. Valídalos antes de cerrar la caja. <a href="#" id="ir-pend" style="text-decoration:underline">Ir a pagos pendientes</a></div></div>` : ''}
    ${res.cerrado ? `<div class="alert ok">✅ Caja cerrada por ${esc(res.cerrado.por)} el ${fmtTs(res.cerrado.ts)}.</div>` : ''}
    <div class="kpis">
      <div class="kpi dark"><div class="k-label">Total del día</div><div class="k-val">${fmtCOP(res.total)}</div></div>
      <div class="kpi"><div class="k-label">Movimientos</div><div class="k-val">${res.pagos.length}</div></div>
      <div class="kpi"><div class="k-label">Abonos</div><div class="k-val">${fmtCOP(tipos.abono)}</div></div>
      <div class="kpi"><div class="k-label">Saldos</div><div class="k-val">${fmtCOP(tipos.saldo)}</div></div>
      <div class="kpi"><div class="k-label">Reembolsos</div><div class="k-val">${fmtCOP(tipos.reembolso)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>Movimientos</h3><div class="table-wrap" style="max-height:380px;overflow:auto"><table class="tbl">
        <thead><tr><th>Hora</th><th>Código</th><th>Tipo</th><th>Método</th><th>Monto</th><th>Estado</th></tr></thead>
        <tbody>${res.pagos.sort((a, b) => a.ts - b.ts).map(p => `<tr><td class="small">${new Date(p.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</td><td><code>${getReserva(p.reservaId)?.codigo}</code></td><td>${p.tipo}</td><td>${METODOS[p.metodo]?.label || p.metodo}</td><td class="bold">${fmtCOP(p.monto)}</td><td>${p.validado ? '<span class="badge b-ok">Validado</span>' : '<span class="badge b-warn">Por validar</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin movimientos.</td></tr>'}</tbody>
      </table></div></div>
      <div>
        <div class="card mb"><h3>Por método de pago</h3>
          ${Object.entries(res.porMetodo).map(([k, v]) => `<div class="between small" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${METODOS[k]?.ico || ''} ${METODOS[k]?.label || k}</span><b>${fmtCOP(v)}</b></div>`).join('') || '<p class="small muted">—</p>'}
          <button class="btn btn-primary btn-block mt" id="cerrar" ${res.cerrado ? 'disabled' : ''}>${res.cerrado ? 'Caja cerrada' : 'Cerrar caja del día'}</button>
        </div>
        <div class="card"><h3>Cierres anteriores</h3>
          ${Store.db.cierres.slice().reverse().slice(0, 8).map(k => `<div class="between small" style="padding:5px 0"><span>${fmtFecha(k.fecha)} · ${esc(k.por)}</span><b>${fmtCOP(k.total)}</b></div>`).join('') || '<p class="small muted">Aún no hay cierres.</p>'}
        </div>
      </div>
    </div>`;
  document.getElementById('fcaja').onchange = e => { fechaCaja = e.target.value || today(); pintarCierre(sub); };
  document.getElementById('ir-pend')?.addEventListener('click', e => { e.preventDefault(); tabPagos = 'pendientes'; pagos(); });
  document.getElementById('cerrar').onclick = async () => {
    if (res.pendientes.length) {
      const ok = await confirmar('Hay pagos sin validar', `Quedan ${res.pendientes.length} pago(s) sin validar. ¿Cerrar la caja de todas formas?`, { ok: 'Cerrar igual' });
      if (!ok) return;
    }
    const x = Motor.cerrarCaja(fechaCaja, yo);
    toast(x.error || `Caja cerrada: ${fmtCOP(res.total)}`, x.error ? 'err' : 'ok'); pintarCierre(sub);
  };
}

/* =========================================================
   SEDES Y CANCHAS
   ========================================================= */
function sedes() {
  const canchas = Store.db.canchas.filter(c => c.sedeId === sedeSel);
  view.innerHTML = `
  <div class="grid-2" style="grid-template-columns:300px 1fr">
    <div>
      <div class="between mb"><h3 class="p-sub">Sedes</h3><button class="btn btn-primary btn-sm" id="nueva-sede">+ Sede</button></div>
      ${Store.db.sedes.map(s => `
        <div class="card mb" data-sede="${s.id}" style="cursor:pointer;padding:14px 16px;${s.id === sedeSel ? 'outline:2.5px solid var(--lime-600)' : ''}">
          <div class="between"><b>${esc(s.nombre)}</b><span class="badge b-muted">${Store.db.canchas.filter(c => c.sedeId === s.id).length} canchas</span></div>
          <div class="tiny muted">${esc(s.direccion)}</div>
          <button class="btn btn-ghost btn-sm mt-s" data-edit-sede="${s.id}" style="padding-left:0">Editar sede</button>
        </div>`).join('')}
    </div>
    <div class="card">
      <div class="between mb"><h3 style="margin:0">Canchas de ${esc(getSede(sedeSel).nombre)}</h3><button class="btn btn-primary btn-sm" id="nueva-cancha">+ Cancha</button></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Cancha</th><th>Tipo</th><th>Franja horaria</th><th>Tarifa diurna</th><th>Tarifa nocturna</th><th>Estado</th><th></th></tr></thead>
        <tbody>${canchas.map(c => `<tr>
          <td class="bold">${esc(c.nombre)}<div class="tiny muted">⭐ ${c.rating} (${c.votos})</div></td><td>${TIPOS[c.tipo].label}</td>
          <td>${fmtHora(c.apertura)} – ${fmtHora(c.cierre)}</td><td>${fmtCOP(c.precioDia)}</td><td>${fmtCOP(c.precioNoche)}</td>
          <td>${!c.activa ? '<span class="badge b-muted">Inactiva</span>' : c.mantenimiento ? '<span class="badge b-warn">Mantenimiento</span>' : '<span class="badge b-ok">Activa</span>'}</td>
          <td><div class="actions"><button class="btn btn-outline btn-sm" data-edit="${c.id}">Franjas y tarifas</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin canchas. Crea la primera.</td></tr>'}
        </tbody></table></div>
      <p class="tiny muted mt">La tarifa nocturna aplica desde las ${fmtHora(Store.db.reglas.nocheDesde)} (configurable en Reglas). Los cambios se reflejan en la app del jugador en tiempo real.</p>
    </div>
  </div>`;
  view.querySelectorAll('[data-sede]').forEach(el => el.onclick = e => { if (e.target.closest('[data-edit-sede]')) return; sedeSel = el.dataset.sede; sedes(); });
  view.querySelectorAll('[data-edit-sede]').forEach(b => b.onclick = () => modalSede(b.dataset.editSede));
  document.getElementById('nueva-sede').onclick = () => modalSede(null);
  document.getElementById('nueva-cancha').onclick = () => modalCancha(null);
  view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => modalCancha(b.dataset.edit));
}

function modalSede(id) {
  const s = id ? getSede(id) : { nombre: '', direccion: '', telefono: '' };
  const m = openModal(`<h3>${id ? 'Editar sede' : 'Nueva sede'}</h3><form id="fs">
    <div class="field"><label>Nombre</label><input class="input" name="nombre" value="${esc(s.nombre)}" required></div>
    <div class="field"><label>Dirección</label><input class="input" name="direccion" value="${esc(s.direccion)}" required></div>
    <div class="field"><label>Teléfono</label><input class="input" name="telefono" value="${esc(s.telefono)}"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`);
  m.querySelector('[data-close]').onclick = closeModal;
  m.querySelector('#fs').onsubmit = e => {
    e.preventDefault(); const f = e.target;
    const datos = { nombre: f.nombre.value.trim(), direccion: f.direccion.value.trim(), telefono: f.telefono.value.trim() };
    if (id) Object.assign(s, datos); else { const n = { id: uid('s'), ...datos }; Store.db.sedes.push(n); sedeSel = n.id; }
    Store.save(); closeModal(); toast('Sede guardada', 'ok'); sedes();
  };
}

function modalCancha(id) {
  const nueva = !id;
  const c = id ? getCancha(id) : { nombre: `Cancha ${Store.db.canchas.filter(x => x.sedeId === sedeSel).length + 1}`, tipo: 'F5', apertura: 8, cierre: 22, precioDia: 70000, precioNoche: 85000, servicios: ['luz'], descripcion: '', activa: true, mantenimiento: false };
  const horas = Array.from({ length: 25 }, (_, i) => i);
  const m = openModal(`<h3>${nueva ? 'Nueva cancha' : 'Franjas y tarifas · ' + esc(c.nombre)}</h3><form id="fc">
    <div class="row">
      <div class="field"><label>Nombre</label><input class="input" name="nombre" value="${esc(c.nombre)}" required></div>
      <div class="field"><label>Tipo</label><select class="input" name="tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${k === c.tipo ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div class="field"><label>Abre</label><select class="input" name="apertura">${horas.slice(0, 24).map(h => `<option value="${h}" ${h === c.apertura ? 'selected' : ''}>${fmtHora(h)}</option>`).join('')}</select></div>
      <div class="field"><label>Cierra</label><select class="input" name="cierre">${horas.slice(1).map(h => `<option value="${h}" ${h === c.cierre ? 'selected' : ''}>${h === 24 ? '12 am (medianoche)' : fmtHora(h)}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div class="field"><label>Tarifa diurna (por hora)</label><input class="input" type="number" min="1000" step="1000" name="precioDia" value="${c.precioDia}" required></div>
      <div class="field"><label>Tarifa nocturna (por hora)</label><input class="input" type="number" min="1000" step="1000" name="precioNoche" value="${c.precioNoche}" required></div>
    </div>
    <div class="field"><label>Servicios</label><div class="flex" style="flex-wrap:wrap">${Object.entries(SERVICIOS).map(([k, s]) => `<label class="check small"><input type="checkbox" name="serv" value="${k}" ${c.servicios.includes(k) ? 'checked' : ''}>${s.ico} ${s.label}</label>`).join('')}</div></div>
    <div class="field"><label>Descripción</label><textarea class="input" name="descripcion" rows="2">${esc(c.descripcion)}</textarea></div>
    <div class="flex" style="gap:24px"><label class="check"><input type="checkbox" name="activa" ${c.activa ? 'checked' : ''}> Activa</label><label class="check"><input type="checkbox" name="mantenimiento" ${c.mantenimiento ? 'checked' : ''}> En mantenimiento</label></div>
    <div id="val" class="mt"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`, { wide: true });
  const f = m.querySelector('#fc');
  f.querySelector('[data-close]').onclick = closeModal;
  // Validación en línea: franjas que se cruzan con reservas existentes
  const validar = () => {
    const ap = Number(f.apertura.value), ci = Number(f.cierre.value);
    const pd = Number(f.precioDia.value), pn = Number(f.precioNoche.value);
    const errores = [];
    if (ap >= ci) errores.push('La hora de cierre debe ser posterior a la de apertura.');
    if (pd <= 0 || pn <= 0) errores.push('Las tarifas deben ser mayores a cero.');
    let choques = [];
    if (!nueva) choques = Store.db.reservas.filter(r => r.canchaId === c.id && ['confirmada', 'pendiente_pago'].includes(r.estado) && startTs(r) > Date.now() && (r.hora < ap || r.hora + r.duracion > ci));
    f.querySelector('#val').innerHTML =
      errores.map(e => `<div class="alert err">❌ ${e}</div>`).join('') +
      (choques.length ? `<div class="alert warn">⚠️ <div>${choques.length} reserva(s) futura(s) quedan fuera del nuevo horario: ${choques.slice(0, 3).map(r => `${fmtFecha(r.fecha)} ${fmtHora(r.hora)}`).join(', ')}${choques.length > 3 ? '…' : ''}. Se mantendrán, pero revisa con los jugadores.</div></div>` : '');
    return errores.length === 0;
  };
  f.addEventListener('input', validar); f.addEventListener('change', validar);
  validar();
  f.onsubmit = e => {
    e.preventDefault();
    if (!validar()) return;
    const datos = {
      nombre: f.nombre.value.trim(), tipo: f.tipo.value, apertura: Number(f.apertura.value), cierre: Number(f.cierre.value),
      precioDia: Number(f.precioDia.value), precioNoche: Number(f.precioNoche.value), descripcion: f.descripcion.value.trim(),
      servicios: [...f.querySelectorAll('[name=serv]:checked')].map(x => x.value), activa: f.activa.checked, mantenimiento: f.mantenimiento.checked,
    };
    if (nueva) Store.db.canchas.push({ id: uid('c'), sedeId: sedeSel, rating: 5, votos: 0, ...datos });
    else Object.assign(c, datos);
    Store.save(); closeModal(); toast('Cancha guardada. Ya se ve en la app ✅', 'ok'); sedes();
  };
}

/* =========================================================
   REGLAS AUTOMÁTICAS
   ========================================================= */
function reglas() {
  const R = Store.db.reglas;
  const num = (k, label, sufijo, min, max, step = 1) => `<div class="rule"><div><div class="bold small">${label}</div></div><div class="flex"><input class="input" type="number" name="${k}" value="${R[k]}" min="${min}" max="${max}" step="${step}"><span class="small muted" style="width:60px">${sufijo}</span></div></div>`;
  const sw = (k, label, desc = '') => `<div class="rule"><div><div class="bold small">${label}</div>${desc ? `<div class="tiny muted">${desc}</div>` : ''}</div><label class="switch"><input type="checkbox" name="${k}" ${R[k] ? 'checked' : ''}><span></span></label></div>`;
  view.innerHTML = `
  <form id="fr" class="grid-2e">
    <div>
      <div class="card mb"><h3>💳 Pago y liberación por falta de abono</h3>
        ${num('abonoPct', 'Porcentaje de abono', '%', 10, 100, 5)}
        ${num('minutosLiberacion', 'Plazo para pagar el abono (bloqueo temporal)', 'min', 1, 120)}
        ${sw('liberacionAutomatica', 'Liberación automática', 'Libera la franja al vencer el plazo y avisa a la lista de espera')}
      </div>
      <div class="card mb"><h3>⏰ Recordatorios</h3>
        ${sw('recordatorio24', 'Recordatorio 24 h antes', 'Pide confirmar asistencia')}
        ${sw('recordatorio2', 'Recordatorio 2 h antes', 'Incluye el código QR')}
        ${sw('canalWhatsapp', 'Enviar por WhatsApp')}
        ${sw('canalEmail', 'Enviar por correo')}
      </div>
    </div>
    <div>
      <div class="card mb"><h3>↩️ Política de cancelación y reembolso</h3>
        ${num('cancelacionHoras', 'Cancelación con reembolso total hasta', 'horas', 0, 168)}
        ${num('reembolsoPct', 'Reembolso si cancela después', '%', 0, 100, 5)}
      </div>
      <div class="card mb"><h3>🌙 Tarifas y mantenimiento</h3>
        ${num('nocheDesde', 'Tarifa nocturna desde la hora', 'h (0-23)', 0, 23)}
        ${sw('alertasMantenimiento', 'Alertas de mantenimiento', 'Mostrar aviso en el dashboard')}
      </div>
      <button class="btn btn-primary btn-block">Guardar reglas</button>
    </div>
  </form>
  <div class="card mt">
    <div class="between mb"><h3 style="margin:0">⚙️ Motor de tareas programadas <span class="tiny muted">(Celery + Redis simulado · corre cada 15 s)</span></h3><button class="btn btn-dark btn-sm" id="run">Ejecutar ahora</button></div>
    <div class="log" id="log">${Store.db.log.slice().reverse().slice(0, 60).map(l => `[${fmtTs(l.ts)}] ${esc(l.msg)}`).join('\n') || 'Sin actividad.'}</div>
  </div>`;
  const f = document.getElementById('fr');
  f.onsubmit = e => {
    e.preventDefault();
    f.querySelectorAll('input').forEach(i => { R[i.name] = i.type === 'checkbox' ? i.checked : Number(i.value); });
    Store.save(); toast('Reglas guardadas ✅', 'ok'); logTarea('Reglas automáticas actualizadas por ' + yo.nombre); Store.save(); reglas();
  };
  document.getElementById('run').onclick = () => { const n = Motor.ejecutarTareas(); toast(n ? `${n} acción(es) ejecutadas` : 'Nada pendiente por ejecutar'); reglas(); };
}

/* =========================================================
   LISTA DE ESPERA
   ========================================================= */
function espera() {
  const vigentes = Store.db.listaEspera.filter(w => parseYmd(w.fecha).getTime() + (w.hora + 1) * 3600000 > Date.now());
  const grupos = {};
  vigentes.forEach(w => { const k = `${w.canchaId}|${w.fecha}|${w.hora}`; (grupos[k] = grupos[k] || []).push(w); });
  const claves = Object.keys(grupos).sort((a, b) => { const [, fa, ha] = a.split('|'), [, fb, hb] = b.split('|'); return (fa + pad(ha)).localeCompare(fb + pad(hb)); });
  view.innerHTML = `
    <div class="alert info">ℹ️ <div>Cuando una franja se libera (cancelación o falta de abono) el sistema avisa automáticamente al primero de la cola. También puedes notificar manualmente.</div></div>
    ${claves.length ? claves.map(k => {
      const [cid, fecha, hora] = k.split('|');
      const c = getCancha(cid); const st = estadoFranja(c, fecha, Number(hora));
      const cola = grupos[k].sort((a, b) => a.creadoEn - b.creadoEn);
      return `<div class="card mb">
        <div class="between mb"><div><h3 style="margin:0">${esc(nombreCancha(c))} · ${fmtFecha(fecha)} ${fmtHora(Number(hora))}</h3><div class="tiny muted">${cola.length} en cola</div></div>
          <div class="flex">${st.libre ? '<span class="badge b-ok">Franja libre</span>' : `<span class="badge b-muted">${st.motivo}</span>`}
          <button class="btn btn-primary btn-sm" data-notif="${k}" ${st.libre ? '' : 'disabled title="La franja sigue ocupada"'}>Notificar cupo</button></div></div>
        <table class="tbl"><thead><tr><th>#</th><th>Jugador</th><th>Teléfono</th><th>En espera desde</th><th>Estado</th><th></th></tr></thead><tbody>
        ${cola.map((w, i) => `<tr><td class="bold">${i + 1}</td><td>${esc(getUser(w.usuarioId)?.nombre)}</td><td>${esc(getUser(w.usuarioId)?.telefono || '')}</td><td class="small">${fmtTs(w.creadoEn)}</td>
          <td>${w.notificado ? `<span class="badge b-ok">Notificado ${fmtTs(w.notificadoEn)}</span>` : '<span class="badge b-muted">En espera</span>'}</td>
          <td><div class="actions"><button class="btn btn-ghost btn-sm" data-quitar="${w.id}">Quitar</button></div></td></tr>`).join('')}
        </tbody></table></div>`;
    }).join('') : '<div class="empty"><div class="big">📭</div>No hay jugadores en lista de espera.</div>'}`;
  view.querySelectorAll('[data-notif]').forEach(b => b.onclick = () => {
    const [cid, fecha, hora] = b.dataset.notif.split('|');
    const w = Motor.avisarEspera(cid, fecha, Number(hora)); Store.save();
    toast(w ? `Aviso enviado a ${getUser(w.usuarioId).nombre} 🔔` : 'Todos en la cola ya fueron notificados', w ? 'ok' : ''); espera(); pintarSide('espera');
  });
  view.querySelectorAll('[data-quitar]').forEach(b => b.onclick = () => { Store.db.listaEspera = Store.db.listaEspera.filter(w => w.id !== b.dataset.quitar); Store.save(); espera(); pintarSide('espera'); });
}

/* =========================================================
   REPORTES
   ========================================================= */
let rep = { desde: addDays(today(), -29), hasta: today(), sede: '' };
function reportes() {
  const R = Motor.reporte(rep.desde, rep.hasta, rep.sede);
  const ingresos = R.porDia.reduce((s, d) => s + d.ingresos, 0);
  const reservas = R.porCancha.reduce((s, c) => s + c.reservas, 0);
  const horas = R.porCancha.reduce((s, c) => s + c.horas, 0);
  const disp = R.porDia.reduce((s, d) => s + d.disp, 0);
  const cancel = R.porCancha.reduce((s, c) => s + c.canceladas, 0);
  const libs = R.porCancha.reduce((s, c) => s + c.liberadas, 0);
  view.innerHTML = `
  <div class="toolbar">
    <label class="small bold">Desde</label><input type="date" class="input" id="d1" value="${rep.desde}">
    <label class="small bold">Hasta</label><input type="date" class="input" id="d2" value="${rep.hasta}">
    <select class="input" id="rs"><option value="">Todas las sedes</option>${Store.db.sedes.map(s => `<option value="${s.id}" ${s.id === rep.sede ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select>
    ${[7, 30, 90].map(n => `<button class="chip" data-n="${n}">${n} días</button>`).join('')}
    <span class="grow"></span>
    <button class="btn btn-outline btn-sm" id="csv">⬇ Exportar CSV</button>
    <button class="btn btn-dark btn-sm" id="pdf">⬇ Exportar PDF</button>
  </div>
  <div class="kpis">
    <div class="kpi dark"><div class="k-label">Ingresos del período</div><div class="k-val">${fmtCOP(ingresos)}</div><div class="k-foot">${fmtFecha(rep.desde)} – ${fmtFecha(rep.hasta)}</div></div>
    <div class="kpi accent"><div class="k-label">Ocupación promedio</div><div class="k-val">${disp ? Math.round(horas / disp * 100) : 0}%</div><div class="k-foot">${horas} de ${disp} horas</div></div>
    <div class="kpi"><div class="k-label">Reservas</div><div class="k-val">${reservas}</div><div class="k-foot">Ticket prom. ${fmtCOP(reservas ? ingresos / reservas : 0)}</div></div>
    <div class="kpi"><div class="k-label">Cancelaciones</div><div class="k-val">${cancel}</div><div class="k-foot">${libs} liberadas por falta de abono</div></div>
  </div>
  <div class="grid-2e">
    <div class="card"><h3>Ingresos por día</h3><div class="chart-box"><div id="ch1" style="height:100%"></div></div></div>
    <div class="card"><h3>Ocupación por día (%)</h3><div class="chart-box"><div id="ch2" style="height:100%"></div></div></div>
    <div class="card"><h3>Horas pico (reservas por hora de inicio)</h3><div class="chart-box"><div id="ch3" style="height:100%"></div></div></div>
    <div class="card"><h3>Detalle por cancha</h3><div class="table-wrap"><table class="tbl">
      <thead><tr><th>Cancha</th><th>Reservas</th><th>Horas</th><th>Ocupación</th><th>Ingresos</th></tr></thead>
      <tbody>${R.porCancha.sort((a, b) => b.ingresos - a.ingresos).map(x => `<tr><td>${esc(nombreCancha(x.cancha))}</td><td>${x.reservas}</td><td>${x.horas}</td>
        <td><div class="flex" style="gap:6px"><div style="width:60px;height:6px;border-radius:4px;background:#ecebe4"><div style="width:${Math.min(100, x.ocupacion)}%;height:100%;border-radius:4px;background:var(--pitch-2)"></div></div>${x.ocupacion}%</div></td>
        <td class="bold">${fmtCOP(x.ingresos)}</td></tr>`).join('')}</tbody></table></div>
      <p class="tiny muted mt">Sugerencia: revisa tarifas de canchas con ocupación menor al 30%.</p></div>
  </div>`;
  const upd = () => { rep.desde = document.getElementById('d1').value || rep.desde; rep.hasta = document.getElementById('d2').value || rep.hasta; rep.sede = document.getElementById('rs').value; if (rep.desde > rep.hasta) [rep.desde, rep.hasta] = [rep.hasta, rep.desde]; router(); };
  ['d1', 'd2', 'rs'].forEach(id => document.getElementById(id).onchange = upd);
  view.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { rep.hasta = today(); rep.desde = addDays(today(), -(Number(b.dataset.n) - 1)); router(); });
  document.getElementById('csv').onclick = () => {
    const filas = [['Fecha', 'Reservas', 'Horas reservadas', 'Horas disponibles', 'Ocupación %', 'Ingresos COP']]
      .concat(R.porDia.map(d => [d.fecha, d.reservas, d.horas, d.disp, d.ocupacion, d.ingresos]))
      .concat([[], ['Cancha', 'Reservas', 'Horas', 'Ocupación %', 'Ingresos COP', 'Canceladas', 'Liberadas']])
      .concat(R.porCancha.map(x => [nombreCancha(x.cancha), x.reservas, x.horas, x.ocupacion, x.ingresos, x.canceladas, x.liberadas]));
    descargar(`reporte_${rep.desde}_${rep.hasta}.csv`, filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n'));
    toast('CSV descargado', 'ok');
  };
  document.getElementById('pdf').onclick = () => window.print();

  // Gráficas propias en SVG (no requieren internet ni librerías)
  const etiquetas = R.porDia.map(d => fmtFecha(d.fecha, { corto: true }));
  const verde = '#2c8a4d';
  graficaBarras(document.getElementById('ch1'), etiquetas, R.porDia.map(d => d.ingresos), { color: () => verde, fmt: v => '$' + Math.round(v / 1000) + 'k', fmtTip: fmtCOP });
  graficaLinea(document.getElementById('ch2'), etiquetas, R.porDia.map(d => d.ocupacion), { color: '#27223c', fmt: v => v + '%' });
  const hs = Object.keys(R.porHora).map(Number).sort((a, b) => a - b);
  graficaBarras(document.getElementById('ch3'), hs.map(fmtHora), hs.map(h => R.porHora[h]), { color: i => hs[i] >= Store.db.reglas.nocheDesde ? '#27223c' : '#65a30d', fmt: v => String(Math.round(v)), fmtTip: v => v + ' reservas' });
  document.getElementById('ch3').insertAdjacentHTML('afterend', `<div class="legend"><span><i style="background:#65a30d"></i>Tarifa diurna</span><span><i style="background:#27223c"></i>Tarifa nocturna</span></div>`);
}

/* ---------------- Mini librería de gráficas SVG ---------------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function ejes(el, labels, max, fmt) {
  const W = el.clientWidth || 500, H = el.clientHeight || 260;
  const m = { l: 48, r: 10, t: 12, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const raw = max / 4 || 1; const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].find(x => x * p10 >= raw) * p10;
  const ticks = Math.max(1, Math.ceil(max / nice)), top = ticks * nice;
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= ticks; i++) {
    const v = nice * i, y = m.t + ih - ih * v / top;
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${i ? '#efeee6' : '#d6d4cb'}"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8a8999">${fmt(v)}</text>`;
  }
  const step = Math.ceil(labels.length / Math.max(1, Math.floor(iw / 56)));
  labels.forEach((l, i) => { if (i % step === 0) svg += `<text x="${m.l + iw * (i + .5) / labels.length}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8a8999">${esc(l)}</text>`; });
  return { W, H, m, iw, ih, top, svg };
}
function tooltip(el) {
  el.style.position = 'relative';
  let t = el.querySelector('.ch-tip');
  if (!t) { t = document.createElement('div'); t.className = 'ch-tip'; t.style.cssText = 'position:absolute;pointer-events:none;background:#1d1b2b;color:#fff;font-size:12px;padding:6px 10px;border-radius:10px;white-space:nowrap;opacity:0;transition:opacity .1s;transform:translate(-50%,-110%);z-index:5'; el.appendChild(t); }
  return { show: (x, y, html) => { t.innerHTML = html; t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.opacity = 1; }, hide: () => t.style.opacity = 0 };
}
function graficaBarras(el, labels, values, { color, fmt, fmtTip = fmt }) {
  const max = Math.max(...values, 1);
  const g = ejes(el, labels, max, fmt);
  const bw = Math.min(26, g.iw / labels.length - 4);
  let bars = '';
  values.forEach((v, i) => {
    const h = g.ih * v / g.top, x = g.m.l + g.iw * (i + .5) / labels.length - bw / 2, y = g.m.t + g.ih - h;
    const r = Math.min(4, h);
    bars += `<path d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + h} Z" fill="${color(i)}"/>`;
    bars += `<rect x="${g.m.l + g.iw * i / labels.length}" y="${g.m.t}" width="${g.iw / labels.length}" height="${g.ih}" fill="transparent" data-i="${i}" data-x="${x + bw / 2}" data-y="${y}"/>`;
  });
  el.innerHTML = g.svg + bars + '</svg>';
  const tt = tooltip(el);
  el.querySelectorAll('rect[data-i]').forEach(r => {
    r.addEventListener('mouseenter', () => { const i = +r.dataset.i; tt.show(+r.dataset.x, +r.dataset.y - 4, `<b>${esc(labels[i])}</b> · ${fmtTip(values[i])}`); });
    r.addEventListener('mouseleave', tt.hide);
  });
}
function graficaLinea(el, labels, values, { color, fmt }) {
  const max = Math.max(...values, 1);
  const g = ejes(el, labels, max, fmt);
  const pts = values.map((v, i) => [g.m.l + g.iw * (i + .5) / labels.length, g.m.t + g.ih - g.ih * v / g.top]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = d + ` L${pts[pts.length - 1][0]},${g.m.t + g.ih} L${pts[0][0]},${g.m.t + g.ih} Z`;
  el.innerHTML = g.svg + `<path d="${area}" fill="${color}" opacity=".07"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <line id="cross" y1="${g.m.t}" y2="${g.m.t + g.ih}" stroke="#bdbbb0" stroke-dasharray="3 3" opacity="0"/><circle id="dot" r="5" fill="${color}" stroke="#fff" stroke-width="2" opacity="0"/>
    <rect x="${g.m.l}" y="${g.m.t}" width="${g.iw}" height="${g.ih}" fill="transparent" id="hit"/></svg>`;
  const tt = tooltip(el), hit = el.querySelector('#hit'), cross = el.querySelector('#cross'), dot = el.querySelector('#dot');
  hit.addEventListener('mousemove', e => {
    const box = el.querySelector('svg').getBoundingClientRect();
    const i = Math.max(0, Math.min(values.length - 1, Math.floor((e.clientX - box.left - g.m.l) / g.iw * values.length)));
    const [x, y] = pts[i];
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', 1);
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('opacity', 1);
    tt.show(x, y - 6, `<b>${esc(labels[i])}</b> · ${fmt(values[i])}`);
  });
  hit.addEventListener('mouseleave', () => { tt.hide(); cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); });
}

/* =========================================================
   CUENTA Y SOPORTE
   ========================================================= */
function cuenta() {
  const esAdmin = yo.rol === 'admin';
  view.innerHTML = `
  <div class="grid-2">
    <div>
      ${esAdmin ? `<div class="card mb">
        <div class="between mb"><h3 style="margin:0">Usuarios y roles</h3><button class="btn btn-primary btn-sm" id="nuevo-u">+ Usuario del panel</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Activo</th></tr></thead><tbody>
        ${Store.db.usuarios.map(u => `<tr><td>${esc(u.nombre)}</td><td class="small">${esc(u.email)}</td>
          <td><select class="input" data-rol="${u.id}" style="padding:6px 10px" ${u.id === yo.id ? 'disabled' : ''}>${['jugador', 'recepcion', 'admin'].map(r => `<option ${u.rol === r ? 'selected' : ''} value="${r}">${r === 'admin' ? 'Administrador' : r === 'recepcion' ? 'Recepción' : 'Jugador'}</option>`).join('')}</select></td>
          <td><label class="switch"><input type="checkbox" data-act="${u.id}" ${u.activo !== false ? 'checked' : ''} ${u.id === yo.id ? 'disabled' : ''}><span></span></label></td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      <div class="card">
        <h3>Ayuda y feedback</h3>
        <form id="ff">
          <div class="field"><label>Tipo</label><select class="input" name="tipo"><option>Sugerencia</option><option>Error en el sistema</option><option>Pregunta</option></select></div>
          <div class="field"><label>Mensaje</label><textarea class="input" name="msg" rows="3" required placeholder="Cuéntanos qué podemos mejorar"></textarea></div>
          <button class="btn btn-dark">Enviar</button>
        </form>
        ${(Store.db.feedback || []).length ? `<div class="mt">${Store.db.feedback.slice().reverse().slice(0, 5).map(f => `<div class="notif mt-s"><div><b class="small">${esc(f.tipo)}</b> · <span class="tiny muted">${esc(f.por)} · ${fmtTs(f.ts)}</span><div class="small">${esc(f.msg)}</div></div></div>`).join('')}</div>` : ''}
      </div>
    </div>
    <div>
      <form class="card mb" id="fp">
        <h3>Mi perfil</h3>
        <div class="field"><label>Nombre</label><input class="input" name="nombre" value="${esc(yo.nombre)}" required></div>
        <div class="field"><label>Correo</label><input class="input" name="email" type="email" value="${esc(yo.email)}" required></div>
        <div class="field"><label>Nueva contraseña</label><input class="input" name="pass" type="password" placeholder="Dejar vacío para no cambiar"></div>
        <button class="btn btn-primary">Guardar</button>
      </form>
      ${esAdmin ? `<div class="card">
        <h3>Auditoría y backup de datos</h3>
        <p class="small muted">Descarga una copia de toda la base de datos (JSON) o restaura una copia anterior.</p>
        <div class="flex" style="flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="bk">⬇ Descargar backup</button>
          <label class="btn btn-outline btn-sm">⬆ Restaurar<input type="file" id="rest" accept=".json" hidden></label>
          <button class="btn btn-danger btn-sm" id="reset">Restablecer datos de ejemplo</button>
        </div>
        <p class="tiny muted mt">Registros: ${Store.db.reservas.length} reservas · ${Store.db.pagos.length} pagos · ${Store.db.usuarios.length} usuarios.</p>
      </div>` : ''}
    </div>
  </div>`;

  view.querySelectorAll('[data-rol]').forEach(s => s.onchange = () => { getUser(s.dataset.rol).rol = s.value; Store.save(); toast('Rol actualizado', 'ok'); });
  view.querySelectorAll('[data-act]').forEach(s => s.onchange = () => { getUser(s.dataset.act).activo = s.checked; Store.save(); toast(s.checked ? 'Usuario activado' : 'Usuario desactivado'); });
  document.getElementById('nuevo-u')?.addEventListener('click', () => {
    const m = openModal(`<h3>Nuevo usuario del panel</h3><form id="fu">
      <div class="field"><label>Nombre</label><input class="input" name="nombre" required></div>
      <div class="field"><label>Correo</label><input class="input" type="email" name="email" required></div>
      <div class="row"><div class="field"><label>Contraseña</label><input class="input" name="pass" required minlength="4"></div>
      <div class="field"><label>Rol</label><select class="input" name="rol"><option value="recepcion">Recepción</option><option value="admin">Administrador</option></select></div></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary">Crear</button></div></form>`);
    m.querySelector('[data-close]').onclick = closeModal;
    m.querySelector('#fu').onsubmit = e => {
      e.preventDefault(); const f = e.target;
      if (Store.db.usuarios.some(u => u.email.toLowerCase() === f.email.value.trim().toLowerCase())) return toast('Ese correo ya existe', 'err');
      Store.db.usuarios.push({ id: uid('u'), nombre: f.nombre.value.trim(), email: f.email.value.trim(), password: f.pass.value, rol: f.rol.value, activo: true });
      Store.save(); closeModal(); toast('Usuario creado', 'ok'); cuenta();
    };
  });
  document.getElementById('ff').onsubmit = e => {
    e.preventDefault();
    Store.db.feedback = Store.db.feedback || [];
    Store.db.feedback.push({ tipo: e.target.tipo.value, msg: e.target.msg.value.trim(), por: yo.nombre, ts: Date.now() });
    Store.save(); toast('¡Gracias por tu feedback!', 'ok'); cuenta();
  };
  document.getElementById('fp').onsubmit = e => {
    e.preventDefault(); const f = e.target; const u = getUser(yo.id);
    u.nombre = f.nombre.value.trim(); u.email = f.email.value.trim(); if (f.pass.value) u.password = f.pass.value;
    Object.assign(yo, u); Store.save(); toast('Perfil actualizado', 'ok'); pintarSide('cuenta');
  };
  document.getElementById('bk')?.addEventListener('click', () => descargar(`backup_canchapp_${today()}.json`, JSON.stringify(Store.db, null, 2), 'application/json'));
  document.getElementById('rest')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(String(rd.result).replace(/^﻿/, ''));
        if (!data.reservas || !data.canchas) throw new Error();
        localStorage.setItem(DB_KEY, JSON.stringify(data)); Store.load(); toast('Backup restaurado ✅', 'ok'); router();
      } catch (err) { toast('Archivo de backup no válido', 'err'); }
    };
    rd.readAsText(file);
  });
  document.getElementById('reset')?.addEventListener('click', async () => {
    if (!await confirmar('Restablecer datos', 'Se borrarán todos los cambios y se cargarán los datos de ejemplo.', { ok: 'Restablecer', danger: true })) return;
    Store.reset(); toast('Datos restablecidos', 'ok'); router();
  });
}

/* ---------------- Arranque ---------------- */
if (yo) {
  document.getElementById('salir').onclick = () => Auth.logout();
  document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  window.addEventListener('hashchange', router);
  // Cambios hechos desde la app del jugador en otra pestaña
  window.addEventListener('storage', e => { if (e.key === DB_KEY) { Store.load(); if (!document.getElementById('modal-back') && ['dashboard', 'agenda', 'pagos', 'espera'].includes(currentKey())) router(); else pintarSide(currentKey()); } });
  // Tareas programadas (simulan Celery + Redis)
  setInterval(() => {
    const n = Motor.ejecutarTareas();
    if (n && !document.getElementById('modal-back') && ['dashboard', 'agenda', 'pagos'].includes(currentKey())) router();
    else pintarSide(currentKey());
  }, 15000);
  router();
}
