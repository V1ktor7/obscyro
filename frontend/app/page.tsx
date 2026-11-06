import HeroShell from "@/components/landing/HeroShell";
import ProductSection from "@/components/landing/ProductSection";
import Statement from "@/components/landing/Statement";
import Capabilities from "@/components/landing/Capabilities";
import Interop from "@/components/landing/Interop";
import Optimisation from "@/components/landing/Optimisation";
import Sources from "@/components/landing/Sources";
import Offer from "@/components/landing/Offer";
import DemoRequest from "@/components/landing/DemoRequest";

export default function Home() {
  return (
    <>
      <HeroShell />
      <ProductSection />
      <Statement />
      <Capabilities />
      <Interop />
      <Optimisation />
      <Sources />
      <Offer />
      <DemoRequest />
    </>
  );
}
