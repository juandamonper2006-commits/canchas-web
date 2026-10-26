/* =========================================================
   CanchApp - Portal del jugador (versión web de la app móvil)
   Rutas (hash):
     #/inicio              Home: búsqueda, categorías, canchas cerca
     #/cancha/:id          Detalle de la cancha
     #/reservar/:id        Elegir día, hora y duración
     #/pago/:reservaId     Resumen + pago del abono (franja bloqueada)
     #/reservas            Mis reservas (próximas / historial)
     #/reserva/:id         Detalle con QR, pagar saldo, reprogramar, cancelar, calificar
     #/favoritas           Canchas favoritas, reservar de nuevo, lista de espera
     #/perfil              Datos del grupo, métodos de pago, notificaciones
     #/notificaciones      Bandeja de avisos
   ========================================================= */

const yo = Auth.require(['jugador']);
const view = document.getElementById('view');
let filtroTipo = null;
let busqueda = '';
let intervalo = null;
const sel = { canchaId: null, fecha: today(), hora: null, dur: 1 };

/* ---------------- Navegación ---------------- */
const NAV = [
  { href: '#/inicio', key: 'inicio', label: 'Inicio', ico: I.home },
  { href: '#/reservas', key: 'reservas', label: 'Reservas', ico: I.pin },
  { href: '#/favoritas', key: 'favoritas', label: 'Favoritas', ico: I.heart },
  { href: '#/perfil', key: 'perfil', label: 'Perfil', ico: I.user },
];
function pintarNav(activa) {
  document.getElementById('nav-desktop').innerHTML = NAV.map(n => `<a href="${n.href}" class="${n.key === activa ? 'active' : ''}">${n.ico}${n.label}</a>`).join('');
  document.getElementById('nav-bottom').innerHTML = NAV.map(n => `<a href="${n.href}" class="${n.key === activa ? 'active' : ''}"><span class="bi">${n.ico}</span>${n.label}</a>`).join('');
  const sinLeer = Store.db.notificaciones.filter(n => n.usuarioId === yo.id && !n.leida).length;
  document.getElementById('bell').innerHTML = I.bell + (sinLeer ? `<span class="dot">${sinLeer}</span>` : '');
}

const RUTAS = [
  [/^\/inicio$/, inicio, 'inicio'],
  [/^\/cancha\/(\w+)$/, detalleCancha, 'inicio'],
  [/^\/reservar\/(\w+)$/, reservar, 'inicio'],
  [/^\/pago\/(\w+)$/, pago, 'inicio'],
  [/^\/reservas$/, misReservas, 'reservas'],
  [/^\/reserva\/(\w+)$/, detalleReserva, 'reservas'],
  [/^\/favoritas$/, favoritas, 'favoritas'],
  [/^\/perfil$/, perfil, 'perfil'],
  [/^\/notificaciones$/, notificaciones, ''],
];
function router() {
  clearInterval(intervalo);
  const path = location.hash.replace(/^#/, '') || '/inicio';
  for (const [re, fn, nav] of RUTAS) {
    const m = path.match(re);
    if (m) { pintarNav(nav); fn(...m.slice(1)); return; }
  }
  location.hash = '#/inicio';
}
function ir(hash) { if (location.hash === hash) router(); else location.hash = hash; window.scrollTo(0, 0); }

/* ---------------- Componentes ---------------- */
function tarjetaCancha(c) {
  const fav = misFavoritas(yo.id).includes(c.id);
  const sede = getSede(c.sedeId);
  return `
  <article class="c-card" data-cancha="${c.id}">
    <div class="c-img">
      <span class="c-rate">⭐ ${c.rating.toFixed(1)}</span>
      <button class="c-fav" data-fav="${c.id}" title="Favorita">${fav ? '❤️' : '🤍'}</button>
      <span class="ball">⚽</span>
    </div>
    <div class="c-body">
      <h4>${esc(sede.nombre)} · ${esc(c.nombre)}</h4>
      <div class="addr">${esc(sede.direccion)}</div>
      <div class="between">
        <span class="price">${fmtCOP(c.precioDia)} / hora · ${c.tipo}</span>
        ${c.mantenimiento ? '<span class="badge b-warn">Mantenimiento</span>' : ''}
      </div>
    </div>
  </article>`;
}
function enlazarTarjetas(root) {
  root.querySelectorAll('[data-cancha]').forEach(el => el.addEventListener('click', () => ir(`#/cancha/${el.dataset.cancha}`)));
  root.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const ahora = toggleFavorita(yo.id, b.dataset.fav);
    b.textContent = ahora ? '❤️' : '🤍';
    toast(ahora ? 'Agregada a favoritas' : 'Quitada de favoritas');
  }));
}
function proximasDe(uidv) {
  return reservasDeUsuario(uidv).filter(r => ['pendiente_pago', 'confirmada', 'en_curso'].includes(r.estado) && endTs(r) > Date.now());
}
function itemReserva(r) {
  const extra = r.estado === 'pendiente_pago' ? `<div class="tiny" style="color:#9a5b00">Paga el abono antes de ${new Date(r.venceEn).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>` : '';
  return `
  <div class="res-item" data-res="${r.id}">
    <div>
      <h4>${esc(nombreCancha(r.canchaId))}</h4>
      <div class="small muted">${fmtFecha(r.fecha)} · ${fmtHora(r.hora)} · ${fmtDur(r.duracion)}</div>
      ${extra}
    </div>
    <div style="text-align:right">${badge(r.estado)}<div class="tiny muted mt-s">${fmtCOP(r.total)}</div></div>
  </div>`;
}
function enlazarReservas(root) {
  root.querySelectorAll('[data-res]').forEach(el => el.addEventListener('click', () => ir(`#/reserva/${el.dataset.res}`)));
}

