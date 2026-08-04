# ProGear MCP Servers

Four standalone MCP servers for the ProGear basketball-equipment demo — Inventory, Customer, Sales, and Pricing — each speaking the real MCP protocol (Streamable HTTP transport) and secured by **your own Okta org** (one Custom Authorization Server + scope set per domain).

This is a deliberately smaller sibling of [`ProGearSalesAI`](https://github.com/oktaforai-okta/ProGearSalesAI): no Auth0 FGA, no ID-JAG token exchange, no LangGraph orchestrator, no frontend. Just tools an agent can call directly, gated by a normal OAuth bearer token + scope check against Okta.

## Servers & scopes

| Server | Scopes | Tools |
|---|---|---|
| `mcp-inventory` | `inventory:read`, `inventory:write`, `inventory:alert` | `list_products`, `search_inventory`, `check_stock`, `get_low_stock_alerts`, `get_inventory_summary`, `update_inventory_quantity` |
| `mcp-customer` | `customer:read`, `customer:lookup`, `customer:history` | `get_customer`, `search_customers`, `get_customers_by_tier`, `get_top_customers`, `get_customer_summary` |
| `mcp-sales` | `sales:read`, `sales:quote`, `sales:order` | `list_orders`, `get_order`, `get_pipeline`, `create_quote`, `create_order`, `cancel_order` |
| `mcp-pricing` | `pricing:read`, `pricing:margin`, `pricing:discount` | `get_price`, `get_category_pricing`, `calculate_bulk_price`, `get_discount_structure` |

Each tool call checks its required scope against the granted scopes in the caller's Okta access token — a token missing `inventory:write` can call `check_stock` but not `update_inventory_quantity`.

## Data

Seeded from a ported snapshot of the ProGearSalesAI demo dataset: 90 inventory SKUs, 90 pricing entries, 34 customers, tier/volume discount tables (`packages/shared/src/data/initial_data.json`). Sales orders/quotes are in-memory only. **All state resets on process restart** — this is a tools server, not a system of record.

## Project structure

```
packages/
  shared/           # ported data + store, JWKS auth + scope enforcement, HTTP/MCP transport helper
  mcp-inventory/     mcp-customer/     mcp-sales/     mcp-pricing/
```

## Local development

```bash
npm install
npm run build                    # builds shared + all 4 servers

npm run dev:inventory             # tsx watch, defaults to port 3001
npm run dev:customer               # port 3002
npm run dev:sales                  # port 3003
npm run dev:pricing                 # port 3004
```

Without `OKTA_ISSUER`/`OKTA_AUDIENCE` set, a server returns `500` on every `/mcp` request unless you set `ALLOW_INSECURE=true`, which skips token validation and grants every scope — local dev only, never set this in a deployed environment.

## Okta setup (per server)

Each server needs its own Custom Authorization Server issuer + audience — this repo assumes you already have the 4 auth servers and scopes from the ProGearSalesAI setup (`inventory:*`, `customer:*`, `sales:*`, `pricing:*`). Set `OKTA_DOMAIN` once (same value for all 4 services) plus `OKTA_AUTH_SERVER_ID` + `OKTA_AUDIENCE` per service, using that domain's existing values:

```
OKTA_DOMAIN=https://your-org.okta.com          # same for all 4 services
OKTA_AUTH_SERVER_ID=<that domain's auth server id>   # e.g. your OKTA_CUSTOMER_AUTH_SERVER_ID's value, on the mcp-customer service
OKTA_AUDIENCE=api://progear-<domain>
```

(Alternatively, set `OKTA_ISSUER` directly as a full URL — it takes precedence over `OKTA_DOMAIN`/`OKTA_AUTH_SERVER_ID`.) See `.env.example` for the full list, including which vars from a ProGearSalesAI-style `.env` don't apply here (Anthropic key, CORS, the AI Agent's own private key/client ID — this server validates incoming tokens, it doesn't self-issue any). Tokens are validated by signature + issuer + audience against Okta's JWKS endpoint (`jose`'s `createRemoteJWKSet`) — no shared secret needed on this side.

## Deploying to Render

`render.yaml` defines all 4 services as a Render Blueprint:

```bash
# from the Render dashboard: New > Blueprint > point at this repo
```

Render will build/deploy all 4 services from one repo. After creating them, set `OKTA_ISSUER` and `OKTA_AUDIENCE` for each service in the Render dashboard (marked `sync: false` in the blueprint, so they're not synced from a shared env group — set them per service).

## Connecting an agent

Each deployed server exposes MCP over Streamable HTTP at `POST/GET/DELETE /mcp` (stateless — no session persistence across requests) and a plain `GET /health`.

Get an access token from Okta for the relevant Custom Authorization Server + scopes (e.g. client-credentials grant for a service/agent identity), then:

**Claude Code CLI:**
```bash
claude mcp add --transport http progear-inventory \
  https://progear-mcp-inventory.onrender.com/mcp \
  --header "Authorization: Bearer <token>"
```

**Any other MCP client / agent SDK:** point it at the server's `/mcp` URL with an `Authorization: Bearer <token>` header on every request.

Claude.ai / Claude Desktop's remote-connector UI expects full OAuth 2.1 discovery (dynamic client registration) for zero-config connect — that's not implemented here since Okta is already the authorization server and tokens are obtained out-of-band. Wiring OAuth discovery metadata onto these servers is a reasonable next step if you want that flow instead of a static bearer token.
