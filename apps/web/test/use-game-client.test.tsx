/** @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGameClient } from "../src/features/room/hooks/use-game-client.js";

describe("useGameClient", () => {
  it("reuses a valid client until the configured service origin changes", () => {
    const { rerender, result } = renderHook(
      ({ serviceOrigin }: { serviceOrigin: string | undefined }) =>
        useGameClient(serviceOrigin),
      { initialProps: { serviceOrigin: "https://api.example.test" } },
    );
    const firstClient = result.current;

    rerender({ serviceOrigin: "https://api.example.test" });
    expect(result.current).toBe(firstClient);

    rerender({ serviceOrigin: "https://next-api.example.test" });
    expect(result.current).not.toBe(firstClient);
  });

  it("rejects missing and invalid service origins", () => {
    const { rerender, result } = renderHook(
      ({ serviceOrigin }: { serviceOrigin: string | undefined }) =>
        useGameClient(serviceOrigin),
      { initialProps: { serviceOrigin: undefined } },
    );

    expect(result.current).toBe(null);
    rerender({ serviceOrigin: "not-a-url" });
    expect(result.current).toBe(null);
  });
});
