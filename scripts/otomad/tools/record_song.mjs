import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";

const song = process.argv[2] || "samson3";
const repo = "C:\\_own\\git\\_users\\onjmin\\dtm";
const outDir = join(repo, "scratch", "speech-melody");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 40325;

console.log(`Starting recorder for ${song} on port ${port}...`);

// 1. Start server.mjs
const serverProc = spawn("node", ["scripts/speech-melody/rec/server.mjs"], {
  cwd: repo,
  env: {
    ...process.env,
    PORT: String(port),
    SPEECH_OUT_DIR: outDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

serverProc.stdout.on("data", (d) => process.stdout.write(`[SERVER] ${d}`));
serverProc.stderr.on("data", (d) => process.stderr.write(`[SERVER ERR] ${d}`));

await new Promise((r) => setTimeout(r, 1000));

// 2. Launch Chrome
const url = `http://127.0.0.1:${port}/rec.html?song=${encodeURIComponent(song)}&auto=1`;
console.log(`Launching Chrome: ${url}`);

const chromeProc = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--autoplay-policy=no-user-gesture-required",
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=" + join(repo, "scratch", "chrome-profile"),
  url,
], {
  stdio: ["ignore", "pipe", "pipe"],
});

chromeProc.stdout.on("data", (d) => process.stdout.write(`[CHROME] ${d}`));
chromeProc.stderr.on("data", (d) => process.stderr.write(`[CHROME ERR] ${d}`));

// 3. Wait for acc.wav and lead.wav
const accFile = join(outDir, song, "acc.wav");
const leadFile = join(outDir, song, "lead.wav");
const mmlFile = join(outDir, song, "song.mml");

console.log("Waiting for recordings...");
const start = Date.now();
// 64 bars at 126 BPM = ~122 seconds. Recording both stems takes ~244 seconds. Max wait: 400s
while (Date.now() - start < 450000) {
  await new Promise((r) => setTimeout(r, 3000));
  if (existsSync(accFile) && existsSync(leadFile) && existsSync(mmlFile)) {
    const accSize = statSync(accFile).size;
    const leadSize = statSync(leadFile).size;
    if (accSize > 1000000 && leadSize > 1000000) {
      console.log(`Recording complete! acc: ${accSize} bytes, lead: ${leadSize} bytes`);
      break;
    }
  }
}

chromeProc.kill("SIGKILL");
serverProc.kill("SIGKILL");
console.log("Finished recording step.");
process.exit(0);
