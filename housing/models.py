import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


CSV_COLUMNS = (
    "listing_id", "data_kind", "city", "district", "area", "community", "room_type", "layout",
    "room_area_sqm", "apartment_area_sqm", "rental_channel", "monthly_rent_cny",
    "monthly_service_fee_cny", "estimated_utilities_cny_month", "estimated_total_cny_month",
    "deposit_cny", "rent_payment_months", "min_lease_days", "max_lease_days", "available_from",
    "available_until_exclusive", "lease_fit_mar_jun_2027", "has_elevator",
    "longitude_gcj02_synthetic", "latitude_gcj02_synthetic",
    "benchmark_2024_whole_unit_cny_sqm_month", "location_description", "location_reference_name",
    "reference_straight_line_m_approx", "location_reference_amap_url", "listing_amap_url",
    "roommate_rule", "roommate_count", "roommates_json", "roommate_summary",
)
LISTING_TEXT_FIELDS = ("district", "area", "community", "room_type", "layout")
LISTING_INTEGER_FIELDS = (
    "monthly_rent_cny", "monthly_service_fee_cny", "estimated_utilities_cny_month",
    "deposit_cny", "rent_payment_months", "min_lease_days", "max_lease_days",
)
LISTING_DATE_FIELDS = ("available_from", "available_until_exclusive")
LISTING_COORDINATE_FIELDS = ("longitude_gcj02_synthetic", "latitude_gcj02_synthetic")
FIT_START = date(2027, 3, 1)
FIT_END = date(2027, 7, 1)
ROOMMATE_RULES = {"不限性别": None, "仅女生入住": "女", "仅男生入住": "男"}
RHYTHMS = ("早睡早起", "正常规律", "夜猫子", "不规律")
SMOKE_LEVELS = ("不吸烟", "偶尔·室外为主", "室内常吸")


def roommate_summary(profiles):
    return " / ".join(
        " · ".join((
            f"室友{position}", profile["gender"], profile["occ"], profile["mbti"],
            RHYTHMS[profile["rhythm"]], SMOKE_LEVELS[profile["smoke"]],
            "养宠" if profile["hasPet"] else "未养宠",
            "接受带宠室友" if profile["acceptPet"] else "不接受带宠室友",
        ))
        for position, profile in enumerate(profiles, start=1)
    )


def is_same_number(source_value, value):
    try:
        return Decimal(source_value) == value
    except (InvalidOperation, TypeError, ValueError):
        return False