/* ---------------- HOME ---------------- */
function inicio() {
  const prox = proximasDe(yo.id)[0];
  const favs = misFavoritas(yo.id).map(getCancha).filter(Boolean);
  view.innerHTML = `
    <section class="hero-search">
      <h2>Hola, ${esc(yo.nombre.split(' ')[0])} 👋</h2>
      <div class="small" style="color:#4b5a2a">¿Dónde jugamos hoy?</div>
      <label class="searchbar">${I.search}<input id="q" placeholder="Busca tu cancha favorita" value="${esc(busqueda)}"></label>
    </section>

    ${prox ? `
    <div class="next-res" data-res="${prox.id}" style="cursor:pointer">
      <div class="when">${fmtHora(prox.hora)}<small>${fmtFecha(prox.fecha)}</small></div>
      <div class="grow">
        <div class="tiny" style="color:#bdb8d6">Tu próxima reserva</div>
        <div class="bold">${esc(nombreCancha(prox.canchaId))}</div>
        <div class="tiny" style="color:#bdb8d6">${ESTADOS[prox.estado]} · ${prox.saldoPagado ? 'Saldo pagado' : 'Saldo en sede ' + fmtCOP(prox.saldo)}</div>
      </div>
      <span class="btn btn-primary btn-sm">${I.qr} Ver QR</span>
    </div>` : ''}

    <div class="between"><h3 class="p-sub">Categorías</h3></div>
    <div class="cats">
      ${Object.entries(TIPOS).map(([k, t]) => `<button class="cat ${filtroTipo === k ? 'active' : ''}" data-tipo="${k}"><span class="ico">${t.ico}</span>${t.label}</button>`).join('')}
    </div>

    ${favs.length ? `
    <div class="between"><h3 class="p-sub">Reservar de nuevo</h3><a href="#/favoritas" class="small muted">Ver favoritas</a></div>
    <div class="flex mt-s mb" style="flex-wrap:wrap">
      ${favs.map(c => `<button class="chip" data-again="${c.id}">❤️ ${esc(nombreCancha(c))}</button>`).join('')}
    </div>` : ''}

    <div class="between mb"><h3 class="p-sub" id="tit-lista">Canchas cerca de ti</h3><a href="#" id="ver-todas" class="small muted">Ver todas</a></div>
    <div class="grid-canchas" id="lista"></div>
  `;
  view.querySelector('.next-res')?.addEventListener('click', () => ir(`#/reserva/${prox.id}`));
  view.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => {
    filtroTipo = filtroTipo === b.dataset.tipo ? null : b.dataset.tipo;
    view.querySelectorAll('[data-tipo]').forEach(x => x.classList.toggle('active', x.dataset.tipo === filtroTipo));
    pintarLista();
  }));
  view.querySelectorAll('[data-again]').forEach(b => b.addEventListener('click', () => reservarDeNuevo(b.dataset.again)));
  document.getElementById('ver-todas').addEventListener('click', e => {
    e.preventDefault(); filtroTipo = null; busqueda = ''; document.getElementById('q').value = '';
    view.querySelectorAll('[data-tipo]').forEach(x => x.classList.remove('active'));
    pintarLista();
  });
  document.getElementById('q').addEventListener('input', e => { busqueda = e.target.value; pintarLista(); });
  pintarLista();
}
function pintarLista() {
  const q = busqueda.trim().toLowerCase();
  const lista = Store.db.canchas.filter(c => c.activa)
    .filter(c => !filtroTipo || c.tipo === filtroTipo)
    .filter(c => !q || `${nombreCancha(c)} ${getSede(c.sedeId).direccion} ${TIPOS[c.tipo].label}`.toLowerCase().includes(q));
  document.getElementById('tit-lista').textContent = filtroTipo ? TIPOS[filtroTipo].label : (q ? 'Resultados' : 'Canchas cerca de ti');
  const cont = document.getElementById('lista');
  cont.innerHTML = lista.length ? lista.map(tarjetaCancha).join('') : `<div class="empty" style="grid-column:1/-1"><div class="big">🔍</div>No encontramos canchas con ese filtro.</div>`;
  enlazarTarjetas(cont);
}

/* ---------------- DETALLE DE CANCHA ---------------- */
function detalleCancha(id) {
  const c = getCancha(id); if (!c) return ir('#/inicio');
  const sede = getSede(c.sedeId);
  const fav = misFavoritas(yo.id).includes(c.id);
  const libresHoy = horasCancha(c).filter(h => estadoFranja(c, today(), h).libre);
  view.innerHTML = `
  <div class="detail-wrap">
    <div>
      <div class="detail-hero">
        <button class="round-btn back" onclick="history.back()" title="Volver">${I.back}</button>
        <button class="round-btn fav" id="fav">${fav ? '❤️' : '🤍'}</button>
        <span>⚽</span>
      </div>
      <div style="text-align:center;margin:18px 0 6px">
        <h2 style="font-size:22px">${esc(sede.nombre)} · ${esc(c.nombre)} <span class="stars" style="font-size:15px">★</span> <span class="small">${c.rating.toFixed(1)}</span></h2>
        <div class="small muted">${esc(sede.direccion)}</div>
        <div class="bold mt-s">${fmtCOP(c.precioDia)} / hora · ${c.tipo}</div>
        <div class="tiny muted">Nocturna (desde ${fmtHora(Store.db.reglas.nocheDesde)}): ${fmtCOP(c.precioNoche)} / hora · Horario ${fmtHora(c.apertura)} – ${fmtHora(c.cierre)}</div>
      </div>
      <h3 class="p-sub mt">Acerca de la cancha</h3>
      <p class="small" style="color:var(--ink-2)">${esc(c.descripcion)}</p>
      <h3 class="p-sub">Servicios</h3>
      <div class="services">
        ${c.servicios.map(s => `<div class="service"><div class="s-ico">${SERVICIOS[s].ico}</div>${SERVICIOS[s].label}</div>`).join('')}
      </div>
    </div>
    <aside class="card">
      ${c.mantenimiento ? '<div class="alert warn">🛠 Esta cancha está en mantenimiento. No se puede reservar por ahora.</div>' : ''}
      <h3>Disponible hoy</h3>
      ${libresHoy.length
        ? `<div class="flex" style="flex-wrap:wrap">${libresHoy.slice(0, 8).map(h => `<button class="chip" data-h="${h}">${fmtHora(h)}</button>`).join('')}</div>`
        : '<p class="small muted">No quedan horarios hoy. Revisa otros días.</p>'}
      <div class="policy mt">🛡 Abono del ${Store.db.reglas.abonoPct}% para confirmar. Cancelación gratis hasta ${Store.db.reglas.cancelacionHoras} h antes; después se reembolsa el ${Store.db.reglas.reembolsoPct}% del abono.</div>
      <button class="btn btn-primary btn-block mt" id="go" ${c.mantenimiento ? 'disabled' : ''}>Continuar a reservar</button>
    </aside>
  </div>`;
  document.getElementById('fav').onclick = e => { const a = toggleFavorita(yo.id, c.id); e.currentTarget.textContent = a ? '❤️' : '🤍'; toast(a ? 'Agregada a favoritas' : 'Quitada de favoritas'); };
  const empezar = (hora = null) => { Object.assign(sel, { canchaId: c.id, fecha: today(), hora, dur: 1 }); ir(`#/reservar/${c.id}`); };
  document.getElementById('go').onclick = () => empezar();
  view.querySelectorAll('[data-h]').forEach(b => b.onclick = () => empezar(Number(b.dataset.h)));
}

