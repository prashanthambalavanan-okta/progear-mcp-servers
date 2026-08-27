# ProGear MCP demo app

A demo application for exercising the full auth chain end-to-end against the deployed gateway: **human login (PKCE) → agent ID-JAG exchange → domain-scoped access token → MCP tool call**. Runs locally or deployed (e.g. to Render) — no LLM involved anywhere; every tool maps directly to its arguments and its response.

## What it does

1. **You log in** via Okta Authorization Code + PKCE (confidential Web app — client ID + secret, plus PKCE for defense in depth).
2. The dashboard lists all 4 MCP servers (inventory/customer/sales/pricing) and every tool each one exposes, with a pre-filled, editable JSON argument box per tool.
3. Clicking **Run** on any tool plays the role of **the AI agent**: it runs the two-step [ID-JAG](https://datatracker.ietf.org/doc/html/draft-parecki-oauth-identity-assertion-authz-grant) exchange for that tool's domain —
   - **Step 1**: one of your login tokens → an ID-JAG, requested at the org's token endpoint, authenticated as the agent via a JWT client assertion signed with the agent's own private key (no shared secret).
   - **Step 2**: that ID-JAG → a domain-scoped access token, presented as a `urn:ietf:params:oauth:grant-type:jwt-bearer` assertion at that domain's own Custom Authorization Server token endpoint (same client-assertion auth).
4. It then calls the deployed MCP gateway's `/<domain>/mcp` with the resulting access token and that tool's arguments, and shows a formatted rendering of the result — with the raw JSON-RPC response available behind a "Show raw JSON-RPC response" toggle. The two tokens that matter sit in a right-hand pane next to the result: the **end user access token** from the login and the **MCP server access token** that was sent as the Bearer token, each with its decoded claims one click away. The intermediate ID token and ID-JAG are not shown.

This mirrors exactly what `ProGearSalesAI`'s `okta_cross_app_access.py` / `multi_agent_auth.py` did with the proprietary `okta_ai_sdk` Python package — reimplemented here as plain HTTP + `jose`, since there's no Node equivalent of that SDK.

## Setup — local

```bash
npm install                     # from repo root
cp packages/local-tester/.env.example packages/local-tester/.env
# fill in .env, then:
npm run dev -w packages/local-tester      # or `npm run dev:tester` from the root
```

Open `http://localhost:4000`.

`npm run dev` loads `.env` itself (via Node's `--env-file`), so there's nothing to
export in your shell first — and exported `OKTA_*` variables actually take
precedence over `.env`, so a stale value in your shell will silently win. If a var
looks like it isn't being picked up, check `env | grep OKTA_` in that shell.

Stop the server with **Ctrl-C** in its terminal. Just closing the terminal
window often leaves the `tsx watch` process tree orphaned and still holding port
4000 — so `npm run dev` first runs `npm run stop`, which kills both whatever is
listening on `PORT` (default 4000) and any leftover `tsx watch` supervisor for
this package. Run `npm run stop -w packages/local-tester` on its own if you need
to clean up without starting the server.

`tsx watch` reloads on source edits but **not** on `.env` edits — Node reads
`--env-file` once at startup. Restart after changing `.env`.

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
- **Which issuer the login uses (`OKTA_ISSUER`).** The human login's `/authorize` and `/token` are derived from an issuer, not from `OKTA_DOMAIN` directly. Set `OKTA_ISSUER` to a full issuer URL — either the org issuer (`https://your-org.okta.com`, endpoints under `/oauth2/v1`) or a Custom Authorization Server's (`https://your-org.okta.com/oauth2/aus…`, endpoints under `/oauth2/aus…/v1`). Unset, it falls back to `OKTA_MAIN_AUTH_SERVER_ID` if that is set, then to the org issuer from `OKTA_DOMAIN` — i.e. the previous behaviour. `OKTA_DOMAIN` is still required either way: it builds the ID-JAG token endpoint and all four per-domain Custom AS issuers.
  Caveat: ID-JAG step 1 always runs at the org (or `OKTA_MAIN_AUTH_SERVER_ID`) authorization server — Okta mints ID-JAGs there, not at a per-resource Custom AS. Pointing `OKTA_ISSUER` at an unrelated Custom AS can therefore produce a login token that the exchange refuses as a subject token; keep the login and the exchange on the same authorization server if you hit that.
- **Audience-binding the login to the agent (`OKTA_AI_AGENT_AUDIENCE`).** Set it to the resource URL configured on the agent app in Okta and the login sends it as the [RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707) `resource` parameter on **both** `/authorize` and `/token` (Okta pins the audience at consent and re-checks it at exchange, so it has to be on both). The user's access token then comes back with the agent as its `aud`, and that access token — not the ID token — is what gets presented as the ID-JAG subject token, which Okta accepts as `urn:ietf:params:oauth:token-type:access_token`. Leave the variable unset and `resource` is omitted entirely and the ID token stays the subject token; `OKTA_ID_JAG_SUBJECT_TOKEN=id_token|access_token` forces the choice either way.
  Caveat: Okta documents `resource` on the client-credentials and token-exchange requests, not on the human Authorization Code + PKCE login — the org authorization server may ignore it there and return its own audience. Expand the end user access token's decoded claims on the results page and check its `aud` to find out.
- The audience returned in the domain access token is checked against the expected `OKTA_<DOMAIN>_AUDIENCE` value; the results page states it in one line, and calls it out as a mismatch only when it doesn't line up.
- If a step fails, the error page shows the raw error from whichever endpoint rejected the request (org token endpoint, domain token endpoint, or the MCP gateway itself) — that's usually enough to tell which policy or config is the problem (e.g. `no_matching_policy` means the logged-in user isn't authorized for that domain's scopes).
- Some tools mutate demo data on the deployed gateway (flagged with a "Mutates" badge) — they run like any other tool, no confirmation step.
