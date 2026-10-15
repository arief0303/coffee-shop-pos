export const KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "⌫"] as const;
/** Not on the grid; the cash display offers it as a text button. */
export const CLEAR_KEY = "C" as const;
export type KeypadKey = (typeof KEYPAD_KEYS)[number] | typeof CLEAR_KEY;

const MAX_DIGITS = 9;

/** Pure reducer for an on-screen cash keypad; the value is a digit string without leading zeros. */
export function applyKey(current: string, key: KeypadKey): string {
  if (key === "C") return "";
  if (key === "⌫") return current.slice(0, -1);
  if (!current && (key === "0" || key === "000")) return "";
  const next = current + key;
  return next.length > MAX_DIGITS ? current : next;
}
