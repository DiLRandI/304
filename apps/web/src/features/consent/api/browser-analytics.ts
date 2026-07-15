import {
  type AnalyticsEvent,
  type AnalyticsPayload,
  type AnalyticsProperties,
  type ConsentState,
  createAnalyticsPayload,
  isAnalyticsEndpoint,
} from "../model/consent";
import { readConsent } from "./browser-consent-store";

export type AnalyticsTransport = (
  endpoint: string,
  payload: AnalyticsPayload,
) => void;

export interface TrackOptions {
  consent?: ConsentState;
  endpoint?: string;
  transport?: AnalyticsTransport;
}

function configuredEndpoint(): string | undefined {
  const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim();
  return endpoint || undefined;
}

function browserTransport(endpoint: string, payload: AnalyticsPayload): void {
  const serialized = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(
      endpoint,
      new Blob([serialized], { type: "application/json" }),
    );
    return;
  }
  if (typeof fetch === "function") {
    void fetch(endpoint, {
      body: serialized,
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  }
}

export function track(
  event: AnalyticsEvent,
  properties: AnalyticsProperties,
  options: TrackOptions = {},
): boolean {
  const consent = options.consent ?? readConsent();
  const endpoint = options.endpoint ?? configuredEndpoint();
  const payload = createAnalyticsPayload(event, properties);
  if (
    consent !== "optional_analytics" ||
    !isAnalyticsEndpoint(endpoint) ||
    payload === null
  ) {
    return false;
  }
  (options.transport ?? browserTransport)(endpoint, payload);
  return true;
}