/* ---------------- RESERVAR: día, duración y hora ---------------- */
function reservar(id) {
  const c = getCancha(id); if (!c) return ir('#/inicio');
  if (sel.canchaId !== id) Object.assign(sel, { canchaId: id, fecha: today(), hora: null, dur: 1 });
  const dias = Array.from({ length: 7 }, (_, i) => addDays(today(), i));

  function pintar() {
    const horas = horasCancha(c).filter(h => !(sel.fecha === today() && parseYmd(sel.fecha).getTime() + h * 3600000 < Date.now()));
    if (sel.hora != null && !estadoFranja(c, sel.fecha, sel.hora, sel.dur).libre) sel.hora = null;
    const p = sel.hora != null ? calcular(c, sel.hora, sel.dur) : null;
    const libres = horas.filter(h => estadoFranja(c, sel.fecha, h, sel.dur).libre);
    view.innerHTML = `
    <a href="#/cancha/${c.id}" class="small muted flex" style="gap:4px">${I.back} ${esc(nombreCancha(c))}</a>
    <h1 class="p-title">Reservar cancha</h1>
    <div class="detail-wrap">
      <div>
        <h3 class="p-sub mb">Elige el día</h3>
        <div class="days">
          ${dias.map(d => { const dt = parseYmd(d); return `<button class="day ${d === sel.fecha ? 'active' : ''}" data-d="${d}"><small>${DIAS[dt.getDay()]}</small><b>${dt.getDate()}</b></button>`; }).join('')}
        </div>
        <h3 class="p-sub mt mb">Duración</h3>
        <div class="flex">${[1, 1.5, 2].map(d => `<button class="chip ${sel.dur === d ? 'active' : ''}" data-dur="${d}">${fmtDur(d)}</button>`).join('')}</div>
        <h3 class="p-sub mt mb">Elige la hora</h3>
        ${horas.length ? `<div class="hours">
          ${horas.map(h => {
            const st = estadoFranja(c, sel.fecha, h, sel.dur);
            const cls = st.libre ? (sel.hora === h ? 'active' : '') : 'busy' + (st.motivo === 'En proceso' ? ' lock' : '');
            const sub = st.libre ? fmtCOP(precioHora(c, h)) : st.motivo;
            return `<button class="hour ${cls}" data-h="${h}" data-libre="${st.libre}">${fmtHora(h)}<small>${sub}</small></button>`;
          }).join('')}
        </div>` : '<div class="empty"><div class="big">🌙</div>Ya no hay horarios para este día.</div>'}
        ${!libres.length && horas.length ? '<div class="alert info mt">No hay franjas libres este día. Toca una hora ocupada para unirte a la lista de espera o prueba otro día.</div>' : ''}
        <p class="tiny muted mt">Toca una hora <b>ocupada</b> para unirte a la lista de espera. Se actualiza en tiempo real.</p>
      </div>
      <aside>
        <div class="summary">
          <div class="bold mb">${esc(nombreCancha(c))}</div>
          ${p ? `
            <div class="line"><span class="muted">${fmtFecha(sel.fecha)} · ${fmtRango(sel.hora, sel.dur)}</span></div>
            <div class="line"><span>Total (${fmtDur(sel.dur)})</span><span>${fmtCOP(p.total)}</span></div>
            <div class="line"><span class="bold">Abono hoy (${Store.db.reglas.abonoPct} %)</span><span class="bold">${fmtCOP(p.abono)}</span></div>
            <div class="line"><span>Saldo en la sede</span><span>${fmtCOP(p.saldo)}</span></div>`
          : '<p class="small muted">Selecciona una hora disponible para ver el resumen.</p>'}
          <div class="policy">Cancelas gratis hasta ${Store.db.reglas.cancelacionHoras} h antes. Después se reembolsa el ${Store.db.reglas.reembolsoPct}% del abono.</div>
        </div>
        <button class="btn btn-primary btn-block mt" id="continuar" ${p ? '' : 'disabled'}>Pagar abono</button>
        <p class="tiny muted mt-s" style="text-align:center">🔒 Al continuar bloqueamos la franja ${Store.db.reglas.minutosLiberacion} min mientras pagas.</p>
      </aside>
    </div>`;
    view.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { sel.fecha = b.dataset.d; sel.hora = null; pintar(); });
    view.querySelectorAll('[data-dur]').forEach(b => b.onclick = () => { sel.dur = Number(b.dataset.dur); pintar(); });
    view.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
      const h = Number(b.dataset.h);
      if (b.dataset.libre === 'true') { sel.hora = h; pintar(); }
      else ofrecerEspera(c, sel.fecha, h);
    });
    document.getElementById('continuar').onclick = () => {
      const r = Motor.bloquear(yo.id, c.id, sel.fecha, sel.hora, sel.dur);
      if (r.error) { toast(r.error, 'err'); pintar(); return; }
      ir(`#/pago/${r.reserva.id}`);
    };
  }
  pintar();
  // Disponibilidad en tiempo real: refresca por si otro usuario reservó
  intervalo = setInterval(() => { Store.load(); if (!document.getElementById('modal-back')) pintar(); }, 8000);
}

