import { describe, expect, it } from "vitest";
import { GoogleSignInLink } from "@/app/login/page";

describe("Google sign-in link", () => {
  it("uses a native anchor so OAuth starts with a full document navigation", () => {
    const link = GoogleSignInLink();

    expect(link.type).toBe("a");
    expect(link.props.href).toBe("/api/auth/google");
    expect(link.props.className).toBe("google-button");
  });
});
