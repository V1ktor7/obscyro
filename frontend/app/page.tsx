import Hero from "@/components/landing/Hero";
import Features from "@/components/landing/Features";
import ProblemSolution from "@/components/landing/ProblemSolution";
import Pricing from "@/components/landing/Pricing";
import FinalCTA from "@/components/landing/FinalCTA";

export default function Home() {
  return (
    <>
      <Hero />
      <Features />
      <ProblemSolution />
      <Pricing />
      <FinalCTA />
    </>
  );
}
