"""
ARB-006: OpenTelemetry distributed tracing.

Instruments:
  - FastAPI (all HTTP requests/responses)
  - SQLAlchemy (all DB queries)
  - httpx (outbound HTTP — LLM calls, tool HTTP requests)

Exporters (controlled by OTLP_ENDPOINT env var):
  - OTLP_ENDPOINT set  → OTLP/HTTP exporter → Jaeger / Tempo / Honeycomb
  - OTLP_ENDPOINT empty → Console exporter (dev)
  - ENABLE_TRACING=false → tracing disabled entirely

Usage: call setup_tracing(app) in main.py lifespan startup.

Span attributes added automatically:
  - http.method, http.url, http.status_code
  - db.statement (SQL queries)
  - peer.service (for outbound calls)

Manual spans in code:
    from opentelemetry import trace
    tracer = trace.get_tracer(__name__)
    with tracer.start_as_current_span("my-operation") as span:
        span.set_attribute("agent.id", agent_id)
        ...
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def setup_tracing(app, service_name: str = "yuno-ai-platform") -> Optional[object]:
    """
    Configure OpenTelemetry. Returns the tracer provider or None if disabled.
    Safe to call even if opentelemetry packages are not installed — will log
    a warning and continue without tracing.
    """
    from app.core.config import settings

    if not settings.ENABLE_TRACING:
        logger.info("Distributed tracing disabled (ENABLE_TRACING=false).")
        return None

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    except ImportError as e:
        logger.warning(
            "OpenTelemetry packages not installed (%s). "
            "Install: pip install opentelemetry-sdk opentelemetry-instrumentation-fastapi "
            "opentelemetry-instrumentation-sqlalchemy opentelemetry-instrumentation-httpx "
            "opentelemetry-exporter-otlp-proto-http",
            e,
        )
        return None

    # Build resource
    resource = Resource.create({SERVICE_NAME: service_name})
    provider = TracerProvider(resource=resource)

    # Exporter
    if settings.OTLP_ENDPOINT:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
            exporter = OTLPSpanExporter(endpoint=settings.OTLP_ENDPOINT)
            logger.info("OTel tracing → OTLP endpoint: %s", settings.OTLP_ENDPOINT)
        except ImportError:
            logger.warning("OTLP exporter not installed — falling back to console exporter.")
            exporter = ConsoleSpanExporter()
    else:
        exporter = ConsoleSpanExporter()
        logger.info("OTel tracing → console (set OTLP_ENDPOINT for production)")

    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    # Instrument frameworks
    FastAPIInstrumentor.instrument_app(app)
    SQLAlchemyInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()

    logger.info("OpenTelemetry distributed tracing enabled (service=%s)", service_name)
    return provider
