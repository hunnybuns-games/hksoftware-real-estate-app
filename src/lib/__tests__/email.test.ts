import { afterEach, describe, expect, it } from "vitest";
import { bodyForLog, describeEmailError } from "@/lib/email";

/**
 * The recorded copy of a message is not always the sent copy. A password reset
 * link is a working account-takeover credential and NotificationLog is readable
 * at /app/settings/outbox by every admin in the organization, so in production
 * the link is stripped before it's stored.
 */
describe("bodyForLog", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    // NODE_ENV is readonly in the types but writable at runtime; vitest needs it
    // put back or later tests inherit the change.
    (process.env as Record<string, string | undefined>).NODE_ENV = original;
  });

  const body = "Use this link:\n\nhttps://app.example.com/reset-password/SECRET-TOKEN\n\nIgnore if not you.";

  it("strips links from a sensitive body in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const out = bodyForLog(body, true);
    expect(out).not.toContain("SECRET-TOKEN");
    expect(out).toContain("[link removed from this log]");
    // The surrounding prose survives, so the log still reads as a record of what
    // was sent rather than an empty row.
    expect(out).toContain("Use this link:");
  });

  it("keeps a non-sensitive body intact in production", () => {
    // Invitation links are deliberately not stripped: they're scoped to one
    // invited address and reading one out of the log is how a manager re-sends it.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    expect(bodyForLog(body, undefined)).toBe(body);
  });

  it("keeps a sensitive body outside production, where the log is the inbox", () => {
    // Nothing is delivered in logged mode, so redacting here would make the flow
    // impossible to follow locally and untestable end to end.
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    expect(bodyForLog(body, true)).toBe(body);
  });

  it("strips every link, not just the first", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const two = "http://a.test/x/TOKEN1 and https://b.test/y/TOKEN2";
    const out = bodyForLog(two, true);
    expect(out).not.toContain("TOKEN1");
    expect(out).not.toContain("TOKEN2");
  });
});

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
