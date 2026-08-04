import { AsyncLocalStorage } from 'node:async_hooks';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { NextFunction, Request, Response } from 'express';

interface AuthContext {
  payload: JWTPayload;
  scopes: string[];
}

const authStorage = new AsyncLocalStorage<AuthContext>();

function scopesOf(payload: JWTPayload): string[] {
  const scp = (payload as Record<string, unknown>).scp;
  if (Array.isArray(scp)) return scp as string[];
  if (typeof payload.scope === 'string') return payload.scope.split(' ').filter(Boolean);
  return [];
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks(issuer: string) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/v1/keys`));
  return jwks;
}

/**
 * Resolves the Okta issuer for this service. Accepts either a full
 * OKTA_ISSUER, or OKTA_DOMAIN + OKTA_AUTH_SERVER_ID (matching the naming
 * convention already used per-domain in the original ProGearSalesAI env
 * vars, e.g. OKTA_CUSTOMER_AUTH_SERVER_ID — just set the plain
 * OKTA_AUTH_SERVER_ID per service to that domain's value).
 */
function resolveIssuer(): string | undefined {
  if (process.env.OKTA_ISSUER) return process.env.OKTA_ISSUER;
  const domain = process.env.OKTA_DOMAIN;
  const authServerId = process.env.OKTA_AUTH_SERVER_ID;
  if (domain && authServerId) {
    return `${domain.replace(/\/$/, '')}/oauth2/${authServerId}`;
  }
  return undefined;
}

/**
 * Express middleware: validates the Okta access token (signature, issuer,
 * audience) for every request to /mcp and makes its granted scopes
 * available to tool handlers via `assertScope`/`hasScope`.
 *
 * Set ALLOW_INSECURE=true only for local dev without an Okta org configured
 * — it grants every scope with no token check.
 */
export function bearerAuth() {
  const issuer = resolveIssuer();
  const audience = process.env.OKTA_AUDIENCE;
  const allowInsecure = process.env.ALLOW_INSECURE === 'true';

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!issuer || !audience) {
      if (allowInsecure) {
        console.warn('[auth] Okta issuer/audience not set — ALLOW_INSECURE bypass is active');
        authStorage.run({ payload: {}, scopes: ['*'] }, next);
        return;
      }
      res.status(500).json({
        error: 'Server misconfigured: set OKTA_AUDIENCE and either OKTA_ISSUER or OKTA_DOMAIN + OKTA_AUTH_SERVER_ID',
      });
      return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    try {
      const { payload } = await jwtVerify(header.slice('Bearer '.length), getJwks(issuer), {
        issuer,
        audience,
      });
      authStorage.run({ payload, scopes: scopesOf(payload) }, next);
    } catch (err) {
      res.status(401).json({ error: 'Invalid token', detail: (err as Error).message });
    }
  };
}

export function currentScopes(): string[] {
  return authStorage.getStore()?.scopes ?? [];
}

export function hasScope(scope: string): boolean {
  const scopes = currentScopes();
  return scopes.includes('*') || scopes.includes(scope);
}

/** Call at the top of every tool handler to enforce its required scope. */
export function assertScope(scope: string): { ok: true } | { ok: false; message: string } {
  if (hasScope(scope)) return { ok: true };
  const granted = currentScopes().join(', ') || 'none';
  return { ok: false, message: `Missing required scope: ${scope} (granted: ${granted})` };
}
