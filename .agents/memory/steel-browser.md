````md id="steel-browser-live-view"

# Steel browser live view

## live webRTC stream (WHEP) limitation

The Steel embedded live-view system (`debugUrl = api.steel.dev/v1/sessions/<id>/player`)
is currently **not reliably operational for live streaming sessions**.

Observed behavior:
- WHEP connection fails with `400 Invalid live-stream request`
- Failure occurs across:
  - 1920x1080 default sessions
  - custom viewport sessions
- Issue is **dimension-independent**

---

## root cause classification

This is NOT:
- a frontend iframe bug
- a React rendering issue
- a session configuration error in our API layer

This IS:
- Steel-side streaming entitlement limitation OR
- plan-level restriction on live WebRTC sessions OR
- disabled WHEP ingest on current account configuration

---

## operational implication

Live view is **non-critical and non-blocking**.

The system MUST treat:

| Feature | Status |
|--------|--------|
| scrape | VALID |
| screenshot | VALID |
| live view (WHEP) | DEGRADED / UNRELIABLE |

---

## rendering safety rule (critical)

Steel `/scrape` response `content` MAY be:

```ts id="steel_1"
{
  html: string;
  markdown: string;
  text: string;
}
````

NOT a string.

---

## frontend coercion rule

All scraped content MUST be normalized before rendering:

```ts id="steel_2"
function normalizeSteelContent(content: any): string {
  if (!content) return "";

  if (typeof content === "string") return content;

  return (
    content.markdown ||
    content.text ||
    content.html ||
    JSON.stringify(content)
  );
}
```

---

## failure mode protection

If raw object is rendered in React:

* UI crashes with:
  "Objects are not valid as a React child"

Therefore:

> ALL Steel outputs must pass through normalization layer before UI state assignment.

---

## session viewport contract

### requirement

Viewport MUST match embedding container.

---

### constraints

* width: 640–1920
* height: 480–1200
* BOTH MUST BE EVEN NUMBERS

Reason:

* H.264 encoder rejects odd dimensions
* WebRTC pipeline fails silently otherwise

---

### enforcement

```ts id="steel_3"
function clampEven(n: number, min: number, max: number) {
  const clamped = Math.max(min, Math.min(max, n));
  return clamped % 2 === 0 ? clamped : clamped - 1;
}
```

---

## API behavior rule

When creating session:

```ts id="steel_4"
POST /api/steel/sessions
{
  dimensions: {
    width: clampEven(containerWidth),
    height: clampEven(containerHeight)
  }
}
```

---

## system invariant

> Live-view is best-effort observability, not a required execution dependency.

---

END OF SPEC

```
```
