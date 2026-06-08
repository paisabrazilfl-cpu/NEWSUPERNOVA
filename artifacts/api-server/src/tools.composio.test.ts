import { describe, it, expect, vi } from "vitest";

// tools.ts pulls in the db via its imports; mock it like the other tool/route
// tests so importing the registry never touches a real database.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { TOOL_REGISTRY, getToolNamesForAgent, isToolAllowed, buildCapabilityCard } from "./tools";

const ABBY = 1;
const WIRE = 5;

describe("Composio: agents know which apps are LIVE", () => {
  it("registers a composio_apps discovery tool", () => {
    expect(TOOL_REGISTRY["composio_apps"]).toBeTruthy();
    expect(TOOL_REGISTRY["composio_apps"]!.description.toLowerCase()).toContain("live");
  });

  it("wires composio_apps to ABBY and WIRE (the agents that can act via Composio)", () => {
    for (const id of [ABBY, WIRE]) {
      expect(isToolAllowed(id, "composio_apps"), `agent #${id} should have composio_apps`).toBe(true);
      expect(isToolAllowed(id, "composio_action"), `agent #${id} should have composio_action`).toBe(true);
    }
  });

  it("composio_action tells the agent to check live apps first", () => {
    expect(TOOL_REGISTRY["composio_action"]!.description.toLowerCase()).toContain("composio_apps");
  });

  it("WIRE's capability card instructs checking live Composio apps before acting", () => {
    const card = buildCapabilityCard(WIRE);
    expect(card).toContain("composio_apps");
    expect(card.toLowerCase()).toContain("connect apps");
  });

  it("getToolNamesForAgent lists composio_apps before composio_action for WIRE", () => {
    const names = getToolNamesForAgent(WIRE);
    expect(names.indexOf("composio_apps")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("composio_apps")).toBeLessThan(names.indexOf("composio_action"));
  });
});
