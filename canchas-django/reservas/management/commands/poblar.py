"""
Carga datos de ejemplo en la base de datos.

    python manage.py poblar            # solo si la base está vacía
    python manage.py poblar --borrar   # borra todo y vuelve a cargar los datos de ejemplo
"""
import random
from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from reservas.models import (Cancha, CierreCaja, Configuracion, Favorita, Feedback, ListaEspera,
                             LogTarea, Notificacion, Pago, Perfil, Reserva, Sede)
from reservas.servicios import calcular, gen_codigo, hoy

User = get_user_model()

SEDES = [
    ('Sede Norte', 'Calle 170 #20-15, Bogotá', '601 555 0101'),
    ('Sede Centro', 'Cra 7 #32-10, Bogotá', '601 555 0202'),
    ('Sede Sur', 'Av. Boyacá #58-20 Sur, Bogotá', '601 555 0303'),
]
# (sede, nombre, tipo, día, noche, abre, cierra, rating, votos, servicios, descripción)
CANCHAS = [
    (0, 'Cancha 1', 'F7', 100000, 120000, 8, 23, 4.8, 64, ['parqueadero', 'agua', 'balon', 'luz'],
     'Cancha sintética cómoda y bien iluminada, ideal para un partido entre amigos o para entrenar. Reserva con un abono del 30 % y paga el saldo en la sede.'),
    (0, 'Cancha 2', 'F5', 75000, 90000, 8, 23, 4.6, 41, ['parqueadero', 'agua', 'luz'],
     'Cancha de fútbol 5 con grama de última generación y malla perimetral completa.'),
    (1, 'Cancha 1', 'F8', 95000, 110000, 7, 22, 4.7, 52, ['agua', 'balon', 'luz', 'camerino'],
     'La cancha más grande de la sede, perfecta para fútbol 8 con camerinos y duchas.'),
    (1, 'Cancha 2', 'F5', 70000, 85000, 7, 22, 4.5, 30, ['agua', 'luz', 'cafeteria'],
     'Cancha techada de fútbol 5, se juega aunque llueva.'),
    (2, 'Cancha 1', 'F5', 65000, 80000, 8, 22, 4.4, 22, ['parqueadero', 'luz'],
     'Cancha económica de fútbol 5 en el sur de la ciudad.'),
    (2, 'Cancha 2', 'F7', 95000, 115000, 8, 22, 4.6, 35, ['parqueadero', 'agua', 'balon', 'luz', 'camerino'],
     'Fútbol 7 con tribuna para acompañantes y parqueadero amplio.'),
]
# (email, contraseña, nombre, apellido, rol, teléfono, grupo, integrantes)
USUARIOS = [
    ('admin@canchas.com', 'admin123', 'Admin', 'Canchas', 'admin', '300 000 0000', '', None),
    ('andres@correo.com', '1234', 'Andrés', 'Martínez', 'jugador', '310 555 1234', 'Los Parceros FC', 12),
    ('dilan@correo.com', '1234', 'Dilan', 'González', 'jugador', '311 555 2222', 'Dilan & amigos', 10),
    ('laura@correo.com', '1234', 'Laura', 'Pérez', 'jugador', '312 555 3333', '', None),
    ('carlos@correo.com', '1234', 'Carlos', 'Ruiz', 'jugador', '313 555 4444', '', None),
    ('camila@correo.com', '1234', 'Camila', 'Torres', 'jugador', '314 555 5555', '', None),
    ('recepcion@canchas.com', 'recep123', 'Recepción', 'Norte', 'recepcion', '300 111 2222', '', None),
]
METODOS = ['nequi', 'daviplata', 'tarjeta', 'pse']


def borrar_todo():
    for modelo in (Pago, Notificacion, ListaEspera, Favorita, Reserva, Cancha, Sede, CierreCaja,
                   LogTarea, Feedback, Configuracion, Perfil):
        modelo.objects.all().delete()
    User.objects.all().delete()


