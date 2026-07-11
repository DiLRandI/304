export function clearGameUiElements(elements) {
  for (const element of Object.values(elements)) {
    if (element) {
      element.textContent = "";
    }
  }
}

export function formatLobbySeatAvailability(seats) {
  const entries = Array.isArray(seats) ? seats : [];
  const disconnectedSeats = entries.filter((seat) => seat.connectionStatus === "disconnected").length;
  if (disconnectedSeats === 0) {
    return "";
  }
  const autopilotSeats = entries.filter((seat) => seat.connectionStatus === "autopilot").length;
  return `Seat availability: ${disconnectedSeats} disconnected, ${autopilotSeats} on autopilot.`;
}