function ofrecerEspera(c, fecha, hora) {
  const st = estadoFranja(c, fecha, hora);
  if (st.motivo === 'Cierre' || st.motivo === 'Pasada') return;
  // Sugerir horarios alternativos cercanos
  const alternativas = horasCancha(c).filter(h => Math.abs(h - hora) <= 3 && estadoFranja(c, fecha, h, sel.dur).libre).slice(0, 4);
  const otras = Store.db.canchas.filter(x => x.id !== c.id && x.tipo === c.tipo && estadoFranja(x, fecha, hora, sel.dur).libre).slice(0, 3);
  const m = openModal(`
    <h3>Franja ${st.motivo === 'En proceso' ? 'en proceso de pago' : 'ocupada'}</h3>
    <p class="muted small">${esc(nombreCancha(c))} · ${fmtFecha(fecha)} · ${fmtHora(hora)}</p>
    ${alternativas.length ? `<p class="small bold">Horarios cercanos libres en esta cancha:</p><div class="flex" style="flex-wrap:wrap">${alternativas.map(h => `<button class="chip" data-alt="${h}">${fmtHora(h)}</button>`).join('')}</div>` : ''}
    ${otras.length ? `<p class="small bold mt">Otras canchas ${TIPOS[c.tipo].label} libres a esa hora:</p><div class="flex" style="flex-wrap:wrap">${otras.map(x => `<button class="chip" data-otra="${x.id}">${esc(nombreCancha(x))}</button>`).join('')}</div>` : ''}
    <div class="alert info mt">🔔 Únete a la lista de espera y te avisamos por WhatsApp si la franja se libera.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cerrar</button>
      <button class="btn btn-dark" id="espera">Unirme a lista de espera</button>
    </div>`);
  m.querySelectorAll('[data-alt]').forEach(b => b.onclick = () => { closeModal(); sel.hora = Number(b.dataset.alt); router(); });
  m.querySelectorAll('[data-otra]').forEach(b => b.onclick = () => { closeModal(); Object.assign(sel, { canchaId: b.dataset.otra, fecha, hora, dur: sel.dur }); ir(`#/reservar/${b.dataset.otra}`); });
  m.querySelector('#espera').onclick = () => {
    const r = Motor.unirseEspera(yo.id, c.id, fecha, hora);
    closeModal();
    toast(r.error || 'Te uniste a la lista de espera 🔔', r.error ? 'err' : 'ok');
  };
}

