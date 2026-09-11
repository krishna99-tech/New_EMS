import os
import sys
import threading
from django.apps import AppConfig


class EmsCoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'ems_core'
    verbose_name = 'Energy Management System Core'

    def ready(self):
        # Prevent starting background threads twice or during migrations/shell/check
        if any(cmd in sys.argv for cmd in ['makemigrations', 'migrate', 'check', 'shell', 'inspectdb']):
            return

        # Start background UDP receiver if in runserver or WSGI worker
        # Check runserver reload guard
        if os.environ.get('RUN_MAIN') == 'true' or 'runserver' not in sys.argv:
            try:
                from udp_server import udp_server
                t = threading.Thread(target=udp_server, args=(None,), daemon=True, name="udp_server")
                t.start()
            except Exception as e:
                print(f"UDP Server thread startup warning: {e}")
