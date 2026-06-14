import { redirect } from "next/navigation";

// Self-serve sign-up is disabled: the platform is locked to a single account.
// Anyone hitting /sign-up is sent to the sign-in gate.
export default function SignUpPage() {
  redirect("/sign-in");
}