/* ---------------- PAGO DEL ABONO ---------------- */
function pago(resId) {
  Motor.ejecutarTareas();
  const r = getReserva(resId);
  if (!r || r.usuarioId !== yo.id) return ir('#/inicio');
  if (r.estado !== 'pendiente_pago') {
    view.innerHTML = `<div class="empty"><div class="big">${r.estado === 'liberada' ? '⌛' : '✅'}</div>
      <p>${r.estado === 'liberada' ? 'El tiempo para pagar venció y la franja fue liberada.' : 'Esta reserva ya fue pagada.'}</p>
      <a class="btn btn-primary" href="${r.estado === 'liberada' ? '#/reservar/' + r.canchaId : '#/reserva/' + r.id}">${r.estado === 'liberada' ? 'Elegir otra franja' : 'Ver reserva'}</a></div>`;
    return;
  }
  const c = getCancha(r.canchaId);
  const guardados = Store.db.metodosGuardados[yo.id] || [];
  let metodo = guardados[0] || 'nequi';
  const pol = Motor.politica(r);

  view.innerHTML = `
  <a href="#" id="volver" class="small muted flex" style="gap:4px">${I.back} Cambiar horario</a>
  <div class="between"><h1 class="p-title">Resumen y pago</h1><span class="timer" id="timer">⏳ --:--</span></div>
  <div class="detail-wrap">
    <div>
      <div class="summary">
        <div class="bold">${esc(nombreCancha(c))}</div>
        <div class="small muted mb">${fmtFechaLarga(r.fecha)} · ${fmtRango(r.hora, r.duracion)}</div>
        <div class="line"><span>Total (${fmtDur(r.duracion)})</span><span>${fmtCOP(r.total)}</span></div>
        <div class="line"><span>Abono hoy (${Store.db.reglas.abonoPct} %)</span><span>${fmtCOP(r.abono)}</span></div>
        <div class="line"><span>Saldo en la sede</span><span>${fmtCOP(r.saldo)}</span></div>
        <div class="line total"><span>A pagar ahora</span><span>${fmtCOP(r.abono)}</span></div>
        <div class="policy"><b>Política de cancelación:</b> si cancelas con ${Store.db.reglas.cancelacionHoras} h o más de anticipación te devolvemos el 100% del abono; con menos tiempo, el ${Store.db.reglas.reembolsoPct}%. ${pol.horas < Store.db.reglas.cancelacionHoras ? '<br>⚠️ Tu partido es en menos de ' + Store.db.reglas.cancelacionHoras + ' h.' : ''}</div>
      </div>
    </div>
    <aside>
      <h3 class="p-sub mb">Método de pago</h3>
      <div class="pay-methods">
        ${['nequi', 'daviplata', 'tarjeta', 'pse'].map(k => `<button class="pay-m ${k === metodo ? 'active' : ''}" data-m="${k}"><span class="pm-ico">${METODOS[k].ico}</span>${METODOS[k].label}</button>`).join('')}
      </div>
      <label class="check mt"><input type="checkbox" id="guardar" ${guardados.includes(metodo) ? 'checked' : ''}> Guardar este método</label>
      <label class="check mt-s tiny muted"><input type="checkbox" id="fallo"> Simular pago rechazado (demo)</label>
      <button class="btn btn-primary btn-block mt" id="pagar">Pagar abono ${fmtCOP(r.abono)}</button>
      <button class="btn btn-ghost btn-block mt-s" id="soltar">Cancelar y liberar la franja</button>
    </aside>
  </div>`;

  view.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    metodo = b.dataset.m;
    view.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('active', x === b));
  });
  // Si el jugador se arrepiente antes de pagar, se elimina el bloqueo temporal
  const soltar = () => { const x = getReserva(resId); if (x && x.estado === 'pendiente_pago') { Store.db.reservas = Store.db.reservas.filter(y => y.id !== resId); Store.save(); } };
  document.getElementById('volver').onclick = e => { e.preventDefault(); soltar(); Object.assign(sel, { canchaId: r.canchaId, fecha: r.fecha, hora: null, dur: r.duracion }); ir(`#/reservar/${r.canchaId}`); };
  document.getElementById('soltar').onclick = () => { soltar(); toast('Franja liberada'); ir(`#/cancha/${r.canchaId}`); };

  document.getElementById('pagar').onclick = e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Procesando pago…';
    setTimeout(() => {
      if (document.getElementById('fallo').checked) {
        btn.disabled = false; btn.textContent = `Reintentar pago ${fmtCOP(r.abono)}`;
        openModal(`<h3>Pago rechazado ❌</h3><p class="muted">Tu entidad no aprobó la transacción. Puedes reintentar o cambiar de método. La franja sigue bloqueada para ti hasta que se acabe el tiempo.</p><div class="modal-actions"><button class="btn btn-primary" data-close>Entendido</button></div>`);
        return;
      }
      const res = Motor.pagarAbono(r.id, metodo);
      if (res.error) { toast(res.error, 'err'); router(); return; }
      if (document.getElementById('guardar').checked) {
        const g = Store.db.metodosGuardados[yo.id] = Store.db.metodosGuardados[yo.id] || [];
        if (!g.includes(metodo)) { g.push(metodo); Store.save(); }
      }
      clearInterval(intervalo);
      const m = openModal(`
        <h3>¡Reserva confirmada! ✅</h3>
        <p class="small muted" style="margin:0">${esc(nombreCancha(c))}</p>
        <p class="small muted" style="margin:0">${fmtFecha(r.fecha)} · ${fmtHora(r.hora)}</p>
        <p class="small muted" style="margin:0">Abono pagado: ${fmtCOP(r.abono)} · Código <b>${r.codigo}</b></p>
        <div class="qr" id="qr-modal" style="display:flex;justify-content:center;margin:14px 0"></div>
        <div class="modal-actions">
          <a class="btn btn-outline" target="_blank" rel="noopener" href="${linkWhatsapp(r)}">Compartir al grupo</a>
          <button class="btn btn-primary" id="listo">Listo</button>
        </div>`, { onClose: () => ir(`#/reserva/${r.id}`) });
      renderQR(m.querySelector('#qr-modal'), r.codigo, 140);
      m.querySelector('#listo').onclick = () => { closeModal(); ir(`#/reserva/${r.id}`); };
    }, 1100);
  };

  const tick = () => {
    const ms = r.venceEn - Date.now();
    const el = document.getElementById('timer');
    if (!el) return clearInterval(intervalo);
    if (ms <= 0) { clearInterval(intervalo); Motor.ejecutarTareas(); router(); return; }
    el.textContent = `⏳ Franja reservada para ti: ${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;
  };
  tick(); intervalo = setInterval(tick, 1000);
}

function linkWhatsapp(r) {
  const txt = `⚽ ¡Partido confirmado!\n${nombreCancha(r.canchaId)}\n📍 ${getSede(getCancha(r.canchaId).sedeId).direccion}\n📅 ${fmtFechaLarga(r.fecha)} · ${fmtRango(r.hora, r.duracion)}\nCódigo: ${r.codigo}\nSaldo en sede: ${fmtCOP(r.saldoPagado ? 0 : r.saldo)}`;
  return 'https://wa.me/?text=' + encodeURIComponent(txt);
}

/* ---------------- MIS RESERVAS ---------------- */
let tabReservas = 'proximas';
function misReservas() {
  Motor.ejecutarTareas();
  const todas = reservasDeUsuario(yo.id);
  const prox = todas.filter(r => ['pendiente_pago', 'confirmada', 'en_curso'].includes(r.estado));
  const hist = todas.filter(r => ['finalizada', 'cancelada', 'liberada'].includes(r.estado)).reverse();
  const lista = tabReservas === 'proximas' ? prox : hist;
  view.innerHTML = `
    <h1 class="p-title">Mis reservas</h1>
    <div class="tabs">
      <button class="chip ${tabReservas === 'proximas' ? 'active' : ''}" data-t="proximas">Próximas (${prox.length})</button>
      <button class="chip ${tabReservas === 'historial' ? 'active' : ''}" data-t="historial">Historial (${hist.length})</button>
    </div>
    <div class="res-list">
      ${lista.length ? lista.map(itemReserva).join('') : `<div class="empty"><div class="big">📅</div>${tabReservas === 'proximas' ? 'No tienes reservas próximas.' : 'Aún no tienes historial.'}<br><a href="#/inicio" class="btn btn-primary mt">Buscar cancha</a></div>`}
    </div>`;
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tabReservas = b.dataset.t; misReservas(); });
  enlazarReservas(view);
}

/* ---------------- DETALLE DE RESERVA ---------------- */
function detalleReserva(id) {
  Motor.ejecutarTareas();
  const r = getReserva(id);
  if (!r || r.usuarioId !== yo.id) return ir('#/reservas');
  const c = getCancha(r.canchaId);
  const sede = getSede(c.sedeId);
  const activa = ['confirmada', 'en_curso'].includes(r.estado);
  const pol = Motor.politica(r);

  view.innerHTML = `
  <a href="#/reservas" class="small muted flex" style="gap:4px">${I.back} Mis reservas</a>
  <div class="between"><h1 class="p-title">Detalle de la reserva</h1>${badge(r.estado)}</div>
  <div class="detail-wrap">
    <div>
      ${activa ? `
      <div class="qr-box">
        <div class="small muted">Presenta este código en recepción para hacer check-in</div>
        <div id="qr"></div>
        <div class="code">${r.codigo}</div>
        ${r.estado === 'en_curso' ? '<div class="badge b-en_curso mt-s">Check-in realizado · ¡Buen partido!</div>' : ''}
      </div>` : ''}
      ${r.estado === 'pendiente_pago' ? `<div class="alert warn">⏳ Tienes hasta las ${new Date(r.venceEn).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} para pagar el abono o la franja se libera automáticamente.</div><a class="btn btn-primary btn-block" href="#/pago/${r.id}">Pagar abono ${fmtCOP(r.abono)}</a>` : ''}
      ${r.estado === 'liberada' ? '<div class="alert err">Esta franja fue liberada porque no se pagó el abono a tiempo. Si ya pagaste, comunícate con la sede para reactivarla.</div>' : ''}
      ${r.estado === 'cancelada' ? `<div class="alert err">Reserva cancelada${r.reembolso ? ` · Reembolso ${fmtCOP(r.reembolso)}` : ''}.</div>` : ''}
      ${r.estado === 'finalizada' ? `
      <div class="card" style="text-align:center">
        <h3>${r.calificacion ? '¡Gracias por calificar!' : '¿Cómo estuvo la cancha?'}</h3>
        <div class="rate-stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" class="${n <= r.calificacion ? 'on' : ''}">★</button>`).join('')}</div>
        <div class="tiny muted">Califica con un toque</div>
      </div>` : ''}
    </div>
    <aside class="card">
      <h3>${esc(sede.nombre)} · ${esc(c.nombre)}</h3>
      <dl class="kv">
        <dt>Dirección</dt><dd>${esc(sede.direccion)}</dd>
        <dt>Fecha</dt><dd>${fmtFechaLarga(r.fecha)}</dd>
        <dt>Horario</dt><dd>${fmtRango(r.hora, r.duracion)}</dd>
        <dt>Tipo</dt><dd>${TIPOS[c.tipo].label}</dd>
        <dt>Total</dt><dd>${fmtCOP(r.total)}</dd>
        <dt>Abono</dt><dd>${fmtCOP(r.abono)} ${r.abonoPagado ? '<span class="badge b-ok">Pagado</span>' : '<span class="badge b-warn">Pendiente</span>'}</dd>
        <dt>Saldo</dt><dd>${fmtCOP(r.saldo)} ${r.saldoPagado ? '<span class="badge b-ok">Pagado</span>' : '<span class="badge b-muted">En sede</span>'}</dd>
        ${r.metodo ? `<dt>Método</dt><dd>${METODOS[r.metodo]?.label || r.metodo}</dd>` : ''}
        ${r.estado === 'confirmada' ? `<dt>Asistencia</dt><dd>${r.asistenciaConfirmada ? '<span class="badge b-ok">Confirmada</span>' : '<span class="badge b-warn">Sin confirmar</span>'}</dd>` : ''}
      </dl>
      <div class="actions-grid mt">
        ${r.estado === 'confirmada' && !r.asistenciaConfirmada ? '<button class="btn btn-primary" id="asist" style="grid-column:1/-1">✋ Confirmar asistencia</button>' : ''}
        ${activa && !r.saldoPagado ? `<button class="btn btn-dark" id="saldo" style="grid-column:1/-1">Pagar saldo ${fmtCOP(r.saldo)}</button>` : ''}
        ${r.estado === 'confirmada' ? '<button class="btn btn-outline" id="repro">Reprogramar</button><button class="btn btn-danger" id="cancel">Cancelar</button>' : ''}
        ${activa ? `<a class="btn btn-ghost" style="grid-column:1/-1" target="_blank" rel="noopener" href="${linkWhatsapp(r)}">📤 Compartir con el grupo</a>` : ''}
        ${['finalizada', 'cancelada', 'liberada'].includes(r.estado) ? `<button class="btn btn-primary" id="again" style="grid-column:1/-1">🔁 Reservar de nuevo</button>` : ''}
      </div>
      ${r.estado === 'confirmada' ? `<div class="policy">Si cancelas ahora recibes el ${pol.pct}% del abono (${fmtCOP(pol.reembolso)}).</div>` : ''}
    </aside>
  </div>`;

  if (activa) renderQR(document.getElementById('qr'), r.codigo, 190);
  document.getElementById('asist')?.addEventListener('click', () => { Motor.confirmarAsistencia(r.id); toast('¡Asistencia confirmada! Nos vemos en la cancha ⚽', 'ok'); router(); });
  document.getElementById('saldo')?.addEventListener('click', () => modalSaldo(r));
  document.getElementById('repro')?.addEventListener('click', () => modalReprogramar(r));
  document.getElementById('cancel')?.addEventListener('click', async () => {
    const ok = await confirmar('¿Cancelar la reserva?', `Faltan ${Math.max(0, Math.floor(pol.horas))} h para el partido. Según la política recibirás el ${pol.pct}% del abono: <b>${fmtCOP(pol.reembolso)}</b>.`, { ok: 'Sí, cancelar', danger: true });
    if (!ok) return;
    const res = Motor.cancelar(r.id);
    toast(res.error || `Reserva cancelada. Reembolso ${fmtCOP(res.reembolso)}`, res.error ? 'err' : '');
    router();
  });
  document.getElementById('again')?.addEventListener('click', () => reservarDeNuevo(r.canchaId, r.duracion));
  view.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { Motor.calificar(r.id, Number(b.dataset.s)); toast('¡Gracias por tu calificación! ⭐', 'ok'); router(); });
}

