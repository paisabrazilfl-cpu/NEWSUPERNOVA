import { describe, it, expect } from "vitest";
import { renderWorldFrame, sliceTiles } from "./worldEngine";

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
});
