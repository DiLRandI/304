import assert from "node:assert/strict";
import test from "node:test";
import { clearGameUiElements, formatLobbySeatAvailability } from "../src/ui/view.js";

test("clearing the game view also clears its live announcement", () => {
  const elements = Object.fromEntries(
    [
      "gameMessage",
      "announcementBanner",
      "matchBoard",
      "scoreboard",
      "trumpArea",
      "trickArea",
      "handAuditArea",
      "bidHistoryArea",
      "previousTrickArea",
      "myHandArea",
      "actionsArea",
      "resultSummary",
      "promptLine",
    ].map((name) => [name, { textContent: `${name} stale content` }]),
  );

  clearGameUiElements(elements);

  for (const element of Object.values(elements)) {
    assert.equal(element.textContent, "");
  }
});

test("lobby seat availability stays scoped to disconnected seats", () => {
  assert.equal(
    formatLobbySeatAvailability([
      { connectionStatus: "online" },
      { connectionStatus: "online" },
    ]),
    "",
  );
  assert.equal(
    formatLobbySeatAvailability([
      { connectionStatus: "online" },
      { connectionStatus: "disconnected" },
      { connectionStatus: "autopilot" },
    ]),
    "Seat availability: 1 disconnected, 1 on autopilot.",
  );
});
