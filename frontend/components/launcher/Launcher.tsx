"use client";

// The landing page: a full-screen scene of the fly typing trades at its computer.
// Clicking the fly opens the brain modal; the scene pauses while it is open.

import { useCallback, useEffect, useRef, useState } from "react";
import { createFlyScene, type FlyScene } from "./flyScene";
import BrainModal from "@/components/brain/BrainModal";

type Status = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

export default function Launcher() {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<FlyScene | null>(null);
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handle = createFlyScene(mount.current!, {
      onReady: () => setStatus({ state: "ready" }),
      onError: (message) => setStatus({ state: "error", message }),
      onHover: setHover,
      onFlyClick: () => setOpen(true),
    });
    scene.current = handle;
    return () => {
      handle.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setPaused(open);
  }, [open]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#07090d]">
      <div ref={mount} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55))]" />

      <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center">
        {status.state === "loading" && <p className="font-mono text-sm text-zinc-500">loading the fly…</p>}
        {status.state === "error" && <p className="max-w-md px-4 text-center text-sm text-red-400">{status.message}</p>}
        {status.state === "ready" && (
          // also a real button, so the brain opens from the keyboard and for screen readers
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`pointer-events-auto rounded px-2 py-1 font-mono text-sm tracking-wide transition-colors hover:text-teal-300 focus-visible:text-teal-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-teal-300/60 ${hover ? "text-teal-300" : "text-zinc-500"}`}
          >
            click the fly to see its brain
          </button>
        )}
      </div>

      <p className="absolute bottom-3 right-4 text-[11px] text-zinc-600">
        <a
          className="hover:text-zinc-400"
          href="https://sketchfab.com/3d-models/fly-6a4470f884554864827d848718b2b6bc"
          target="_blank"
          rel="noopener noreferrer"
        >
          “Fly” by victorberdugo1
        </a>{" "}
        ·{" "}
        <a
          className="hover:text-zinc-400"
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
        >
          CC BY 4.0
        </a>
      </p>

      <BrainModal open={open} onClose={close} />
    </main>
  );
}
