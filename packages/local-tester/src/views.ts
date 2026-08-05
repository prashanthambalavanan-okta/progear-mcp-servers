import type { DomainConfig, ToolSpec } from './config.js';
import { formatMcpResult } from './formatResult.js';
import { escapeHtml } from './htmlEscape.js';
import { UpstreamHttpError } from './httpError.js';
import type { JsonRpcToolCallResponse } from './mcpClient.js';

function json(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0b0e14;
      --surface: #12161f;
      --surface-2: #191f2c;
      --border: #262e3d;
      --text: #e7ebf3;
      --text-dim: #9aa4b8;
      --accent: #5b8cff;
      --accent-dim: #2a3d6b;
      --green: #3ecf8e;
      --green-dim: #163a2b;
      --amber: #f5a623;
      --amber-dim: #3a2c10;
      --red: #f26d6d;
      --red-dim: #3a1a1a;
      --radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top, #131826 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
    }
    .container { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; }
    a { color: var(--accent); }
    h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin: 0 0 12px; }
    p.lede { color: var(--text-dim); max-width: 640px; line-height: 1.5; }
    .topbar { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 32px; flex-wrap: wrap; gap: 8px; }
    .topbar .who { color: var(--text-dim); font-size: 14px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px;
    }
    a.button, button {
      display: inline-block;
      padding: 9px 16px;
      background: var(--accent);
      color: #0b0e14;
      text-decoration: none;
      border-radius: 8px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    a.button:hover, button:hover { filter: brightness(1.08); }
    a.link-muted { color: var(--text-dim); font-size: 13px; text-decoration: none; }
    a.link-muted:hover { color: var(--text); }

    .copy-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    button.btn-secondary {
      background: var(--surface-2);
      color: var(--text-dim);
      border: 1px solid var(--border);
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 500;
    }
    button.btn-secondary:hover { color: var(--text); filter: none; border-color: var(--accent); }

    .domain-section { margin-bottom: 40px; }
    .domain-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
    .domain-header h2 { margin: 0; }
    .domain-scopes { display: flex; gap: 6px; flex-wrap: wrap; }

    .pill {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      letter-spacing: 0.02em;
    }
    .pill-scope { background: var(--surface-2); color: var(--text-dim); border: 1px solid var(--border); font-weight: 500; }
    .pill-read { background: var(--green-dim); color: var(--green); }
    .pill-mutate { background: var(--amber-dim); color: var(--amber); }
    .pill-error { background: var(--red-dim); color: var(--red); }
    .pill-match { background: var(--green-dim); color: var(--green); }
    .pill-mismatch { background: var(--red-dim); color: var(--red); }

    .tool-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .tool-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .tool-card .tool-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; font-weight: 600; }
    .tool-card .tool-desc { color: var(--text-dim); font-size: 13px; line-height: 1.4; min-height: 34px; }
    .tool-card .badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .tool-card textarea {
      width: 100%;
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 10px;
      resize: vertical;
    }
    .tool-card form { display: flex; flex-direction: column; gap: 8px; }
    .tool-card button { align-self: flex-start; }

    pre {
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 14px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
      margin: 0;
    }
    .error pre { border-color: var(--red); color: var(--red); }
    .result-error {
      background: var(--red-dim);
      color: var(--red);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      margin-bottom: 10px;
    }

    table.result-table, table.kv { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.result-table th, table.result-table td, table.kv th, table.kv td {
      border-bottom: 1px solid var(--border);
      padding: 7px 10px;
      text-align: left;
      vertical-align: top;
    }
    table.result-table th { color: var(--text-dim); font-weight: 600; font-size: 12px; }
    table.kv th { color: var(--text-dim); font-weight: 500; width: 30%; white-space: nowrap; }
    table.kv, table.result-table { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }

    .step { border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; margin: 14px 0; background: var(--surface); }
    .step-title { font-size: 14px; font-weight: 600; margin: 0 0 10px; }
    details > summary { cursor: pointer; color: var(--accent); font-size: 13px; margin-top: 10px; }
    details[open] > summary { margin-bottom: 10px; }

    .foot-nav { margin-top: 32px; display: flex; gap: 16px; }
  </style>
</head>
<body>
  <div class="container">${body}</div>
  <script>
    function copyText(id, btn) {
      var el = document.getElementById(id);
      if (!el) return;
      var original = btn.textContent;
      navigator.clipboard.writeText(el.value).then(function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = original; }, 1200);
      }, function () {
        btn.textContent = 'Copy failed';
        setTimeout(function () { btn.textContent = original; }, 1200);
      });
    }
  </script>
