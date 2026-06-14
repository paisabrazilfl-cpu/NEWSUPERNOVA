import { describe, it, expect } from "vitest";
import { renderPdf } from "./tools";

// The live incident: agents could not produce a PDF (the sandbox is a throwaway
// VM where pip installs/files never persist), so ABBY fabricated GCS download
// links. renderPdf replaces that path with a real, in-process PDF. These tests
// prove it actually emits a valid PDF — and never throws on real-world content.

const pdfHeader = (bytes: Uint8Array) => Buffer.from(bytes.slice(0, 5)).toString("latin1");

describe("renderPdf", () => {
  it("emits a real, non-trivial PDF with the %PDF- signature", async () => {
    const bytes = await renderPdf(
      "30-Day Content Calendar",
      "# Overview\n\nA day-by-day plan.\n\n- Motivation Monday\n- Training Tuesday\n\n1. First\n2. Second",
    );
    expect(pdfHeader(bytes)).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(800);
  });

  it("never throws on emoji / arrows / smart-quotes (folds to WinAnsi)", async () => {
    const bytes = await renderPdf(
      "Plan ✅",
      "Status: ✅ done → next\nCafé “quoted” — em-dash • bullet 😀 €5 £3\n",
    );
    expect(pdfHeader(bytes)).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("paginates long content across pages without error", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Line ${i}: filler text for pagination.`).join("\n");
    const bytes = await renderPdf("", long);
    expect(pdfHeader(bytes)).toBe("%PDF-");
  });

  it("is exposed to the swarm as the pdf_generate tool", async () => {
    const { TOOL_REGISTRY, AGENT_TOOLS } = await import("./tools");
    expect(TOOL_REGISTRY["pdf_generate"]).toBeTruthy();
    // every CLAW that can save_artifact can also make a PDF
    for (const id of [2, 3, 4, 5, 6]) {
      expect(AGENT_TOOLS[id]).toContain("pdf_generate");
    }
  });
});
