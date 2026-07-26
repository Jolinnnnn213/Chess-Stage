"use client";

import dynamic from "next/dynamic";

const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const MorsLightCanvas = dynamic(
  () => import("./light/MorsLightCanvas").then((module) => module.MorsLightCanvas),
  {
    loading: () => <main className="experience-shell chess-stage-loading" aria-label="Loading Chess Stage" />,
    ssr: false,
  },
);

export function MorsLightExperience() {
  return (
    <>
      <MorsLightCanvas />
      <div className="opening-sequence" aria-hidden="true">
        <div className="opening-sequence-art"
          style={{ backgroundImage: `url(${ASSET_BASE}/chess-stage-intro.png)` }} />
      </div>
    </>
  );
}
