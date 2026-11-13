// Runs a real PostgreSQL server without Docker, using the `embedded-postgres`
// binaries. Data persists in ./.data/postgres. Keep this terminal open while
// developing; press Ctrl+C to stop the server.
//
//   npm run db:local        start (first run initialises the cluster)
//   npm run db:local:stop   stop a server left running (e.g. terminal closed)
//   npm run db:setup        in another terminal: apply migrations + seed

import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const databaseDir = join(root, ".data", "postgres");
const USER = "longitude";
const PASSWORD = "longitude";
const DATABASE = "longitude";
// 5433 avoids clashing with any other Postgres already on the default 5432.
const PORT = Number(process.env.PGPORT ?? 5433);
const URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;

async function pgCtl(...args) {
  const platform = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform];
  const { pg_ctl } = await import(`@embedded-postgres/${platform}-${process.arch}`);
  return spawnSync(pg_ctl, [...args, "-D", databaseDir], { encoding: "utf8" });
}

if (process.argv.includes("--stop")) {
  if (!existsSync(join(databaseDir, "postmaster.pid"))) {
    console.log("[db] no local Postgres is running");
    process.exit(0);
  }
  const result = await pgCtl("stop", "-m", "fast");
  console.log(result.status === 0 ? "[db] stopped" : `[db] ${result.stderr || result.stdout}`);
  process.exit(result.status ?? 0);
}

if (existsSync(join(databaseDir, "postmaster.pid"))) {
  const status = await pgCtl("status");
  if (status.status === 0) {
    console.log(`[db] Postgres is already running → ${URL}`);
    console.log("[db] stop it with `npm run db:local:stop`");
    process.exit(0);
  }
}

const pg = new EmbeddedPostgres({
  databaseDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  // Force UTF-8: on Windows initdb otherwise inherits the WIN1252 code page,
  // which cannot store names like "Sensō-ji" or "Sacré-Cœur".
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

const firstRun = !existsSync(join(databaseDir, "PG_VERSION"));
if (firstRun) {
  console.log("[db] initialising a new Postgres cluster in .data/postgres …");
  await pg.initialise();
}

try {
  await pg.start();
} catch (error) {
  console.error(`[db] could not start Postgres on port ${PORT}: ${error?.message ?? error}`);
  console.error("[db] is another Postgres (e.g. Docker) already using this port? Set PGPORT to use a different one.");
  process.exit(1);
}

try {
  await pg.createDatabase(DATABASE);
  console.log(`[db] created database "${DATABASE}"`);
} catch {
  // Already exists — fine.
}

console.log(`[db] Postgres is running → ${URL}`);
if (firstRun) console.log("[db] next: run `npm run db:setup` in another terminal to migrate + seed");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\n[db] stopping Postgres …");
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the process alive.
setInterval(() => {}, 1 << 30);
