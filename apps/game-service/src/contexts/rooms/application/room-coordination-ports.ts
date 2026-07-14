export interface RoomLease {
  withLease<Result>(
    roomId: string,
    work: () => Promise<Result>,
  ): Promise<Result>;
}

export interface RoomPresence {
  onlinePlayerIds(
    roomId: string,
    playerIds: readonly string[],
  ): Promise<Set<string>>;
  remove(roomId: string, playerId: string): Promise<void>;
  touch(roomId: string, playerId: string): Promise<void>;
}
