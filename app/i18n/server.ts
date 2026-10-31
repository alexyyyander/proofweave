import { cache } from "react";
import { headers } from "next/headers";
import {
  isLocale,
  negotiateLocale,
  parseLocaleCookie,
  type Locale,
} from "./config";
import { getDictionary } from "./dictionaries";
import { createTranslator, type Dictionary, type Translator } from "./translate";

export const getLocale = cache(async function getLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  const pathLocale = requestHeaders.get("x-pw-locale");
  if (isLocale(pathLocale)) return pathLocale;
  return parseLocaleCookie(requestHeaders.get("cookie"))
    ?? negotiateLocale(requestHeaders.get("accept-language"));
});

export type I18n = {
  locale: Locale;
  dictionary: Dictionary;
  t: Translator;
};

export const getI18n = cache(async function getI18n(): Promise<I18n> {
  const locale = await getLocale();
  const dictionary = getDictionary(locale);
  return { locale, dictionary, t: createTranslator(dictionary) };
});
