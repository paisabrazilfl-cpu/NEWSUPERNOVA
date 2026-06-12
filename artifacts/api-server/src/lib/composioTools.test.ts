/**
 * composioListTools — discovery of REAL action slugs for a toolkit. This is the
 * fix for the swarm guessing GMAIL_DRAFT_EMAIL / GET_PROFILE (which 404). It must
 * call /tools with the snake_case `toolkit_slug` param and parse {items:[{slug,
 * name, description, input_parameters.required}]} from Composio's v3 contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { composioListTools } from "./integrations";

const saved = { key: process.env["COMPOSIO_API_KEY"], base: process.env["COMPOSIO_BASE_URL"] };

beforeEach(() => {
  process.env["COMPOSIO_API_KEY"] = "test-key";
  process.env["COMPOSIO_BASE_URL"] = "https://backend.composio.dev/api/v3";
});
afterEach(() => {
  vi.restoreAllMocks();
  if (saved.key === undefined) delete process.env["COMPOSIO_API_KEY"]; else process.env["COMPOSIO_API_KEY"] = saved.key;
  if (saved.base === undefined) delete process.env["COMPOSIO_BASE_URL"]; else process.env["COMPOSIO_BASE_URL"] = saved.base;
});

describe("composioListTools", () => {
  it("queries /tools with snake_case toolkit_slug and parses real slugs", async () => {
    let calledUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({
          items: [
            {
              slug: "GMAIL_SEND_EMAIL",
              name: "Send Email",
              description: "Send an email via Gmail.",
              input_parameters: { type: "object", required: ["recipient_email", "body"] },
            },
            {
              slug: "GMAIL_CREATE_EMAIL_DRAFT",
              name: "Create email draft",
              description: "Create a Gmail draft.",
              input_parameters: { type: "object", required: ["recipient_email"] },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }));

    const tools = await composioListTools("Gmail");

    // lower-cased slug, correct param name
    expect(calledUrl).toContain("/tools?");
    expect(calledUrl).toContain("toolkit_slug=gmail");
    expect(calledUrl).not.toContain("toolkitSlug");

    expect(tools).toHaveLength(2);
    expect(tools[0]!.slug).toBe("GMAIL_SEND_EMAIL");
    expect(tools[0]!.required).toEqual(["recipient_email", "body"]);
    expect(tools[1]!.slug).toBe("GMAIL_CREATE_EMAIL_DRAFT");
  });

  it("tolerates items missing input_parameters", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ slug: "GMAIL_FETCH_EMAILS", name: "Fetch emails" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));
    const tools = await composioListTools("gmail");
    expect(tools[0]!.slug).toBe("GMAIL_FETCH_EMAILS");
    expect(tools[0]!.required).toEqual([]);
  });
});
