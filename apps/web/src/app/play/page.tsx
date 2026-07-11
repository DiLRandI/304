import { PlayClient } from "../../components/play-client";

export const dynamic = "force-dynamic";

export default function PlayPage() {
  return (
    <main className="play-page">
      <PlayClient serviceOrigin={process.env.NEXT_PUBLIC_GAME_SERVICE_URL} />
    </main>
  );
}