function modalSaldo(r) {
  let metodo = (Store.db.metodosGuardados[yo.id] || [])[0] || 'nequi';
  const m = openModal(`
    <h3>Pagar saldo</h3>
    <p class="muted small">Paga ahora los ${fmtCOP(r.saldo)} restantes y llega directo a jugar.</p>
    <div class="pay-methods">${['nequi', 'daviplata', 'tarjeta', 'pse'].map(k => `<button class="pay-m ${k === metodo ? 'active' : ''}" data-m="${k}"><span class="pm-ico">${METODOS[k].ico}</span>${METODOS[k].label}</button>`).join('')}</div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Pagar ${fmtCOP(r.saldo)}</button></div>`);
  m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { metodo = b.dataset.m; m.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('active', x === b)); });
  m.querySelector('#ok').onclick = () => { const res = Motor.pagarSaldo(r.id, metodo); closeModal(); toast(res.error || 'Saldo pagado 💰', res.error ? 'err' : 'ok'); router(); };
}

function modalReprogramar(r) {
  const c = getCancha(r.canchaId);
  let fecha = r.fecha;
  const m = openModal(`<h3>Reprogramar reserva</h3><p class="muted small">${esc(nombreCancha(c))} · ${fmtDur(r.duracion)}</p><div id="rp"></div>`, { wide: true });
  function pintar() {
    const dias = Array.from({ length: 7 }, (_, i) => addDays(today(), i));
    const libres = horasCancha(c).filter(h => {
      const ts = parseYmd(fecha).getTime() + h * 3600000;
      return ts > Date.now() && h + r.duracion <= c.cierre && !conflicto(c.id, fecha, h, r.duracion, r.id);
    });
    m.querySelector('#rp').innerHTML = `
      <div class="days mb">${dias.map(d => { const dt = parseYmd(d); return `<button class="day ${d === fecha ? 'active' : ''}" data-d="${d}"><small>${DIAS[dt.getDay()]}</small><b>${dt.getDate()}</b></button>`; }).join('')}</div>
      ${libres.length ? `<div class="hours">${libres.map(h => `<button class="hour ${fecha === r.fecha && h === r.hora ? 'active' : ''}" data-h="${h}">${fmtHora(h)}<small>${fmtCOP(precioHora(c, h) * r.duracion)}</small></button>`).join('')}</div>`
        : `<div class="alert info">Sin cupo este día. Puedes unirte a la lista de espera desde "Reservar" o elegir otro día.</div>`}
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Cerrar</button></div>`;
    m.querySelector('[data-close]').onclick = closeModal;
    m.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { fecha = b.dataset.d; pintar(); });
    m.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
      const res = Motor.reprogramar(r.id, fecha, Number(b.dataset.h));
      if (res.error) return toast(res.error, 'err');
      closeModal(); toast('Reserva reprogramada 🔁', 'ok'); router();
    });
  }
  pintar();
}

