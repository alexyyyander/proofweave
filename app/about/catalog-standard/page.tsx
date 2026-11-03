import { permanentRedirect } from "next/navigation";

export default function LegacyIntroductionPage() {
  permanentRedirect("/about#catalog-standard");
}
