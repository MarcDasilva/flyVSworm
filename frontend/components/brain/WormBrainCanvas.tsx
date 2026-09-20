"use client";

import { useEffect, useRef, useState } from "react";
import { createWormBrainScene, type WormSceneStatus } from "./wormBrainScene";

const STATUS_TEXT: Record<WormSceneStatus["phase"], string> = {
  loading: "Loading the worm's brain…",
  // Said out loud rather than left to look live: this app has no chain feed yet, so the arbors are
  // the real tracing with no voltage on them.
  anatomy: "302 neurons, traced anatomy — no live voltages in this view",
  error: "",
};

/** Mounts the three.js worm-brain scene into a div that fills its parent. */
export default function WormBrainCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<WormSceneStatus>({ phase: "loading" });

  useEffect(() => {
    const scene = createWormBrainScene(host.current!, setStatus);
    return () => scene.dispose();
  }, []);

  const text = status.phase === "error" ? status.message : STATUS_TEXT[status.phase];
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {text ? (
        <p role="status" style={{
          position: "absolute", left: 0, right: 0, bottom: 24, margin: 0, textAlign: "center",
          color: status.phase === "error" ? "#f0a39b" : "#9aa3ad", font: "14px system-ui, sans-serif",
          pointerEvents: "none" }}>
          {text}
        </p>
      ) : null}
    </div>
  );
}
