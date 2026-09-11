from django.contrib import admin
from .models import (
    EMSUser, UserSettings, Plant, Location, MeterGroup,
    MeterGroupMember, MeterConfig, MeterData, DeviceHeartbeat, GroupDailySummary
)


@admin.register(EMSUser)
class EMSUserAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'role', 'created_at')
    search_fields = ('username', 'role')
    list_filter = ('role',)


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ('user_id', 'theme', 'color_preset', 'custom_primary', 'custom_sub')


@admin.register(Plant)
class PlantAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'location_id')
    search_fields = ('name',)


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ('id', 'name')
    search_fields = ('name',)


@admin.register(MeterGroup)
class MeterGroupAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'location_id')
    search_fields = ('name',)


@admin.register(MeterGroupMember)
class MeterGroupMemberAdmin(admin.ModelAdmin):
    list_display = ('id', 'group_id', 'plant', 'meter_id')
    list_filter = ('plant', 'group_id')


@admin.register(MeterConfig)
class MeterConfigAdmin(admin.ModelAdmin):
    list_display = ('id', 'plant', 'meter_id', 'name', 'type')
    search_fields = ('plant', 'name')
    list_filter = ('plant', 'type')


@admin.register(MeterData)
class MeterDataAdmin(admin.ModelAdmin):
    list_display = ('id', 'plant', 'meter_id', 'meter_name', 'status', 'kw', 'kwh', 'timestamp')
    search_fields = ('plant', 'meter_name')
    list_filter = ('plant', 'status')
    date_hierarchy = 'timestamp'


@admin.register(DeviceHeartbeat)
class DeviceHeartbeatAdmin(admin.ModelAdmin):
    list_display = ('device_id', 'ip_addr', 'meter_count', 'is_configured', 'last_seen')
    search_fields = ('device_id', 'ip_addr')


@admin.register(GroupDailySummary)
class GroupDailySummaryAdmin(admin.ModelAdmin):
    list_display = ('id', 'group_id', 'date', 'total_kwh')
    list_filter = ('date', 'group_id')
