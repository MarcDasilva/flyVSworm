"use client";

import { useEffect, useRef, useState } from "react";
import { createBrainScene, type SceneStatus } from "./brainScene";

const STATUS_TEXT: Record<SceneStatus["phase"], string> = {
  loading: "Loading the brain…",
  connecting: "Connecting to the fly…",
  live: "",
  offline: "The fly is offline. Start fly-brain/python/chain_server.py; retrying…",
  error: "",
};

/** Mounts the three.js brain scene into a div that fills its parent. */
export default function BrainCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SceneStatus>({ phase: "loading" });

  useEffect(() => {
    const scene = createBrainScene(host.current!, setStatus);
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
