import { Header } from "./Header";
import { ContentLoading } from "../ui/ContentLoading";
import type { ActivePage } from "@/app/lib/navigation";

export function PageLoading({ active = "none", label = "page" }: { active?: ActivePage; label?: string }) {
  return <div className="route-loading"><Header active={active} skipTarget="route-loading-content" /><div id="route-loading-content" tabIndex={-1} className="route-loading-content"><ContentLoading label={`Loading ${label}`} /></div></div>;
}
