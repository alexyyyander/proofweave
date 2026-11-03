import type { Locale } from "../config";
import type { Dictionary } from "../translate";
import { en } from "./en";
import { zhCN } from "./zh-CN";

export const dictionaries: Record<Locale, Dictionary> = {
  en,
  "zh-CN": zhCN,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
