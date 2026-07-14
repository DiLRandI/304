import { PlayClient } from "../../features/room/ui/play-client";

export default function PlayPage() {
  return (
    <main className="play-page">
      <PlayClient serviceOrigin={process.env.NEXT_PUBLIC_GAME_SERVICE_URL} />
    </main>
  );
}
