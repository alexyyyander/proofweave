import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Proof journey",
  description: "Watch a local research Agent turn one Lean proof into reproducible evidence, independent review, and attributable contribution.",
};

export default function ShowcasePage() {
  redirect("/#proof-journey");
}
