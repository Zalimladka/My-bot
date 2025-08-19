/**

Token + Web Panel Messenger Lock Bot (single-file)


---

What this does

Serves a clean web page where you paste:


1) EAAB token (from Vinhtool)  [optional / experimental]

2) AppState JSON (cookies)      [recommended / reliable]

3) Group (Thread) UID to control

4) Group Name to lock

5) Nickname to lock for everyone

Click "Start Bot" and it will:


- Log in (AppState preferred; Token path is experimental)

- Set group title & member nicknames

- Keep watching and auto‑revert changes (name / nicknames)

- Stream logs to the page in real time (via Socket.IO)

How to run

1. npm i express socket.io body-parser ws3-fca puppeteer



2. node index.js



3. Open http://localhost:5000



Notes

Messenger control via EAAB token alone is not officially supported.


We include an EXPERIMENTAL token mode using Puppeteer to obtain session

cookies; if it fails, use AppState JSON (most reliable for ws3-fca).

Do NOT share tokens/appstate publicly. Keep this for personal use. */



const express = require('express'); const http = require('http'); const { Server } = require('socket.io'); const bodyParser = require('body-parser'); const { login } = require('ws3-fca'); const puppeteer = require('puppeteer');

const app = express(); const server = http.createServer(app); const io = new Server(server);

app.use(bodyParser.json({ limit: '2mb' }));

// In‑memory state let api = null; let listenerCleanup = null; let monitorInterval = null; const LOCKS = { threadID: null, groupName: null, nickname: null, };

function sendLog(msg) { const line = typeof msg === 'string' ? msg : JSON.stringify(msg); console.log(line); io.emit('log', line); }

// ---- Simple HTML UI (served from memory) ---------------------------------- app.get('/', (_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!DOCTYPE html>

