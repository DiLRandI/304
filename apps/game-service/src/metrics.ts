import { Counter, collectDefaultMetrics, Registry } from "prom-client";

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "three_zero_four_" });
  const requests = new Counter({
    name: "three_zero_four_http_requests_total",
    help: "Completed HTTP requests by route and status code",
    labelNames: ["route", "status_code"] as const,
    registers: [registry],
  });
  return { registry, requests };
}
