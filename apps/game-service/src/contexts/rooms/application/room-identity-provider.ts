export interface RoomIdentityProvider {
  nextAutomationJobId(): string;
  nextCommandId(): string;
  nextRoomId(): string;
}
