import WebSocket from '/tmp/node_modules/ws/wrapper.mjs';
import fs from 'node:fs';

const API = 'REDACTED_API_KEY';
const URL = 'wss://api.hypedexer.com/ws';
const out = fs.createWriteStream('/home/yaugourt/hypedexer-sdk/exploration/samples/batch-9/ws-session.jsonl');
const log = (dir, msg, extra={}) => out.write(JSON.stringify({ dir, ts: Date.now(), ...extra, msg }) + '\n');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Wait to clear rate limit from previous attempts
console.log('waiting 8s for rate limit reset...');
await sleep(8000);

function tryConnect(label, mk) {
  return new Promise(async (resolve) => {
    const summary = { label, opened: false, error: null, closeCode: null, closeReason: '', msgs: 0, msgsSample: [] };
    let ws;
    try { ws = mk(); } catch (e) { summary.error = String(e); return resolve({ summary, ws: null }); }
    const t = setTimeout(() => { try { ws.terminate(); } catch {} }, 5000);
    ws.on('open', () => { summary.opened = true; log('open', null, { label }); });
    ws.on('unexpected-response', (req, res) => { summary.error = `HTTP ${res.statusCode}`; log('error', `unexpected ${res.statusCode}`, { label }); });
    ws.on('message', (data) => {
      summary.msgs++;
      let s = data.toString();
      let d; try { d = JSON.parse(s); } catch { d = s; }
      if (summary.msgsSample.length < 3) summary.msgsSample.push(d);
      log('<-', d, { label });
    });
    ws.on('error', (e) => { summary.error ||= e.message; log('error', e.message, { label }); });
    ws.on('close', (code, reason) => { summary.closeCode = code; summary.closeReason = reason.toString(); clearTimeout(t); log('close', { code, reason: reason.toString() }, { label }); resolve({ summary, ws }); });
  });
}

// Helper: subprotocol with permissive client
function mkSubprotocol() {
  // Pass empty protocols array? No — we need to send protocol but accept missing response.
  // Strategy: override the protocol-check by patching internal. Easier: use raw http upgrade.
  // ws lib doesn't have a built-in "ignore subprotocol mismatch". Use a separate approach.
  return new WebSocket(URL, [`apikey.${API}`]);
}

const r1 = await tryConnect('subprotocol', mkSubprotocol);
await sleep(3000);
const r2 = await tryConnect('bearer', () => new WebSocket(URL, { headers: { Authorization: `Bearer ${API}` } }));
await sleep(3000);
const r3 = await tryConnect('xapikey', () => new WebSocket(URL, { headers: { 'X-API-Key': API } }));

console.log('AUTH RESULTS:');
console.log(JSON.stringify([r1.summary, r2.summary, r3.summary], null, 2));

const working = [r1, r2, r3].find(r => r.summary.opened);
if (!working) { console.log('NO AUTH WORKED — ending'); out.end(); process.exit(0); }

const workLabel = working.summary.label;
console.log('Main session using:', workLabel);
await sleep(2000);

const mk = workLabel === 'subprotocol'
  ? () => new WebSocket(URL, [`apikey.${API}`])
  : workLabel === 'bearer'
    ? () => new WebSocket(URL, { headers: { Authorization: `Bearer ${API}` } })
    : () => new WebSocket(URL, { headers: { 'X-API-Key': API } });

const ws = mk();
await new Promise((resolve, reject) => {
  ws.on('open', () => { log('open', null, { label: 'main' }); resolve(); });
  ws.on('error', (e) => { log('error', e.message, { label: 'main' }); });
  setTimeout(() => reject(new Error('open timeout')), 6000);
});

ws.on('message', (data) => { let s = data.toString(); let d; try { d = JSON.parse(s); } catch { d = s; } log('<-', d, { label: 'main' }); });
ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }, { label: 'main' }));
ws.on('ping', (data) => log('ping', data.toString('hex'), { label: 'main' }));
ws.on('pong', (data) => log('pong', data.toString('hex'), { label: 'main' }));

const send = (obj) => { log('->', obj, { label: 'main' }); ws.send(JSON.stringify(obj)); };

await sleep(800);
send({ method: 'list_subscriptions' });
await sleep(800);
send({ method: 'subscribe', subscription: { type: 'completed_trades' } });
await sleep(20000);
send({ method: 'list_subscriptions' });
await sleep(800);
send({ method: 'subscribe', subscription: { type: 'completed_trades', user: '0xf3f496c9486be5924a93d67e98298733bb47057c' } });
await sleep(12000);
send({ method: 'unsubscribe', subscription: { type: 'completed_trades' } });
await sleep(1000);
send({ method: 'subscribe', subscription: { type: 'not_a_real_channel' } });
await sleep(1000);
send({ method: 'subscribe', subscription: { type: 'fills' } });
await sleep(1000);
send({ method: 'subscribe', subscription: { type: 'liquidations' } });
await sleep(1000);
send({ method: 'subscribe', subscription: { type: 'gossip_status' } });
await sleep(1000);
send({ method: 'subscribe', subscription: { type: 'twap' } });
await sleep(1000);
send({ method: 'list_subscriptions' });
await sleep(1000);
send({ method: 'bogus_method' });
await sleep(1000);

ws.close(1000, 'done');
await sleep(800);
out.end();
console.log('done');