</body>
</html>`;
}

/** Hidden source textareas + copy buttons for a token's raw compact form and its decoded claims. */
function copyRow(idPrefix: string, rawToken: string, decodedClaims: unknown): string {
  const rawId = `${idPrefix}-raw`;
  const decodedId = `${idPrefix}-decoded`;
  return `<div class="copy-row">
    <textarea id="${rawId}" hidden>${escapeHtml(rawToken)}</textarea>
    <textarea id="${decodedId}" hidden>${escapeHtml(JSON.stringify(decodedClaims, null, 2))}</textarea>
    <button type="button" class="btn-secondary" onclick="copyText('${rawId}', this)">Copy raw token</button>
    <button type="button" class="btn-secondary" onclick="copyText('${decodedId}', this)">Copy decoded</button>
  </div>`;
}

export function loginPage(): string {
  return page(
    'ProGear MCP',
    `<div class="card">
       <h1>ProGear MCP</h1>
       <p class="lede">Sign in, then run any tool across the 4 ProGear MCP servers. Each run performs the real Identity Assertion Authorization Grant (ID-JAG) exchange — your ID token → an ID-JAG → a domain-scoped access token — then calls that tool on the live gateway. No LLM in the loop: every tool maps directly to its arguments and its response.</p>
       <a class="button" href="/login">Sign in with Okta</a>
     </div>`,
  );
}

function toolCard(domain: DomainConfig, tool: ToolSpec): string {
  const badge = tool.mutates ? '<span class="pill pill-mutate">Mutates</span>' : '<span class="pill pill-read">Read-only</span>';
  const args = escapeHtml(JSON.stringify(tool.defaultArguments, null, 2));
  return `<article class="tool-card">
    <div class="tool-name">${escapeHtml(tool.name)}</div>
    <div class="tool-desc">${escapeHtml(tool.description)}</div>
    <div class="badges">
      <span class="pill pill-scope">${escapeHtml(tool.scope)}</span>
      ${badge}
    </div>
    <form method="post" action="/invoke/${encodeURIComponent(domain.key)}/${encodeURIComponent(tool.name)}">
      <textarea name="arguments" rows="4" spellcheck="false">${args}</textarea>
      <button type="submit">Run</button>
    </form>
  </article>`;
}

export function dashboardPage(user: { sub?: string; email?: string; name?: string }, domains: DomainConfig[]): string {
  const sections = domains
    .map(
      (d) => `<section class="domain-section">
        <div class="domain-header">
          <h2>${escapeHtml(d.label)}</h2>
          <div class="domain-scopes">${d.scopes.map((s) => `<span class="pill pill-scope">${escapeHtml(s)}</span>`).join('')}</div>
        </div>
        <div class="tool-grid">${d.tools.map((t) => toolCard(d, t)).join('')}</div>
      </section>`,
    )
    .join('');

  return page(
    'ProGear MCP',
    `<div class="topbar">
       <h1>ProGear MCP</h1>
       <div class="who">Signed in as ${escapeHtml(user.name ?? user.email ?? user.sub ?? 'unknown')} — <a class="link-muted" href="/logout">Sign out</a></div>
     </div>
     <p class="lede">Pick any tool below. Edit its arguments if you like, then Run — each click performs the full ID-JAG exchange for that server and calls the tool on the live gateway.</p>
     ${sections}`,
  );
}

export function resultPage(opts: {
  domainLabel: string;
  toolName: string;
  toolArguments: unknown;
  idToken: string;
  idTokenClaims: unknown;
  idJagToken: string;
  idJagClaims: unknown;
  domainAccessToken: string;
  accessClaims: unknown;
  audienceCheck: { expected: string; actual: unknown; match: boolean };
  rawResponse: JsonRpcToolCallResponse;
}): string {
  return page(
    'ProGear MCP — result',
    `<h1>${escapeHtml(opts.domainLabel)} — ${escapeHtml(opts.toolName)}</h1>

     <details class="step" open>
       <summary class="step-title">Step 1 — your ID token (PKCE login)</summary>
       <pre>${json(opts.idTokenClaims)}</pre>
       ${copyRow('idtoken', opts.idToken, opts.idTokenClaims)}
     </details>

     <details class="step" open>
       <summary class="step-title">Step 2 — ID-JAG (org token endpoint, audience = domain auth server)</summary>
       <pre>${json(opts.idJagClaims)}</pre>
       ${copyRow('idjag', opts.idJagToken, opts.idJagClaims)}
     </details>

     <details class="step" open>
       <summary class="step-title">Step 3 — domain access token (jwt-bearer grant with the ID-JAG as assertion)</summary>
       <pre>${json(opts.accessClaims)}</pre>
       <p>Audience check: expected <code>${escapeHtml(opts.audienceCheck.expected)}</code>, got <code>${escapeHtml(JSON.stringify(opts.audienceCheck.actual))}</code> —
         <span class="pill ${opts.audienceCheck.match ? 'pill-match' : 'pill-mismatch'}">${opts.audienceCheck.match ? 'match' : 'MISMATCH'}</span></p>
       ${copyRow('access', opts.domainAccessToken, opts.accessClaims)}
     </details>

     <div class="step">
       <div class="step-title">Step 4 — tool call against the deployed gateway</div>
       <p><code>${escapeHtml(opts.toolName)}(${escapeHtml(JSON.stringify(opts.toolArguments))})</code></p>
       ${formatMcpResult(opts.rawResponse)}
       <details>
         <summary>Show raw JSON-RPC response</summary>
         <pre>${json(opts.rawResponse)}</pre>
       </details>
     </div>

     <div class="foot-nav"><a href="/">Back to dashboard</a></div>`,
  );
}

const OAUTH_ERROR_TITLES: Record<string, string> = {
  access_denied: 'Access denied by policy',
  invalid_grant: 'Invalid or expired grant',
  invalid_scope: 'Scope not granted',
  invalid_client: 'Client authentication failed',
  unauthorized_client: 'Client not authorized for this grant',
};

export function errorPage(step: string, error: unknown): string {
  if (error instanceof UpstreamHttpError) {
    const oauth = error.oauthError;
    const title = oauth ? OAUTH_ERROR_TITLES[oauth.error] ?? `Rejected: ${oauth.error}` : `Request failed`;

    return page(
      'ProGear MCP — error',
      `<div class="card error">
         <h1>${escapeHtml(title)}</h1>
         <p class="lede">While ${escapeHtml(step)}, <code>${escapeHtml(error.endpoint)}</code> returned
           <span class="pill pill-error">${error.status}</span>.</p>
         ${oauth ? `<p>${escapeHtml(oauth.error)}${oauth.description ? ' — ' + escapeHtml(oauth.description) : ''}</p>` : ''}
         <details>
           <summary>Show raw response</summary>
           <pre>${json(error.body)}</pre>
         </details>
       </div>
       <div class="foot-nav"><a href="/">Back to dashboard</a></div>`,
    );
  }

  return page(
    'ProGear MCP — error',
    `<div class="card error">
       <h1>Failed at: ${escapeHtml(step)}</h1>
       <pre>${escapeHtml(error instanceof Error ? error.stack ?? error.message : String(error))}</pre>
     </div>
     <div class="foot-nav"><a href="/">Back to dashboard</a></div>`,
  );
}
