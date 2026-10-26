# CanchApp · Sistema de reservas de canchas sintéticas (Django + SQLite)

Proyecto académico (Universidad ECCI · Innovación tecnológica · Taller 4).

- **Backend:** Python + Django 5, con una API JSON y el administrador de Django.
- **Base de datos:** SQLite (archivo `db.sqlite3`). Todo se guarda ahí: usuarios, reservas, pagos, etc.
- **Frontend:** HTML + CSS + JavaScript, con el mismo diseño de la app móvil.

## 1. Requisitos

- **Python 3.10 o superior** → https://www.python.org/downloads/
  (en Windows marca la casilla **"Add Python to PATH"** al instalar).
- Visual Studio Code con la extensión **Python** (de Microsoft).

## 2. Cómo correrlo

### Opción rápida (Windows)
Doble clic en **`iniciar.bat`**. El script crea el entorno virtual, instala Django,
crea las tablas, carga los datos de ejemplo y abre el navegador en http://127.0.0.1:8000

### Opción paso a paso (terminal de VS Code: *Terminal → Nueva terminal*)
```bash
python -m venv venv
venv\Scripts\activate          # Windows   (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
python manage.py makemigrations reservas
python manage.py migrate       # crea las tablas en db.sqlite3
python manage.py poblar        # carga datos de ejemplo
python manage.py runserver     # inicia el servidor
```
Abre **http://127.0.0.1:8000**

> Las siguientes veces solo necesitas: `venv\Scripts\activate` y `python manage.py runserver`.

## 3. Cuentas de prueba

| Rol | Correo | Contraseña | Entra a |
|---|---|---|---|
| Jugador | andres@correo.com | 1234 | `/jugador/` |
| Administrador | admin@canchas.com | admin123 | `/panel/` y `/admin/` |
| Recepción | recepcion@canchas.com | recep123 | `/panel/` (sin configuración) |

## 4. Ver la base de datos

- **Administrador de Django:** http://127.0.0.1:8000/admin/ (entra con `admin@canchas.com` / `admin123`).
  Ahí ves y editas todas las tablas: Reservas, Pagos, Canchas, Sedes, Lista de espera...
  También aparece el botón **🗄 Base de datos** en el panel.
- **Archivo SQLite:** `db.sqlite3`. Puedes abrirlo con la extensión de VS Code **SQLite Viewer**
  o con **DB Browser for SQLite**.

## 5. Estructura

```
canchas-django/
├── manage.py
├── requirements.txt
├── iniciar.bat / iniciar.sh        Inicio rápido
├── config/                         Configuración de Django (settings, urls)
├── reservas/                       App principal
│   ├── models.py                   Tablas de la base de datos
│   ├── servicios.py                Motor de reservas (reglas de negocio)
│   ├── views.py                    Páginas y API JSON
│   ├── serializers.py              Conversión de datos a JSON
│   ├── admin.py                    Tablas en /admin/
│   └── management/commands/
│       ├── poblar.py               python manage.py poblar [--borrar]
│       └── correr_tareas.py        python manage.py correr_tareas
├── templates/                      index.html, jugador.html, panel.html
└── static/                         css/styles.css, js/data.js, js/jugador.js, js/admin.js
```

### Tablas (modelos)
`Sede` → `Cancha` → `Reserva` → `Pago`, más `Perfil` (rol del usuario), `ListaEspera`,
`Notificacion`, `Favorita`, `Configuracion` (reglas automáticas), `CierreCaja`, `LogTarea` y `Feedback`.

## 6. Reglas de negocio implementadas en el servidor

| Regla del documento | Dónde |
|---|---|
| Bloqueo temporal de la franja mientras se paga (evita doble reserva) | `servicios.bloquear()` |
| Validación de conflictos de horario | `servicios.conflicto()` |
| Liberación automática por falta de abono + aviso a lista de espera | `servicios.ejecutar_tareas()` |
| Reactivación en 1 clic por pago tardío (o reubicar si ya la tomaron) | `servicios.reactivar()` |
| Recordatorios 24 h y 2 h antes | `servicios.ejecutar_tareas()` |
| Política de cancelación y reembolso parcial | `servicios.politica()` / `cancelar()` |
| Check-in con código QR | `servicios.check_in()` |
| Cierre de caja | `servicios.cerrar_caja()` |

**Tareas automáticas (equivalente a Celery + Redis):** se ejecutan solas cada vez que alguien
consulta el sistema (el frontend lo hace cada 15 s). Para que corran aunque nadie tenga la
página abierta, en otra terminal ejecuta: `python manage.py correr_tareas`.

**Seguridad:** sesiones y contraseñas cifradas con Django, protección CSRF, permisos por rol
en cada acción de la API, y un jugador solo recibe sus propios datos (de las demás reservas
solo ve qué horarios están ocupados).

## 7. API

| Método | URL | Descripción |
|---|---|---|
| POST | `/api/login/` | Iniciar sesión `{email, password}` |
| POST | `/api/registro/` | Crear cuenta de jugador |
| POST | `/api/logout/` | Cerrar sesión |
| GET | `/api/estado/` | Datos del usuario según su rol |
| POST | `/api/accion/<nombre>/` | Acciones: `bloquear`, `pagarAbono`, `cancelar`, `reprogramar`, `checkIn`, `reactivar`, `crearManual`, `cerrarCaja`, `guardarCancha`, `guardarReglas`... |
| GET | `/api/backup/` | Descarga backup JSON (admin) |

## 8. Comandos útiles

```bash
python manage.py poblar --borrar     # reinicia la base con los datos de ejemplo
python manage.py createsuperuser     # crea otro administrador
python manage.py correr_tareas       # motor de tareas en bucle
```

## Notas

- Los pagos son simulados (Nequi, Daviplata, Tarjeta, PSE). En producción se integraría una
  pasarela real en `servicios.pagar_abono()`.
- Para pasar a PostgreSQL o MySQL solo se cambia `DATABASES` en `config/settings.py`.
- El código QR usa la librería `qrcodejs` desde internet; sin conexión se muestra el código en texto.
