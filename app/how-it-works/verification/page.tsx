import { permanentRedirect } from "next/navigation";

export default function LegacyIntroductionPage() {
  permanentRedirect("/how-it-works#verification");
}
