import HeroShell from "@/components/landing/HeroShell";
import ProblemSolution from "@/components/landing/ProblemSolution";
import Interop from "@/components/landing/Interop";
import Optimisation from "@/components/landing/Optimisation";
import Architecture from "@/components/landing/Architecture";
import Features from "@/components/landing/Features";
import Contact from "@/components/landing/Contact";
import FinalCTA from "@/components/landing/FinalCTA";

export default function Home() {
  return (
    <>
      <HeroShell />
      <ProblemSolution />
      <Interop />
      <Optimisation />
      <Architecture />
      <Features />
      <Contact />
      <FinalCTA />
    </>
  );
}
