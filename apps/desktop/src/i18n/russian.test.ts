import { afterEach, expect, it } from "vitest";
import { translate, type TranslationKey } from "../i18n";
import { russian } from "./ru";
import { russian as interfaceCopy } from "../../../../shared/i18n/ru";
import { guiText, setGuiLanguage } from "./guiText";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
afterEach(() => setGuiLanguage("zh"));

it("covers desktop keys and preserves interpolation placeholders", () => {
  for (const [key, value] of Object.entries(russian)) {
    expect(placeholders(value), key).toEqual(placeholders(translate("en", key as TranslationKey)));
    expect(value, key).not.toMatch(/[\u4e00-\u9fff]/);
  }
  for (const [source, value] of Object.entries(interfaceCopy)) {
    expect(placeholders(value), source).toEqual(placeholders(source));
    expect(value, source).not.toMatch(/[\u4e00-\u9fff]/);
  }
});

it("keeps Russian available as an explicit choice and preserves user content", () => {
  setGuiLanguage("ru");
  expect(guiText("取消")).toBe("Отмена");
  expect(guiText("未匹配的用户内容")).toBe("未匹配的用户内容");
  expect(guiText("{value1}% 已用（剩余 {value2}%）", { value1: 30, value2: 70 })).toContain("70");
  setGuiLanguage("zh");
  expect(guiText("取消")).toBe("取消");
  expect(translate("en", "autoReset.cancel")).toBe("Cancel");
});
