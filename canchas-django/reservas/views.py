"""
Vistas de CanchApp.

  Páginas:   /            -> login
             /jugador/    -> portal del jugador
             /panel/      -> panel del administrador
  API JSON:  /api/login/  /api/registro/  /api/logout/  /api/estado/
             /api/accion/<nombre>/   (todas las acciones del sistema)
             /api/backup/            (descarga de la base de datos en JSON)
"""
import io
import json
import tempfile
from datetime import date

from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.core.exceptions import ObjectDoesNotExist
from django.core.management import call_command
from django.db import transaction
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from . import servicios as S
from .models import (Cancha, Configuracion, Favorita, Feedback, ListaEspera, Notificacion,
                     Pago, Perfil, Reserva, Sede)
from .serializers import REGLAS_MAP, estado_para, perfil_de

User = get_user_model()


# ---------------- Páginas ----------------
@ensure_csrf_cookie
def pagina_login(request):
    return render(request, 'index.html')


@ensure_csrf_cookie
def pagina_jugador(request):
    return render(request, 'jugador.html')


@ensure_csrf_cookie
def pagina_panel(request):
    return render(request, 'panel.html')


# ---------------- Utilidades ----------------
def leer_json(request):
    try:
        return json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return {}


def error(msg, status=400):
    return JsonResponse({'ok': False, 'error': msg}, status=status)


def rol(user):
    return perfil_de(user).rol if user.is_authenticated else None


def a_fecha(s):
    return date.fromisoformat(str(s))


# ---------------- Autenticación ----------------
@require_POST
def api_login(request):
    d = leer_json(request)
    email = (d.get('email') or '').strip().lower()
    user = authenticate(request, username=email, password=d.get('password') or '')
    if not user:
        return error('Correo o contraseña incorrectos.', 401)
    login(request, user)
    return JsonResponse({'ok': True, 'rol': rol(user)})


@require_POST
def api_registro(request):
    d = leer_json(request)
    nombre = (d.get('nombre') or '').strip()
    email = (d.get('email') or '').strip().lower()
    password = d.get('password') or ''
    if not nombre or '@' not in email or len(password) < 4:
        return error('Completa nombre, correo válido y contraseña de mínimo 4 caracteres.')
    if User.objects.filter(username=email).exists():
        return error('Ya existe una cuenta con ese correo.')
    with transaction.atomic():
        partes = nombre.split(' ', 1)
        user = User.objects.create_user(username=email, email=email, password=password,
                                        first_name=partes[0], last_name=partes[1] if len(partes) > 1 else '')
        Perfil.objects.create(usuario=user, rol='jugador', telefono=(d.get('telefono') or '').strip(),
                              prefs={'whatsapp': True, 'email': True, 'promos': False})
        S.notificar(user, f'👋 ¡Bienvenido a CanchApp, {partes[0]}! Reserva tu primera cancha.')
    login(request, user)
    return JsonResponse({'ok': True, 'rol': 'jugador'})


@require_POST
def api_logout(request):
    logout(request)
    return JsonResponse({'ok': True})


@require_GET
def api_estado(request):
    if not request.user.is_authenticated:
        return error('No has iniciado sesión.', 401)
    S.ejecutar_tareas()  # las reglas automáticas se aplican antes de responder
    return JsonResponse({'ok': True, 'estado': estado_para(request.user)})


# ---------------- Acciones ----------------
ACCIONES = {}


def accion(nombre, roles=('jugador', 'recepcion', 'admin')):
    def deco(fn):
        ACCIONES[nombre] = (fn, roles)
        return fn
    return deco


def reserva_propia(request, d):
    """Un jugador solo puede tocar sus reservas; el personal, cualquiera."""
    r = get_object_or_404(Reserva.objects.select_related('cancha__sede', 'usuario'), pk=d.get('id'))
    if rol(request.user) == 'jugador' and r.usuario_id != request.user.pk:
        raise S.ErrorNegocio('Esta reserva no es tuya.')
    return r


# --- Jugador ---
@accion('bloquear', roles=('jugador',))
def a_bloquear(request, d):
    r = S.bloquear(request.user, d['canchaId'], a_fecha(d['fecha']), float(d['hora']), float(d['duracion']))
    return {'reservaId': str(r.pk)}


