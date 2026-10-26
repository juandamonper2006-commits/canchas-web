"""
Modelos (tablas) de la base de datos de CanchApp.

Diagrama simplificado:
    Sede 1──* Cancha 1──* Reserva 1──* Pago
    User 1──1 Perfil
    User 1──* Reserva / ListaEspera / Notificacion / Favorita
    Configuracion  (una sola fila con las reglas automáticas)
    CierreCaja, LogTarea, Feedback
"""
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

User = settings.AUTH_USER_MODEL


class Sede(models.Model):
    nombre = models.CharField(max_length=80)
    direccion = models.CharField(max_length=150)
    telefono = models.CharField(max_length=30, blank=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.nombre


class Cancha(models.Model):
    TIPOS = [('F5', 'Fútbol 5'), ('F7', 'Fútbol 7'), ('F8', 'Fútbol 8')]

    sede = models.ForeignKey(Sede, on_delete=models.CASCADE, related_name='canchas')
    nombre = models.CharField(max_length=60)
    tipo = models.CharField(max_length=2, choices=TIPOS, default='F5')
    precio_dia = models.PositiveIntegerField('Tarifa diurna (COP/hora)')
    precio_noche = models.PositiveIntegerField('Tarifa nocturna (COP/hora)')
    apertura = models.PositiveSmallIntegerField(default=8, help_text='Hora de apertura (0-23)')
    cierre = models.PositiveSmallIntegerField(default=22, help_text='Hora de cierre (1-24)')
    rating = models.FloatField(default=5.0)
    votos = models.PositiveIntegerField(default=0)
    activa = models.BooleanField(default=True)
    mantenimiento = models.BooleanField(default=False)
    servicios = models.JSONField(default=list, blank=True)
    descripcion = models.TextField(blank=True)

    class Meta:
        ordering = ['sede', 'id']

    def __str__(self):
        return f'{self.sede.nombre} · {self.nombre}'


class Perfil(models.Model):
    ROLES = [('jugador', 'Jugador'), ('recepcion', 'Recepción'), ('admin', 'Administrador')]

    usuario = models.OneToOneField(User, on_delete=models.CASCADE, related_name='perfil')
    rol = models.CharField(max_length=10, choices=ROLES, default='jugador')
    telefono = models.CharField(max_length=30, blank=True)
    grupo = models.CharField(max_length=80, blank=True)
    integrantes = models.PositiveSmallIntegerField(null=True, blank=True)
    prefs = models.JSONField(default=dict, blank=True)
    metodos_guardados = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f'{self.usuario.get_full_name()} ({self.rol})'


class Configuracion(models.Model):
    """Reglas automáticas del negocio. Siempre existe una sola fila (pk=1)."""
    abono_pct = models.PositiveSmallIntegerField(default=30)
    minutos_liberacion = models.PositiveSmallIntegerField(default=15)
    liberacion_automatica = models.BooleanField(default=True)
    recordatorio_24 = models.BooleanField(default=True)
    recordatorio_2 = models.BooleanField(default=True)
    canal_whatsapp = models.BooleanField(default=True)
    canal_email = models.BooleanField(default=True)
    cancelacion_horas = models.PositiveSmallIntegerField(default=24)
    reembolso_pct = models.PositiveSmallIntegerField(default=50)
    noche_desde = models.PositiveSmallIntegerField(default=18)
    alertas_mantenimiento = models.BooleanField(default=True)

    class Meta:
        verbose_name = 'Configuración (reglas automáticas)'
        verbose_name_plural = 'Configuración (reglas automáticas)'

    def __str__(self):
        return 'Reglas automáticas'

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Reserva(models.Model):
    ESTADOS = [
        ('pendiente_pago', 'Pendiente de abono'),
        ('confirmada', 'Confirmada'),
        ('en_curso', 'En curso'),
        ('finalizada', 'Finalizada'),
        ('cancelada', 'Cancelada'),
        ('liberada', 'Liberada'),
    ]
    # Estados que ocupan la franja (impiden otra reserva en el mismo horario)
    ESTADOS_QUE_BLOQUEAN = ['pendiente_pago', 'confirmada', 'en_curso', 'finalizada']

    codigo = models.CharField(max_length=12, unique=True)
    usuario = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='reservas')
    nombre_cliente = models.CharField(max_length=100, blank=True, help_text='Solo para reservas manuales')
    telefono = models.CharField(max_length=30, blank=True)
    cancha = models.ForeignKey(Cancha, on_delete=models.CASCADE, related_name='reservas')
    fecha = models.DateField()
    hora = models.FloatField(help_text='Hora de inicio, ej. 18 = 6 pm')
    duracion = models.FloatField(default=1)
    total = models.PositiveIntegerField()
    abono = models.PositiveIntegerField()
    saldo = models.IntegerField()
    estado = models.CharField(max_length=15, choices=ESTADOS, default='pendiente_pago', db_index=True)
    abono_pagado = models.BooleanField(default=False)
    saldo_pagado = models.BooleanField(default=False)
    asistencia_confirmada = models.BooleanField(default=False)
    calificacion = models.PositiveSmallIntegerField(default=0)
    origen = models.CharField(max_length=10, default='app')
    metodo = models.CharField(max_length=15, blank=True)
    recordatorio_24 = models.BooleanField(default=False)
    recordatorio_2 = models.BooleanField(default=False)
    reembolso = models.PositiveIntegerField(default=0)
    creado_en = models.DateTimeField(default=timezone.now)
    vence_en = models.DateTimeField(null=True, blank=True, help_text='Fin del bloqueo temporal (soft-lock)')
    liberada_en = models.DateTimeField(null=True, blank=True)
    cancelada_en = models.DateTimeField(null=True, blank=True)
    check_in_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['fecha', 'hora']
        indexes = [models.Index(fields=['cancha', 'fecha'])]

    def __str__(self):
        return f'{self.codigo} · {self.cancha} · {self.fecha} {self.hora}'

    # --- utilidades de tiempo ---
    @property
    def inicio(self):
        base = timezone.make_aware(datetime.combine(self.fecha, time(0, 0)))
        return base + timedelta(hours=self.hora)

    @property
    def fin(self):
        return self.inicio + timedelta(hours=self.duracion)

    def bloquea(self):
        if self.estado == 'pendiente_pago':
            return self.vence_en is not None and self.vence_en > timezone.now()
        return self.estado in ('confirmada', 'en_curso', 'finalizada')

    @property
    def cliente(self):
        if self.nombre_cliente:
            return self.nombre_cliente
        return self.usuario.get_full_name() if self.usuario else '—'


