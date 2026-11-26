"""Dedicated VYRN background scheduler process.

Deploy this as one Background Worker instance, separate from FastAPI. This
avoids duplicate global jobs when the API is scaled to multiple workers or
replicas. Set SCHEDULER_ENABLED=true only on this process.
"""
from __future__ import annotations

import logging
import signal
import threading

from core.config import get_settings, validate_runtime_security_settings

logger = logging.getLogger("vyrn.worker")


def _require_scheduler_enabled(settings) -> None:
    if not settings.scheduler_enabled:
        raise RuntimeError(
            "SCHEDULER_ENABLED must be true for the dedicated worker. "
            "Do not enable it on API/web processes."
        )


def run_worker() -> None:
    settings = get_settings()
    validate_runtime_security_settings(settings)
    _require_scheduler_enabled(settings)

    # Scheduled agents can query vector-based safety guardrails; seed them in
    # this process as well as the API process so the worker is self-contained.
    from db.chroma_client import seed_guardrails
    seed_guardrails()

    from services.scheduler import start_scheduler
    scheduler = start_scheduler()
    stop_event = threading.Event()

    def request_shutdown(_signum, _frame) -> None:
        logger.info("Shutdown signal received; stopping scheduler.")
        stop_event.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    logger.info("VYRN scheduler worker is running.")
    try:
        stop_event.wait()
    finally:
        logger.info("Shutting down VYRN scheduler worker.")
        scheduler.shutdown(wait=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker()
