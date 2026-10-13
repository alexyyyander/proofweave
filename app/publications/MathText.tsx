import { renderPublicationText } from "@/packages/domain/publication-math.mjs";

export function MathText({ text, className }: { text: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderPublicationText(text) }} />;
}
