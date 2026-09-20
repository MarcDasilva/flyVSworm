"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrainModal from "@/components/brain/BrainModal";

function Brain() {
  const router = useRouter();
  const of = useSearchParams().get("of");
  return <BrainModal subject={of === "worm" ? "worm" : "fly"} onClose={() => router.push("/")} />;
}

// The brain modal on its own page: a direct link for testing and a fallback for the demo.
// /brain?of=worm opens the worm instead of the fly.
//
// The Suspense boundary is required, not decorative: useSearchParams opts the subtree out of
// prerendering, and without it `next build` fails on this route.
export default function BrainPage() {
  return (
    <Suspense>
      <Brain />
    </Suspense>
  );
}
