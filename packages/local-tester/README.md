# ProGear MCP demo app

A demo application for exercising the full auth chain end-to-end against the deployed gateway: **human login (PKCE) → agent ID-JAG exchange → domain-scoped access token → MCP tool call**. Runs locally or deployed (e.g. to Render) — no LLM involved anywhere; every tool maps directly to its arguments and its response.

## What it does

1. **You log in** via Okta Authorization Code + PKCE (confidential Web app — client ID + secret, plus PKCE for defense in depth).
2. The dashboard lists all 4 MCP servers (inventory/customer/sales/pricing) and every tool each one exposes, with a pre-filled, editable JSON argument box per tool.
3. Clicking **Run** on any tool plays the role of **the AI agent**: it runs the two-step [ID-JAG](https://datatracker.ietf.org/doc/html/draft-parecki-oauth-identity-assertion-authz-grant) exchange for that tool's domain —
   - **Step 1**: your ID token → an ID-JAG, requested at the org's token endpoint, authenticated as the agent via a JWT client assertion signed with the agent's own private key (no shared secret).
   - **Step 2**: that ID-JAG → a domain-scoped access token, presented as a `urn:ietf:params:oauth:grant-type:jwt-bearer` assertion at that domain's own Custom Authorization Server token endpoint (same client-assertion auth).
4. It then calls the deployed MCP gateway's `/<domain>/mcp` with the resulting access token and that tool's arguments, and shows a formatted rendering of the result — with the raw JSON-RPC response available behind a "Show raw JSON-RPC response" toggle.

This mirrors exactly what `ProGearSalesAI`'s `okta_cross_app_access.py` / `multi_agent_auth.py` did with the proprietary `okta_ai_sdk` Python package — reimplemented here as plain HTTP + `jose`, since there's no Node equivalent of that SDK.

## Setup — local

```bash
npm install                     # from repo root
cp packages/local-tester/.env.example packages/local-tester/.env
# fill in .env, then, from packages/local-tester:
npx tsx watch --env-file=.env src/server.ts
```

Open `http://localhost:4000`.

## Deploying (e.g. to Render)

- Set every variable from `.env.example` in the platform's environment variable dashboard — do not commit a `.env` file.
- `REDIRECT_URI` must point at the deployed host (e.g. `https://your-app.onrender.com/callback`), and that exact URL must be added to the Okta Web app's sign-in redirect URIs.
- Set `NODE_ENV=production` — the session cookie is only marked `secure` in production, since Render terminates TLS in front of the app (the app trusts the proxy via `app.set('trust proxy', 1)`).
- Sessions are still in-memory only — a restart or redeploy logs everyone out. Fine for a single-instance demo; don't scale this to multiple instances without moving session storage out of process.

### Okta prerequisites

- A **Web** app (Authorization Code grant, PKCE required) with the tester's `/callback` URL (local and/or deployed) in its sign-in redirect URIs — this is what the human logs into.
- The **AI Agent** identity (`OKTA_AI_AGENT_ID` / `OKTA_AI_AGENT_PRIVATE_KEY`) registered with access to request ID-JAGs and to authenticate at each domain's Custom Authorization Server.
- The 4 Custom Authorization Servers (inventory/customer/sales/pricing) already set up with their scopes — same ones the gateway itself validates against.
- The customer domain needs a `customer:write` scope on its Custom Authorization Server (for `add_customer`/`delete_customer`), granted to the AI agent's access policy — without it those two tools fail with `invalid_scope`/`access_denied`. Inventory's add/delete tools reuse the existing `inventory:write` scope, no Okta changes needed there.

## Notes

- The tool catalog (names, descriptions, default arguments) is a static list in `src/config.ts` mirroring each domain server's actual tool definitions — it is not fetched live via `tools/list`, so it needs a manual update if a domain server's tools change.
- The audience returned in the domain access token is checked against the expected `OKTA_<DOMAIN>_AUDIENCE` value and shown as match/mismatch on the results page — a quick sanity check that the exchange landed on the right resource.
- If a step fails, the error page shows the raw error from whichever endpoint rejected the request (org token endpoint, domain token endpoint, or the MCP gateway itself) — that's usually enough to tell which policy or config is the problem (e.g. `no_matching_policy` means the logged-in user isn't authorized for that domain's scopes).
- Some tools mutate demo data on the deployed gateway (flagged with a "Mutates" badge) — they run like any other tool, no confirmation step.
