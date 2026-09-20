"use client";

import { useRouter } from "next/navigation";
import BrainModal from "@/components/brain/BrainModal";

// The brain modal on its own page (/brain): a direct link for testing and a fallback for the demo.
export default function BrainPage() {
  const router = useRouter();
  return <BrainModal open onClose={() => router.push("/")} />;
}
