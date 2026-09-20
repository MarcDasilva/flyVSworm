"use client";

// The landing page: the fly typing trades at its computer, with the worm's terrarium across the
// desk. Clicking either animal opens that animal's brain; the scene pauses while it is open.

import { useCallback, useEffect, useRef, useState } from "react";
import { createFlyScene, type FlyScene, type Subject } from "./flyScene";
import BrainModal from "@/components/brain/BrainModal";

type Status = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

const PROMPT: Record<Subject, string> = {
  fly: "click the fly to see its brain",
  worm: "click the worm to see its brain",
};

export default function Launcher() {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<FlyScene | null>(null);
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [hover, setHover] = useState<Subject | null>(null);
  const [open, setOpen] = useState<Subject | null>(null);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    const handle = createFlyScene(mount.current!, {
      onReady: () => setStatus({ state: "ready" }),
      onError: (message) => setStatus({ state: "error", message }),
      onHover: setHover,
      onPick: setOpen,
    });
    scene.current = handle;
    return () => {
      handle.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setPaused(open !== null);
  }, [open]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#07090d]">
      <div ref={mount} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55))]" />

      <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center gap-6">
        {status.state === "loading" && <p className="font-mono text-sm text-zinc-500">loading the fly…</p>}
        {status.state === "error" && <p className="max-w-md px-4 text-center text-sm text-red-400">{status.message}</p>}
        {status.state === "ready" && (["fly", "worm"] as const).map((subject) => (
          // also real buttons, so each brain opens from the keyboard and for screen readers
          <button
            key={subject}
            type="button"
            onClick={() => setOpen(subject)}
            className={`pointer-events-auto rounded px-2 py-1 font-mono text-sm tracking-wide transition-colors hover:text-teal-300 focus-visible:text-teal-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-teal-300/60 ${hover === subject ? "text-teal-300" : "text-zinc-500"}`}
          >
            {PROMPT[subject]}
          </button>
        ))}
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

      {/* The worm's gait here is local, not the chain's (wormTank.ts) — say so where it shows. */}
      <p className="absolute bottom-3 left-4 text-[11px] text-zinc-600">
        worm: demo gait, not on chain
      </p>

      <BrainModal subject={open} onClose={close} />
    </main>
  );
}
