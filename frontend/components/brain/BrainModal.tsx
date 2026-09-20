"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

// three.js needs the browser: load the scene client-side only, and only once the modal opens.
const BrainCanvas = dynamic(() => import("./BrainCanvas"), { ssr: false });

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Full-viewport overlay holding only the live 3D fly brain. Close with the button or Esc. */
export default function BrainModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Live fly brain"
         style={{ position: "fixed", inset: 0, zIndex: 50, background: "#07080b" }}>
      <BrainCanvas />
      <button type="button" onClick={onClose} aria-label="Close the brain"
              style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 20,
                       border: "1px solid #2a2e35", background: "rgba(20,22,27,0.8)", color: "#c9d1db",
                       font: "20px system-ui, sans-serif", lineHeight: "38px", cursor: "pointer" }}>
        ×
      </button>
    </div>
  );
}
