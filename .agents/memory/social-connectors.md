
# social-connectors

## social platform API access model

Agents access social platforms exclusively through **official API connectors backed by OAuth**.

No credential-based login automation is permitted.

---

## enforcement decision



### allowed
- OAuth-based official APIs
- Replit-managed connector proxy
- short-lived access tokens
- scoped permissions per platform

---

## core principle

> Agents never see, store, or handle raw credentials.

---

## connector architecture

### OAuth flow

1. user initiates connection via platform consent screen
2. Replit connector service exchanges authorization code
3. short-lived access token is issued
4. token is injected ONLY at request time
5. token is never persisted in DB or model context

---

## token retrieval (runtime only)

```ts id="soc_1"
GET https://${REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection
  ?include_secrets=true
  &connector_names=<name>

Headers:
  X_REPLIT_TOKEN: repl <REPL_IDENTITY>
