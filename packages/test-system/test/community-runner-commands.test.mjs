import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tailCommands } from '../../../docs/reference/community-harness-examples/dsh/openrig-dsh-runner.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  assert.ok(predicate(), message);
}

test('channel retains partial UTF-8 lines and consumes appended lines once', { timeout: 10000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'openrig-command-tail-'));
  const path = join(root, 'commands.jsonl');
  writeFileSync(path, '');
  const seen = [];
  const close = tailCommands(path, (command) => seen.push(command));
  try {
    const bytes = Buffer.from(JSON.stringify({ type: 'wake', id: 'one', question: 'été' }) + '\n');
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    appendFileSync(path, bytes.subarray(0, split));
    await delay(1100);
    assert.equal(seen.length, 0);
    appendFileSync(path, bytes.subarray(split));
    await until(() => seen.length === 1, 'complete wake line was not consumed');
    appendFileSync(path, JSON.stringify({ type: 'cancel', id: 'two' }) + '\n');
    await until(() => seen.length === 2, 'cancel line was not consumed');
    await delay(1100);
    assert.deepEqual(seen.map((entry) => entry.id), ['one', 'two']);
    assert.equal(seen[0].question, 'été');
    assert.ok(readFileSync(path).length > bytes.length, 'runner truncated the channel');
  } finally { close(); rmSync(root, { recursive: true, force: true }); }
});

test('dsh runner posts correlated wake_answer and Stop/cancelled hooks', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'openrig-command-runner-'));
  const hooks = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    assert.equal(req.url, '/api/activity/hooks');
    hooks.push(JSON.parse(raw)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const commands = join(root, 'commands.jsonl'); writeFileSync(commands, '');
  const fake = join(root, 'dsh.mjs');
  writeFileSync(fake, `#!/usr/bin/env node
import {createInterface} from 'node:readline';
if(process.argv.includes('--version')) { console.log('dsh 0.2.1-rc.2'); process.exit(0); }
let pending;
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.method==='session/prompt'){pending=m.id;return;}
 if(m.method==='session/cancel'){console.log(JSON.stringify({jsonrpc:'2.0',id:pending,result:{stopReason:'cancelled'}}));return;}
 if(m.id===undefined)return;
 const result=m.method==='initialize'?{protocolVersion:1}:m.method==='session/new'?{sessionId:'test-session'}:{};
 console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
});`, { mode: 0o700 });
  const child = spawn(process.execPath, ['docs/reference/community-harness-examples/dsh/openrig-dsh-runner.mjs'], {
    env: { PATH: process.env.PATH, HOME: root, OPENRIG_HOME: root, OPENRIG_DSH: fake,
      OPENRIG_URL: `http://127.0.0.1:${server.address().port}`, OPENRIG_ACTIVITY_HOOK_TOKEN: 'fixture',
      OPENRIG_SESSION_NAME: 'worker@test', OPENRIG_NODE_ID: 'node-test', OPENRIG_OCCUPANT_GENERATION: 'generation-test',
      OPENRIG_COMMAND_PATH: commands }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', (data) => { output += data; });
  try {
    await until(() => output.includes('ready ·'), 'runner did not open its conversation');
    appendFileSync(commands, JSON.stringify({ type: 'wake', id: 'wake-one', at: new Date().toISOString(), question: 'hello', timeoutSeconds: 2 }) + '\n');
    await until(() => hooks.some((hook) => hook.id === 'wake-one'), 'wake assertion: correlated answer missing');
    const wake = hooks.find((hook) => hook.id === 'wake-one');
    assert.equal(wake.eventFamily, 'wake_answer'); assert.equal(wake.answer, 'dsh-awake: hello');
    assert.equal(wake.sessionName, 'worker@test'); assert.equal(wake.nodeId, 'node-test');
    assert.equal(wake.generation, 'generation-test'); assert.ok(Date.parse(wake.occurredAt));
    child.stdin.write('hold this turn\n');
    await until(() => hooks.some((hook) => hook.hookEvent === 'UserPromptSubmit'), 'turn did not start');
    appendFileSync(commands, JSON.stringify({ type: 'cancel', id: 'cancel-one', at: new Date().toISOString() }) + '\n');
    await until(() => hooks.some((hook) => hook.hookEvent === 'Stop' && hook.reason === 'cancelled'), 'cancel hook missing');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await Promise.race([exited, delay(5000).then(() => { throw new Error('runner cleanup timed out'); })]); }
      finally { clearTimeout(kill); }
    }
    await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true });
  }
});
