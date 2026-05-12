// WebSocket exploration session
import fs from 'node:fs';

const API = 'REDACTED_API_KEY';
const URL = 'wss://api.hypedexer.com/ws';
const out = fs.createWriteStream('/home/yaugourt/hypedexer-sdk/exploration/samples/batch-9/ws-session.jsonl');
const log = (dir, msg, extra={}) => out.write(JSON.stringify({ dir, ts: Date.now(), ...extra, msg }) + '\n');

function tryConnect(label, opts) {
  return new Promise((resolve) => {
    const summary = { label, opened: false, error: null, closeCode: null, closeReason: null, msgs: 0 };
    let ws;
    try { ws = new WebSocket(URL, opts); } catch (e) { summary.error = String(e); return resolve(summary); }
    const t = setTimeout(() => { try { ws.close(); } catch{} }, 4000);
    ws.onopen = () => { summary.opened = true; log('open', null, { label }); };
    ws.onmessage = (ev) => { summary.msgs++; let d; try { d = JSON.parse(ev.data); } catch { d = ev.data; } log('<-', d, { label }); };
    ws.onerror = (e) => { summary.error = e?.message || 'err'; log('error', String(e?.message||e), { label }); };
    ws.onclose = (e) => { summary.closeCode = e.code; summary.closeReason = e.reason; clearTimeout(t); log('close', { code: e.code, reason: e.reason }, { label }); resolve(summary); };
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const results = [];

  // 1. Auth: subprotocol
  results.push(await tryConnect('subprotocol', [`apikey.${API}`]));
  // 2. Auth: Bearer header
  results.push(await tryConnect('bearer', { headers: { Authorization: `Bearer ${API}` } }));
  // 3. Auth: X-API-Key header
  results.push(await tryConnect('xapikey', { headers: { 'X-API-Key': API } }));

  console.log('Auth results:', JSON.stringify(results, null, 2));

  // Pick whichever worked for full session
  const working = results.find(r => r.opened);
  if (!working) { console.log('NO AUTH WORKED'); out.end(); return; }

  // Full session — try subprotocol first if it worked, else fallback
  const opts = working.label === 'subprotocol'
    ? [`apikey.${API}`]
    : working.label === 'bearer'
      ? { headers: { Authorization: `Bearer ${API}` } }
      : { headers: { 'X-API-Key': API } };

  const ws = new WebSocket(URL, opts);
  await new Promise((resolve, reject) => {
    ws.onopen = () => { log('open', null, { label: 'main' }); resolve(); };
    ws.onerror = (e) => { log('error', String(e?.message||e), { label: 'main' }); reject(e); };
    setTimeout(() => reject(new Error('open timeout')), 5000);
  });

  ws.onmessage = (ev) => { let d; try { d = JSON.parse(ev.data); } catch { d = ev.data; } log('<-', d, { label: 'main' }); };
  ws.onclose = (e) => log('close', { code: e.code, reason: e.reason }, { label: 'main' });

  const send = (obj) => { log('->', obj, { label: 'main' }); ws.send(JSON.stringify(obj)); };

  await sleep(500);
  send({ method: 'list_subscriptions' });
  await sleep(800);
  send({ method: 'subscribe', subscription: { type: 'completed_trades' } });
  await sleep(20000); // 20s of pushes
  send({ method: 'list_subscriptions' });
  await sleep(800);
  // user-scoped — pick a known active user from prior batches
  send({ method: 'subscribe', subscription: { type: 'completed_trades', user: '0xf3f496c9486be5924a93d67e98298733bb47057c' } });
  await sleep(15000);
  send({ method: 'unsubscribe', subscription: { type: 'completed_trades' } });
  await sleep(800);
  send({ method: 'subscribe', subscription: { type: 'not_a_real_channel' } });
  await sleep(1500);
  send({ method: 'subscribe', subscription: { type: 'fills' } });
  await sleep(1500);
  send({ method: 'subscribe', subscription: { type: 'liquidations' } });
  await sleep(1500);
  send({ method: 'subscribe', subscription: { type: 'gossip_status' } });
  await sleep(1500);
  send({ method: 'subscribe', subscription: { type: 'twap' } });
  await sleep(1500);
  send({ method: 'list_subscriptions' });
  await sleep(1000);
  send({ method: 'bogus_method' });
  await sleep(1000);

  ws.close(1000, 'done');
  await sleep(500);
  out.end();
  console.log('WS session done');
}

main().catch(e => { console.error(e); out.end(); });
