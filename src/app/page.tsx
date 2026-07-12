"use client";

import dynamic from "next/dynamic";

// The whole game touches the DOM/canvas and window, so it must never run
// during SSR/prerender. Load it client-only. (ssr:false is allowed here
// because this is a Client Component.)
const GameRoot = dynamic(() => import("@/components/GameRoot"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-dim">
      loading…
    </div>
  ),
});

export default function Home() {
  return <GameRoot />;
}
