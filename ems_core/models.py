from django.db import models


class EMSUser(models.Model):
    id = models.AutoField(primary_key=True)
    username = models.CharField(max_length=150, unique=True)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=50, default='admin')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users'
        managed = False
        verbose_name = 'User'
        verbose_name_plural = 'Users'

    def __str__(self):
        return f"{self.username} ({self.role})"


class UserSettings(models.Model):
    user_id = models.IntegerField(primary_key=True)
    theme = models.CharField(max_length=50, default='light')
    color_preset = models.CharField(max_length=50, default='blue')
    custom_primary = models.CharField(max_length=50, default='#4f46e5')
    custom_sub = models.CharField(max_length=50, default='#6366f1')

    class Meta:
        db_table = 'user_settings'
        managed = False
        verbose_name = 'User Setting'
        verbose_name_plural = 'User Settings'

    def __str__(self):
        return f"Settings for user_id {self.user_id}"


class Plant(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=150, unique=True)
    location_id = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = 'plants'
        managed = False
        verbose_name = 'Plant'
        verbose_name_plural = 'Plants'

    def __str__(self):
        return self.name


class Location(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=150, unique=True)

    class Meta:
        db_table = 'locations'
        managed = False
        verbose_name = 'Location'
        verbose_name_plural = 'Locations'

    def __str__(self):
        return self.name


class MeterGroup(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=150)
    location_id = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = 'meter_groups'
        managed = False
        verbose_name = 'Meter Group'
        verbose_name_plural = 'Meter Groups'

    def __str__(self):
        return self.name


class MeterGroupMember(models.Model):
    id = models.AutoField(primary_key=True)
    group_id = models.IntegerField()
    plant = models.CharField(max_length=150)
    meter_id = models.IntegerField()

    class Meta:
        db_table = 'meter_group_members'
        managed = False
        verbose_name = 'Meter Group Member'
        verbose_name_plural = 'Meter Group Members'

    def __str__(self):
        return f"Group {self.group_id}: {self.plant} #{self.meter_id}"


class MeterConfig(models.Model):
    id = models.AutoField(primary_key=True)
    plant = models.CharField(max_length=150)
    meter_id = models.IntegerField()
    name = models.CharField(max_length=150)
    type = models.CharField(max_length=50, default='submeter')

    class Meta:
        db_table = 'meter_config'
        managed = False
        verbose_name = 'Meter Configuration'
        verbose_name_plural = 'Meter Configurations'

    def __str__(self):
        return f"{self.plant} - {self.name} (#{self.meter_id})"


class MeterData(models.Model):
    id = models.AutoField(primary_key=True)
    plant = models.CharField(max_length=150)
    meter_id = models.IntegerField()
    meter_name = models.CharField(max_length=150, null=True, blank=True)
    meter_type = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=50, null=True, blank=True)
    freq = models.FloatField(null=True, blank=True)
    volt = models.FloatField(null=True, blank=True)
    curr = models.FloatField(null=True, blank=True)
    pf = models.FloatField(null=True, blank=True)
    kw = models.FloatField(null=True, blank=True)
    kva = models.FloatField(null=True, blank=True)
    kwh = models.FloatField(null=True, blank=True)
    line_voltage = models.FloatField(null=True, blank=True)
    line_to_line_voltage = models.FloatField(null=True, blank=True)
    avg_voltage = models.FloatField(null=True, blank=True)
    voltage_unbalance = models.FloatField(null=True, blank=True)
    line_current = models.FloatField(null=True, blank=True)
    current_l1 = models.FloatField(null=True, blank=True)
    current_l2 = models.FloatField(null=True, blank=True)
    current_l3 = models.FloatField(null=True, blank=True)
    avg_current = models.FloatField(null=True, blank=True)
    neutral_line_current = models.FloatField(null=True, blank=True)
    kw_l1 = models.FloatField(null=True, blank=True)
    kw_l2 = models.FloatField(null=True, blank=True)
    kw_l3 = models.FloatField(null=True, blank=True)
    kw_total = models.FloatField(null=True, blank=True)
    kva_l1 = models.FloatField(null=True, blank=True)
    kva_l2 = models.FloatField(null=True, blank=True)
    kva_l3 = models.FloatField(null=True, blank=True)
    kva_total = models.FloatField(null=True, blank=True)
    kva_max_demand = models.FloatField(null=True, blank=True)
    timestamp = models.DateTimeField()

    class Meta:
        db_table = 'meter_data'
        managed = False
        verbose_name = 'Meter Reading'
        verbose_name_plural = 'Meter Readings'

    def __str__(self):
        return f"{self.plant} #{self.meter_id} @ {self.timestamp}"


class DeviceHeartbeat(models.Model):
    device_id = models.CharField(primary_key=True, max_length=100)
    last_seen = models.DateTimeField()
    ip_addr = models.CharField(max_length=50, null=True, blank=True)
    meter_count = models.IntegerField(null=True, blank=True)
    meter_ids = models.TextField(null=True, blank=True)
    is_configured = models.BooleanField(default=False)

    class Meta:
        db_table = 'device_heartbeats'
        managed = False
        verbose_name = 'Device Heartbeat'
        verbose_name_plural = 'Device Heartbeats'

    def __str__(self):
        return f"{self.device_id} ({self.ip_addr})"


class GroupDailySummary(models.Model):
    id = models.AutoField(primary_key=True)
    group_id = models.IntegerField()
    date = models.DateField()
    total_kwh = models.FloatField()

    class Meta:
        db_table = 'group_daily_summary'
        managed = False
        verbose_name = 'Group Daily Summary'
        verbose_name_plural = 'Group Daily Summaries'

    def __str__(self):
        return f"Group {self.group_id} on {self.date}: {self.total_kwh} kWh"
