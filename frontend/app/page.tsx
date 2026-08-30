import HeroShell from "@/components/landing/HeroShell";
import Features from "@/components/landing/Features";
import ProblemSolution from "@/components/landing/ProblemSolution";
import Architecture from "@/components/landing/Architecture";
import Contact from "@/components/landing/Contact";
import FinalCTA from "@/components/landing/FinalCTA";

export default function Home() {
  return (
    <>
      <HeroShell />
      <ProblemSolution />
      <Architecture />
      <Features />
      <Contact />
      <FinalCTA />
    </>
  );
}
