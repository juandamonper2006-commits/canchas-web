"""
Motor de reservas de CanchApp.

Aquí vive toda la lógica de negocio (reglas del documento):
  - Bloqueo temporal de la franja mientras el jugador paga (soft-lock).
  - Validación de conflictos para que nunca haya doble reserva.
  - Liberación automática por falta de abono + aviso a la lista de espera.
  - Reactivación en 1 clic ante pagos tardíos.
  - Recordatorios escalonados 24 h y 2 h antes.
  - Política de cancelación y reembolso parcial.
  - Cierre de caja.

Las vistas (views.py) solo reciben la petición, llaman a estas funciones y
devuelven JSON. Así la lógica se puede probar y reutilizar (p. ej. desde Celery).
"""
import random
import string
from datetime import timedelta

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .models import (Cancha, CierreCaja, Configuracion, ListaEspera, LogTarea,
                     Notificacion, Pago, Reserva)


class ErrorNegocio(Exception):
    """Error que se le muestra tal cual al usuario."""


# ---------------- Formato (para los textos de notificaciones) ----------------
DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']


def hoy():
    return timezone.localdate()


def fmt_fecha(f):
    if f == hoy():
        return 'hoy'
    if f == hoy() + timedelta(days=1):
        return 'mañana'
    return f'{DIAS[f.weekday()]} {f.day} {MESES[f.month - 1]}'


def fmt_hora(h):
    hh, mm = int(h), round((h % 1) * 60)
    suf = 'pm' if hh >= 12 else 'am'
    h12 = 12 if hh % 12 == 0 else hh % 12
    return f'{h12}:{mm:02d} {suf}' if mm else f'{h12} {suf}'


def fmt_cop(n):
    return '$' + f'{round(n or 0):,}'.replace(',', '.')


def nombre_cancha(c):
    return f'{c.sede.nombre} · {c.nombre}'


def gen_codigo():
    while True:
        cod = 'CA-' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=4)) + str(random.randint(10, 99))
        if not Reserva.objects.filter(codigo=cod).exists():
            return cod


def notificar(usuario, texto):
    if usuario:
        Notificacion.objects.create(usuario=usuario, texto=texto[:300])


def log(msg):
    LogTarea.objects.create(msg=msg[:300])


# ---------------- Cálculos ----------------
def precio_hora(cancha, hora, reglas=None):
    reglas = reglas or Configuracion.get()
    return cancha.precio_noche if hora >= reglas.noche_desde else cancha.precio_dia


def calcular(cancha, hora, duracion, reglas=None):
    reglas = reglas or Configuracion.get()
    total = int(precio_hora(cancha, hora, reglas) * duracion)
    abono = int(round(total * reglas.abono_pct / 100 / 100) * 100)
    return {'total': total, 'abono': abono, 'saldo': total - abono}


def conflicto(cancha, fecha, hora, duracion, excluir_id=None):
    """Devuelve la reserva que choca con el horario pedido, o None."""
    qs = (Reserva.objects
          .filter(cancha=cancha, fecha=fecha, estado__in=Reserva.ESTADOS_QUE_BLOQUEAN)
          .filter(hora__lt=hora + duracion)
          .exclude(pk=excluir_id))
    for r in qs:
        if r.hora + r.duracion > hora and r.bloquea():
            return r
    return None


def validar_franja(cancha, fecha, hora, duracion):
    if not cancha.activa:
        raise ErrorNegocio('La cancha no está disponible.')
    if cancha.mantenimiento:
        raise ErrorNegocio('La cancha está en mantenimiento.')
    if hora < cancha.apertura or hora + duracion > cancha.cierre:
        raise ErrorNegocio('La franja está fuera del horario de la cancha.')
    inicio = Reserva(fecha=fecha, hora=hora, duracion=duracion).inicio
    if inicio < timezone.now():
        raise ErrorNegocio('Elige una franja futura.')


def _bloquear_escritura():
    """
    SQLite no tiene SELECT ... FOR UPDATE. Hacemos una escritura mínima al
    inicio de la transacción para tomar el candado de escritura de la base y así
    serializar las reservas simultáneas (dos jugadores no pueden tomar la misma
    franja al mismo tiempo). En PostgreSQL bastaría con select_for_update().
    """
    Configuracion.get()
    Configuracion.objects.filter(pk=1).update(abono_pct=F('abono_pct'))


