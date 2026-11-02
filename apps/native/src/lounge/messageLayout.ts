export const MESSAGE_FONT_SIZE = 14;
export const BUBBLE_HORIZONTAL_PADDING = 13;
const TEXT_WIDTH_ALLOWANCE = 1;
const LATIN_CHARACTER_WIDTH = 0.65;

/** Reserve one extra glyph before Yoga's content sizing, including at enlarged system font scales. */
export function messageMinimumWidth(text: string, fontScale: number, fontSize = MESSAGE_FONT_SIZE) {
  if (!text) return 0;
  const lines = text.split('\n').map(line => Array.from(line).reduce((width, character) => {
    if (/[\p{Mark}\u200d\ufe0f]/u.test(character)) return width;
    return width + (/^[\x20-\x7e]$/.test(character) && !/[MW@#]/.test(character) ? LATIN_CHARACTER_WIDTH : 1);
  }, 0));
  return Math.ceil((Math.max(...lines) + TEXT_WIDTH_ALLOWANCE) * fontSize * fontScale)
    + BUBBLE_HORIZONTAL_PADDING * 2;
}