/** Flujo 3: plantilla precargada con sede, cancha y duración */
function reservarDeNuevo(canchaId, dur) {
  const ultima = reservasDeUsuario(yo.id).filter(r => r.canchaId === canchaId).pop();
  Object.assign(sel, { canchaId, fecha: today(), hora: null, dur: dur || ultima?.duracion || 1 });
  // Si su hora habitual está libre hoy o en los próximos días, la preselecciona
  if (ultima) {
    const c = getCancha(canchaId);
    for (let i = 0; i < 7; i++) {
      const f = addDays(today(), i);
      if (estadoFranja(c, f, ultima.hora, sel.dur).libre) { sel.fecha = f; sel.hora = ultima.hora; break; }
    }
  }
  ir(`#/reservar/${canchaId}`);
  if (sel.hora != null) setTimeout(() => toast(`Precargamos tu horario habitual: ${fmtFecha(sel.fecha)} ${fmtHora(sel.hora)}`), 200);
}

/* ---------------- FAVORITAS + LISTA DE ESPERA ---------------- */
function favoritas() {
  const favs = misFavoritas(yo.id).map(getCancha).filter(Boolean);
  const espera = Store.db.listaEspera.filter(w => w.usuarioId === yo.id && parseYmd(w.fecha).getTime() + w.hora * 3600000 > Date.now());
  view.innerHTML = `
    <h1 class="p-title">Favoritas</h1>
    ${favs.length ? `<div class="grid-canchas" id="favs">${favs.map(c => tarjetaCancha(c).replace('</article>', `<div style="padding:0 16px 16px"><button class="btn btn-primary btn-sm btn-block" data-again="${c.id}">🔁 Reservar de nuevo</button></div></article>`)).join('')}</div>`
      : '<div class="empty"><div class="big">🤍</div>Aún no tienes canchas favoritas. Toca el corazón en cualquier cancha.</div>'}
    <h2 class="p-title mt">Lista de espera</h2>
    ${espera.length ? `<div class="res-list">${espera.map(w => `
      <div class="res-item" style="cursor:default">
        <div><h4>${esc(nombreCancha(w.canchaId))}</h4><div class="small muted">${fmtFecha(w.fecha)} · ${fmtHora(w.hora)} · desde ${fmtTs(w.creadoEn)}</div></div>
        <div class="flex">${w.notificado ? `<span class="badge b-ok">¡Cupo liberado!</span><button class="btn btn-primary btn-sm" data-go="${w.canchaId}|${w.fecha}|${w.hora}">Reservar</button>` : '<span class="badge b-muted">En espera</span>'}
        <button class="btn btn-ghost btn-sm" data-del="${w.id}">Salir</button></div>
      </div>`).join('')}</div>` : '<p class="muted small">No estás en ninguna lista de espera.</p>'}
  `;
  const cont = document.getElementById('favs');
  if (cont) enlazarTarjetas(cont);
  view.querySelectorAll('[data-again]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); reservarDeNuevo(b.dataset.again); }));
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { Store.db.listaEspera = Store.db.listaEspera.filter(w => w.id !== b.dataset.del); Store.save(); toast('Saliste de la lista de espera'); favoritas(); });
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const [cid, f, h] = b.dataset.go.split('|'); Object.assign(sel, { canchaId: cid, fecha: f, hora: Number(h), dur: 1 }); ir(`#/reservar/${cid}`); });
  // Al cambiar favorita desde esta vista, refrescar
  view.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', () => setTimeout(favoritas, 50)));
}