# ---------------- Acciones del jugador ----------------
@transaction.atomic
def bloquear(usuario, cancha_id, fecha, hora, duracion):
    """Paso 1 del flujo de reserva: bloqueo temporal de la franja mientras paga."""
    _bloquear_escritura()
    reglas = Configuracion.get()
    cancha = Cancha.objects.select_related('sede').get(pk=cancha_id)
    validar_franja(cancha, fecha, hora, duracion)
    choque = conflicto(cancha, fecha, hora, duracion)
    if choque:
        if choque.estado == 'pendiente_pago':
            raise ErrorNegocio('Otro jugador está pagando esta franja en este momento.')
        raise ErrorNegocio('La franja ya no está disponible.')
    return Reserva.objects.create(
        codigo=gen_codigo(), usuario=usuario, cancha=cancha, fecha=fecha, hora=hora, duracion=duracion,
        **calcular(cancha, hora, duracion, reglas), estado='pendiente_pago',
        vence_en=timezone.now() + timedelta(minutes=reglas.minutos_liberacion),
    )


@transaction.atomic
def soltar(usuario, reserva_id):
    """El jugador se arrepiente antes de pagar: se elimina el bloqueo."""
    Reserva.objects.filter(pk=reserva_id, usuario=usuario, estado='pendiente_pago').delete()


def pagar_abono(reserva, metodo):
    if reserva.estado != 'pendiente_pago':
        raise ErrorNegocio('Esta reserva ya no está pendiente de pago.')
    if reserva.vence_en and reserva.vence_en <= timezone.now():
        with transaction.atomic():  # la liberación se guarda aunque luego mostremos el error
            liberar(reserva, 'no se pagó el abono a tiempo')
        raise ErrorNegocio('El tiempo para pagar venció y la franja fue liberada.')
    with transaction.atomic():
        return _confirmar_abono(reserva, metodo)


def _confirmar_abono(reserva, metodo):
    # Aquí se integraría la pasarela de pagos real (Wompi, PayU, Mercado Pago...).
    reserva.estado = 'confirmada'
    reserva.abono_pagado = True
    reserva.metodo = metodo
    reserva.save()
    Pago.objects.create(reserva=reserva, monto=reserva.abono, tipo='abono', metodo=metodo, fecha=hoy(), validado=False)
    notificar(reserva.usuario, f'✅ ¡Reserva confirmada! {nombre_cancha(reserva.cancha)} · {fmt_fecha(reserva.fecha)} '
                               f'{fmt_hora(reserva.hora)}. Código {reserva.codigo}.')
    return reserva


@transaction.atomic
def pagar_saldo(reserva, metodo):
    if reserva.saldo_pagado:
        raise ErrorNegocio('No hay saldo pendiente.')
    if reserva.estado not in ('confirmada', 'en_curso'):
        raise ErrorNegocio('La reserva no está activa.')
    reserva.saldo_pagado = True
    reserva.save()
    Pago.objects.create(reserva=reserva, monto=reserva.saldo, tipo='saldo', metodo=metodo, fecha=hoy(),
                        validado=(metodo == 'efectivo'))
    notificar(reserva.usuario, f'💰 Pagaste el saldo de {fmt_cop(reserva.saldo)} de tu reserva {reserva.codigo}.')
    return reserva


def politica(reserva):
    reglas = Configuracion.get()
    horas = (reserva.inicio - timezone.now()).total_seconds() / 3600
    pct = 100 if horas >= reglas.cancelacion_horas else reglas.reembolso_pct
    reembolso = round(reserva.abono * pct / 100) if reserva.abono_pagado else 0
    return {'horas': horas, 'pct': pct, 'reembolso': reembolso}


