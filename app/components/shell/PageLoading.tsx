import { Header } from "./Header";
import { ContentLoading } from "../ui/ContentLoading";
import type { ActivePage } from "@/app/lib/navigation";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

export async function PageLoading({ active = "none", labelKey = "common.loadingPage" }: { active?: ActivePage; labelKey?: TranslationKey }) {
  const { t } = await getI18n();
  return <div className="route-loading"><Header active={active} skipTarget="route-loading-content" /><div id="route-loading-content" tabIndex={-1} className="route-loading-content"><ContentLoading label={t(labelKey)} /></div></div>;
}