@accion('soltar', roles=('jugador',))
def a_soltar(request, d):
    S.soltar(request.user, d['id'])


@accion('pagarAbono', roles=('jugador',))
def a_pagar_abono(request, d):
    S.pagar_abono(reserva_propia(request, d), d.get('metodo') or 'nequi')
    if d.get('guardarMetodo'):
        p = perfil_de(request.user)
        if d['metodo'] not in p.metodos_guardados:
            p.metodos_guardados = p.metodos_guardados + [d['metodo']]
            p.save()


@accion('pagarSaldo')
def a_pagar_saldo(request, d):
    S.pagar_saldo(reserva_propia(request, d), d.get('metodo') or 'efectivo')


@accion('cancelar')
def a_cancelar(request, d):
    pol = S.cancelar(reserva_propia(request, d), por=rol(request.user))
    return {'reembolso': pol['reembolso'], 'pct': pol['pct']}


@accion('reprogramar', roles=('jugador',))
def a_reprogramar(request, d):
    S.reprogramar(reserva_propia(request, d), a_fecha(d['fecha']), float(d['hora']))


@accion('confirmarAsistencia', roles=('jugador',))
def a_asistencia(request, d):
    S.confirmar_asistencia(reserva_propia(request, d))


@accion('calificar', roles=('jugador',))
def a_calificar(request, d):
    S.calificar(reserva_propia(request, d), d.get('estrellas', 5))


@accion('unirseEspera', roles=('jugador',))
def a_unirse(request, d):
    S.unirse_espera(request.user, get_object_or_404(Cancha, pk=d['canchaId']), a_fecha(d['fecha']), float(d['hora']))


@accion('salirEspera', roles=('jugador',))
def a_salir(request, d):
    ListaEspera.objects.filter(pk=d['id'], usuario=request.user).delete()


@accion('favorita', roles=('jugador',))
def a_favorita(request, d):
    cancha = get_object_or_404(Cancha, pk=d['canchaId'])
    fav, creada = Favorita.objects.get_or_create(usuario=request.user, cancha=cancha)
    if not creada:
        fav.delete()
    return {'favorita': creada}


@accion('perfil')
def a_perfil(request, d):
    u, p = request.user, perfil_de(request.user)
    if 'nombre' in d:
        partes = d['nombre'].strip().split(' ', 1)
        u.first_name, u.last_name = partes[0], (partes[1] if len(partes) > 1 else '')
    if 'email' in d and d['email'].strip():
        email = d['email'].strip().lower()
        if User.objects.filter(username=email).exclude(pk=u.pk).exists():
            raise S.ErrorNegocio('Ese correo ya está en uso.')
        u.email = u.username = email
    if d.get('password'):
        u.set_password(d['password'])
    u.save()
    if d.get('password'):
        update_session_auth_hash(request, u)  # mantener la sesión tras cambiar la contraseña
    for campo in ('telefono', 'grupo'):
        if campo in d:
            setattr(p, campo, d[campo])
    if 'integrantes' in d:
        p.integrantes = int(d['integrantes']) if str(d['integrantes']).isdigit() else None
    if 'prefs' in d:
        p.prefs = d['prefs']
    if 'metodosGuardados' in d:
        p.metodos_guardados = [m for m in d['metodosGuardados'] if m in dict(Pago.METODOS)]
    p.save()


@accion('leerNotificaciones')
def a_leer(request, d):
    Notificacion.objects.filter(usuario=request.user, leida=False).update(leida=True)


@accion('feedback')
def a_feedback(request, d):
    if not (d.get('msg') or '').strip():
        raise S.ErrorNegocio('Escribe un mensaje.')
    Feedback.objects.create(tipo=d.get('tipo', 'Sugerencia'), msg=d['msg'].strip(), por=request.user.get_full_name())


# --- Personal de la sede (administrador y recepción) ---
STAFF = ('recepcion', 'admin')


@accion('checkIn', roles=STAFF)
def a_checkin(request, d):
    r = S.check_in(d.get('codigo'))
    return {'reservaId': str(r.pk)}


