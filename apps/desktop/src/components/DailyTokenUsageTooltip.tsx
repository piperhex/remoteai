import inlineCopy from '@remoteai/i18n/copy/inline/desktop/components/DailyTokenUsageTooltip';
import { uiText } from "../../../../shared/localization/uiText";
import type { Language } from "../i18n";
import { formatCompactTokenCount } from "../../../../shared/context-usage/format";

export interface TokenTypeTotals {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cached: number;
}

export const EMPTY_TOKEN_TOTALS: TokenTypeTotals = {
  total: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cached: 0,
};

export function DailyTokenUsageTooltip({ totals, language }: {
  totals: TokenTypeTotals;
  language: Language;
}) {
  const labels = (language !== "zh" && language !== "en" ? {
      title: uiText("client.usage.todaySTokenUsage", {}, language),
      input: uiText("client.chat.input", {}, language),
      output: uiText("client.chat.output", {}, language),
      reasoning: uiText("client.chat.reasoning", {}, language),
      cached: uiText("client.chat.cached", {}, language),
    } : language === "zh"
    ? {
      title: inlineCopy["Token_ce3351b6"],
      input: inlineCopy["text_2087c777"],
      output: inlineCopy["text_fb04addb"],
      reasoning: inlineCopy["text_132411ba"],
      cached: inlineCopy["text_e3ca04a9"],
    }
    : {
      title: inlineCopy["Todays_Token_usage_6d7b75c8"],
      input: inlineCopy["Input_36ecb4f8"],
      output: inlineCopy["Output_b2439bcb"],
      reasoning: inlineCopy["Reasoning_d8211e24"],
      cached: inlineCopy["Cached_a251c182"],
    });
  const values = [totals.input, totals.output, totals.reasoning, totals.cached];

  return (
    <div className="compact-token-tooltip">
      <strong>{labels.title}</strong>
      {values.map((value, index) => (
        <span key={index}>
          <i className={`token-type-${index}`} />
          {([labels.input, labels.output, labels.reasoning, labels.cached] as const)[index]}
          <b>{formatCompactTokenCount(value, language)}</b>
        </span>
      ))}
    </div>
  );
}
