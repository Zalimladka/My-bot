/**
 * Simplified & Optimized Facebook Group & Nickname Lock Bot with Puppeteer
 * Based on original script with ws3-fca and 10min fixed cycle
 * Features:
 * - 10min fixed cycle for nickname and group name changes
 * - 3hr rest for 30min
 * - Nickname lock (nlock) and group name lock (gclock)
 * - Group health monitoring for unhealthy threads
 * - Exponential reconnect with backoff
 * - Appstate backup every 2hr and 6hr with timestamp
 * - Advanced logging to bot.log with colors
 * - Anti-blocking with error-based throttling
 * - Puppeteer for login recovery
 * - Proxy support via .env
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const ws3 = require("ws3-fca");
const loginLib = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
require("dotenv").config();

// ANSI color codes for logging
const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m" };

// Logging function
function log(type, ...args) {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const logMsg = `${type === "ERROR" ? C.red : type === "WARN" ? C.yellow : C.green}[BOT] [${timestamp}]${C.reset} ${args.join(" ")}`;
  console.log(logMsg);
  fsp.appendFile(logFile, `${timestamp} - ${args.join(" ")}\n`).catch(() => {});
}

// Configuration constants
const BOSS_UID = process.env.BOSS_UID || "YOUR_UID";
const DEFAULT_NICKNAME = process.env.DEFAULT_NICKNAME || "Bot";
const DATA_DIR = process.env.DATA_DIR || __dirname;
const appStatePath = path.join(DATA_DIR, "appstate.json");
const dataFile = path.join(DATA_DIR, "groupData.json");
const logFile = path.join(DATA_DIR, "bot.log");
const PROXY = process.env.PROXY || null;
const FB_USERNAME = process.env.FB_USERNAME || "";
const FB_PASSWORD = process.env.FB_PASSWORD || "";

const CYCLE_INTERVAL = 10 * 60 * 1000; // 10min fixed cycle
const REST_INTERVAL = 3 * 60 * 60 * 1000; // 3hr
const REST_DURATION = 30 * 60 * 1000; // 30min
const GROUP_DELAY = 3000; // 3s delay between groups
const APPSTATE_BACKUP_INTERVAL = 2 * 60 * 60 * 1000; // 2hr
const LONG_BACKUP_INTERVAL = 6 * 60 * 60 * 1000; // 6hr
const NICKNAME_CHANGE_LIMIT = 10;
const NICKNAME_COOLDOWN = 60 * 60 * 1000; // 1hr
const MEMBER_CHANGE_SILENCE_DURATION = 20 * 1000;
const MAX_RETRIES = 7;

let api = null;
let groupLocks = {};
let groupHealth = {};
let memberChangeSilence = {};
let lastEventLog = {};
let shuttingDown = false;
let errorCount = 0;
let cycleCount = 0;

// Sleep utility
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Generate appstate with Puppeteer
async function generateAppStateWithPuppeteer() {
  let browser;
  try {
    if (!FB_USERNAME || !FB_PASSWORD) {
      throw new Error("FB_USERNAME or FB_PASSWORD not set in .env");
    }
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || null,
      args: PROXY ? [`--proxy-server=${PROXY}`, "--no-sandbox", "--disable-setuid-sandbox"] : ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto("https://facebook.com", { waitUntil: "networkidle2" });
    await sleep(2000 + Math.random() * 1000); // Random delay
    await page.type("#email", FB_USERNAME, { delay: 100 });
    await page.type("#pass", FB_PASSWORD, { delay: 100 });
    await page.click("[type=submit]");
    await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
    const cookies = await page.cookies();
    const appState = cookies.map(cookie => ({
      key: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      secure: cookie.secure,
    }));
    await fsp.writeFile(appStatePath, JSON.stringify(appState, null, 2));
    log("INFO", "New appstate.json generated with Puppeteer");
    return appState;
  } catch (e) {
    log("ERROR", `Puppeteer login failed: ${e.message || e}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// Ensure groupData.json exists
async function ensureDataFile() {
  try {
    await fsp.access(dataFile);
  } catch {
    await fsp.writeFile(dataFile, JSON.stringify({}, null, 2));
  }
}

// Load group locks
async function loadLocks() {
  try {
    await ensureDataFile();
    const txt = await fsp.readFile(dataFile, "utf8");
    groupLocks = JSON.parse(txt || "{}");
    for (const threadID in groupLocks) {
      if (!groupLocks[threadID].nick) groupLocks[threadID].nick = DEFAULT_NICKNAME;
      if (!groupLocks[threadID].original) groupLocks[threadID].original = {};
      if (!groupLocks[threadID].count) groupLocks[threadID].count = 0;
      if (groupLocks[threadID].enabled === undefined) groupLocks[threadID].enabled = false;
      if (groupLocks[threadID].nlock === undefined) groupLocks[threadID].nlock = false;
      if (groupLocks[threadID].cooldown === undefined) groupLocks[threadID].cooldown = false;
      if (groupLocks[threadID].groupName && !groupLocks[threadID].groupNames) {
        groupLocks[threadID].groupNames = [groupLocks[threadID].groupName];
        delete groupLocks[threadID].groupName;
      }
      if (!groupLocks[threadID].groupNames || groupLocks[threadID].groupNames.length === 0) {
        groupLocks[threadID].groupNames = ["Default Group Name"];
      }
      if (groupLocks[threadID].gclock === undefined) groupLocks[threadID].gclock = false;
    }
    await saveLocks();
  } catch {
    groupLocks = {};
  }
}

// Save group locks
async function saveLocks() {
  try {
    const tmp = `${dataFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(groupLocks, null, 2));
    await fsp.rename(tmp, dataFile);
  } catch {}
}

// Load appstate
async function loadAppState() {
  try {
    const txt = await fsp.readFile(appStatePath, "utf8");
    const appState = JSON.parse(txt);
    if (!Array.isArray(appState)) throw new Error("Invalid appstate.json: must be an array");
    return appState;
  } catch (e) {
    log("ERROR", `Cannot load appstate.json: ${e.message || e}`);
    return null;
  }
}

// Backup appstate
async function backupAppState() {
  try {
    if (!api) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(DATA_DIR, `appstate_backup_${timestamp}.json`);
    const appState = api.getAppState();
    await fsp.writeFile(backupPath, JSON.stringify(appState, null, 2));
    log("INFO", `Appstate backup saved to ${backupPath}`);
  } catch (e) {
    log("ERROR", `Appstate backup failed: ${e.message || e}`);
  }
}

// Get thread info safely
async function safeGetThreadInfo(apiObj, threadID, maxRetries = MAX_RETRIES) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const info = await new Promise((resolve, reject) => {
        apiObj.getThreadInfo(threadID, (err, res) => (err ? reject(err) : resolve(res)));
      });
      if (!info || typeof info !== "object") throw new Error("Invalid thread info");
      groupHealth[threadID] = { lastCheck: Date.now(), status: "healthy" };
      return {
        threadName: info.threadName || "",
        participantIDs: (info.participantIDs || []).filter((id) => id),
        nicknames: info.nicknames || {},
        userInfo: Array.isArray(info.userInfo) ? info.userInfo.filter((u) => u && u.id) : [],
      };
    } catch (e) {
      retries++;
      groupHealth[threadID] = { lastCheck: Date.now(), status: "unhealthy", error: e.message || e };
      log("ERROR", `[DEBUG] Failed to get thread info for ${threadID}, retry ${retries}/${maxRetries}: ${e.message || e}`);
      if (retries === maxRetries) return null;
      await sleep(5000 * retries);
    }
  }
}

// Change group title
async function changeThreadTitle(apiObj, threadID, title, maxRetries = MAX_RETRIES) {
  const group = groupLocks[threadID];
  const selectedTitle = title || group.groupNames[Math.floor(Math.random() * group.groupNames.length)];
  let retries = 0;
  while (retries < maxRetries) {
    try {
      await new Promise((resolve, reject) => {
        apiObj.setTitle(selectedTitle, threadID, (err) => (err ? reject(err) : resolve()));
      });
      log("INFO", `[SUCCESS] Changed ${threadID} to "${selectedTitle}"`);
      groupHealth[threadID].status = "healthy";
      return;
    } catch (e) {
      retries++;
      groupHealth[threadID].status = "unhealthy";
      log("ERROR", `[ERROR] Title change failed for ${threadID}, retry ${retries}/${maxRetries}: ${e.message || e}`);
      if (retries === maxRetries) throw e;
      await sleep(5000 * retries);
    }
  }
}

// Change nickname
async function changeNickname(apiObj, threadID, nickname) {
  try {
    await new Promise((resolve, reject) => {
      apiObj.changeNickname(nickname, threadID, BOSS_UID, (err) => (err ? reject(err) : resolve()));
    });
    log("INFO", `Nickname for ${threadID} set to "${nickname}"`);
  } catch (e) {
    log("ERROR", `Failed to set nickname for ${threadID}: ${e.message || e}`);
  }
}

// Cycle through groups
async function cycleGroups() {
  const threadIDs = Object.keys(groupLocks).filter((t) => groupLocks[t].enabled);
  if (threadIDs.length === 0) {
    log("INFO", "No groups found in groupData.json");
    return;
  }

  for (const threadID of threadIDs) {
    if (shuttingDown) break;
    const group = groupLocks[threadID];
    if (!group.enabled) continue;

    // Change nickname
    await changeNickname(api, threadID, group.nick || DEFAULT_NICKNAME);
    await sleep(GROUP_DELAY);

    // Change group name
    await changeThreadTitle(api, threadID);
    await sleep(GROUP_DELAY);
  }
}

// Initialize group check loop
async function initCheckLoop(apiObj) {
  try {
    const threadIDs = Object.keys(groupLocks);
    for (const threadID of threadIDs) {
      const group = groupLocks[threadID];
      if (!group || !group.enabled) continue;
      try {
        const threadInfo = await safeGetThreadInfo(apiObj, threadID);
        if (!threadInfo) {
          log("ERROR", `[ERROR] Failed to load thread info for ${threadID}`);
          continue;
        }
        log("INFO", `[CHECK] Monitoring ${threadID} - Current name: "${threadInfo.threadName}"`);
        const botNick = group.original[BOSS_UID] || group.nick || DEFAULT_NICKNAME;
        if (group.nlock && threadInfo.nicknames[BOSS_UID] !== botNick) {
          try {
            await new Promise((resolve, reject) => {
              apiObj.changeNickname(botNick, threadID, BOSS_UID, (err) => (err ? reject(err) : resolve()));
            });
            log("INFO", `Bot nickname set to ${botNick} in ${threadID}`);
            await sleep(GROUP_DELAY);
          } catch (e) {
            log("ERROR", `[ERROR] Nickname set failed for ${threadID}: ${e.message || e}`);
          }
        }
        if (group.nlock) {
          for (const uid of Object.keys(group.original)) {
            if (uid === BOSS_UID) continue;
            const desired = group.original[uid];
            if (!desired) continue;
            const current = threadInfo.nicknames[uid] || null;
            if (current !== desired) {
              try {
                await new Promise((resolve, reject) => {
                  apiObj.changeNickname(desired, threadID, uid, (err) => (err ? reject(err) : resolve()));
                });
                log("INFO", `Nickname for ${uid} set to ${desired} in ${threadID}`);
                group.count = (group.count || 0) + 1;
                await saveLocks();
                await sleep(GROUP_DELAY);
                if (group.count >= NICKNAME_CHANGE_LIMIT) {
                  group.cooldown = true;
                  setTimeout(() => {
                    group.cooldown = false;
                    group.count = 0;
                    saveLocks();
                  }, NICKNAME_COOLDOWN);
                }
              } catch (e) {
                log("ERROR", `[ERROR] Nickname set failed for ${uid} in ${threadID}: ${e.message || e}`);
              }
            }
          }
        }
        if (group.gclock && !group.groupNames.includes(threadInfo.threadName)) {
          try {
            await changeThreadTitle(apiObj, threadID);
            log("INFO", `[SUCCESS] Initialized ${threadID} with random name`);
          } catch (e) {
            log("ERROR", `[ERROR] Failed to initialize group name for ${threadID}: ${e.message || e}`);
          }
        }
      } catch (e) {
        log("ERROR", `[ERROR] Init check failed for ${threadID}: ${e.message || e}`);
      }
      await sleep(10000);
    }
  } catch (e) {
    log("ERROR", `[ERROR] Init check loop failed: ${e.message || e}`);
  }
}

// Main bot logic
let loginAttempts = 0;
async function loginAndRun() {
  while (!shuttingDown) {
    try {
      let appState = await loadAppState();
      if (!appState) {
        log("INFO", "Appstate invalid, attempting Puppeteer login...");
        appState = await generateAppStateWithPuppeteer();
        if (!appState) throw new Error("Puppeteer login failed");
      }
      log("INFO", `Attempt login (attempt ${++loginAttempts})`);
      const loginOptions = PROXY ? { appState, proxy: PROXY } : { appState };
      api = await new Promise((resolve, reject) => {
        loginLib(loginOptions, (err, a) => (err ? reject(err) : resolve(a)));
      });
      api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true });
      log("INFO", `Logged in as: ${api.getCurrentUserID ? api.getCurrentUserID() : "(unknown)"}`);
      errorCount = 0;

      await loadLocks();

      // Periodic backups
      setInterval(backupAppState, APPSTATE_BACKUP_INTERVAL);
      setInterval(backupAppState, LONG_BACKUP_INTERVAL);

      // Group cycle loop
      async function runCycleLoop() {
        while (!shuttingDown) {
          log("INFO", `Starting cycle ${++cycleCount}, next in 10min`);
          await cycleGroups();
          if (cycleCount % 18 === 0) { // Approx every 3hr (18 * 10min)
            log("INFO", "Resting for 30min...");
            await sleep(REST_DURATION);
          }
          if (errorCount > 5) {
            log("WARN", `High error count (${errorCount}), pausing for 1min`);
            await sleep(60 * 1000);
            errorCount = 0;
          }
          await sleep(CYCLE_INTERVAL);
        }
      }
      runCycleLoop();

      // Periodic group checks
      setInterval(() => initCheckLoop(api), 10 * 60 * 1000);

      // MQTT event listener for nickname lock
      api.listenMqtt(async (err, event) => {
        if (err) {
          log("ERROR", `[ERROR] MQTT error: ${err.message || err}`);
          return;
        }
        try {
          const threadID = event.threadID;
          if (!groupLocks[threadID] || !groupLocks[threadID].enabled) return;
          const eventKey = `${event.logMessageType}_${threadID}_${event.logMessageData?.participant_id || event.logMessageData?.name || ""}`;
          const now = Date.now();

          if (lastEventLog[eventKey] && (now - lastEventLog[eventKey]) < 10000) return;
          lastEventLog[eventKey] = now;

          if (event.logMessageType === "log:user-nickname") {
            const group = groupLocks[threadID];
            if (!group || !group.enabled || group.cooldown || !group.nlock) return;

            const uid = event.logMessageData?.participant_id;
            const currentNick = event.logMessageData?.nickname;
            const lockedNick = group.original[uid];

            if (lockedNick && currentNick !== lockedNick && uid !== BOSS_UID) {
              memberChangeSilence[threadID] = Date.now() + MEMBER_CHANGE_SILENCE_DURATION;
              try {
                await sleep(MEMBER_CHANGE_SILENCE_DURATION);
                await new Promise((resolve, reject) => {
                  api.changeNickname(lockedNick, threadID, uid, (err) => (err ? reject(err) : resolve()));
                });
                group.count = (group.count || 0) + 1;
                log("INFO", `🎭 [NICKLOCK] Reverted ${uid} in ${threadID} to "${lockedNick}"`);
                if (group.count >= NICKNAME_CHANGE_LIMIT) {
                  group.cooldown = true;
                  setTimeout(() => {
                    group.cooldown = false;
                    group.count = 0;
                    saveLocks();
                  }, NICKNAME_COOLDOWN);
                }
                await saveLocks();
                await sleep(GROUP_DELAY);
              } catch (e) {
                log("ERROR", `[ERROR] Nickname revert failed for ${uid} in ${threadID}: ${e.message || e}`);
              } finally {
                if (memberChangeSilence[threadID] && Date.now() >= memberChangeSilence[threadID]) {
                  delete memberChangeSilence[threadID];
                }
              }
            }
          }

          if (event.type === "event" && (event.logMessageType === "log:subscribe" || event.logMessageType === "log:thread-created")) {
            const g = groupLocks[event.threadID];
            if (g && g.enabled && g.nlock) {
              try {
                const threadInfo = await safeGetThreadInfo(api, event.threadID);
                if (!threadInfo) return;
                g.original = g.original || {};
                for (const u of threadInfo.userInfo || []) {
                  if (u.id === BOSS_UID || !g.original[u.id]) continue;
                  try {
                    await new Promise((resolve, reject) => {
                      api.changeNickname(g.original[u.id], event.threadID, u.id, (err) => (err ? reject(err) : resolve()));
                    });
                    log("INFO", `Nickname for ${u.id} set to ${g.original[u.id]} in ${event.threadID}`);
                    g.count = (g.count || 0) + 1;
                    await saveLocks();
                    await sleep(GROUP_DELAY);
                  } catch (e) {
                    log("ERROR", `[ERROR] Nickname set failed for ${u.id} in ${event.threadID}: ${e.message || e}`);
                  }
                }
                await saveLocks();
              } catch (e) {
                log("ERROR", `[ERROR] Event handling failed for ${event.threadID}: ${e.message || e}`);
              }
            }
          }
        } catch (e) {
          log("ERROR", `[ERROR] MQTT event error: ${e.message || e}`);
          if ((e && e.message) === "FORCE_RECONNECT") throw e;
        }
      });

      loginAttempts = 0;
      break;
    } catch (e) {
      log("ERROR", `[ERROR] Login failed: ${e.message || e}, retrying in ${Math.min(900, Math.pow(2, loginAttempts) * 30)}s`);
      await sleep(Math.min(900, Math.pow(2, loginAttempts) * 30) * 1000);
    }
  }
}

// Start the bot
loginAndRun().catch((e) => {
  log("ERROR", `Fatal error: ${e.message || e}`);
  process.exit(1);
});

// Error handling
process.on("uncaughtException", (err) => {
  log("ERROR", `[ERROR] Uncaught exception: ${err.message || err}, restarting in 30s`);
  setTimeout(() => loginAndRun(), 30000);
});

process.on("unhandledRejection", (reason) => {
  log("ERROR", `[ERROR] Unhandled rejection: ${reason.message || reason}, restarting in 30s`);
  setTimeout(() => loginAndRun(), 30000);
});

// Graceful shutdown
async function gracefulExit() {
  shuttingDown = true;
  try {
    if (api && api.getAppState) await fsp.writeFile(appStatePath, JSON.stringify(api.getAppState(), null, 2));
  } catch {}
  try {
    await saveLocks();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", gracefulExit);
process.on("SIGTERM", gracefulExit);