@accion('finalizar', roles=STAFF)
def a_finalizar(request, d):
    S.finalizar(reserva_propia(request, d))


@accion('validarPago', roles=STAFF)
def a_validar(request, d):
    S.validar_pago(d['id'])


@accion('validarTodos', roles=STAFF)
def a_validar_todos(request, d):
    return {'n': Pago.objects.filter(validado=False).update(validado=True)}


@accion('reactivar', roles=STAFF)
def a_reactivar(request, d):
    r = reserva_propia(request, d)
    nueva_cancha = get_object_or_404(Cancha, pk=d['canchaId']) if d.get('canchaId') else None
    nueva_hora = float(d['hora']) if d.get('hora') is not None else None
    S.reactivar(r, d.get('metodo'), nueva_hora=nueva_hora, nueva_cancha=nueva_cancha)


@accion('crearManual', roles=STAFF)
def a_manual(request, d):
    r = S.crear_manual(get_object_or_404(Cancha, pk=d['canchaId']), a_fecha(d['fecha']), float(d['hora']),
                       float(d['duracion']), (d.get('nombreCliente') or '').strip(), (d.get('telefono') or '').strip(),
                       bool(d.get('pagado')), d.get('metodo') or 'efectivo')
    return {'reservaId': str(r.pk), 'codigo': r.codigo}


@accion('notificarEspera', roles=STAFF)
def a_notificar(request, d):
    w = S.avisar_espera(get_object_or_404(Cancha, pk=d['canchaId']), a_fecha(d['fecha']), float(d['hora']))
    return {'notificado': w.usuario.get_full_name() if w else None}


@accion('quitarEspera', roles=STAFF)
def a_quitar(request, d):
    ListaEspera.objects.filter(pk=d['id']).delete()


@accion('cerrarCaja', roles=STAFF)
def a_cerrar(request, d):
    k = S.cerrar_caja(a_fecha(d['fecha']), request.user)
    return {'total': k.total}


@accion('ejecutarTareas', roles=STAFF)
def a_tareas(request, d):
    return {'n': S.ejecutar_tareas()}


# --- Solo administrador ---
ADMIN = ('admin',)


@accion('guardarSede', roles=ADMIN)
def a_sede(request, d):
    s = get_object_or_404(Sede, pk=d['id']) if d.get('id') else Sede()
    s.nombre, s.direccion, s.telefono = d['nombre'].strip(), d['direccion'].strip(), d.get('telefono', '').strip()
    if not s.nombre or not s.direccion:
        raise S.ErrorNegocio('Nombre y dirección son obligatorios.')
    s.save()
    return {'sedeId': str(s.pk)}


@accion('guardarCancha', roles=ADMIN)
def a_cancha(request, d):
    c = get_object_or_404(Cancha, pk=d['id']) if d.get('id') else Cancha(sede=get_object_or_404(Sede, pk=d['sedeId']))
    apertura, cierre = int(d['apertura']), int(d['cierre'])
    if apertura >= cierre:
        raise S.ErrorNegocio('La hora de cierre debe ser posterior a la de apertura.')
    if int(d['precioDia']) <= 0 or int(d['precioNoche']) <= 0:
        raise S.ErrorNegocio('Las tarifas deben ser mayores a cero.')
    if d.get('tipo') not in dict(Cancha.TIPOS):
        raise S.ErrorNegocio('Tipo de cancha no válido.')
    c.nombre, c.tipo = d['nombre'].strip(), d['tipo']
    c.apertura, c.cierre = apertura, cierre
    c.precio_dia, c.precio_noche = int(d['precioDia']), int(d['precioNoche'])
    c.servicios, c.descripcion = d.get('servicios', []), d.get('descripcion', '')
    c.activa, c.mantenimiento = bool(d.get('activa')), bool(d.get('mantenimiento'))
    c.save()
    return {'canchaId': str(c.pk)}


