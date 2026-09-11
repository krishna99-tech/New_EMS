"""
ems_core/management/commands/run_daily_rollup.py — Run the daily energy group rollup calculation.
"""

from django.core.management.base import BaseCommand
from services.rollup_service import perform_daily_rollup

class Command(BaseCommand):
    help = "Performs the daily energy meter group rollup calculation."

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("Running Daily Group Rollup..."))
        try:
            perform_daily_rollup()
            self.stdout.write(self.style.SUCCESS("Daily Group Rollup completed successfully."))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Rollup failed: {e}"))
