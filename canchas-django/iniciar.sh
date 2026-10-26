#!/usr/bin/env bash
# CanchApp - inicio rápido (macOS / Linux)
set -e
cd "$(dirname "$0")"
[ -d venv ] || python3 -m venv venv
source venv/bin/activate
pip install -q -r requirements.txt
python manage.py makemigrations reservas
python manage.py migrate
python manage.py poblar
python manage.py runserver