@accion('guardarReglas', roles=ADMIN)
def a_reglas(request, d):
    r = Configuracion.get()
    for camel, snake in REGLAS_MAP.items():
        if camel in d:
            actual = getattr(r, snake)
            setattr(r, snake, bool(d[camel]) if isinstance(actual, bool) else max(0, int(d[camel])))
    if not 1 <= r.abono_pct <= 100 or r.reembolso_pct > 100 or r.noche_desde > 23 or r.minutos_liberacion < 1:
        raise S.ErrorNegocio('Revisa los valores: porcentajes entre 0 y 100, hora nocturna entre 0 y 23 y plazo mínimo de 1 minuto.')
    r.save()
    S.log(f'Reglas automáticas actualizadas por {request.user.get_full_name()}')


@accion('usuario', roles=ADMIN)
def a_usuario(request, d):
    u = get_object_or_404(User, pk=d['id'])
    if u.pk == request.user.pk:
        raise S.ErrorNegocio('No puedes cambiar tu propio rol o estado.')
    p = perfil_de(u)
    if 'rol' in d and d['rol'] in dict(Perfil.ROLES):
        p.rol = d['rol']
        p.save()
        u.is_staff = d['rol'] == 'admin'
    if 'activo' in d:
        u.is_active = bool(d['activo'])
    u.save()


@accion('crearUsuario', roles=ADMIN)
def a_crear_usuario(request, d):
    email = (d.get('email') or '').strip().lower()
    if User.objects.filter(username=email).exists():
        raise S.ErrorNegocio('Ese correo ya existe.')
    if d.get('rol') not in ('admin', 'recepcion') or len(d.get('password') or '') < 4:
        raise S.ErrorNegocio('Datos incompletos.')
    partes = (d.get('nombre') or '').strip().split(' ', 1)
    u = User.objects.create_user(username=email, email=email, password=d['password'], first_name=partes[0],
                                 last_name=partes[1] if len(partes) > 1 else '', is_staff=d['rol'] == 'admin')
    Perfil.objects.create(usuario=u, rol=d['rol'])


@accion('reset', roles=ADMIN)
def a_reset(request, d):
    call_command('poblar', '--borrar', verbosity=0)
    # El usuario actual pudo haber sido borrado y recreado: volver a iniciar sesión
    u = User.objects.filter(username=request.user.username).first()
    if u:
        login(request, u)


@accion('restaurar', roles=ADMIN)
def a_restaurar(request, d):
    datos = d.get('datos')
    if not isinstance(datos, list):
        raise S.ErrorNegocio('Archivo de backup no válido.')
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(datos, f)
        ruta = f.name
    with transaction.atomic():
        call_command('poblar', '--borrar', '--vacio', verbosity=0)
        call_command('loaddata', ruta, verbosity=0)
    u = User.objects.filter(username=request.user.username).first()
    if u:
        login(request, u)
    else:
        logout(request)  # el backup no tiene este usuario: hay que volver a iniciar sesión


@require_POST
def api_accion(request, nombre):
    if not request.user.is_authenticated:
        return error('No has iniciado sesión.', 401)
    if nombre not in ACCIONES:
        return error('Acción desconocida.', 404)
    fn, roles = ACCIONES[nombre]
    if rol(request.user) not in roles:
        return error('No tienes permiso para esta acción.', 403)
    try:
        extra = fn(request, leer_json(request)) or {}
    except S.ErrorNegocio as e:
        return JsonResponse({'ok': False, 'error': str(e), 'estado': estado_para(request.user)})
    except (Http404, ObjectDoesNotExist):
        return JsonResponse({'ok': False, 'error': 'No se encontró el registro (puede que ya no exista).',
                             'estado': estado_para(request.user)})
    except (KeyError, ValueError, TypeError) as e:
        return error(f'Datos inválidos: {e}')
    if not request.user.is_authenticated:  # p. ej. tras restaurar un backup sin este usuario
        return JsonResponse({'ok': True, 'relogin': True})
    return JsonResponse({'ok': True, **extra, 'estado': estado_para(request.user)})


@require_GET
def api_backup(request):
    """Copia de seguridad de la base de datos (formato de fixtures de Django)."""
    if rol(request.user) != 'admin':
        return error('Solo el administrador puede descargar backups.', 403)
    buf = io.StringIO()
    call_command('dumpdata', 'auth.user', 'reservas', indent=2, stdout=buf)
    resp = HttpResponse(buf.getvalue(), content_type='application/json; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="backup_canchapp_{S.hoy()}.json"'
    return resp