@transaction.atomic
def cancelar(reserva, por='jugador'):
    if reserva.estado not in ('pendiente_pago', 'confirmada'):
        raise ErrorNegocio('No se puede cancelar esta reserva.')
    pol = politica(reserva)
    reserva.estado = 'cancelada'
    reserva.cancelada_en = timezone.now()
    reserva.reembolso = pol['reembolso']
    reserva.save()
    if pol['reembolso'] > 0:
        Pago.objects.create(reserva=reserva, monto=-pol['reembolso'], tipo='reembolso',
                            metodo=reserva.metodo or 'nequi', fecha=hoy(), validado=True)
    notificar(reserva.usuario, f'❌ Reserva {reserva.codigo} cancelada. Reembolso: {fmt_cop(pol["reembolso"])} ({pol["pct"]}%).')
    avisar_espera(reserva.cancha, reserva.fecha, reserva.hora, reserva.duracion)
    return pol


@transaction.atomic
def reprogramar(reserva, fecha, hora):
    _bloquear_escritura()
    if reserva.estado != 'confirmada':
        raise ErrorNegocio('Solo se pueden reprogramar reservas confirmadas.')
    cancha = reserva.cancha
    validar_franja(cancha, fecha, hora, reserva.duracion)
    if conflicto(cancha, fecha, hora, reserva.duracion, excluir_id=reserva.pk):
        raise ErrorNegocio('Esa franja ya está ocupada.')
    anterior = (reserva.fecha, reserva.hora)
    p = calcular(cancha, hora, reserva.duracion)
    reserva.fecha, reserva.hora = fecha, hora
    reserva.total = p['total']
    reserva.saldo = p['total'] - reserva.abono
    reserva.recordatorio_24 = reserva.recordatorio_2 = False
    reserva.asistencia_confirmada = False
    reserva.save()
    notificar(reserva.usuario, f'🔁 Reserva {reserva.codigo} reprogramada para {fmt_fecha(fecha)} a las {fmt_hora(hora)}.')
    avisar_espera(cancha, anterior[0], anterior[1], reserva.duracion)
    return reserva


def confirmar_asistencia(reserva):
    reserva.asistencia_confirmada = True
    reserva.save(update_fields=['asistencia_confirmada'])


@transaction.atomic
def calificar(reserva, estrellas):
    estrellas = max(1, min(5, int(estrellas)))
    if reserva.estado != 'finalizada':
        raise ErrorNegocio('Solo puedes calificar partidos finalizados.')
    c = reserva.cancha
    if not reserva.calificacion:
        c.rating = round(((c.rating * c.votos) + estrellas) / (c.votos + 1), 1)
        c.votos += 1
        c.save(update_fields=['rating', 'votos'])
    reserva.calificacion = estrellas
    reserva.save(update_fields=['calificacion'])


def unirse_espera(usuario, cancha, fecha, hora):
    if ListaEspera.objects.filter(usuario=usuario, cancha=cancha, fecha=fecha, hora=hora).exists():
        raise ErrorNegocio('Ya estás en la lista de espera de esta franja.')
    return ListaEspera.objects.create(usuario=usuario, cancha=cancha, fecha=fecha, hora=hora)


# ---------------- Acciones del administrador ----------------
@transaction.atomic
def check_in(codigo):
    codigo = (codigo or '').strip().upper()
    r = Reserva.objects.select_related('cancha__sede').filter(codigo=codigo).first()
    if not r:
        raise ErrorNegocio('Código QR no válido. Verifica manualmente la reserva.')
    if r.estado != 'confirmada':
        raise ErrorNegocio(f'La reserva está en estado "{r.get_estado_display()}".')
    if r.fecha != hoy():
        raise ErrorNegocio(f'La reserva es para {fmt_fecha(r.fecha)}, no para hoy.')
    r.estado = 'en_curso'
    r.check_in_en = timezone.now()
    r.save()
    log(f'Check-in {r.codigo} · {nombre_cancha(r.cancha)} {fmt_hora(r.hora)}')
    return r


def finalizar(reserva):
    reserva.estado = 'finalizada'
    reserva.save(update_fields=['estado'])
    notificar(reserva.usuario, f'⭐ ¿Qué tal el partido en {nombre_cancha(reserva.cancha)}? Califícalo con un toque.')


def validar_pago(pago_id):
    Pago.objects.filter(pk=pago_id).update(validado=True)


