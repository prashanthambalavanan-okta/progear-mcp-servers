# ProGear MCP local tester

A local-only harness for exercising the full auth chain end-to-end against the deployed gateway: **human login (PKCE) → agent ID-JAG exchange → domain-scoped access token → MCP tool call**. Never deployed — run it on your machine only.

## What it does

1. **You log in** via Okta Authorization Code + PKCE (confidential Web app — client ID + secret, plus PKCE for defense in depth).
2. The app then plays the role of **the AI agent**: for whichever domain you pick, it runs the two-step [ID-JAG](https://datatracker.ietf.org/doc/html/draft-parecki-oauth-identity-assertion-authz-grant) exchange —
   - **Step 1**: your ID token → an ID-JAG, requested at the org's token endpoint, authenticated as the agent via a JWT client assertion signed with the agent's own private key (no shared secret).
   - **Step 2**: that ID-JAG → a domain-scoped access token, presented as a `urn:ietf:params:oauth:grant-type:jwt-bearer` assertion at that domain's own Custom Authorization Server token endpoint (same client-assertion auth).
3. It calls the deployed MCP gateway's `/<domain>/mcp` with the resulting access token and runs one representative tool, then shows every step's decoded token claims plus the tool result.

This mirrors exactly what `ProGearSalesAI`'s `okta_cross_app_access.py` / `multi_agent_auth.py` did with the proprietary `okta_ai_sdk` Python package — reimplemented here as plain HTTP + `jose`, since there's no Node equivalent of that SDK.

## Setup

```bash
npm install                     # from repo root
cp packages/local-tester/.env.example packages/local-tester/.env
# fill in .env, then:
export $(grep -v '^#' packages/local-tester/.env | xargs)   # or use a tool like dotenv-cli
npm run dev:tester
```

Open `http://localhost:4000`.

### Okta prerequisites

- A **Web** app (Authorization Code grant, PKCE required) with `http://localhost:4000/callback` in its sign-in redirect URIs — this is what the human logs into.
- The **AI Agent** identity (`OKTA_AI_AGENT_ID` / `OKTA_AI_AGENT_PRIVATE_KEY`) registered with access to request ID-JAGs and to authenticate at each domain's Custom Authorization Server.
- The 4 Custom Authorization Servers (inventory/customer/sales/pricing) already set up with their scopes — same ones the gateway itself validates against.

## Notes

- Sessions are in-memory only (a `Map`, keyed by a random cookie) — restarting the process logs everyone out. Nothing is written to disk.
- The audience returned in the domain access token is checked against the expected `OKTA_<DOMAIN>_AUDIENCE` value and shown as match/mismatch on the results page — a quick sanity check that the exchange landed on the right resource.
- If a step fails, the error page shows the raw error from whichever endpoint rejected the request (org token endpoint, domain token endpoint, or the MCP gateway itself) — that's usually enough to tell which policy or config is the problem (e.g. `no_matching_policy` means the logged-in user isn't authorized for that domain's scopes).
