/**
 * Facebook Group & Nickname Lock Bot (Render Worker Version)
 * Features:
 * - Uses pre-generated appstate.json
 * - Proxy support via .env
 * - Background worker friendly (no web ports)
 * - Fixed 10-min cycles, nickname & group lock
 * - Safe error handling
 */

const fs = require("fs").promises;
const path = require("path");
const ws3 = require("ws3-fca");
const loginLib = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
require("dotenv").config();

// Logging
const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m" };
const DATA_DIR = process.env.DATA_DIR || __dirname;
const logFile = path.join(DATA_DIR, "bot.log");
function log(type, ...args) {
  const timestamp = new Date().toISOString().replace('T',' ').split('.')[0];
  const msg = `${type==="ERROR"?C.red:type==="WARN"?C.yellow:C.green}[BOT] [${timestamp}]${C.reset} ${args.join(" ")}`;
  console.log(msg);
  fs.appendFile(logFile, `${timestamp} - ${args.join(" ")}\n`).catch(()=>{});
}

// Config
const BOSS_UID = process.env.BOSS_UID || "YOUR_UID";
const DEFAULT_NICKNAME = process.env.DEFAULT_NICKNAME || "Bot";
const appStatePath = path.join(DATA_DIR, "appstate.json");
const dataFile = path.join(DATA_DIR, "groupData.json");
const PROXY = process.env.PROXY || null;

// Intervals
const CYCLE_INTERVAL = 10*60*1000;
const GROUP_DELAY = 3000;
const NICKNAME_CHANGE_LIMIT = 10;
const NICKNAME_COOLDOWN = 60*60*1000;

let api = null;
let groupLocks = {};
let groupHealth = {};
let shuttingDown = false;

// Sleep util
const sleep = ms => new Promise(r=>setTimeout(r, ms));

// Load appstate.json
async function loadAppState() {
  try {
    const txt = await fs.readFile(appStatePath, "utf8");
    const appState = JSON.parse(txt);
    if (!Array.isArray(appState)) throw new Error("Invalid appstate.json");
    return appState;
  } catch(e) {
    log("ERROR","Cannot load appstate.json:", e.message||e);
    return null;
  }
}

// Load group data
async function loadLocks() {
  try {
    await fs.access(dataFile).catch(()=>fs.writeFile(dataFile, "{}"));
    const txt = await fs.readFile(dataFile, "utf8");
    groupLocks = JSON.parse(txt||"{}");
    for(const t in groupLocks){
      const g = groupLocks[t];
      g.nick = g.nick || DEFAULT_NICKNAME;
      g.groupNames = g.groupNames && g.groupNames.length>0 ? g.groupNames : ["Default Group Name"];
      g.enabled = g.enabled||false;
      g.nlock = g.nlock||false;
      g.gclock = g.gclock||false;
      g.count = g.count||0;
      g.cooldown = g.cooldown||false;
      g.original = g.original||{};
    }
  } catch(e){ groupLocks = {}; }
}

// Save group locks
async function saveLocks(){ 
  try { await fs.writeFile(dataFile, JSON.stringify(groupLocks,null,2)); } catch{} 
}

// Change nickname
async function changeNickname(threadID, nickname){
  try{
    await new Promise((res,rej)=>api.changeNickname(nickname, threadID, BOSS_UID, err=>err?rej(err):res()));
    log("INFO", `Nickname for ${threadID} set to "${nickname}"`);
  }catch(e){ log("ERROR", `Nickname change failed for ${threadID}: ${e.message||e}`); }
}

// Change group title
async function changeThreadTitle(threadID, title){
  const g = groupLocks[threadID];
  const selected = title || g.groupNames[Math.floor(Math.random()*g.groupNames.length)];
  try{
    await new Promise((res,rej)=>api.setTitle(selected, threadID, err=>err?rej(err):res()));
    log("INFO", `[SUCCESS] Changed ${threadID} to "${selected}"`);
    groupHealth[threadID] = groupHealth[threadID]||{};
    groupHealth[threadID].status = "healthy";
  }catch(e){
    log("ERROR", `Title change failed for ${threadID}: ${e.message||e}`);
    groupHealth[threadID] = groupHealth[threadID]||{};
    groupHealth[threadID].status = "unhealthy";
  }
}

// Cycle groups
async function cycleGroups(){
  const threads = Object.keys(groupLocks).filter(t=>groupLocks[t].enabled);
  for(const t of threads){
    if(shuttingDown) break;
    const g = groupLocks[t];
    await changeNickname(t, g.nick);
    await sleep(GROUP_DELAY);
    if(g.gclock) await changeThreadTitle(t);
    await sleep(GROUP_DELAY);
  }
}

// Login & run
let loginAttempts=0;
async function loginAndRun(){
  while(!shuttingDown){
    try{
      const appState = await loadAppState();
      if(!appState) throw new Error("appstate.json missing or invalid");

      const loginOpts = PROXY ? { appState, proxy: PROXY } : { appState };
      api = await new Promise((res,rej)=>loginLib(loginOpts,(err,a)=>err?rej(err):res(a)));
      api.setOptions({listenEvents:true,selfListen:true,updatePresence:true});
      log("INFO","Logged in as:", api.getCurrentUserID?api.getCurrentUserID():"unknown");

      await loadLocks();

      // Main cycle loop
      while(!shuttingDown){
        await cycleGroups();
        await sleep(CYCLE_INTERVAL);
      }

      break;
    }catch(e){
      loginAttempts++;
      const wait = Math.min(900, Math.pow(2,loginAttempts)*30);
      log("ERROR","Login failed:", e.message||e, `retrying in ${wait}s`);
      await sleep(wait*1000);
    }
  }
}

// Graceful shutdown
async function gracefulExit(){ 
  shuttingDown=true;
  try{ if(api && api.getAppState) await fs.writeFile(appStatePath, JSON.stringify(api.getAppState(),null,2)); }catch{}
  try{ await saveLocks(); }catch{}
  process.exit(0);
}

process.on("SIGINT", gracefulExit);
process.on("SIGTERM", gracefulExit);
process.on("uncaughtException", async e=>{ log("ERROR","Uncaught:",e.message||e); await sleep(30000); loginAndRun(); });
process.on("unhandledRejection", async e=>{ log("ERROR","Unhandled rejection:",e.message||e); await sleep(30000); loginAndRun(); });

// Start bot
loginAndRun();
