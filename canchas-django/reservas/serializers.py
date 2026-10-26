"""
Convierte los objetos de la base de datos en el JSON que consume el frontend.

El frontend recibe un "estado" con la misma forma que usaba la versión sin
servidor, así las pantallas no tuvieron que cambiar. Por privacidad, un jugador
solo recibe SUS datos; de las demás reservas solo ve lo necesario para saber
qué horarios están ocupados (sin nombres ni teléfonos).
"""
from datetime import timedelta

from django.contrib.auth import get_user_model

from .models import (Cancha, CierreCaja, Configuracion, Favorita, Feedback, ListaEspera,
                     LogTarea, Notificacion, Pago, Perfil, Reserva, Sede)
from .servicios import hoy

User = get_user_model()

REGLAS_MAP = {
    'abonoPct': 'abono_pct', 'minutosLiberacion': 'minutos_liberacion',
    'liberacionAutomatica': 'liberacion_automatica', 'recordatorio24': 'recordatorio_24',
    'recordatorio2': 'recordatorio_2', 'canalWhatsapp': 'canal_whatsapp', 'canalEmail': 'canal_email',
    'cancelacionHoras': 'cancelacion_horas', 'reembolsoPct': 'reembolso_pct', 'nocheDesde': 'noche_desde',
    'alertasMantenimiento': 'alertas_mantenimiento',
}


def ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


def sid(pk):
    return str(pk) if pk is not None else None


def perfil_de(user):
    perfil, _ = Perfil.objects.get_or_create(usuario=user, defaults={'rol': 'admin' if user.is_superuser else 'jugador'})
    return perfil


def usuario_json(u):
    p = perfil_de(u)
    return {
        'id': sid(u.pk), 'nombre': u.get_full_name() or u.username, 'email': u.email, 'rol': p.rol,
        'telefono': p.telefono, 'grupo': p.grupo, 'integrantes': p.integrantes or '', 'prefs': p.prefs or {},
        'activo': u.is_active,
    }


def reglas_json():
    r = Configuracion.get()
    return {camel: getattr(r, snake) for camel, snake in REGLAS_MAP.items()}


def sede_json(s):
    return {'id': sid(s.pk), 'nombre': s.nombre, 'direccion': s.direccion, 'telefono': s.telefono}


def cancha_json(c):
    return {
        'id': sid(c.pk), 'sedeId': sid(c.sede_id), 'nombre': c.nombre, 'tipo': c.tipo,
        'precioDia': c.precio_dia, 'precioNoche': c.precio_noche, 'apertura': c.apertura, 'cierre': c.cierre,
        'rating': c.rating, 'votos': c.votos, 'activa': c.activa, 'mantenimiento': c.mantenimiento,
        'servicios': c.servicios or [], 'descripcion': c.descripcion,
    }


def reserva_json(r, completa=True):
    if not completa:  # Reserva de otra persona: solo datos de ocupación
        return {'id': sid(r.pk), 'canchaId': sid(r.cancha_id), 'fecha': r.fecha.isoformat(), 'hora': r.hora,
                'duracion': r.duracion, 'estado': r.estado, 'venceEn': ms(r.vence_en), 'usuarioId': None,
                'codigo': '', 'total': 0, 'abono': 0, 'saldo': 0}
    return {
        'id': sid(r.pk), 'codigo': r.codigo, 'usuarioId': sid(r.usuario_id), 'nombreCliente': r.nombre_cliente,
        'telefono': r.telefono, 'canchaId': sid(r.cancha_id), 'fecha': r.fecha.isoformat(), 'hora': r.hora,
        'duracion': r.duracion, 'total': r.total, 'abono': r.abono, 'saldo': r.saldo, 'estado': r.estado,
        'abonoPagado': r.abono_pagado, 'saldoPagado': r.saldo_pagado, 'asistenciaConfirmada': r.asistencia_confirmada,
        'calificacion': r.calificacion, 'origen': r.origen, 'metodo': r.metodo,
        'recordatorios': {'r24': r.recordatorio_24, 'r2': r.recordatorio_2}, 'reembolso': r.reembolso,
        'creadoEn': ms(r.creado_en), 'venceEn': ms(r.vence_en), 'liberadaEn': ms(r.liberada_en),
        'canceladaEn': ms(r.cancelada_en), 'checkInEn': ms(r.check_in_en),
    }


