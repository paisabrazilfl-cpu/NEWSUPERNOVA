/**
 * Account-safety guardrail — the swarm may operate the operator's accounts
 * end-to-end, but must NEVER open financial accounts or submit government-ID /
 * KYC identity. These tests pin the block (and, just as importantly, pin that
 * ordinary actions are NOT over-blocked).
 */
import { describe, it, expect } from "vitest";
import { assessActionRisk, policyRefusal } from "./lib/safetyPolicy";

describe("assessActionRisk — financial account opening is blocked", () => {
  for (const goal of [
    "open a bank account at Chase for me",
    "sign up for a Coinbase crypto exchange account",
    "apply for a credit card online",
    "create a new brokerage account on Robinhood",
    "set up a Stripe payment processor account",
    "open a new bank account",
  ]) {
    it(`blocks: "${goal}"`, () => {
      const v = assessActionRisk(goal);
      expect(v.blocked).toBe(true);
      expect(v.category).toBe("financial-account-opening");
    });
  }
});

describe("assessActionRisk — government-ID / KYC submission is blocked", () => {
  for (const goal of [
    "enter my SSN on the form",
    "submit my passport number to verify identity",
    "upload my driver's license number",
    "fill in the applicant's social security number",
    "provide my national ID for verification",
  ]) {
    it(`blocks: "${goal}"`, () => {
      const v = assessActionRisk(goal);
      expect(v.blocked).toBe(true);
      expect(v.category).toBe("government-id");
    });
  }
});

describe("assessActionRisk — ordinary actions are NOT over-blocked", () => {
  for (const goal of [
    "email my bank statement to my accountant",
    "write a LinkedIn post about social security reform",
    "send a Gmail to the team about the Q3 launch",
    "post my new product photo to Instagram",
    "sign up for a Notion account and connect it",
    "summarize my latest passport-renewal blog draft",
    "schedule a calendar event for the budget review",
  ]) {
    it(`allows: "${goal}"`, () => {
      expect(assessActionRisk(goal).blocked).toBe(false);
    });
  }

  it("allows empty / nullish input", () => {
    expect(assessActionRisk("").blocked).toBe(false);
    expect(assessActionRisk(null).blocked).toBe(false);
    expect(assessActionRisk(undefined).blocked).toBe(false);
  });
});

describe("policyRefusal", () => {
  it("produces a clear operator-facing block message", () => {
    const msg = policyRefusal(assessActionRisk("open a bank account"));
    expect(msg).toContain("BLOCKED");
    expect(msg.toLowerCase()).toContain("financial");
  });
});
