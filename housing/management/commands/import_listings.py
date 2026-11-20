import csv
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from housing.models import (
    LISTING_COORDINATE_FIELDS, LISTING_DATE_FIELDS, LISTING_INTEGER_FIELDS, LISTING_TEXT_FIELDS,
    RHYTHMS, ROOMMATE_RULES, SMOKE_LEVELS, Listing, Roommate,
)


DEFAULT_CSV = "beijing-central-shared-rent-synthetic.csv"
REQUIRED_COLUMNS = {
    "listing_id", "monthly_rent_cny", "min_lease_days", "max_lease_days",
    *LISTING_COORDINATE_FIELDS, *LISTING_DATE_FIELDS, *LISTING_TEXT_FIELDS,
}
COORDINATE_LIMITS = (180, 90)


def parse_roommates(row, rule):
    source = json.loads(row.get("roommates_json") or "[]")
    if not isinstance(source, list):
        raise ValueError("roommates_json 应为室友列表。")
    count = row.get("roommate_count")
    if count and int(count) != len(source):
        raise ValueError("室友人数与画像数量不一致。")
    allowed_gender = ROOMMATE_RULES[rule]
    profiles = []
    for profile in source:
        if not isinstance(profile, dict):
            raise ValueError("室友画像格式有误。")
        gender = profile.get("gender")
        mbti = profile.get("mbti")
        rhythm = profile.get("rhythm")
        smoke = profile.get("smoke")
        occupation = profile.get("occ")
        if (
            gender not in ("男", "女")
            or (allowed_gender is not None and gender != allowed_gender)
            or not isinstance(mbti, str) or not re.fullmatch("[EI][SN][TF][JP]", mbti)
            or type(rhythm) is not int or not 0 <= rhythm < len(RHYTHMS)
            or type(smoke) is not int or not 0 <= smoke < len(SMOKE_LEVELS)
            or type(profile.get("hasPet")) is not bool or type(profile.get("acceptPet")) is not bool
            or not isinstance(occupation, str) or not occupation.strip() or len(occupation) > 80
        ):
            raise ValueError("室友画像的性别、作息、吸烟、宠物或职业字段有误。")
        profiles.append({
            "gender": gender, "mbti": mbti, "rhythm": rhythm, "smoke": smoke,
            "has_pet": profile["hasPet"], "accept_pet": profile["acceptPet"],
            "occupation": occupation,
        })
    return profiles


def parse_listing(row):
    if None in row or any(value is None for value in row.values()):
        raise ValueError("列数与表头不一致。")
    if any(not row[field].strip() for field in REQUIRED_COLUMNS):
        raise ValueError("房源编号、房型、租期或坐标有缺失。")

    attributes = {field: row[field] for field in LISTING_TEXT_FIELDS}
    for field in LISTING_INTEGER_FIELDS:
        default = "1" if field == "rent_payment_months" else "0"
        attributes[field] = int(row.get(field) or default)
    for field in LISTING_DATE_FIELDS:
        parsed = date.fromisoformat(row[field])
        if parsed.isoformat() != row[field]:
            raise ValueError(f"{field} 应采用 YYYY-MM-DD 格式。")
        attributes[field] = parsed
    for field, limit in zip(LISTING_COORDINATE_FIELDS, COORDINATE_LIMITS):
        coordinate = Decimal(row[field])
        if not coordinate.is_finite() or abs(coordinate) > limit:
            raise ValueError(f"{field} 超出有效范围。")
        attributes[field] = coordinate
    rule = row.get("roommate_rule") or "不限性别"
    if rule not in ROOMMATE_RULES:
        raise ValueError("入住规则无效。")
    attributes["roommate_rule"] = rule
    attributes["source_record"] = row

    listing = Listing(listing_id=row["listing_id"], **attributes)
    # Compute validation without querying for an existing primary key on reimports.
    listing.full_clean(validate_unique=False)
    return listing, parse_roommates(row, rule)


def read_listings(path):
    parsed = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, strict=True)
        headers = reader.fieldnames
        if not headers or not REQUIRED_COLUMNS.issubset(headers) or len(headers) != len(set(headers)):
            raise CommandError("CSV 表头缺少必填字段，或存在重复列。")
        for row in reader:
            try:
                listing, profiles = parse_listing(row)
                if listing.pk in parsed:
                    raise ValueError(f"房源编号 {listing.pk} 重复。")
                parsed[listing.pk] = (listing, profiles)
            except (ValueError, InvalidOperation, ValidationError) as exc:
                raise CommandError(f"CSV 第 {reader.line_num} 行有误：{exc}") from exc
    if not parsed:
        raise CommandError("CSV 没有可导入的房源。")
    return parsed


class Command(BaseCommand):
    help = "将 UTF-8 房源 CSV 按房源编号导入，并同步室友画像。"

    def add_arguments(self, parser):
        parser.add_argument("csv_path", nargs="?", type=Path, default=settings.BASE_DIR / DEFAULT_CSV)

    def handle(self, *args, **options):
        path = options["csv_path"]
        try:
            parsed = read_listings(path)
        except (OSError, UnicodeError, csv.Error) as exc:
            raise CommandError(f"无法读取房源 CSV：{exc}") from exc

        imported_roommates = 0
        with transaction.atomic():
            for listing_id in sorted(parsed):
                listing, profiles = parsed[listing_id]
                defaults = {
                    field.name: getattr(listing, field.name)
                    for field in Listing._meta.concrete_fields
                    if not field.primary_key
                }
                saved, _ = Listing.objects.update_or_create(pk=listing.pk, defaults=defaults)
                for position, profile in enumerate(profiles, start=1):
                    Roommate.objects.update_or_create(listing=saved, position=position, defaults=profile)
                saved.roommates.filter(position__gt=len(profiles)).delete()
                imported_roommates += len(profiles)

        self.stdout.write(self.style.SUCCESS(f"已导入 {len(parsed)} 套房源、{imported_roommates} 位室友。"))