def liberar(reserva, motivo):
    reserva.estado = 'liberada'
    reserva.liberada_en = timezone.now()
    reserva.save()
    notificar(reserva.usuario, f'⚠️ Tu franja en {nombre_cancha(reserva.cancha)} ({fmt_fecha(reserva.fecha)} '
                               f'{fmt_hora(reserva.hora)}) fue liberada: {motivo}.')
    log(f'Liberada {reserva.codigo} · {nombre_cancha(reserva.cancha)} {fmt_fecha(reserva.fecha)} {fmt_hora(reserva.hora)} ({motivo})')
    avisar_espera(reserva.cancha, reserva.fecha, reserva.hora, reserva.duracion)


@transaction.atomic
def reactivar(reserva, metodo=None, nueva_hora=None, nueva_cancha=None):
    """Pago tardío: el administrador reactiva la reserva con un clic (o la reubica)."""
    _bloquear_escritura()
    if reserva.estado != 'liberada':
        raise ErrorNegocio('La reserva no está liberada.')
    if nueva_cancha is not None:
        reserva.cancha = nueva_cancha
    if nueva_hora is not None:
        reserva.hora = nueva_hora
    if nueva_cancha is not None or nueva_hora is not None:
        for campo, valor in calcular(reserva.cancha, reserva.hora, reserva.duracion).items():
            setattr(reserva, campo, valor)
    if conflicto(reserva.cancha, reserva.fecha, reserva.hora, reserva.duracion, excluir_id=reserva.pk):
        raise ErrorNegocio('La franja ya fue tomada por otra persona. Ofrécele otra franja al jugador.')
    if reserva.fin < timezone.now():
        raise ErrorNegocio('La franja ya pasó.')
    metodo = metodo or reserva.metodo or 'nequi'
    reserva.estado = 'confirmada'
    reserva.abono_pagado = True
    reserva.metodo = metodo
    reserva.save()
    Pago.objects.create(reserva=reserva, monto=reserva.abono, tipo='abono', metodo=metodo, fecha=hoy(), validado=True)
    notificar(reserva.usuario, f'✅ Recibimos tu pago tardío: la reserva {reserva.codigo} fue reactivada '
                               f'({nombre_cancha(reserva.cancha)} {fmt_hora(reserva.hora)}).')
    log(f'Reactivada {reserva.codigo} por pago tardío')
    return reserva


@transaction.atomic
def crear_manual(cancha, fecha, hora, duracion, nombre_cliente, telefono, pagado, metodo):
    _bloquear_escritura()
    if not nombre_cliente:
        raise ErrorNegocio('Escribe el nombre del cliente.')
    if hora + duracion > cancha.cierre or hora < cancha.apertura:
        raise ErrorNegocio('La reserva está fuera del horario de la cancha.')
    if conflicto(cancha, fecha, hora, duracion):
        raise ErrorNegocio('La franja está ocupada.')
    r = Reserva.objects.create(
        codigo=gen_codigo(), nombre_cliente=nombre_cliente, telefono=telefono, cancha=cancha, fecha=fecha,
        hora=hora, duracion=duracion, **calcular(cancha, hora, duracion), estado='confirmada',
        abono_pagado=bool(pagado), asistencia_confirmada=True, origen='manual', metodo=metodo,
        recordatorio_24=True, recordatorio_2=True,
    )
    if pagado:
        Pago.objects.create(reserva=r, monto=r.abono, tipo='abono', metodo=metodo, fecha=hoy(), validado=True)
    return r


def avisar_espera(cancha, fecha, hora, duracion=1):
    """Avisa al primero de la lista de espera (prioridad por antigüedad)."""
    w = (ListaEspera.objects
         .filter(cancha=cancha, fecha=fecha, hora__gte=hora, hora__lt=hora + duracion, notificado=False)
         .select_related('usuario').order_by('creado_en').first())
    if not w:
        return None
    w.notificado = True
    w.notificado_en = timezone.now()
    w.save()
    notificar(w.usuario, f'🔔 ¡Se liberó un cupo! {nombre_cancha(cancha)} · {fmt_fecha(fecha)} {fmt_hora(w.hora)}. '
                         f'Resérvalo antes de que alguien más lo tome.')
    log(f'Lista de espera: aviso a {w.usuario.get_full_name()} ({nombre_cancha(cancha)} {fmt_hora(w.hora)})')
    return w


