import { RoomClient } from "../../../features/room/ui/room-client";

export const dynamic = "force-dynamic";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomRef: string }>;
}) {
  const { roomRef } = await params;
  return (
    <main className="room-page">
      <RoomClient
        roomReference={roomRef}
        serviceOrigin={process.env.NEXT_PUBLIC_GAME_SERVICE_URL}
      />
    </main>
  );
}
