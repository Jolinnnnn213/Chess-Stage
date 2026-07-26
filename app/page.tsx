import type { Metadata } from "next";
import { MorsLightExperience } from "./MorsLightExperience";

export const metadata: Metadata = {
  title: "Chess Stage",
  description:
    "An interactive chess and light experiment by Jolin Li. Swing the lamp to wake the scattered pieces.",
};

export default function Home() {
  return <MorsLightExperience />;
}
