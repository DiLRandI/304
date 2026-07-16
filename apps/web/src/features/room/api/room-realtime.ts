import {
  type RealtimeServerMessage,
  RealtimeServerMessageSchema,
} from "@three-zero-four/contracts";
import { parseGameServiceOrigin } from "./game-service-transport";

export function parseRealtimeServerMessage(
  value: unknown,
): RealtimeServerMessage {
  return RealtimeServerMessageSchema.parse(value);
}

export function toRoomSocketUrl(serviceOrigin: string, roomId: string): string {
  const url = new URL(
    `/v1/realtime/rooms/${encodeURIComponent(roomId)}`,
    parseGameServiceOrigin(serviceOrigin),
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