/* ---------------- PERFIL ---------------- */
function perfil() {
  const mias = reservasDeUsuario(yo.id);
  const mes = today().slice(0, 7);
  const gastoMes = Store.db.pagos.filter(p => p.fecha.startsWith(mes) && getReserva(p.reservaId)?.usuarioId === yo.id).reduce((s, p) => s + p.monto, 0);
  const jugados = mias.filter(r => r.estado === 'finalizada').length;
  const guardados = Store.db.metodosGuardados[yo.id] || [];
  yo.prefs = yo.prefs || { whatsapp: true, email: true, promos: false };
  const ini = yo.nombre.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();

  view.innerHTML = `
  <div class="profile-head">
    <div class="avatar">${ini}</div>
    <h2>${esc(yo.nombre)}</h2>
    <div class="small muted">${esc(yo.email)}</div>
  </div>
  <div class="kpis">
    <div class="kpi accent"><div class="k-label">Partidos jugados</div><div class="k-val">${jugados}</div></div>
    <div class="kpi"><div class="k-label">Reservas totales</div><div class="k-val">${mias.length}</div></div>
    <div class="kpi dark"><div class="k-label">Gasto este mes</div><div class="k-val">${fmtCOP(gastoMes)}</div></div>
  </div>
  <div class="grid-2e">
    <form class="card" id="f-grupo">
      <h3>Datos del grupo</h3>
      <div class="field"><label>Nombre</label><input class="input" name="nombre" value="${esc(yo.nombre)}" required></div>
      <div class="field"><label>Celular (WhatsApp)</label><input class="input" name="telefono" value="${esc(yo.telefono || '')}"></div>
      <div class="row">
        <div class="field"><label>Nombre del grupo</label><input class="input" name="grupo" value="${esc(yo.grupo || '')}" placeholder="Ej: Los Parceros FC"></div>
        <div class="field"><label>Integrantes</label><input class="input" type="number" min="2" max="30" name="integrantes" value="${yo.integrantes || ''}"></div>
      </div>
      <button class="btn btn-dark">Guardar cambios</button>
    </form>
    <div>
      <div class="card mb">
        <h3>Métodos de pago guardados</h3>
        <div class="flex" style="flex-wrap:wrap">${['nequi', 'daviplata', 'tarjeta', 'pse'].map(k => `<button class="chip ${guardados.includes(k) ? 'active' : ''}" data-pm="${k}">${METODOS[k].ico} ${METODOS[k].label}</button>`).join('')}</div>
      </div>
      <div class="card mb">
        <h3>Notificaciones</h3>
        ${[['whatsapp', 'Recordatorios por WhatsApp'], ['email', 'Recordatorios por correo'], ['promos', 'Promociones y torneos']].map(([k, l]) => `
          <div class="between" style="padding:6px 0"><span class="small">${l}</span><label class="switch"><input type="checkbox" data-pref="${k}" ${yo.prefs[k] ? 'checked' : ''}><span></span></label></div>`).join('')}
      </div>
      <div class="list-menu">
        <a class="li" href="#/notificaciones">${I.bell} Ver notificaciones</a>
        <a class="li" href="#" id="ayuda">${I.help} Ayuda</a>
        <a class="li" href="#" id="salir" style="color:var(--danger)">${I.out} Cerrar sesión</a>
      </div>
    </div>
  </div>`;

  document.getElementById('f-grupo').onsubmit = e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    yo.nombre = fd.get('nombre').trim(); yo.telefono = fd.get('telefono').trim(); yo.grupo = fd.get('grupo').trim(); yo.integrantes = Number(fd.get('integrantes')) || '';
    Object.assign(getUser(yo.id), yo); Store.save(); toast('Perfil actualizado', 'ok'); perfil();
  };
  view.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => {
    const g = Store.db.metodosGuardados[yo.id] = Store.db.metodosGuardados[yo.id] || [];
    const i = g.indexOf(b.dataset.pm); if (i >= 0) g.splice(i, 1); else g.push(b.dataset.pm);
    Store.save(); b.classList.toggle('active');
  });
  view.querySelectorAll('[data-pref]').forEach(i => i.onchange = () => { yo.prefs[i.dataset.pref] = i.checked; Object.assign(getUser(yo.id), { prefs: yo.prefs }); Store.save(); toast('Preferencia guardada'); });
  document.getElementById('salir').onclick = e => { e.preventDefault(); Auth.logout(); };
  document.getElementById('ayuda').onclick = e => {
    e.preventDefault();
    openModal(`<h3>Ayuda</h3>
      <p class="small"><b>¿Cómo reservo?</b><br>Busca la cancha → elige día y hora → paga el abono. Recibirás un QR al instante.</p>
      <p class="small"><b>¿Qué pasa si no pago el abono?</b><br>La franja se bloquea ${Store.db.reglas.minutosLiberacion} minutos para ti; si no pagas, se libera y avisamos a la lista de espera.</p>
      <p class="small"><b>¿Puedo cancelar?</b><br>Sí. Gratis hasta ${Store.db.reglas.cancelacionHoras} h antes; después se reembolsa el ${Store.db.reglas.reembolsoPct}% del abono.</p>
      <p class="small"><b>¿Cómo hago check-in?</b><br>Muestra el QR de "Mis reservas" en recepción.</p>
      <div class="modal-actions"><button class="btn btn-primary" data-close>Entendido</button></div>`);
  };
}

/* ---------------- NOTIFICACIONES ---------------- */
function notificaciones() {
  const mias = Store.db.notificaciones.filter(n => n.usuarioId === yo.id).sort((a, b) => b.ts - a.ts);
  view.innerHTML = `
    <h1 class="p-title">Notificaciones</h1>
    <div class="res-list">
      ${mias.length ? mias.map(n => `<div class="notif ${n.leida ? '' : 'unread'}"><div class="grow">${esc(n.texto)}<div class="tiny muted">${fmtTs(n.ts)}</div></div></div>`).join('') : '<div class="empty"><div class="big">🔕</div>No tienes notificaciones.</div>'}
    </div>`;
  mias.forEach(n => n.leida = true);
  Store.save();
  setTimeout(() => pintarNav(''), 600);
}

/* ---------------- Arranque ---------------- */
if (yo) {
  Motor.ejecutarTareas();
  window.addEventListener('hashchange', router);
  // Sincroniza cambios hechos en otra pestaña (p. ej. el panel admin)
  window.addEventListener('storage', e => { if (e.key === DB_KEY) { Store.load(); const u = getUser(yo.id); if (u) Object.assign(yo, u); pintarNav(currentNav()); } });
  // Tareas programadas (simulan Celery + Redis)
  setInterval(() => { if (Motor.ejecutarTareas()) router(); else pintarNav(currentNav()); }, 15000);
  router();
}
function currentNav() {
  const p = location.hash.replace(/^#/, '');
  for (const [re, , nav] of RUTAS) if (re.test(p)) return nav;
  return '';
}
