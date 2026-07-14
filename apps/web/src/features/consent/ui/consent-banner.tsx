"use client";

import { useState, useSyncExternalStore } from "react";
import {
  type ConsentState,
  readConsent,
  readServerConsent,
  subscribeToConsent,
  writeConsent,
} from "../model/consent";

export function ConsentBanner({
  onChoice,
}: {
  onChoice?(choice: Exclude<ConsentState, "unknown">): void;
}) {
  const storedConsent = useSyncExternalStore(
    subscribeToConsent,
    readConsent,
    readServerConsent,
  );
  const [sessionConsent, setSessionConsent] = useState<ConsentState>("unknown");
  const consent = sessionConsent === "unknown" ? storedConsent : sessionConsent;

  function choose(choice: Exclude<ConsentState, "unknown">): void {
    writeConsent(choice);
    setSessionConsent(choice);
    onChoice?.(choice);
  }

  if (consent !== "unknown") return null;

  return (
    <aside aria-label="Privacy choices" className="consent-banner">
      <p className="eyebrow">Your choice</p>
      <p>
        Essential cookies keep your private table connected. Optional anonymous
        analytics stay off unless you allow them and this release is configured
        with an analytics endpoint.
      </p>
      <div className="consent-actions">
        <button onClick={() => choose("essential_only")} type="button">
          Essential only
        </button>
        <button
          className="secondary-action"
          onClick={() => choose("optional_analytics")}
          type="button"
        >
          Allow optional analytics
        </button>
      </div>
    </aside>
  );
}
