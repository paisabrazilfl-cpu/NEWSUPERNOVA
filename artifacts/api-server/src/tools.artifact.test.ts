/**
 * Chunked save_artifact — a large base64 file (e.g. a generated PDF) often does
 * not fit in one tool-call turn, so the model could never save it and looped
 * forever (observed live). save_artifact now accepts ordered slices via
 * chunk:true and assembles them on done:true. These tests prove the assembled
 * bytes equal the original and that the single-shot path still works.
 */
import { describe, it, expect, vi } from "vitest";

// Capture what gets inserted into the attachments table so we can assert the
// reassembled bytes are correct, without a real database. vi.hoisted makes the
// array exist before the hoisted vi.mock factory runs.
const { inserted } = vi.hoisted(() => ({
  inserted: [] as Array<{ filename: string; data: string; sizeBytes: number; mimeType: string }>,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const insertChain = {
    values: (v: { filename: string; data: string; sizeBytes: number; mimeType: string }) => ({
      returning: async () => {
        inserted.push(v);
        return [{ id: inserted.length }];
      },
    }),
  };
  const mockDb = { insert: () => insertChain } as never;
  return { ...actual, db: mockDb };
});

import { TOOL_REGISTRY } from "./tools";

const ctx = { agentId: 2, agentName: "FORGE" } as never;
const save = TOOL_REGISTRY.save_artifact!;

describe("save_artifact — chunked save", () => {
  it("assembles ordered base64 slices into the original file", async () => {
    inserted.length = 0;
    // "Hello, BOS-AURA!" → base64, split across three uneven slices.
    const full = Buffer.from("Hello, BOS-AURA!").toString("base64");
    const a = full.slice(0, 5);
    const b = full.slice(5, 11);
    const c = full.slice(11);

    const r1 = await save.run({ filename: "g.bin", content: a, encoding: "base64", chunk: true }, ctx);
    expect(r1).toContain("chunk stored");
    await save.run({ filename: "g.bin", content: b, encoding: "base64", chunk: true }, ctx);
    const done = await save.run({ filename: "g.bin", content: c, encoding: "base64", done: true }, ctx);

    expect(done).toContain("saved");
    expect(inserted).toHaveLength(1);
    expect(Buffer.from(inserted[0]!.data, "base64").toString("utf8")).toBe("Hello, BOS-AURA!");
  });

  it("errors on done with no buffered chunks", async () => {
    const r = await save.run({ filename: "empty.bin", done: true }, ctx);
    expect(r).toContain("error");
    expect(r.toLowerCase()).toContain("no chunks");
  });

  it("still saves a single-shot utf8 file unchanged", async () => {
    inserted.length = 0;
    const r = await save.run({ filename: "note.md", content: "# hi" }, ctx);
    expect(r).toContain("saved");
    expect(Buffer.from(inserted[0]!.data, "base64").toString("utf8")).toBe("# hi");
    expect(inserted[0]!.mimeType).toBe("text/markdown");
  });
});
