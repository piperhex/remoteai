import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { translate, type Language } from "../../i18n";
import type { CreditsSnapshot } from "../../types";
import { AccountCredits } from "./AccountCredits";

function render(credits: CreditsSnapshot | null | undefined, language: Language = "en") {
  return renderToStaticMarkup(<AccountCredits credits={credits} language={language}
    t={(key) => translate(language, key)} />);
}

describe("Codex credits display", () => {
  it("formats the balance as credits with decimals and no currency conversion", () => {
    expect(render({ hasCredits: true, unlimited: false, balance: "62500.25" })).toContain(">62,500.25<");
    expect(render({ hasCredits: true, unlimited: false, balance: "62500" }, "zh")).toContain(">62,500<");
  });

  it("distinguishes zero, unlimited and unavailable credits", () => {
    expect(render({ hasCredits: false, unlimited: false, balance: "0" })).toContain(">0<");
    expect(render({ hasCredits: false, unlimited: false, balance: null })).toContain(">0<");
    expect(render({ hasCredits: true, unlimited: true, balance: null })).toContain(">Unlimited<");
    expect(render(null)).toContain(">—<");
    expect(render(undefined)).toContain(">—<");
  });

  it.each([null, "", "NaN", "-1", "Infinity"])("does not display an invalid balance %s as zero", (balance) => {
    expect(render({ hasCredits: true, unlimited: false, balance })).toContain(">—<");
  });
});
