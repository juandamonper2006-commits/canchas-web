# CanchApp · Sistema de reservas de canchas sintéticas

Proyecto académico (Universidad ECCI · Innovación tecnológica · Taller 4).
Página web en **HTML + CSS + JavaScript puro**, con el mismo estilo visual de la app móvil
(verde lima, crema y morado oscuro). Incluye:

- **Portal del jugador** (versión web de la app): buscar cancha, categorías Fútbol 5/7/8,
  disponibilidad en tiempo real, bloqueo temporal de la franja mientras paga, pago del abono,
  comprobante con QR, mis reservas, confirmar asistencia, pagar saldo, reprogramar, cancelar
  con política de reembolso, calificar con 1 toque, favoritas, "reservar de nuevo", lista de
  espera, perfil y notificaciones.
- **Panel del administrador** (7 módulos del mapa de sitio): Dashboard, Agenda por sede,
  Pagos y caja (validar pagos, franjas liberadas con reactivación en 1 clic, cierre del día),
  Sedes y canchas (franjas y tarifas), Reglas automáticas, Lista de espera, Reportes
  (gráficas + exportar CSV/PDF) y Cuenta y soporte (usuarios, roles, backup).
- **Motor de reservas simulado**: liberación automática por falta de abono, recordatorios
  24 h / 2 h y aviso a la lista de espera (simula Celery + Redis; corre cada 15 s).

## Cómo abrirlo en Visual Studio Code

1. Descomprime la carpeta `canchas-web` y ábrela en VS Code (**Archivo → Abrir carpeta**).
2. Instala la extensión **Live Server** (de Ritwick Dey).
3. Clic derecho sobre `index.html` → **Open with Live Server**.
   (También funciona abriendo `index.html` con doble clic en el navegador.)

## Cuentas de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Jugador | andres@correo.com | 1234 |
| Administrador | admin@canchas.com | admin123 |
| Recepción | recepcion@canchas.com | recep123 |

Tip para la sustentación: abre el portal del jugador en una pestaña y el panel admin en otra
del mismo navegador (no uses modo incógnito para una de ellas, porque no comparte los datos). Lo que reserves como jugador
aparece al instante en la agenda del administrador.

## Estructura

```
canchas-web/
├── index.html        Login y registro
├── jugador.html      Portal del jugador
├── admin.html        Panel del administrador
├── css/styles.css    Estilos compartidos
└── js/
    ├── data.js       Base de datos (localStorage), datos de ejemplo y motor de reservas
    ├── jugador.js    Pantallas del jugador
    └── admin.js      Módulos del panel admin (incluye gráficas SVG propias)
```

## Notas

- Los datos se guardan en el `localStorage` del navegador. Para volver a los datos de ejemplo
  usa "Restablecer datos de ejemplo" en el login o en Cuenta y soporte.
- El código QR se genera con la librería `qrcodejs` desde cdnjs (requiere internet). Sin
  internet se muestra el código alfanumérico, que también sirve para el check-in.
- Los pagos son simulados (Nequi, Daviplata, Tarjeta, PSE). Para un sistema real se
  conectaría una pasarela y un backend (por ejemplo Django + PostgreSQL + Celery/Redis).
