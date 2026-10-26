from django.contrib import admin
from django.urls import path

from reservas import views

admin.site.site_header = 'CanchApp · Base de datos'
admin.site.site_title = 'CanchApp'
admin.site.index_title = 'Administración de la base de datos'

urlpatterns = [
    # Páginas
    path('', views.pagina_login, name='login'),
    path('jugador/', views.pagina_jugador, name='jugador'),
    path('panel/', views.pagina_panel, name='panel'),

    # API JSON
    path('api/login/', views.api_login),
    path('api/registro/', views.api_registro),
    path('api/logout/', views.api_logout),
    path('api/estado/', views.api_estado),
    path('api/accion/<str:nombre>/', views.api_accion),
    path('api/backup/', views.api_backup),

    # Administrador de Django para ver/editar las tablas directamente
    path('admin/', admin.site.urls),
]
