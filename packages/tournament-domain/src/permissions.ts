export type TournamentRole = "organizer" | "captain" | "member";
export type TournamentStatus =
  | "registration"
  | "group_stage"
  | "knockout"
  | "completed"
  | "cancelled";
export type TournamentAction =
  | "rename_team"
  | "remove_member"
  | "transfer_captain"
  | "open_round"
  | "draw"
  | "lock"
  | "forfeit"
  | "cancel";

export function canExecuteTournamentAction(
  role: TournamentRole,
  action: TournamentAction,
  status: TournamentStatus,
  fixtureActive: boolean,
): boolean {
  if (status === "completed" || status === "cancelled") {
    return false;
  }
  if (action === "transfer_captain") {
    return (role === "captain" || role === "organizer") && !fixtureActive;
  }
  if (action === "rename_team" || action === "remove_member") {
    return (
      status === "registration" && (role === "captain" || role === "organizer")
    );
  }
  if (action === "open_round") {
    return (
      role === "organizer" &&
      (status === "group_stage" || status === "knockout")
    );
  }
  if (action === "draw" || action === "lock") {
    return role === "organizer" && status === "registration";
  }
  return role === "organizer";
}
