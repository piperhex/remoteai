import { expect, type Page } from '@playwright/test';

export function languageControl(page: Page, label: string) {
  return page.getByRole('combobox', { name: label, exact: true })
    .or(page.getByRole('button', { name: new RegExp(`^${label} `) }));
}

export async function openLanguageSettings(page: Page) {
  const row = page.locator('button.settings-row').filter({ has: page.locator('.lucide-languages') });
  await page.locator('.interface-language-select').or(row).click();
}

export function languageOption(page: Page, label: string) {
  return page.getByRole('option', { name: label, exact: true })
    .or(page.getByRole('radio', { name: label, exact: true }));
}

export async function expectSelectedLanguage(page: Page, label: string) {
  const option = languageOption(page, label);
  const role = await option.getAttribute('role');
  await expect(option).toHaveAttribute(role === 'radio' ? 'aria-checked' : 'aria-selected', 'true');
}
