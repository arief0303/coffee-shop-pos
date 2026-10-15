import { describe, expect, it } from "vitest";
import { cleanReference, providersWithImages, qrisImageKey } from "@/lib/qris";

describe("qris helpers", () => {
  it("lists only providers with an uploaded image, in fixed order", () => {
    expect(providersWithImages({})).toEqual([]);
    expect(providersWithImages({ gopay: "data:a", bri: "data:b" })).toEqual(["bri", "gopay"]);
    expect(providersWithImages({ bca: "", other: "data:c" })).toEqual(["other"]);
  });

  it("cleans references and treats blank as unset", () => {
    expect(cleanReference(" 033-265 ")).toBe("033265");
    expect(cleanReference("GP-AB12")).toBe("GPAB12");
    expect(cleanReference("   ")).toBeUndefined();
    expect(cleanReference("x".repeat(80))?.length).toBe(64);
  });

  it("namespaces image settings per provider", () => {
    expect(qrisImageKey("gopay")).toBe("qris-image:gopay");
  });
});
