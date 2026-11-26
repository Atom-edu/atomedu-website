#!/usr/bin/env node
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const names = ['issuer', 'client-id', 'deployment-id', 'auth-url', 'token-url', 'jwks-url', 'service-origin', 'institution'];
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value === '--apply') { args.set('apply', true); continue; }
  if (value === '--help') { args.set('help', true); continue; }
  if (!value.startsWith('--') || !names.includes(value.slice(2)) || !process.argv[index + 1]) {
    throw new Error(`Unknown or incomplete argument: ${value}`);
  }
  args.set(value.slice(2), process.argv[++index]);
}
if (args.has('help') || names.some(name => !args.has(name))) {
  process.stdout.write(`Usage: node scripts/register-canvas.mjs ${names.map(name => `--${name} VALUE`).join(' ')} [--apply]\nWithout --apply, this validates and previews the registration.\n`);
  process.exit(args.has('help') ? 0 : 1);
}
function https(name) {
  const value = String(args.get(name));
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${name} must be an HTTPS URL`);
  return url.href.replace(/\/$/, '');
}
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
const issuer = https('issuer');
const auth = https('auth-url');
const token = https('token-url');
const jwks = https('jwks-url');
const origin = new URL(https('service-origin')).origin;
if (origin !== args.get('service-origin')) throw new Error('service-origin must contain only the HTTPS origin');
const client = String(args.get('client-id'));
const deployment = String(args.get('deployment-id'));
const institution = String(args.get('institution'));
if (!client || client.length > 200 || !deployment || deployment.length > 200 || institution.length > 200) throw new Error('Invalid registration identifiers');
process.stdout.write(JSON.stringify({ issuer, client_id: client, deployment_id: deployment, auth_url: auth, token_url: token, jwks_url: jwks, service_origin: origin, institution }, null, 2) + '\n');
if (!args.has('apply')) {
  process.stdout.write('Validated only. Add --apply after checking every value with the Canvas administrator.\n');
  process.exit(0);
}
const statement = `INSERT INTO platforms (issuer,client_id,auth_url,token_url,jwks_url,service_origin,active)
VALUES (${[issuer,client,auth,token,jwks,origin].map(literal).join(',')},1)
ON CONFLICT(issuer,client_id) DO UPDATE SET auth_url=excluded.auth_url,token_url=excluded.token_url,jwks_url=excluded.jwks_url,service_origin=excluded.service_origin,active=1;
INSERT INTO deployments (issuer,client_id,deployment_id,institution,active)
VALUES (${[issuer,client,deployment,institution].map(literal).join(',')},1)
ON CONFLICT(issuer,client_id,deployment_id) DO UPDATE SET institution=excluded.institution,active=1;\n`;
const dir = mkdtempSync(join(tmpdir(), 'atom-lti-registration-'));
try {
  const file = join(dir, 'registration.sql');
  writeFileSync(file, statement, { mode: 0o600 });
  const cwd = dirname(dirname(fileURLToPath(import.meta.url)));
  const command = join(cwd, 'node_modules', '.bin', 'wrangler');
  const result = spawnSync(command, ['d1', 'execute', 'atom-lti', '--remote', '--file', file], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
