import { describe, it, expect } from "vitest";
import { renderWorldFrame, sliceTiles } from "./worldEngine";

const PNG_MAGIC = "89504e47";

describe("worldEngine — production render ($0, no AI)", () => {
  it("renders a valid PNG buffer", () => {
    const buf = renderWorldFrame({ width: 600, height: 200, chapter: 0, caption: ["test ☼"] });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString("hex")).toBe(PNG_MAGIC);
  });

  it("renders both calm and busy states without throwing", () => {
    expect(() => renderWorldFrame({ width: 300, height: 100, busy: false })).not.toThrow();
    expect(() => renderWorldFrame({ width: 300, height: 100, busy: true, chapter: 5 })).not.toThrow();
  });

  it("slices a wide frame into 3 square tiles", () => {
    const wide = renderWorldFrame({ width: 900, height: 300, chapter: 0 });
    const tiles = sliceTiles(wide);
    expect(tiles).toHaveLength(3);
    for (const t of tiles) expect(t.subarray(0, 4).toString("hex")).toBe(PNG_MAGIC);
  });
});
