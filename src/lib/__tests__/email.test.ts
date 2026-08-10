import { describe, expect, it } from "vitest";
import { describeEmailError } from "@/lib/email";

/**
 * `describeEmailError` is what a landlord actually reads when a rent notice
 * doesn't arrive, so the thing worth testing is that it turns Cloudflare's error
 * codes into a next step rather than echoing them.
 */
describe("describeEmailError", () => {
  it("explains the two codes that mean 'the domain isn't set up yet'", () => {
    // These are what every new account hits first, and both are configuration,
    // not a bug — the message has to say so or it reads as a broken app.
    const notOnboarded = describeEmailError(
      Object.assign(new Error("domain not available"), {
        code: "E_SENDER_DOMAIN_NOT_AVAILABLE",
      }),
    );
    expect(notOnboarded).toContain("E_SENDER_DOMAIN_NOT_AVAILABLE");
    expect(notOnboarded).toMatch(/EMAIL_FROM/);
    expect(notOnboarded).toMatch(/verified destination addresses/i);

    const unverified = describeEmailError(
      Object.assign(new Error("nope"), { code: "E_SENDER_NOT_VERIFIED" }),
    );
    expect(unverified).toMatch(/Email Service/);
  });

  it("points at wrangler.jsonc when the binding itself is the restriction", () => {
    // A recipient rejection looks like a bad address but isn't — it means the
    // binding was configured with an allowlist. Different fix, different file.
    expect(
      describeEmailError(
        Object.assign(new Error("nope"), { code: "E_RECIPIENT_NOT_ALLOWED" }),
      ),
    ).toMatch(/allowed_destination_addresses/);
  });

  it("distinguishes a retryable rate limit from an exhausted daily quota", () => {
    expect(
      describeEmailError(Object.assign(new Error("slow down"), { code: "E_RATE_LIMIT_EXCEEDED" })),
    ).toMatch(/retried/);
    expect(
      describeEmailError(Object.assign(new Error("no more"), { code: "E_DAILY_LIMIT_EXCEEDED" })),
    ).toMatch(/quota/);
  });

  it("keeps an unrecognised code visible instead of swallowing it", () => {
    // A code we have no explanation for is still the most useful thing in the
    // log, so it has to survive rather than be replaced by a generic message.
    const out = describeEmailError(
      Object.assign(new Error("something new"), { code: "E_FUTURE_CODE" }),
    );
    expect(out).toContain("E_FUTURE_CODE");
    expect(out).toContain("something new");
  });

  it("handles a plain Error and a non-Error throw", () => {
    expect(describeEmailError(new Error("network down"))).toBe("network down");
    expect(describeEmailError("just a string")).toBe("unknown error");
  });

  it("stays inside the NotificationLog.error column budget", () => {
    // Recorded into a column this app caps at 500 chars elsewhere; an overlong
    // message would either truncate awkwardly or fail the insert.
    const out = describeEmailError(
      Object.assign(new Error("x".repeat(2000)), { code: "E_UNKNOWN_LONG" }),
    );
    expect(out.length).toBeLessThanOrEqual(500);
  });
});
