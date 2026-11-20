from django.contrib import admin

from .models import Listing, Roommate


class RoommateInline(admin.TabularInline):
    model = Roommate
    extra = 0


@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ("listing_id", "district", "area", "monthly_rent_cny", "available_from", "available_until_exclusive")
    list_filter = ("district", "room_type", "roommate_rule")
    search_fields = ("listing_id", "community", "area")
    inlines = [RoommateInline]
