import { describe, expect, it } from "vitest";
import { buildAlertEmail } from "@/lib/error-reporting";

/**
 * `buildAlertEmail` is the part of the alerting path with real judgement in
 * it — what actually lands in an inbox when something breaks — so it's kept
 * pure and tested separately from `reportServerError`'s network/binding
 * side, which needs a live Cloudflare context to exercise meaningfully.
 */
describe("buildAlertEmail", () => {
  it("names the failing context in the subject, so an inbox full of alerts is scannable", () => {
    const { subject } = buildAlertEmail("cron:rent-run:org_123", new Error("boom"));
    expect(subject).toBe("ComfyLease error: cron:rent-run:org_123");
  });

  it("includes the error's name and message in the body", () => {
    const { body } = buildAlertEmail("action", new TypeError("cannot read property 'x'"));
    expect(body).toContain("TypeError: cannot read property 'x'");
    expect(body).toContain("Context: action");
  });

  it("includes a stack trace, truncated to a reasonable length", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n" + "    at somewhere (file.ts:1:1)\n".repeat(200);
    const { body } = buildAlertEmail("action", err);
    expect(body).toContain("at somewhere");
    // 2000 chars of stack, not the entire multi-KB trace — an alert email is
    // meant to be read, not to be the full log line.
    expect(body.length).toBeLessThan(3000);
  });

  it("handles a non-Error throw without crashing", () => {
    // Not everything thrown in JS is an Error — a rejected promise can reject
    // with a string, an object, anything. This has to degrade, not throw.
    const { body } = buildAlertEmail("action", "just a string failure");
    expect(body).toContain("just a string failure");
  });

  it("omits the stack-trace line entirely when there isn't one", () => {
    const err = new Error("no stack");
    err.stack = undefined;
    const { body } = buildAlertEmail("action", err);
    expect(body).not.toMatch(/\n\n\n/); // no dangling blank section left behind
  });

  it("includes a timestamp", () => {
    const { body } = buildAlertEmail("action", new Error("boom"));
    expect(body).toMatch(/Time: \d{4}-\d{2}-\d{2}T/);
  });
});
