import HeroShell from "@/components/landing/HeroShell";
import Statement from "@/components/landing/Statement";
import Capabilities from "@/components/landing/Capabilities";
import Interop from "@/components/landing/Interop";
import Optimisation from "@/components/landing/Optimisation";
import Sources from "@/components/landing/Sources";
import DemoRequest from "@/components/landing/DemoRequest";

export default function Home() {
  return (
    <>
      <HeroShell />
      <Statement />
      <Capabilities />
      <Interop />
      <Optimisation />
      <Sources />
      <DemoRequest />
    </>
  );
}
