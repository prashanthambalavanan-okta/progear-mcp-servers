# ProGear MCP Servers

One MCP gateway for the ProGear basketball-equipment demo, hosting four domains — Inventory, Customer, Sales, and Pricing — each speaking the real MCP protocol (Streamable HTTP transport) and secured by **your own Okta org** (its own Custom Authorization Server + scope set per domain).

This is a deliberately smaller sibling of [`ProGearSalesAI`](https://github.com/oktaforai-okta/ProGearSalesAI): no Auth0 FGA, no LangGraph orchestrator, no frontend. The gateway itself just validates whatever bearer token it's given — it doesn't care how the caller got it. `packages/local-tester` (local-only, not deployed) demonstrates one way a caller might: human PKCE login + an agent doing the [ID-JAG](https://datatracker.ietf.org/doc/html/draft-parecki-oauth-identity-assertion-authz-grant) exchange to mint that token, mirroring the original app's Cross-App Access flow.

## Deployment shape

**One process, one Render service, one build/start command.** `packages/gateway` mounts all 4 domains at different paths behind a single Express app:

| Mount | Scopes | Tools |
|---|---|---|
| `/inventory/mcp` | `inventory:read`, `inventory:write`, `inventory:alert` | `list_products`, `search_inventory`, `check_stock`, `get_low_stock_alerts`, `get_inventory_summary`, `update_inventory_quantity` |
| `/customer/mcp` | `customer:read`, `customer:lookup`, `customer:history` | `get_customer`, `search_customers`, `get_customers_by_tier`, `get_top_customers`, `get_customer_summary` |
| `/sales/mcp` | `sales:read`, `sales:quote`, `sales:order` | `list_orders`, `get_order`, `get_pipeline`, `create_quote`, `create_order`, `cancel_order` |
| `/pricing/mcp` | `pricing:read`, `pricing:margin`, `pricing:discount` | `get_price`, `get_category_pricing`, `calculate_bulk_price`, `get_discount_structure` |

Each mount validates against its **own** Okta Custom Authorization Server (different issuer/audience per domain) even though they all run in the same process — a token issued for the inventory auth server can't be used against `/customer/mcp`, and within a mount, each tool call checks its required scope against the granted scopes in the caller's token (a token missing `inventory:write` can call `check_stock` but not `update_inventory_quantity`).

`packages/mcp-inventory`, `mcp-customer`, `mcp-sales`, `mcp-pricing` also still work as **standalone** servers (their own `server.ts` + `/mcp` + `/health`, single-domain env vars) if you ever want to split them back into separate deployments — the gateway just imports each one's tool-registration logic (`./tools` export) and mounts it under its own auth config instead of calling `.listen()` itself.

## Data

Seeded from a ported snapshot of the ProGearSalesAI demo dataset: 90 inventory SKUs, 90 pricing entries, 34 customers, tier/volume discount tables (`packages/shared/src/data/initial_data.json`). Sales orders/quotes are in-memory only. **All state resets on process restart** — this is a tools server, not a system of record.

## Project structure

```
packages/
  shared/            # ported data + store, JWKS auth + scope enforcement, HTTP/MCP transport helper
  mcp-inventory/      mcp-customer/      mcp-sales/      mcp-pricing/   # tool definitions + standalone entrypoint each
  gateway/            # the actual deployment: mounts all 4 at /inventory, /customer, /sales, /pricing
  local-tester/       # local-only: PKCE login + agent ID-JAG exchange, calls the deployed gateway (see its own README)
```

## Local development

```bash
npm install
npm run build            # builds shared + all 4 domains + gateway, in dependency order

npm run dev:gateway       # tsx watch, all 4 mounts on one port (default 3000)
```

Without the relevant Okta env vars set for a mount, that mount returns `500` on every `/mcp` request unless you set `ALLOW_INSECURE=true`, which skips token validation and grants every scope on every mount — local dev only, never set this in a deployed environment.

## Okta setup

Set `OKTA_DOMAIN` once, plus `OKTA_<DOMAIN>_AUTH_SERVER_ID` + `OKTA_<DOMAIN>_AUDIENCE` per domain — these are the **exact same env var names** already used in the ProGearSalesAI backend (`OKTA_CUSTOMER_AUTH_SERVER_ID`, `OKTA_INVENTORY_AUDIENCE`, etc.), so existing values can be copied over as-is:

```
OKTA_DOMAIN=https://your-org.okta.com

OKTA_INVENTORY_AUTH_SERVER_ID=...   OKTA_INVENTORY_AUDIENCE=api://progear-inventory
OKTA_CUSTOMER_AUTH_SERVER_ID=...    OKTA_CUSTOMER_AUDIENCE=api://progear-customer
OKTA_SALES_AUTH_SERVER_ID=...       OKTA_SALES_AUDIENCE=api://progear-sales
OKTA_PRICING_AUTH_SERVER_ID=...     OKTA_PRICING_AUDIENCE=api://progear-pricing
```

See `.env.example` for the full list, including which vars from a ProGearSalesAI-style `.env` don't apply here (Anthropic key, CORS, the AI Agent's own private key/client ID — this gateway validates incoming tokens, it doesn't self-issue any). Tokens are validated by signature + issuer + audience against each domain's own Okta JWKS endpoint (`jose`'s `createRemoteJWKSet`) — no shared secret needed on this side.

## Deploying to Render

Single service, either via the dashboard or the included Blueprint.

**Manual (New → Web Service):**

| Field | Value |
|---|---|
| Language | Node |
| Root Directory | *(blank — npm workspaces monorepo, build runs from repo root)* |
| Build Command | `npm install && npm run build` |
| Start Command | `node packages/gateway/dist/server.js` |
| Health Check Path | `/health` |

**Blueprint:** `render.yaml` at the repo root defines the same single `progear-mcp-gateway` service — New → Blueprint, point at this repo, then fill in the 9 Okta env vars it prompts for (marked `sync: false`).

## Connecting an agent

Each mount exposes MCP over Streamable HTTP at `POST/GET/DELETE <mount>/mcp` (stateless — no session persistence across requests) plus its own `GET <mount>/health`; there's also a top-level `GET /health` listing all mounts.

Get an access token from Okta for the relevant Custom Authorization Server + scopes (e.g. client-credentials grant for a service/agent identity), then:

**Claude Code CLI:**
```bash
claude mcp add --transport http progear-inventory \
  https://<your-render-url>/inventory/mcp \
  --header "Authorization: Bearer <token>"
```

Repeat per domain (`/customer/mcp`, `/sales/mcp`, `/pricing/mcp`) with a token scoped to that domain's audience.

**Any other MCP client / agent SDK:** point it at the mount's `/mcp` URL with an `Authorization: Bearer <token>` header on every request.

### OAuth discovery (no static token)

Clients that implement the MCP authorization spec can find Okta on their own instead of being handed a token. Each mount publishes [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) protected-resource metadata at the **root** of the gateway, path-scoped to the endpoint it describes:

```
GET /.well-known/oauth-protected-resource/inventory/mcp
GET /.well-known/oauth-protected-resource/customer/mcp
GET /.well-known/oauth-protected-resource/sales/mcp
GET /.well-known/oauth-protected-resource/pricing/mcp
```

```json
{
  "resource": "https://<your-render-url>/inventory/mcp",
  "authorization_servers": ["https://your-org.okta.com/oauth2/<inventory-auth-server-id>"],
  "scopes_supported": ["inventory:read", "inventory:write", "inventory:alert"],
  "bearer_methods_supported": ["header"],
  "resource_name": "ProGear Inventory MCP"
}
```

A `401` from `/mcp` now also carries the pointer, so a client that calls the endpoint cold learns where to authenticate:

```
WWW-Authenticate: Bearer resource_metadata="https://<your-render-url>/.well-known/oauth-protected-resource/inventory/mcp"
```

(When a token *was* presented but failed validation, the challenge additionally carries `error="invalid_token"` and `error_description`.)

The URLs in these documents are derived from the incoming request (`X-Forwarded-Proto` + `Host`, with `trust proxy` on — correct on Render). Set `PUBLIC_BASE_URL=https://<your-render-url>` only if something in front of the gateway rewrites the `Host` header.

To let a client complete the flow, register an OIDC **public** client (Authorization Code + PKCE) in your Okta org, add the client's redirect URI (Claude.ai uses `https://claude.ai/api/mcp/auth_callback`), and grant the domain's scopes in that Custom Authorization Server's access policy.

**Still missing for fully zero-config connect:** [dynamic client registration](https://www.rfc-editor.org/rfc/rfc7591). Okta's `/oauth2/v1/clients` endpoint requires an SSWS API token, so it can't be advertised for anonymous registration — clients that insist on DCR (VS Code / Copilot today) need a registration shim in front of it. Clients that accept a pre-registered `client_id` can use the discovery above as-is.