class Pago(models.Model):
    TIPOS = [('abono', 'Abono'), ('saldo', 'Saldo'), ('reembolso', 'Reembolso')]
    METODOS = [('nequi', 'Nequi'), ('daviplata', 'Daviplata'), ('tarjeta', 'Tarjeta'), ('pse', 'PSE'), ('efectivo', 'Efectivo (caja)')]

    reserva = models.ForeignKey(Reserva, on_delete=models.CASCADE, related_name='pagos')
    monto = models.IntegerField(help_text='Negativo si es reembolso')
    tipo = models.CharField(max_length=10, choices=TIPOS)
    metodo = models.CharField(max_length=15, choices=METODOS)
    fecha = models.DateField(db_index=True)
    ts = models.DateTimeField(default=timezone.now)
    validado = models.BooleanField(default=False)

    class Meta:
        ordering = ['ts']

    def __str__(self):
        return f'{self.tipo} {self.monto} ({self.metodo})'


class ListaEspera(models.Model):
    usuario = models.ForeignKey(User, on_delete=models.CASCADE, related_name='esperas')
    cancha = models.ForeignKey(Cancha, on_delete=models.CASCADE)
    fecha = models.DateField()
    hora = models.FloatField()
    creado_en = models.DateTimeField(default=timezone.now)
    notificado = models.BooleanField(default=False)
    notificado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['creado_en']
        verbose_name_plural = 'Lista de espera'


class Notificacion(models.Model):
    usuario = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notificaciones')
    texto = models.CharField(max_length=300)
    ts = models.DateTimeField(default=timezone.now)
    leida = models.BooleanField(default=False)

    class Meta:
        ordering = ['-ts']
        verbose_name_plural = 'Notificaciones'


class Favorita(models.Model):
    usuario = models.ForeignKey(User, on_delete=models.CASCADE, related_name='favoritas')
    cancha = models.ForeignKey(Cancha, on_delete=models.CASCADE)

    class Meta:
        unique_together = ('usuario', 'cancha')


class CierreCaja(models.Model):
    fecha = models.DateField(unique=True)
    total = models.IntegerField()
    n_pagos = models.PositiveIntegerField()
    por_metodo = models.JSONField(default=dict)
    por = models.CharField(max_length=100)
    ts = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['fecha']
        verbose_name = 'Cierre de caja'
        verbose_name_plural = 'Cierres de caja'


class LogTarea(models.Model):
    """Bitácora de las tareas automáticas (liberaciones, recordatorios, check-in...)."""
    ts = models.DateTimeField(default=timezone.now)
    msg = models.CharField(max_length=300)

    class Meta:
        ordering = ['-ts']
        verbose_name = 'Registro de tarea'
        verbose_name_plural = 'Registro de tareas'


class Feedback(models.Model):
    tipo = models.CharField(max_length=40)
    msg = models.TextField()
    por = models.CharField(max_length=100)
    ts = models.DateTimeField(default=timezone.now)