def pago_json(p):
    return {'id': sid(p.pk), 'reservaId': sid(p.reserva_id), 'monto': p.monto, 'tipo': p.tipo, 'metodo': p.metodo,
            'fecha': p.fecha.isoformat(), 'ts': ms(p.ts), 'validado': p.validado}


def espera_json(w):
    return {'id': sid(w.pk), 'usuarioId': sid(w.usuario_id), 'canchaId': sid(w.cancha_id), 'fecha': w.fecha.isoformat(),
            'hora': w.hora, 'creadoEn': ms(w.creado_en), 'notificado': w.notificado, 'notificadoEn': ms(w.notificado_en)}


def estado_para(user):
    """Arma el estado completo que necesita el frontend según el rol del usuario."""
    perfil = perfil_de(user)
    es_staff = perfil.rol in ('admin', 'recepcion')
    yo = usuario_json(user)

    base = {
        'version': 2,
        'yo': yo,
        'reglas': reglas_json(),
        'sedes': [sede_json(s) for s in Sede.objects.all()],
        'canchas': [cancha_json(c) for c in Cancha.objects.all()],
        'notificaciones': [{'id': sid(n.pk), 'usuarioId': sid(n.usuario_id), 'texto': n.texto, 'ts': ms(n.ts), 'leida': n.leida}
                           for n in Notificacion.objects.filter(usuario=user)[:100]],
        'favoritas': {yo['id']: [sid(f.cancha_id) for f in Favorita.objects.filter(usuario=user)]},
        'metodosGuardados': {yo['id']: perfil.metodos_guardados or []},
    }

    if es_staff:
        reservas = Reserva.objects.select_related('usuario').all()
        base.update({
            'usuarios': [usuario_json(u) for u in User.objects.select_related('perfil').all().order_by('id')],
            'reservas': [reserva_json(r) for r in reservas],
            'pagos': [pago_json(p) for p in Pago.objects.all()],
            'listaEspera': [espera_json(w) for w in ListaEspera.objects.all()],
            'cierres': [{'id': sid(k.pk), 'fecha': k.fecha.isoformat(), 'total': k.total, 'nPagos': k.n_pagos,
                         'porMetodo': k.por_metodo, 'por': k.por, 'ts': ms(k.ts)} for k in CierreCaja.objects.all()],
            'log': [{'ts': ms(l.ts), 'msg': l.msg} for l in list(LogTarea.objects.all()[:80])[::-1]],
            'feedback': [{'tipo': f.tipo, 'msg': f.msg, 'por': f.por, 'ts': ms(f.ts)} for f in Feedback.objects.order_by('ts')],
        })
    else:
        mias = list(Reserva.objects.filter(usuario=user))
        ids_mias = {r.pk for r in mias}
        # De los demás: solo reservas que ocupan franjas desde hoy (para la disponibilidad)
        otras = (Reserva.objects.filter(fecha__gte=hoy() - timedelta(days=1), estado__in=Reserva.ESTADOS_QUE_BLOQUEAN)
                 .exclude(pk__in=ids_mias))
        # Datos públicos de quienes están en la cola conmigo no se envían.
        base.update({
            'usuarios': [yo],
            'reservas': [reserva_json(r) for r in mias] + [reserva_json(r, completa=False) for r in otras],
            'pagos': [pago_json(p) for p in Pago.objects.filter(reserva__usuario=user)],
            'listaEspera': [espera_json(w) for w in ListaEspera.objects.filter(usuario=user)],
            'cierres': [], 'log': [], 'feedback': [],
        })
    return base
