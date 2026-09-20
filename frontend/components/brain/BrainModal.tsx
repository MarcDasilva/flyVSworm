"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import type { Subject } from "@/components/launcher/flyScene";

// three.js needs the browser: load the scene client-side only, and only once the modal opens.
const BrainCanvas = dynamic(() => import("./BrainCanvas"), { ssr: false });
const WormBrainCanvas = dynamic(() => import("./WormBrainCanvas"), { ssr: false });

const LABEL: Record<Subject, string> = {
  fly: "Live fly brain",
  worm: "Worm brain, 302 neurons",
};

interface Props {
  /** Which animal was clicked, or null when nothing is open. */
  subject: Subject | null;
  onClose: () => void;
}

/** Full-viewport overlay holding only the 3D brain of whichever animal was clicked. Close with the
 *  button or Esc. Two canvases, ONE overlay — the modal owns the chrome, never the scene. */
export default function BrainModal({ subject, onClose }: Props) {
  useEffect(() => {
    if (!subject) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subject, onClose]);

  if (!subject) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={LABEL[subject]}
         style={{ position: "fixed", inset: 0, zIndex: 50, background: "#07080b" }}>
      {subject === "fly" ? <BrainCanvas /> : <WormBrainCanvas />}
      <button type="button" onClick={onClose} aria-label="Close the brain"
              style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 20,
                       border: "1px solid #2a2e35", background: "rgba(20,22,27,0.8)", color: "#c9d1db",
                       font: "20px system-ui, sans-serif", lineHeight: "38px", cursor: "pointer" }}>
        ×
      </button>
    </div>
  );
}
