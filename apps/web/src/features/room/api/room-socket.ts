import { RealtimeClientMessageSchema } from "@three-zero-four/contracts";

export const ROOM_SOCKET_OPEN = 1;

export interface RoomSocket {
  close(): void;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onopen: ((event: Event) => void) | null;
  readyState: number;
  send(data: string): void;
}

export type RoomSocketFactory = (url: string) => RoomSocket;

export const createBrowserRoomSocket: RoomSocketFactory = (url) =>
  new WebSocket(url);

export function encodeRoomClientMessage(value: unknown): string {
  return JSON.stringify(RealtimeClientMessageSchema.parse(value));
}
