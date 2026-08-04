import { randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt, importJWK, type JWK } from 'jose';

/**
 * Raw HTTP implementation of the Identity Assertion Authorization Grant
 * (ID-JAG) flow — draft-parecki-oauth-identity-assertion-authz-grant.
 *
 * Step 1: exchange the user's OIDC ID token for an ID-JAG at the org's
 *         token endpoint (audience = the target Custom Authorization
 *         Server's issuer URL).
 * Step 2: present that ID-JAG as a JWT-bearer assertion at the target
 *         Custom Authorization Server's own token endpoint to get a
 *         normal, domain-scoped access token.
 *
 * The agent authenticates itself at both steps with a JWT client
 * assertion (RFC 7523) signed by its own private key — no shared secret.
 */

async function signClientAssertion(agentId: string, privateJwk: JWK, audience: string): Promise<string> {
  const alg = (privateJwk.alg as string) ?? 'RS256';
  const key = await importJWK(privateJwk, alg);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg, kid: privateJwk.kid })
    .setIssuer(agentId)
    .setSubject(agentId)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(randomUUID())
    .sign(key);
}

async function postForm(endpoint: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Request to ${endpoint} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

export interface IdJagResult {
  idJagToken: string;
  idJagClaims: Record<string, unknown>;
  raw: any;
}

export interface AccessTokenResult {
  accessToken: string;
  accessClaims: Record<string, unknown>;
  raw: any;
}

/** Step 1: ID token -> ID-JAG, scoped to `targetIssuer` (the resource domain's auth server issuer). */
export async function requestIdJag(opts: {
  orgTokenEndpoint: string;
  idToken: string;
  targetIssuer: string;
  scope: string;
  agentId: string;
  agentPrivateJwk: JWK;
}): Promise<IdJagResult> {
  const clientAssertion = await signClientAssertion(opts.agentId, opts.agentPrivateJwk, opts.orgTokenEndpoint);

  const raw = await postForm(opts.orgTokenEndpoint, {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
    subject_token: opts.idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    audience: opts.targetIssuer,
    scope: opts.scope,
    client_id: opts.agentId,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  });

  const idJagToken = raw.access_token;
  return { idJagToken, idJagClaims: decodeJwt(idJagToken), raw };
}

/** Step 2: ID-JAG -> domain-scoped access token, at the resource domain's own token endpoint. */
export async function exchangeIdJagForAccessToken(opts: {
  domainTokenEndpoint: string;
  idJagToken: string;
  agentId: string;
  agentPrivateJwk: JWK;
}): Promise<AccessTokenResult> {
  const clientAssertion = await signClientAssertion(opts.agentId, opts.agentPrivateJwk, opts.domainTokenEndpoint);

  const raw = await postForm(opts.domainTokenEndpoint, {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: opts.idJagToken,
    client_id: opts.agentId,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  });

  const accessToken = raw.access_token;
  return { accessToken, accessClaims: decodeJwt(accessToken), raw };
}

export interface FullExchangeResult {
  idJag: IdJagResult;
  accessToken: AccessTokenResult;
}

/** Runs both steps: ID token -> ID-JAG (org AS) -> domain access token (domain's own AS). */
export async function exchangeIdTokenForDomainAccessToken(opts: {
  oktaDomain: string;
  mainAuthServerId?: string;
  domainAuthServerId: string;
  idToken: string;
  scope: string;
  agentId: string;
  agentPrivateJwk: JWK;
}): Promise<FullExchangeResult> {
  const orgTokenEndpoint = opts.mainAuthServerId
    ? `${opts.oktaDomain}/oauth2/${opts.mainAuthServerId}/v1/token`
    : `${opts.oktaDomain}/oauth2/v1/token`;

  const targetIssuer = `${opts.oktaDomain}/oauth2/${opts.domainAuthServerId}`;
  const domainTokenEndpoint = `${targetIssuer}/v1/token`;

  const idJag = await requestIdJag({
    orgTokenEndpoint,
    idToken: opts.idToken,
    targetIssuer,
    scope: opts.scope,
    agentId: opts.agentId,
    agentPrivateJwk: opts.agentPrivateJwk,
  });

  const accessToken = await exchangeIdJagForAccessToken({
    domainTokenEndpoint,
    idJagToken: idJag.idJagToken,
    agentId: opts.agentId,
    agentPrivateJwk: opts.agentPrivateJwk,
  });

  return { idJag, accessToken };
}
