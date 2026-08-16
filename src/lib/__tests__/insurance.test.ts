import { describe, expect, it } from "vitest";
import { insuranceStatus } from "@/lib/insurance";
import { utcDate } from "@/lib/dates";

const today = utcDate(2026, 8, 16);

describe("insuranceStatus", () => {
  it("is 'Not required' when nothing is tracked and it isn't required", () => {
    expect(insuranceStatus({ required: false, expiresAt: null, asOf: today })).toEqual({
      tone: "slate",
      label: "Not required",
    });
  });

  it("is 'Missing' when required but no expiry is on file", () => {
    expect(insuranceStatus({ required: true, expiresAt: null, asOf: today })).toEqual({
      tone: "red",
      label: "Missing",
    });
  });

  it("is 'Expired' when the expiry date is in the past", () => {
    expect(
      insuranceStatus({ required: true, expiresAt: utcDate(2026, 7, 1), asOf: today }),
    ).toEqual({ tone: "red", label: "Expired" });
  });

  it("is 'Expired' the day after it lapses", () => {
    expect(
      insuranceStatus({ required: true, expiresAt: utcDate(2026, 8, 15), asOf: today }),
    ).toEqual({ tone: "red", label: "Expired" });
  });

  it("is 'Expiring soon', not yet 'Expired', on the expiry date itself", () => {
    expect(
      insuranceStatus({ required: true, expiresAt: utcDate(2026, 8, 16), asOf: today }),
    ).toEqual({ tone: "amber", label: "Expiring soon" });
  });

  it("is 'Expiring soon' within 30 days", () => {
    expect(
      insuranceStatus({ required: true, expiresAt: utcDate(2026, 9, 10), asOf: today }),
    ).toEqual({ tone: "amber", label: "Expiring soon" });
  });

  it("is 'Expiring soon' at exactly 30 days out", () => {
    expect(
      insuranceStatus({ required: true, expiresAt: utcDate(2026, 9, 15), asOf: today }),
    ).toEqual({ tone: "amber", label: "Expiring soon" });
  });

  it("is 'Current' just past the 30-day window", () => {
    expect(
      insuranceStatus({ required: true, expiresAt: utcDate(2026, 9, 16), asOf: today }),
    ).toEqual({ tone: "green", label: "Current" });
  });

  it("also reports status when tracked but not required, so a landlord can log it voluntarily", () => {
    expect(
      insuranceStatus({ required: false, expiresAt: utcDate(2026, 7, 1), asOf: today }),
    ).toEqual({ tone: "red", label: "Expired" });
  });
});
