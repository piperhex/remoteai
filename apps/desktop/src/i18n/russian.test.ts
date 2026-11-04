import { resources as clientResources } from '@remoteai/i18n/client';
const interfaceCopy: Readonly<Record<string, string>> = clientResources.ru;
import { afterEach, expect, it } from "vitest";
import { translate, type TranslationKey } from "../i18n";
import { russian } from "./ru";

import { displayText, uiText, setGuiLanguage } from "../../../../shared/localization/uiText";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
afterEach(() => setGuiLanguage("zh"));

it("covers desktop keys and preserves interpolation placeholders", () => {
  for (const [key, value] of Object.entries(russian)) {
    expect(placeholders(value), key).toEqual(placeholders(translate("en", key as TranslationKey)));
    expect(value, key).not.toMatch(/[\u4e00-\u9fff]/);
  }
  for (const [source, value] of Object.entries(interfaceCopy)) {
    expect(placeholders(value), source).toEqual(placeholders(clientResources.zh[source as keyof typeof clientResources.zh]));
    expect(value, source).not.toMatch(/[\u4e00-\u9fff]/);
  }
});

it("keeps Russian available as an explicit choice and preserves user content", () => {
  setGuiLanguage("ru");
  expect(uiText("client.accounts.cancel")).toBe("Отмена");
  expect(displayText("未匹配的用户内容")).toBe("未匹配的用户内容");
  expect(uiText("client.composer.usedRemaining", { value1: 30, value2: 70 })).toContain("70");
  setGuiLanguage("zh");
  expect(uiText("client.accounts.cancel")).toBe("取消");
  expect(translate("en", "autoReset.cancel")).toBe("Cancel");
});
