export interface RoomChangedNotice {
  readonly eventVersion: number;
  readonly roomId: string;
}

export interface RoomChangePublisher {
  publish(notice: RoomChangedNotice): Promise<void>;
}
