"""Registro de las tablas en el administrador de Django (http://127.0.0.1:8000/admin/)."""
from django.contrib import admin

from .models import (Cancha, CierreCaja, Configuracion, Favorita, Feedback, ListaEspera,
                     LogTarea, Notificacion, Pago, Perfil, Reserva, Sede)


class CanchaInline(admin.TabularInline):
    model = Cancha
    extra = 0
    fields = ('nombre', 'tipo', 'apertura', 'cierre', 'precio_dia', 'precio_noche', 'activa', 'mantenimiento')


@admin.register(Sede)
class SedeAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'direccion', 'telefono')
    inlines = [CanchaInline]


@admin.register(Cancha)
class CanchaAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'tipo', 'apertura', 'cierre', 'precio_dia', 'precio_noche', 'rating', 'activa', 'mantenimiento')
    list_filter = ('sede', 'tipo', 'activa', 'mantenimiento')


class PagoInline(admin.TabularInline):
    model = Pago
    extra = 0


@admin.register(Reserva)
class ReservaAdmin(admin.ModelAdmin):
    list_display = ('codigo', 'cancha', 'fecha', 'hora', 'duracion', 'cliente', 'estado', 'total', 'abono_pagado', 'saldo_pagado')
    list_filter = ('estado', 'cancha__sede', 'cancha', 'origen', 'fecha')
    search_fields = ('codigo', 'nombre_cliente', 'usuario__first_name', 'usuario__last_name', 'usuario__email')
    date_hierarchy = 'fecha'
    inlines = [PagoInline]


@admin.register(Pago)
class PagoAdmin(admin.ModelAdmin):
    list_display = ('reserva', 'tipo', 'metodo', 'monto', 'fecha', 'validado')
    list_filter = ('tipo', 'metodo', 'validado', 'fecha')


@admin.register(Perfil)
class PerfilAdmin(admin.ModelAdmin):
    list_display = ('usuario', 'rol', 'telefono', 'grupo')
    list_filter = ('rol',)


@admin.register(ListaEspera)
class ListaEsperaAdmin(admin.ModelAdmin):
    list_display = ('usuario', 'cancha', 'fecha', 'hora', 'creado_en', 'notificado')


@admin.register(Notificacion)
class NotificacionAdmin(admin.ModelAdmin):
    list_display = ('usuario', 'texto', 'ts', 'leida')
    list_filter = ('leida',)


@admin.register(CierreCaja)
class CierreCajaAdmin(admin.ModelAdmin):
    list_display = ('fecha', 'total', 'n_pagos', 'por', 'ts')


@admin.register(LogTarea)
class LogTareaAdmin(admin.ModelAdmin):
    list_display = ('ts', 'msg')


admin.site.register(Configuracion)
admin.site.register(Favorita)
admin.site.register(Feedback)
