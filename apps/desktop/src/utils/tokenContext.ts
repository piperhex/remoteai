import { getLocale } from "../i18n";
import type { Language } from "../i18n";
import { formatContextTokens } from "../../../../shared/context-usage/values.js";

export function formatCompactTokenCount(value: number, language: Language) {
  return formatContextTokens(value, getLocale(language));
}