class Command(BaseCommand):
    help = 'Carga datos de ejemplo (sedes, canchas, usuarios y 30 días de reservas).'

    def add_arguments(self, parser):
        parser.add_argument('--borrar', action='store_true', help='Borra todos los datos antes de cargar.')
        parser.add_argument('--vacio', action='store_true', help='Solo borra (no carga datos de ejemplo).')

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts['borrar']:
            borrar_todo()
        if opts['vacio']:
            return
        if Sede.objects.exists():
            self.stdout.write(self.style.WARNING('La base ya tiene datos. Usa --borrar para reiniciarla.'))
            return

        R = random.Random(20261026)
        ahora = timezone.now()
        t = hoy()
        reglas = Configuracion.get()

        sedes = [Sede.objects.create(nombre=n, direccion=d, telefono=tel) for n, d, tel in SEDES]
        canchas = [Cancha.objects.create(sede=sedes[s], nombre=n, tipo=tp, precio_dia=pd, precio_noche=pn, apertura=a,
                                         cierre=c, rating=rt, votos=v, servicios=sv, descripcion=desc)
                   for s, n, tp, pd, pn, a, c, rt, v, sv, desc in CANCHAS]
        users = {}
        for email, pw, nom, ape, rol, tel, grupo, integ in USUARIOS:
            u = User.objects.create_user(username=email, email=email, password=pw, first_name=nom, last_name=ape,
                                         is_staff=(rol == 'admin'), is_superuser=(rol == 'admin'))
            Perfil.objects.create(usuario=u, rol=rol, telefono=tel, grupo=grupo, integrantes=integ,
                                  prefs={'whatsapp': True, 'email': True, 'promos': False},
                                  metodos_guardados=['nequi'] if email.startswith('andres') else [])
            users[email.split('@')[0]] = u
        andres, otros = users['andres'], [users[k] for k in ('dilan', 'laura', 'carlos', 'camila')]

        def libre(cancha, fecha, hora, dur):
            return not any(r.hora < hora + dur and hora < r.hora + r.duracion for r in
                           Reserva.objects.filter(cancha=cancha, fecha=fecha, estado__in=Reserva.ESTADOS_QUE_BLOQUEAN))

        def crear(usuario, cancha, fecha, hora, dur=1, estado='confirmada', saldo_pagado=False, abono_pagado=True,
                  validado=True, calificacion=0, metodo=None, pago_fecha=None, creado=None, **extra):
            metodo = metodo or R.choice(METODOS)
            r = Reserva.objects.create(
                codigo=gen_codigo(), usuario=usuario, cancha=cancha, fecha=fecha, hora=hora, duracion=dur,
                **calcular(cancha, hora, dur, reglas), estado=estado, abono_pagado=abono_pagado,
                saldo_pagado=saldo_pagado, calificacion=calificacion, metodo=metodo,
                creado_en=creado or ahora - timedelta(days=3), **extra)
            if abono_pagado:
                Pago.objects.create(reserva=r, monto=r.abono, tipo='abono', metodo=metodo,
                                    fecha=pago_fecha or fecha - timedelta(days=1), ts=r.creado_en, validado=validado)
            if saldo_pagado:
                Pago.objects.create(reserva=r, monto=r.saldo, tipo='saldo',
                                    metodo='efectivo' if R.random() > .5 else R.choice(METODOS),
                                    fecha=fecha, ts=min(r.inicio, ahora), validado=True)
            return r

        c1, c2, c3, c4, c5, c6 = canchas

        # Reservas del jugador demo (como en el video)
        crear(andres, c1, t, 21, metodo='nequi', asistencia_confirmada=True, pago_fecha=t - timedelta(days=1))
        sabado = next(t + timedelta(days=i) for i in range(1, 8) if (t + timedelta(days=i)).weekday() == 5)
        crear(andres, c3, sabado, 20, metodo='nequi', pago_fecha=t)
        crear(andres, c4, t - timedelta(days=36), 19, estado='finalizada', saldo_pagado=True, calificacion=5, metodo='nequi')
        crear(andres, c1, t - timedelta(days=7), 21, estado='finalizada', saldo_pagado=True, metodo='nequi')
        crear(andres, c1, t - timedelta(days=14), 21, estado='finalizada', saldo_pagado=True, calificacion=4, metodo='nequi')

        # Historial de 30 días (para reportes)
        for d in range(-30, 0):
            fecha = t + timedelta(days=d)
            dow = fecha.weekday()
            n = (24 if dow in (4, 5) else 16 if dow == 6 else 12) + R.randint(0, 5)
            for _ in range(n):
                c = R.choice(canchas)
                hora = 17 + R.randint(0, 4) if R.random() < .65 else c.apertura + R.randint(0, 8)
                dur = 1 if R.random() < .8 else 2
                if hora + dur > c.cierre or not libre(c, fecha, hora, dur):
                    continue
                cancel = R.random() < .06
                crear(R.choice(otros), c, fecha, hora, dur, estado='cancelada' if cancel else 'finalizada',
                      saldo_pagado=not cancel, calificacion=(4 + R.randint(0, 1)) if not cancel and R.random() < .4 else 0,
                      creado=timezone.make_aware(datetime.combine(fecha - timedelta(days=1), time(12, 0))))

        # Agenda de hoy
        h_now = timezone.localtime().hour
        plan = [(c1, 18, 'dilan'), (c1, 19, 'laura'), (c1, 20, 'carlos'), (c2, 17, 'camila'), (c2, 19, 'dilan', 2),
                (c2, 10, 'carlos'), (c3, 18, 'laura'), (c3, 20, 'camila'), (c4, 19, 'carlos'), (c5, 20, 'dilan'),
                (c6, 19, 'laura'), (c6, 9, 'camila')]
        for i, p in enumerate(plan):
            c, h, u = p[0], p[1], users[p[2]]
            dur = p[3] if len(p) > 3 else 1
            estado, saldo = 'confirmada', False
            if h + dur <= h_now:
                estado, saldo = 'finalizada', True
            elif h <= h_now:
                estado, saldo = 'en_curso', True
            crear(u, c, t, h, dur, estado=estado, saldo_pagado=saldo, pago_fecha=t, validado=(i % 4 != 0),
                  creado=ahora - timedelta(hours=i + 2), recordatorio_24=True)
        # Reserva esperando el abono (bloqueo temporal activo)
        crear(users['carlos'], c4, t, 21, estado='pendiente_pago', abono_pagado=False,
              creado=ahora - timedelta(minutes=4), vence_en=ahora + timedelta(minutes=11))
        # Franja liberada por falta de abono (para probar "Reactivar")
        crear(users['camila'], c3, t, 21, estado='liberada', abono_pagado=False, creado=ahora - timedelta(minutes=50),
              vence_en=ahora - timedelta(minutes=35), liberada_en=ahora - timedelta(minutes=35))

        # Próximos días
        for d in range(1, 7):
            fecha = t + timedelta(days=d)
            for i in range(4 + R.randint(0, 4)):
                c = R.choice(canchas)
                hora = 17 + R.randint(0, 4)
                if hora + 1 > c.cierre or not libre(c, fecha, hora, 1):
                    continue
                crear(R.choice(otros), c, fecha, hora, pago_fecha=t, validado=R.random() > .25,
                      creado=ahora - timedelta(hours=i + 1))

        # Cierres de caja de los últimos 5 días
        for d in range(5, 0, -1):
            fecha = t - timedelta(days=d)
            pagos = Pago.objects.filter(fecha=fecha)
            por_metodo = {}
            for p in pagos:
                por_metodo[p.metodo] = por_metodo.get(p.metodo, 0) + p.monto
            CierreCaja.objects.create(fecha=fecha, total=sum(por_metodo.values()), n_pagos=pagos.count(),
                                      por_metodo=por_metodo, por='Admin Canchas',
                                      ts=timezone.make_aware(datetime.combine(fecha, time(23, 0))))

        # Lista de espera, favoritas y notificaciones
        ListaEspera.objects.create(usuario=users['laura'], cancha=c1, fecha=t, hora=19, creado_en=ahora - timedelta(hours=2))
        ListaEspera.objects.create(usuario=andres, cancha=c1, fecha=t, hora=20, creado_en=ahora - timedelta(minutes=90))
        ListaEspera.objects.create(usuario=users['dilan'], cancha=c1, fecha=t, hora=20, creado_en=ahora - timedelta(minutes=30))
        Favorita.objects.create(usuario=andres, cancha=c1)
        Favorita.objects.create(usuario=andres, cancha=c3)
        Favorita.objects.create(usuario=users['dilan'], cancha=c2)
        Notificacion.objects.create(usuario=andres, leida=True, ts=ahora - timedelta(days=1),
                                    texto='✅ Reserva confirmada en Sede Norte · Cancha 1 para hoy a las 9 pm.')
        LogTarea.objects.create(msg='Base de datos inicializada con datos de ejemplo.')

        self.stdout.write(self.style.SUCCESS(
            f'Datos de ejemplo cargados: {Sede.objects.count()} sedes, {Cancha.objects.count()} canchas, '
            f'{User.objects.count()} usuarios, {Reserva.objects.count()} reservas, {Pago.objects.count()} pagos.'))
