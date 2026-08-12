import { createTesterApp } from './app.js';
import { config } from './config.js';

// Standalone mode: the tester runs on its own port and calls the gateway over
// the network. When the gateway hosts the UI itself it imports createTesterApp
// directly and this file is never used.
const app = createTesterApp();

app.listen(config.port, () => {
  console.log(`ProGear MCP local tester listening on http://localhost:${config.port}`);
  console.log(`Redirect URI (must match the Okta app config exactly): ${config.redirectUri}`);
  console.log(`Calling MCP gateway at: ${config.gatewayBaseUrl}`);
});