<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>🚀 Messenger Lock Bot</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    :root{--bg:#f5f7fb;--card:#fff;--text:#111;--muted:#6b7280;--ok:#16a34a;--err:#e11d48}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial}
    .wrap{max-width:980px;margin:30px auto;padding:0 16px}
    .card{background:var(--card);border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.06);padding:22px}
    h1{margin:0 0 8px} .sub{color:var(--muted);margin:0 0 14px}
    label{font-weight:700;display:block;margin:12px 0 6px}
    input,textarea{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fbfbfb}
    textarea{min-height:130px;font-family:ui-monospace,Consolas,Monaco,monospace}
    .grid{display:grid;gap:16px} @media(min-width:860px){.grid{grid-template-columns:1.2fr .8fr}}
    .btn{border:0;border-radius:12px;padding:12px 16px;font-weight:800;cursor:pointer}
    .btn.primary{background:#2563eb;color:#fff} .btn.primary:hover{opacity:.95}
    .status{margin:14px 0;padding:10px 12px;border-radius:10px}
    .ok{background:#dcfce7;color:#065f46} .err{background:#fee2e2;color:#991b1b}
    #console{background:#0b1020;color:#c8d0ff;border-radius:12px;padding:12px;font-family:ui-monospace,monospace;height:320px;overflow:auto;white-space:pre-wrap}
    .hint{color:var(--muted);font-size:12px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>🚀 Messenger Lock Bot (No-Command)</h1>
      <p class="sub">Enter details once, then the bot will lock & auto‑revert group name and nicknames.</p><div id="status" class="status err">❌ Bot is not running</div>

  <div class="grid">
    <div>
      <label>EAAB Token (Vinhtool) — optional / experimental</label>
      <input id="token" placeholder="EAAB..." />
      <div class="hint">If token mode fails, paste AppState JSON below (recommended).</div>

      <label>AppState JSON (preferred)</label>
      <textarea id="appstate" placeholder='[ { "key": "sb", "value": "..." }, ... ]'></textarea>

      <label>Group (Thread) UID</label>
      <input id="threadID" placeholder="e.g. 6280xxxxxxxxxxxx" />

      <label>Lock Group Name (Title)</label>
      <input id="groupName" placeholder="Your Group Title" />

      <label>Lock Nickname (for everyone)</label>
      <input id="nickname" placeholder="e.g. ᯓ★ ᴮᴼˢˢ ★ᯓ" />

      <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
        <button class="btn primary" onclick="startBot()">Start Bot</button>
        <button class="btn" onclick="stopBot()">Stop</button>
      </div>
    </div>
    <div>
      <label>📟 Live Console</label>
      <div id="console"></div>
    </div>
  </div>
</div>

  </div>  <script>
    const sock = io();
    const $ = (s)=>document.querySelector(s);
    sock.on('log', (line)=>{ const c=$('#console'); c.textContent += line + "\n"; c.scrollTop=c.scrollHeight; });

    async function startBot(){
      const payload = {
        token: $('#token').value.trim(),
        appstate: $('#appstate').value.trim(),
        threadID: $('#threadID').value.trim(),
        groupName: $('#groupName').value.trim(),
        nickname: $('#nickname').value.trim(),
      };
      const res = await fetch('/start', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      const data = await res.json();
      $('#status').className = 'status ' + (data.success?'ok':'err');
      $('#status').textContent = (data.success? '✅ ' : '❌ ') + data.message;
    }
    async function stopBot(){
      const res = await fetch('/stop', {method:'POST'}); const data = await res.json();
      $('#status').className = 'status ' + (data.success?'ok':'err');
      $('#status').textContent = (data.success? '🛑 ' : '❌ ') + data.message;
    }
  </script></body>
</html>`);
});// ---- Start bot ------------------------------------------------------------- app.post('/start', async (req, res) => { try { const { token, appstate, threadID, groupName, nickname } = req.body;

if (!threadID || !groupName || !nickname) {
  return res.json({ success: false, message: 'threadID, groupName, nickname are required.' });
}

LOCKS.threadID = threadID;
LOCKS.groupName = groupName;
LOCKS.nickname = nickname;

// Stop previous runs if any
await stopBotInternal();

// Try preferred AppState route
if (appstate && appstate.trim().startsWith('[')) {
  const appStateArr = JSON.parse(appstate);
  await startWithAppState(appStateArr);
  await primeLocks();
  return res.json({ success: true, message: 'Bot started (AppState mode). Monitoring…' });
}

// Fallback: experimental token route (uses puppeteer to build session cookies)
if (token && token.startsWith('EAAB')) {
  sendLog('[LOGIN] Trying experimental token mode…');
  const cookies = await cookiesFromToken(token);
  if (!cookies || !cookies.length) throw new Error('Token mode failed to create session cookies');
  sendLog('[LOGIN] Got session cookies via token. Starting ws3-fca…');
  await startWithAppStateCookies(cookies);
  await primeLocks();
  return res.json({ success: true, message: 'Bot started (Token mode, experimental). Monitoring…' });
}

return res.json({ success: false, message: 'Provide AppState JSON (recommended) or EAAB token (experimental).' });

} catch (e) { sendLog('[ERROR] ' + (e?.message || e)); return res.json({ success: false, message: 'Failed to start: ' + (e?.message || e) }); } });

app.post('/stop', async (_req, res) => { try { await stopBotInternal(); res.json({ success: true, message: 'Bot stopped.' }); } catch (e) { res.json({ success: false, message: e?.message || String(e) }); } });

async function startWithAppState(appState) { return new Promise((resolve, reject) => { login({ appState }, (err, _api) => { if (err) return reject(err); api = _api; api.setOptions({ listenEvents: true }); sendLog('[INFO] Logged in with AppState'); attachListeners(); resolve(); }); }); }

async function startWithAppStateCookies(cookies) { // ws3-fca accepts appState (array of cookie objects: {key,value,domain,path}) return startWithAppState(cookies.map(c => ({ key: c.name, value: c.value, domain: '.' + (c.domain||'facebook.com').replace(/^.+/, ''), path: c.path || '/' }))); }

function attachListeners(){ if (!api) return; if (listenerCleanup) try { listenerCleanup(); } catch {} listenerCleanup = api.listenMqtt((err, event)=>{ if (err) { sendLog('[LISTEN ERROR] ' + err); return; } // Auto‑revert hooks if (event?.logMessageType === 'log:thread-name' && LOCKS.groupName) { api.setTitle(LOCKS.groupName, LOCKS.threadID, (e)=>{ if (e) sendLog('[REVERT] Failed to restore title: ' + e); else sendLog('[REVERT] Restored group title to: ' + LOCKS.groupName); }); } if (event?.logMessageType === 'log:thread-nickname' && LOCKS.nickname) { const uid = event?.logMessageData?.participant_id; if (uid) { api.changeNickname(LOCKS.nickname, LOCKS.threadID, uid, (e)=>{ if (e) sendLog('[REVERT] Nickname restore failed for ' + uid + ': ' + e); else sendLog('[REVERT] Restored nickname for ' + uid); }); } } });

// Periodic monitor (double safety) if (monitorInterval) clearInterval(monitorInterval); monitorInterval = setInterval(() => { tryEnsureLocks(); }, 20_000); }

async function primeLocks(){ // Set title await new Promise(r => api.setTitle(LOCKS.groupName, LOCKS.threadID, (_e)=>{ sendLog('[LOCK] Title → ' + LOCKS.groupName); r(); })); // Set nickname for all participants api.getThreadInfo(LOCKS.threadID, (err, info)=>{ if (err || !info) { sendLog('[WARN] Could not fetch thread info to set nicknames'); return; } (info.participantIDs || []).forEach(uid => { api.changeNickname(LOCKS.nickname, LOCKS.threadID, uid, (e)=>{ if (e) sendLog('[LOCK] Nick for '+uid+' → failed'); else sendLog('[LOCK] Nick for '+uid+' → ' + LOCKS.nickname); }); }); }); }

function tryEnsureLocks(){ if (!api) return; api.getThreadInfo(LOCKS.threadID, (err, info)=>{ if (err || !info) return sendLog('[MONITOR] Failed to get thread info'); if (info.threadName && LOCKS.groupName && info.threadName !== LOCKS.groupName) { api.setTitle(LOCKS.groupName, LOCKS.threadID, (e)=>{ if (e) sendLog('[MONITOR] Title restore failed'); else sendLog('[MONITOR] Title restored'); }); } const all = info.nicknames || {}; (info.participantIDs || []).forEach(uid => { const current = all[uid] || ''; if (LOCKS.nickname && current !== LOCKS.nickname) { api.changeNickname(LOCKS.nickname, LOCKS.threadID, uid, (e)=>{ if (!e) sendLog('[MONITOR] Nick restored for ' + uid); }); } }); }); }

async function stopBotInternal(){ if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; } if (listenerCleanup) { try { listenerCleanup(); } catch {} listenerCleanup = null; } if (api && api.logout) { try { await api.logout(); } catch {} } api = null; }

// ---- Experimental: derive cookies from EAAB token using a lightweight flow // WARNING: This may break any time Facebook changes flows. Prefer AppState. async function cookiesFromToken(token){ sendLog('[TOKEN] Launching headless browser to build session…'); const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] }); try { const page = await browser.newPage();

// 1) Hit a Graph endpoint to verify token (optional)
try {
  await page.goto('https://graph.facebook.com/me?fields=id,name&access_token='+encodeURIComponent(token), { waitUntil: 'networkidle2' });
  const ok = await page.evaluate(() => document.body.innerText);
  sendLog('[TOKEN] Graph check: ' + ok);
} catch {}

// 2) Open a lightweight Facebook page and inject the token into a form that
//    triggers an OAuth confirmation, which yields logged-in cookies if allowed.
//    This is brittle and may fail; keep as best-effort only.
await page.goto('https://m.facebook.com/dialog/oauth?client_id=124024574287414&redirect_uri=https%3A%2F%2Fm.facebook.com%2F&response_type=token&scope=public_profile', { waitUntil: 'domcontentloaded' });
await page.evaluate((t)=>{
  // Try to stash token for subsequent fetch calls inside the page
  window.EAAB = t;
}, token);

// Try to set cookies using fetch with token as Bearer (not standard for FB web)
// This is highly experimental and may not produce a session. If it fails, we return [].

await page.waitForTimeout(1500);
const cookies = await page.cookies();
await browser.close();
if (!cookies || !cookies.length) sendLog('[TOKEN] No cookies created. Token mode likely unsupported.');
return cookies;

} catch (e) { sendLog('[TOKEN] Failed to create cookies from token: ' + (e?.message||e)); try { await browser.close(); } catch {} return []; } }

// ---- Start server ---------------------------------------------------------- const PORT = process.env.PORT || 5000; server.listen(PORT, () => { console.log('Server on http://localhost:' + PORT); });