def resumen_caja(fecha):
    pagos = list(Pago.objects.filter(fecha=fecha))
    por_metodo = {}
    for p in pagos:
        por_metodo[p.metodo] = por_metodo.get(p.metodo, 0) + p.monto
    return {
        'pagos': pagos, 'por_metodo': por_metodo, 'total': sum(p.monto for p in pagos),
        'pendientes': [p for p in pagos if not p.validado],
        'cerrado': CierreCaja.objects.filter(fecha=fecha).first(),
    }


@transaction.atomic
def cerrar_caja(fecha, usuario):
    res = resumen_caja(fecha)
    if res['cerrado']:
        raise ErrorNegocio('La caja de ese día ya fue cerrada.')
    cierre = CierreCaja.objects.create(fecha=fecha, total=res['total'], n_pagos=len(res['pagos']),
                                       por_metodo=res['por_metodo'], por=usuario.get_full_name())
    log(f'Cierre de caja {fecha}: {fmt_cop(res["total"])}')
    return cierre


# ---------------- Tareas programadas ----------------
def ejecutar_tareas():
    """
    Equivalente a las tareas periódicas de Celery + Redis del documento.
    Se ejecuta:
      * automáticamente antes de cada consulta del estado (API /api/estado/), y
      * en bucle con:  python manage.py correr_tareas   (como un "celery beat").
    Devuelve cuántas acciones realizó.
    """
    ahora = timezone.now()
    reglas = Configuracion.get()
    cambios = 0
    with transaction.atomic():
        # 1. Liberación automática por falta de abono
        if reglas.liberacion_automatica:
            vencidas = Reserva.objects.select_related('cancha__sede', 'usuario').filter(
                estado='pendiente_pago', vence_en__lte=ahora)
            for r in vencidas:
                liberar(r, 'no se pagó el abono a tiempo')
                cambios += 1

        # 2. Finalizar reservas cuyo horario ya terminó
        activas = Reserva.objects.filter(estado__in=['confirmada', 'en_curso'], fecha__lte=hoy())
        for r in activas:
            if r.fin <= ahora:
                r.estado = 'finalizada'
                r.save(update_fields=['estado'])
                cambios += 1

        # 3. Recordatorios escalonados 24 h y 2 h antes
        canales = [n for n, ok in (('WhatsApp', reglas.canal_whatsapp), ('correo', reglas.canal_email)) if ok]
        canal = ' y '.join(canales) or 'la app'
        proximas = Reserva.objects.select_related('cancha__sede', 'usuario').filter(
            estado='confirmada', usuario__isnull=False, fecha__lte=hoy() + timedelta(days=1)
        ).filter(Q(recordatorio_24=False) | Q(recordatorio_2=False))
        for r in proximas:
            faltan = (r.inicio - ahora).total_seconds() / 3600
            if reglas.recordatorio_24 and not r.recordatorio_24 and 2 < faltan <= 24:
                r.recordatorio_24 = True
                r.save(update_fields=['recordatorio_24'])
                notificar(r.usuario, f'⏰ Recordatorio (24 h): {nombre_cancha(r.cancha)} · {fmt_fecha(r.fecha)} '
                                     f'{fmt_hora(r.hora)}. ¿Confirmas asistencia?')
                log(f'Recordatorio 24 h por {canal} → {r.codigo}')
                cambios += 1
            if reglas.recordatorio_2 and not r.recordatorio_2 and 0 < faltan <= 2:
                r.recordatorio_2 = r.recordatorio_24 = True
                r.save(update_fields=['recordatorio_2', 'recordatorio_24'])
                notificar(r.usuario, f'⏰ Tu partido empieza en menos de 2 horas ({fmt_hora(r.hora)}). '
                                     f'Lleva tu QR: {r.codigo}.')
                log(f'Recordatorio 2 h por {canal} → {r.codigo}')
                cambios += 1
    return cambios
