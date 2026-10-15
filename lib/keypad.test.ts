import { describe, expect, it } from "vitest";
import { applyKey, KEYPAD_KEYS } from "@/lib/keypad";

describe("cash keypad", () => {
  it("appends digits and drops leading zeros", () => {
    expect(applyKey("", "0")).toBe("");
    expect(applyKey("", "5")).toBe("5");
    expect(applyKey("5", "0")).toBe("50");
    expect(applyKey("50", "000")).toBe("50000");
  });

  it("ignores 000 on an empty value and caps at 9 digits", () => {
    expect(applyKey("", "000")).toBe("");
    expect(applyKey("123456789", "0")).toBe("123456789");
    expect(applyKey("1234567", "000")).toBe("1234567");
  });

  it("supports backspace and clear", () => {
    expect(applyKey("500", "⌫")).toBe("50");
    expect(applyKey("", "⌫")).toBe("");
    expect(applyKey("500", "C")).toBe("");
  });

  it("lays out a 4x3 grid ending with triple zero, zero and backspace", () => {
    expect(KEYPAD_KEYS).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "⌫"]);
  });
});
