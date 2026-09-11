"""
ems_core/management/commands/run_udp_server.py — Run the UDP Energy Meter Listener standalone.
"""

from django.core.management.base import BaseCommand
from udp_server import udp_server

class Command(BaseCommand):
    help = "Runs the standalone UDP energy meter packet listener."

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("Starting UDP Energy Meter Listener..."))
        try:
            udp_server()
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("UDP server stopped by user."))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"UDP server crashed: {e}"))
