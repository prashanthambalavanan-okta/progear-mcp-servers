function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { font-size: 20px; }
    h2 { font-size: 15px; margin-top: 28px; color: #444; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
    a.button, button { display: inline-block; padding: 8px 14px; margin: 4px 6px 4px 0; background: #1a1a1a; color: white; text-decoration: none; border-radius: 6px; border: none; font-size: 14px; cursor: pointer; }
    .error { color: #b00020; }
    .step { border-left: 3px solid #ddd; padding-left: 14px; margin: 16px 0; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function loginPage(): string {
  return page(
    'ProGear MCP — local tester',
    `<h1>ProGear MCP local tester</h1>
     <p>Logs in via Okta (Authorization Code + PKCE), then acts as the AI agent: exchanges your ID token for an ID-JAG, exchanges that ID-JAG for a domain-scoped access token, and calls the deployed MCP gateway with it.</p>
     <a class="button" href="/login">Login with Okta</a>`,
  );
}

export function dashboardPage(user: { sub?: string; email?: string; name?: string }, domains: { key: string; label: string }[]): string {
  const buttons = domains
    .map((d) => `<form method="post" action="/invoke/${d.key}" style="display:inline"><button type="submit">${d.label}</button></form>`)
    .join('');
  return page(
    'ProGear MCP — local tester',
    `<h1>Logged in as ${user.name ?? user.email ?? user.sub}</h1>
     <p>Pick a domain to run the full ID-JAG exchange and call one MCP tool through it:</p>
     ${buttons}
     <p><a href="/logout">Logout</a></p>`,
  );
}

export function resultPage(opts: {
  domainLabel: string;
  idTokenClaims: unknown;
  idJagClaims: unknown;
  accessClaims: unknown;
  audienceCheck: { expected: string; actual: unknown; match: boolean };
  toolCall: { name: string; arguments: unknown };
  toolResult: unknown;
}): string {
  return page(
    'ProGear MCP — exchange result',
    `<h1>${opts.domainLabel} — ID-JAG exchange</h1>

     <div class="step">
       <h2>Step 0 — your ID token (PKCE login)</h2>
       <pre>${JSON.stringify(opts.idTokenClaims, null, 2)}</pre>
     </div>

     <div class="step">
       <h2>Step 1 — ID-JAG (org token endpoint, audience = domain auth server)</h2>
       <pre>${JSON.stringify(opts.idJagClaims, null, 2)}</pre>
     </div>

     <div class="step">
       <h2>Step 2 — domain access token (jwt-bearer grant with the ID-JAG as assertion)</h2>
       <pre>${JSON.stringify(opts.accessClaims, null, 2)}</pre>
       <p>Audience check: expected <code>${opts.audienceCheck.expected}</code>, got <code>${JSON.stringify(opts.audienceCheck.actual)}</code> —
         <strong style="color:${opts.audienceCheck.match ? '#0a7a2f' : '#b00020'}">${opts.audienceCheck.match ? 'match' : 'MISMATCH'}</strong></p>
     </div>

     <div class="step">
       <h2>Step 3 — tool call against the deployed gateway</h2>
       <p><code>${opts.toolCall.name}(${JSON.stringify(opts.toolCall.arguments)})</code></p>
       <pre>${JSON.stringify(opts.toolResult, null, 2)}</pre>
     </div>

     <p><a href="/">Back</a></p>`,
  );
}

export function errorPage(step: string, error: unknown): string {
  return page(
    'ProGear MCP — error',
    `<h1 class="error">Failed at: ${step}</h1>
     <pre class="error">${error instanceof Error ? error.stack ?? error.message : String(error)}</pre>
     <p><a href="/">Back</a></p>`,
  );
}