class Listing(models.Model):
    listing_id = models.CharField("房源编号", max_length=80, primary_key=True)
    district = models.CharField("行政区", max_length=40)
    area = models.CharField("片区", max_length=80)
    community = models.CharField("小区", max_length=150)
    room_type = models.CharField("房型", max_length=40)
    layout = models.CharField("户型", max_length=40)
    monthly_rent_cny = models.PositiveIntegerField("月租", db_index=True)
    monthly_service_fee_cny = models.PositiveIntegerField("每月服务费", default=0)
    estimated_utilities_cny_month = models.PositiveIntegerField("每月预估水电费", default=0)
    deposit_cny = models.PositiveIntegerField("押金", default=0)
    rent_payment_months = models.PositiveSmallIntegerField("预付月数", default=1)
    min_lease_days = models.PositiveIntegerField("最短租期")
    max_lease_days = models.PositiveIntegerField("最长租期")
    available_from = models.DateField("最早入住", db_index=True)
    available_until_exclusive = models.DateField("最晚退租", db_index=True)
    longitude_gcj02_synthetic = models.DecimalField("经度", max_digits=9, decimal_places=6)
    latitude_gcj02_synthetic = models.DecimalField("纬度", max_digits=8, decimal_places=6)
    roommate_rule = models.CharField(
        "入住规则", max_length=20, choices=[(rule, rule) for rule in ROOMMATE_RULES],
        default="不限性别",
    )
    source_record = models.JSONField(default=dict, editable=False)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(monthly_rent_cny__gt=0), name="listing_rent_positive"),
            models.CheckConstraint(condition=models.Q(rent_payment_months__gt=0), name="listing_payment_positive"),
            models.CheckConstraint(
                condition=models.Q(min_lease_days__lte=models.F("max_lease_days")),
                name="listing_lease_days_order",
            ),
            models.CheckConstraint(
                condition=models.Q(available_from__lt=models.F("available_until_exclusive")),
                name="listing_availability_order",
            ),
            models.CheckConstraint(
                condition=models.Q(latitude_gcj02_synthetic__gte=-90, latitude_gcj02_synthetic__lte=90),
                name="listing_valid_latitude",
            ),
            models.CheckConstraint(
                condition=models.Q(longitude_gcj02_synthetic__gte=-180, longitude_gcj02_synthetic__lte=180),
                name="listing_valid_longitude",
            ),
        ]
        verbose_name = "房源"
        verbose_name_plural = "房源"

    def __str__(self):
        return f"{self.listing_id} · {self.community}"

    def csv_record(self):
        record = self.source_record.copy()
        record.setdefault("data_kind", "模拟")
        record.setdefault("city", "北京")
        lease_changed = any(record.get(field) != getattr(self, field).isoformat() for field in LISTING_DATE_FIELDS) or any(
            not is_same_number(record.get(field), getattr(self, field))
            for field in ("min_lease_days", "max_lease_days")
        )
        record["listing_id"] = self.listing_id
        for field in LISTING_TEXT_FIELDS:
            record[field] = getattr(self, field)
        for field in LISTING_INTEGER_FIELDS + LISTING_COORDINATE_FIELDS:
            value = getattr(self, field)
            if not is_same_number(record.get(field), value):
                record[field] = str(value)
        for field in LISTING_DATE_FIELDS:
            record[field] = getattr(self, field).isoformat()
        record["roommate_rule"] = self.roommate_rule
        if lease_changed or not record.get("lease_fit_mar_jun_2027"):
            stay = (FIT_END - FIT_START).days
            matches = (
                self.available_from <= FIT_START and self.available_until_exclusive >= FIT_END
                and self.min_lease_days <= stay <= self.max_lease_days
            )
            record["lease_fit_mar_jun_2027"] = "符合" if matches else "不符合"

        total = self.monthly_rent_cny + self.monthly_service_fee_cny + self.estimated_utilities_cny_month
        if not is_same_number(record.get("estimated_total_cny_month"), total):
            record["estimated_total_cny_month"] = str(total)

        profiles = [roommate.demo_profile() for roommate in self.roommates.all()]
        source_profile = json.loads(record.get("roommates_json") or "[]")
        if source_profile != profiles:
            record["roommates_json"] = json.dumps(profiles, ensure_ascii=False, separators=(",", ":"))
            record["roommate_count"] = str(len(profiles))
            record["roommate_summary"] = roommate_summary(profiles)

        ordered = {field: record[field] for field in CSV_COLUMNS if field in record}
        ordered.update({field: value for field, value in record.items() if field not in ordered})
        return ordered


class Roommate(models.Model):
    listing = models.ForeignKey(Listing, related_name="roommates", on_delete=models.CASCADE)
    position = models.PositiveSmallIntegerField()
    gender = models.CharField(max_length=1, choices=[("女", "女"), ("男", "男")])
    mbti = models.CharField(max_length=4)
    rhythm = models.PositiveSmallIntegerField(choices=list(enumerate(RHYTHMS)))
    smoke = models.PositiveSmallIntegerField(choices=list(enumerate(SMOKE_LEVELS)))
    has_pet = models.BooleanField(default=False)
    accept_pet = models.BooleanField(default=False)
    occupation = models.CharField(max_length=80)

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["listing", "position"], name="unique_roommate_position"),
        ]
        verbose_name = "室友"
        verbose_name_plural = "室友"

    def clean(self):
        super().clean()
        if not isinstance(self.mbti, str) or not re.fullmatch("[EI][SN][TF][JP]", self.mbti):
            raise ValidationError({"mbti": "请填写四位 MBTI 类型，例如 ENFJ。"})
        if self.listing_id:
            allowed_gender = ROOMMATE_RULES.get(self.listing.roommate_rule)
            if allowed_gender and self.gender != allowed_gender:
                raise ValidationError({"gender": "室友性别与房源入住规则不符。"})

    def demo_profile(self):
        return {
            "gender": self.gender, "mbti": self.mbti, "rhythm": self.rhythm,
            "hasPet": self.has_pet, "acceptPet": self.accept_pet,
            "smoke": self.smoke, "occ": self.occupation,
        }


class Favorite(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites")
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="favorites")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "listing"], name="unique_user_listing_favorite"),
        ]


class UserPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="housing_preferences")
    values = models.JSONField(default=dict)
