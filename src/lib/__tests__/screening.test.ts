import { describe, expect, it } from "vitest";
import {
  canRecordResults,
  canStartNewScreening,
  disclosureScopeLine,
  FCRA_DISCLOSURE_PARAGRAPHS,
  isAwaitingConsent,
  screeningStatusLabel,
  screeningStatusTone,
  screeningTypesLabel,
} from "@/lib/screening";

describe("screeningStatusLabel / screeningStatusTone", () => {
  it("covers every status with a human label and a valid badge tone", () => {
    const statuses = [
      "AWAITING_CONSENT",
      "IN_PROGRESS",
      "COMPLETED",
      "DECLINED",
      "CANCELED",
    ] as const;
    for (const status of statuses) {
      expect(screeningStatusLabel(status)).toBeTruthy();
      expect(["green", "amber", "blue", "red", "slate"]).toContain(screeningStatusTone(status));
    }
  });
});

describe("isAwaitingConsent", () => {
  it("is true only for AWAITING_CONSENT", () => {
    expect(isAwaitingConsent("AWAITING_CONSENT")).toBe(true);
    expect(isAwaitingConsent("IN_PROGRESS")).toBe(false);
    expect(isAwaitingConsent("COMPLETED")).toBe(false);
  });
});

describe("canRecordResults", () => {
  it("is true only once consent has been given (IN_PROGRESS)", () => {
    expect(canRecordResults("IN_PROGRESS")).toBe(true);
    expect(canRecordResults("AWAITING_CONSENT")).toBe(false);
    expect(canRecordResults("COMPLETED")).toBe(false);
    expect(canRecordResults("DECLINED")).toBe(false);
  });
});

describe("canStartNewScreening", () => {
  it("allows starting fresh when there's no prior request", () => {
    expect(canStartNewScreening(null)).toBe(true);
  });

  it("blocks a second request while one is still live", () => {
    expect(canStartNewScreening("AWAITING_CONSENT")).toBe(false);
    expect(canStartNewScreening("IN_PROGRESS")).toBe(false);
  });

  it("allows a fresh request once the prior one reached an end state", () => {
    expect(canStartNewScreening("DECLINED")).toBe(true);
    expect(canStartNewScreening("CANCELED")).toBe(true);
    expect(canStartNewScreening("COMPLETED")).toBe(true);
  });
});

describe("screeningTypesLabel", () => {
  it("joins one type with no conjunction", () => {
    expect(
      screeningTypesLabel({ wantCredit: true, wantBackground: false, wantEviction: false }),
    ).toBe("Credit");
  });

  it("joins two types with 'and'", () => {
    expect(
      screeningTypesLabel({ wantCredit: true, wantBackground: true, wantEviction: false }),
    ).toBe("Credit and background");
  });

  it("joins three types with an Oxford comma", () => {
    expect(
      screeningTypesLabel({ wantCredit: true, wantBackground: true, wantEviction: true }),
    ).toBe("Credit, background, and eviction");
  });

  it("never crashes on an impossible all-false input", () => {
    // The request form requires at least one checkbox, but this stays defined
    // for any caller that doesn't go through that form.
    expect(
      screeningTypesLabel({ wantCredit: false, wantBackground: false, wantEviction: false }),
    ).toBe("No report types selected");
  });
});

describe("disclosureScopeLine", () => {
  it("pluralizes 'reports' for more than one type", () => {
    expect(
      disclosureScopeLine({ wantCredit: true, wantBackground: true, wantEviction: false }),
    ).toBe("For this application, that means: credit and background reports.");
  });

  it("keeps 'report' singular for exactly one type", () => {
    expect(
      disclosureScopeLine({ wantCredit: false, wantBackground: true, wantEviction: false }),
    ).toBe("For this application, that means: background report.");
  });
});

describe("FCRA_DISCLOSURE_PARAGRAPHS", () => {
  it("is non-empty and every paragraph names the organization placeholder", () => {
    expect(FCRA_DISCLOSURE_PARAGRAPHS.length).toBeGreaterThan(0);
    for (const p of FCRA_DISCLOSURE_PARAGRAPHS) {
      expect(p).toContain("[ORGANIZATION NAME]");
    }
  });

  it("mentions the applicant's core FCRA rights — dispute and separate adverse-action notice", () => {
    const joined = FCRA_DISCLOSURE_PARAGRAPHS.join(" ");
    expect(joined).toMatch(/dispute/i);
    expect(joined).toMatch(/notified separately/i);
  });
});
