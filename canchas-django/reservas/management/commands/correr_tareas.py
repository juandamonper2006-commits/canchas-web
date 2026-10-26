"""
Ejecuta las tareas automáticas en bucle (equivalente a Celery beat + worker).

    python manage.py correr_tareas            # cada 15 segundos
    python manage.py correr_tareas --cada 60  # cada 60 segundos

No es obligatorio: la API también ejecuta las tareas antes de responder cada
consulta. Este comando sirve para que las liberaciones y recordatorios ocurran
aunque nadie tenga la página abierta.
"""
import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from reservas.servicios import ejecutar_tareas


class Command(BaseCommand):
    help = 'Ejecuta liberaciones automáticas y recordatorios en bucle.'

    def add_arguments(self, parser):
        parser.add_argument('--cada', type=int, default=15, help='Segundos entre ejecuciones.')
        parser.add_argument('--una-vez', action='store_true', help='Ejecuta una sola vez y termina.')

    def handle(self, *args, **opts):
        self.stdout.write(self.style.SUCCESS(f'Motor de tareas iniciado (cada {opts["cada"]} s). Ctrl+C para detener.'))
        while True:
            n = ejecutar_tareas()
            if n:
                self.stdout.write(f'[{timezone.localtime():%H:%M:%S}] {n} acción(es) ejecutadas')
            if opts['una_vez']:
                break
            time.sleep(opts['cada'])
