from __future__ import annotations

from dataclasses import dataclass

from prometheus_client import CollectorRegistry, Counter, Histogram, generate_latest


@dataclass(slots=True)
class Metrics:
    registry: CollectorRegistry
    requests: Counter
    duration: Histogram

    @classmethod
    def create(cls) -> Metrics:
        registry = CollectorRegistry(auto_describe=True)
        return cls(
            registry=registry,
            requests=Counter(
                "workcard_http_requests_total",
                "HTTP requests handled by the API",
                ("method", "route", "status"),
                registry=registry,
            ),
            duration=Histogram(
                "workcard_http_request_duration_seconds",
                "HTTP request duration",
                ("method", "route"),
                registry=registry,
                buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5),
            ),
        )

    def render(self) -> bytes:
        return generate_latest(self.registry)
