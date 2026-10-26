@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ============================================
echo   CanchApp - Sistema de reservas (Django)
echo ============================================

where py > nul 2>&1 && (set PY=py) || (set PY=python)

if not exist venv (
  echo [1/5] Creando entorno virtual...
  %PY% -m venv venv || goto :error
)
call venv\Scripts\activate.bat

echo [2/5] Instalando Django...
pip install -q -r requirements.txt || goto :error

echo [3/5] Creando tablas de la base de datos...
python manage.py makemigrations reservas || goto :error
python manage.py migrate || goto :error

echo [4/5] Cargando datos de ejemplo (solo la primera vez)...
python manage.py poblar || goto :error

echo [5/5] Iniciando servidor en http://127.0.0.1:8000
echo        (Ctrl+C para detener)
start "" http://127.0.0.1:8000
python manage.py runserver
goto :eof

:error
echo.
echo Ocurrio un error. Revisa que Python este instalado (python.org) y vuelve a intentar.
pause
