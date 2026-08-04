import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { decodeJwt } from 'jose';
import { config, DOMAINS, domainAudience, domainAuthServerId } from './config.js';
import { exchangeIdTokenForDomainAccessToken } from './idJag.js';
import { callMcpTool } from './mcpClient.js';
import { generatePkce, randomState } from './pkce.js';
import { dashboardPage, errorPage, loginPage, resultPage } from './views.js';

const app = express();
app.use(cookieParser());

// Short-lived, in-memory only — this app never persists anything to disk.
const pendingLogins = new Map<string, { verifier: string }>();
const sessions = new Map<string, { idToken: string; claims: Record<string, unknown> }>();

app.get('/', (req, res) => {
  const sid = req.cookies?.sid;
  const session = sid ? sessions.get(sid) : undefined;
  if (!session) {
    res.send(loginPage());
    return;
  }
  res.send(dashboardPage(session.claims, DOMAINS.map((d) => ({ key: d.key, label: d.label }))));
});

app.get('/login', (_req, res) => {
  const { verifier, challenge } = generatePkce();
  const state = randomState();
  pendingLogins.set(state, { verifier });

  const authorizeUrl = new URL(`${config.oktaDomain()}/oauth2/v1/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: config.clientId(),
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: config.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  res.redirect(authorizeUrl.toString());
});

app.get('/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const pending = state ? pendingLogins.get(state) : undefined;

  if (!code || !state || !pending) {
    res.status(400).send(errorPage('login callback', 'Missing or unrecognized state/code'));
    return;
  }
  pendingLogins.delete(state);

  try {
    const basicAuth = Buffer.from(`${config.clientId()}:${config.clientSecret()}`).toString('base64');
    const tokenRes = await fetch(`${config.oktaDomain()}/oauth2/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        code_verifier: pending.verifier,
      }),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(`Token endpoint returned ${tokenRes.status}: ${JSON.stringify(tokenJson)}`);

    const idToken = tokenJson.id_token as string;
    const claims = decodeJwt(idToken) as Record<string, unknown>;

    const sid = randomUUID();
    sessions.set(sid, { idToken, claims });
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
    res.redirect('/');
  } catch (err) {
    res.status(500).send(errorPage('exchanging authorization code', err));
  }
});

app.get('/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie('sid');
  res.redirect('/');
});

app.post('/invoke/:domain', async (req, res) => {
  const sid = req.cookies?.sid;
  const session = sid ? sessions.get(sid) : undefined;
  if (!session) {
    res.redirect('/');
    return;
  }

  const domain = DOMAINS.find((d) => d.key === req.params.domain);
  if (!domain) {
    res.status(404).send(errorPage('invoke', `Unknown domain: ${req.params.domain}`));
    return;
  }

  try {
    const { idJag, accessToken } = await exchangeIdTokenForDomainAccessToken({
      oktaDomain: config.oktaDomain(),
      mainAuthServerId: config.mainAuthServerId(),
      domainAuthServerId: domainAuthServerId(domain),
      idToken: session.idToken,
      scope: domain.scopes.join(' '),
      agentId: config.agentId(),
      agentPrivateJwk: config.agentPrivateJwk(),
    });

    const toolResult = await callMcpTool({
      mcpUrl: `${config.gatewayBaseUrl}/${domain.key}/mcp`,
      accessToken: accessToken.accessToken,
      toolName: domain.demoTool.name,
      toolArguments: domain.demoTool.arguments,
    });

    const expectedAudience = domainAudience(domain);
    const actualAudience = accessToken.accessClaims.aud;

    res.send(
      resultPage({
        domainLabel: domain.label,
        idTokenClaims: session.claims,
        idJagClaims: idJag.idJagClaims,
        accessClaims: accessToken.accessClaims,
        audienceCheck: {
          expected: expectedAudience,
          actual: actualAudience,
          match: actualAudience === expectedAudience,
        },
        toolCall: domain.demoTool,
        toolResult,
      }),
    );
  } catch (err) {
    res.status(502).send(errorPage(`ID-JAG exchange / tool call for ${domain.label}`, err));
  }
});

app.listen(config.port, () => {
  console.log(`ProGear MCP local tester listening on http://localhost:${config.port}`);
  console.log(`Redirect URI (must match the Okta app config exactly): ${config.redirectUri}`);
  console.log(`Calling MCP gateway at: ${config.gatewayBaseUrl}`);
});
