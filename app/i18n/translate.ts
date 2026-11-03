import type { TranslationKey } from "./dictionaries/en";

export type { TranslationKey };

export type Dictionary = Record<TranslationKey, string>;

export type TranslateVars = Record<string, string | number>;

/**
 * Looks up a flat, dot-namespaced key and interpolates `{name}` placeholders.
 * A key missing from the dictionary (for example a server-only namespace
 * filtered out of the client dictionary) renders as the key itself so the gap
 * is visible instead of blank, and missing variables stay visible as `{name}`.
 */
export function translate(dictionary: Dictionary, key: TranslationKey, vars?: TranslateVars): string {
  const template = dictionary[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : placeholder,
  );
}

export type Translator = (key: TranslationKey, vars?: TranslateVars) => string;

export function createTranslator(dictionary: Dictionary): Translator {
  return (key, vars) => translate(dictionary, key, vars);
}
