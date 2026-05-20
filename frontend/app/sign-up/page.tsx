import type { Metadata } from "next";
import SignUpWizard from "./SignUpWizard";

export const metadata: Metadata = {
  title: "Sign up",
  description:
    "Create your Obscyro account, agree to the beta terms, and we'll mint a free-plan API key for you in a couple of clicks.",
};

export default function SignUpPage() {
  return <SignUpWizard />;
}
