"use client";

import { applyKey, KEYPAD_KEYS } from "@/lib/keypad";

type Props = { value: string; onChange: (next: string) => void; disabled?: boolean };

/** Large on-screen keypad so the cashier never needs the device keyboard. */
export function Keypad({ value, onChange, disabled }: Props) {
  return (
    <div className="keypad" role="group" aria-label="Cash keypad">
      {KEYPAD_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={key === "⌫" ? "keypad-action" : ""}
          disabled={disabled}
          aria-label={key === "⌫" ? "Backspace" : key}
          onClick={() => onChange(applyKey(value, key))}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
