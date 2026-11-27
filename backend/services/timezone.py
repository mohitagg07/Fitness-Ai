"""Consistent local calendar helpers for schedule-aware training and nutrition."""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def safe_zoneinfo(timezone_name: str | None):
    """Resolve an IANA timezone; malformed names safely fall back to UTC."""
    name = str(timezone_name or "UTC").strip()
    if len(name) > 64:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return timezone.utc


def local_now(timezone_name: str | None) -> datetime:
    return datetime.now(safe_zoneinfo(timezone_name))


def local_today(timezone_name: str | None) -> date:
    return local_now(timezone_name).date()
