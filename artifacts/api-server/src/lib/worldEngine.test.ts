import { describe, it, expect } from "vitest";
import { renderWorldFrame, sliceTiles, renderTraversalBlock, sliceSixTiles } from "./worldEngine";

const PNG_MAGIC = "89504e47";

describe("worldEngine — production render ($0, no AI, pure-JS/bundleable)", () => {
  it("renders a valid PNG buffer", async () => {
    const buf = await renderWorldFrame({ width: 600, height: 240, chapter: 0, caption: ["test"] });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString("hex")).toBe(PNG_MAGIC);
  });

  it("renders both calm and busy states without throwing", async () => {
    await expect(renderWorldFrame({ width: 300, height: 120, busy: false })).resolves.toBeInstanceOf(Buffer);
    await expect(renderWorldFrame({ width: 300, height: 120, busy: true, chapter: 5 })).resolves.toBeInstanceOf(Buffer);
  });

  it("slices a wide frame into 3 square tiles", async () => {
    const wide = await renderWorldFrame({ width: 900, height: 300, chapter: 0 });
    const tiles = await sliceTiles(wide);
    expect(tiles).toHaveLength(3);
    for (const t of tiles) expect(t.subarray(0, 4).toString("hex")).toBe(PNG_MAGIC);
  });

  // The real posting path: the 6-tile traversal block Aura publishes to IG.
  it("renders a 6-tile traversal block as a valid PNG and slices into 6 square tiles", async () => {
    const block = await renderTraversalBlock({
      mood: "working", chapter: 0, step: 1, direction: "down",
      caption: ["chapter 0 · she walks"], stateLine: "test · 6-tile block", seed: 2,
    });
    expect(block.length).toBeGreaterThan(1000);
    expect(block.subarray(0, 4).toString("hex")).toBe(PNG_MAGIC);

    const tiles = await sliceSixTiles(block);
    expect(tiles).toHaveLength(6);
    for (const t of tiles) expect(t.subarray(0, 4).toString("hex")).toBe(PNG_MAGIC);
  }, 60_000);

  // One render per mood, alternating direction — covers every mood + both
  // directions. Full-size block renders are heavy in pure-JS, so allow time.
  it("renders the block in every mood and both directions without throwing", async () => {
    const moods = ["resting", "working", "deep", "storm"] as const;
    for (let i = 0; i < moods.length; i++) {
      const direction = i % 2 === 0 ? "down" : "up";
      await expect(
        renderTraversalBlock({ mood: moods[i], chapter: 1, step: 3, direction, caption: ["x"], stateLine: "y", seed: 1 }),
      ).resolves.toBeInstanceOf(Buffer);
    }
  }, 60_000);
});
