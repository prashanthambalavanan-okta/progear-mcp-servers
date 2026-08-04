import { AsyncLocalStorage } from 'node:async_hooks';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { NextFunction, Request, Response } from 'express';

interface AuthContext {
  payload: JWTPayload;
  scopes: string[];
}

export interface AuthOptions {
  /** Full issuer URL. Takes precedence over domain/authServerId. */
  issuer?: string;
  /** Okta org domain, e.g. https://your-org.okta.com — combined with authServerId if issuer isn't set. */
  domain?: string;
  /** Custom Authorization Server ID for this domain. */
  authServerId?: string;
  audience?: string;
  /** Skip token validation entirely and grant every scope — local dev only. */
  allowInsecure?: boolean;
}

const authStorage = new AsyncLocalStorage<AuthContext>();

function scopesOf(payload: JWTPayload): string[] {
  const scp = (payload as Record<string, unknown>).scp;
  if (Array.isArray(scp)) return scp as string[];
  if (typeof payload.scope === 'string') return payload.scope.split(' ').filter(Boolean);
  return [];
}

// Keyed by issuer, since one process can host several domains (each with its
// own Okta Custom Authorization Server / JWKS) behind a single gateway.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(issuer: string) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/v1/keys`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

/**
 * Resolves an issuer from explicit options, falling back to env vars
 * (OKTA_ISSUER, or OKTA_DOMAIN + OKTA_AUTH_SERVER_ID) when running a single
 * domain standalone — matches the per-domain Okta Custom Authorization
 * Server naming already used in the ProGearSalesAI env vars (e.g.
 * OKTA_CUSTOMER_AUTH_SERVER_ID — pass that value as `authServerId`).
 */
function resolveIssuer(opts: AuthOptions): string | undefined {
  if (opts.issuer) return opts.issuer;
  if (opts.domain && opts.authServerId) {
    return `${opts.domain.replace(/\/$/, '')}/oauth2/${opts.authServerId}`;
  }
  if (process.env.OKTA_ISSUER) return process.env.OKTA_ISSUER;
  const domain = process.env.OKTA_DOMAIN;
  const authServerId = process.env.OKTA_AUTH_SERVER_ID;
  if (domain && authServerId) return `${domain.replace(/\/$/, '')}/oauth2/${authServerId}`;
  return undefined;
}

/**
 * Express middleware: validates the Okta access token (signature, issuer,
 * audience) for every request to /mcp and makes its granted scopes
 * available to tool handlers via `assertScope`/`hasScope`.
 *
 * Pass explicit `issuer`/`domain`+`authServerId`/`audience` when this
 * process hosts more than one domain (see packages/gateway); omit them to
 * fall back to OKTA_ISSUER / OKTA_DOMAIN+OKTA_AUTH_SERVER_ID / OKTA_AUDIENCE
 * env vars for a single-domain standalone deployment.
 *
 * Set allowInsecure (or ALLOW_INSECURE=true) only for local dev without an
 * Okta org configured — it grants every scope with no token check.
 */
export function bearerAuth(opts: AuthOptions = {}) {
  const issuer = resolveIssuer(opts);
  const audience = opts.audience ?? process.env.OKTA_AUDIENCE;
  const allowInsecure = opts.allowInsecure ?? process.env.ALLOW_INSECURE === 'true';

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!issuer || !audience) {
      if (allowInsecure) {
        console.warn('[auth] Okta issuer/audience not set — ALLOW_INSECURE bypass is active');
        authStorage.run({ payload: {}, scopes: ['*'] }, next);
        return;
      }
      res.status(500).json({
        error: 'Server misconfigured: set audience and either issuer or domain + authServerId',
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
