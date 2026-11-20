from datetime import date

from django.http import JsonResponse

from .models import Listing


def query_rent(params, field):
    value = params.get(field)
    if not value:
        return None
    try:
        rent = int(value)
    except ValueError:
        raise ValueError("租金应为非负整数。") from None
    if rent < 0 or rent > 2_147_483_647:
        raise ValueError("租金应为有效的非负整数。")
    return rent


def query_date(params, field):
    value = params.get(field)
    if not value:
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError("日期应采用 YYYY-MM-DD 格式。") from None
    if parsed.isoformat() != value:
        raise ValueError("日期应采用 YYYY-MM-DD 格式。")
    return parsed


def listings(request):
    if request.method != "GET":
        return JsonResponse({"error": "此接口只支持 GET 请求。"}, status=405, headers={"Allow": "GET"})
    try:
        min_rent = query_rent(request.GET, "min_rent")
        max_rent = query_rent(request.GET, "max_rent")
        check_in = query_date(request.GET, "check_in")
        check_out = query_date(request.GET, "check_out")
        if min_rent is not None and max_rent is not None and min_rent > max_rent:
            raise ValueError("最低租金应小于或等于最高租金。")
        if check_in and check_out and check_in >= check_out:
            raise ValueError("退租日期应晚于入住日期。")
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    base = Listing.objects.all()
    budget = base
    if min_rent is not None:
        budget = budget.filter(monthly_rent_cny__gte=min_rent)
    if max_rent is not None:
        budget = budget.filter(monthly_rent_cny__lte=max_rent)

    matching = budget
    if check_in:
        matching = matching.filter(available_from__lte=check_in, available_until_exclusive__gt=check_in)
    if check_out:
        matching = matching.filter(available_from__lt=check_out, available_until_exclusive__gte=check_out)
    if check_in and check_out:
        stay = (check_out - check_in).days
        matching = matching.filter(min_lease_days__lte=stay, max_lease_days__gte=stay)
    records = [listing.csv_record() for listing in matching.order_by("listing_id").prefetch_related("roommates")]
    budget_count = budget.count()
    return JsonResponse({
        "listings": records,
        "counts": {
            "budget_excluded": base.count() - budget_count,
            "lease_excluded": budget_count - len(records),
        },
    })


def listing_detail(request, listing_id):
    if request.method != "GET":
        return JsonResponse({"error": "此接口只支持 GET 请求。"}, status=405, headers={"Allow": "GET"})
    listing = Listing.objects.filter(pk=listing_id).prefetch_related("roommates").first()
    if listing is None:
        return JsonResponse({"error": "未找到该房源。"}, status=404)
    return JsonResponse({"listing": listing.csv_record()})
