/**
 * 원본(english-chat-mvp scripts/build-capacitor.mjs)에서 창구·운영 페이지 처리만 뺀 것.
 *
 * Static export for Capacitor: some route folders cannot or must not be in the
 * bundle the APK carries, so we temporarily move them aside (see
 * MOVED_FOR_BUILD), run `next build` with CAPACITOR_STATIC=1, copy `out/` →
 * `www/`, then put them back for normal web development.
 *
 * Run: `npm run build:capacitor` (not `npm run build` — Vercel uses `build` for server + API routes.)
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
/**
 * Route folders the APK must not carry, moved aside for the build.
 *
 * `api` is here because Next cannot export route handlers at all. `dev` is here
 * for a different reason: it exports perfectly well, which is the problem — a
 * static export takes every page it finds, so scratch pages meant for `next dev`
 * would be built into the bundle and shipped to users unless something takes
 * them out.
 */
const MOVED_FOR_BUILD = [
  { dir: "api", backup: "_capacitor_build_backup_api" },
  { dir: "dev", backup: "_capacitor_build_backup_dev" },
].map(({ dir, backup }) => ({
  name: dir,
  from: path.join(root, "src", "app", dir),
  to: path.join(root, "src", backup),
}));
const outDir = path.join(root, "out");
const wwwDir = path.join(root, "www");
const nextDir = path.join(root, ".next");
const tsconfigPath = path.join(root, "tsconfig.json");

process.chdir(root);

/**
 * Play only enforces versionCode, so nothing ever complained when package.json and
 * the Android versionName drifted apart — they were four minor versions out by 2.36.
 * Checked before anything is moved or deleted, so a mismatch costs nothing to fix.
 */
function assertVersionsAgree() {
  const pkgVersion =
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version ?? "";
  const gradlePath = path.join(root, "android", "app", "build.gradle");
  const versionName = readFileSync(gradlePath, "utf8").match(
    /versionName\s+"([^"]+)"/,
  )?.[1];
  if (!versionName) {
    console.error(`Could not read versionName from ${gradlePath}.`);
    process.exit(1);
  }
  const majorMinor = (value) => value.split(".").slice(0, 2).join(".");
  if (majorMinor(pkgVersion) !== majorMinor(versionName)) {
    console.error(
      `Version mismatch: package.json is ${pkgVersion}, android versionName is ${versionName}.\n` +
        "Bump both. android/app/build.gradle also needs a versionCode above the last Play upload.",
    );
    process.exit(1);
  }
}

// android/ 폴더는 `npx cap add android` 뒤에 생긴다 — 있을 때만 버전을 맞춰 본다.
if (existsSync(path.join(root, "android", "app", "build.gradle"))) assertVersionsAgree();

// Drop stale generated types that still reference `src/app/api/*` before we move that folder.
rmSync(nextDir, { recursive: true, force: true });
rmSync(path.join(nextDir, "dev"), { recursive: true, force: true });

for (const { to } of MOVED_FOR_BUILD) {
  if (existsSync(to)) {
    console.error(
      `Found stale ${path.relative(root, to)} — remove it manually, then retry.`,
    );
    process.exit(1);
  }
}

rmSync(wwwDir, { recursive: true, force: true });

function moveDir(from, to) {
  // Prefer copy+remove over rename — rename often hits EPERM on Windows locks.
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
}

const moved = [];
for (const entry of MOVED_FOR_BUILD) {
  if (!existsSync(entry.from)) continue;
  moveDir(entry.from, entry.to);
  moved.push(entry);
}

const tsconfigRaw = readFileSync(tsconfigPath, "utf8");
const tsconfig = JSON.parse(tsconfigRaw);
if (Array.isArray(tsconfig.include)) {
  tsconfig.include = tsconfig.include.filter(
    (entry) => !String(entry).includes(".next/dev"),
  );
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
}

function restoreMoved() {
  for (const { from, to } of moved) {
    if (!existsSync(to)) continue;
    if (existsSync(from)) {
      rmSync(from, { recursive: true, force: true });
    }
    moveDir(to, from);
  }
}

function restoreTsconfig() {
  writeFileSync(tsconfigPath, tsconfigRaw);
}

// Ctrl+C kills this process before `finally` runs, which used to leave src/app/api
// moved aside and the PC repo looking like every route was deleted (2026-10-18).
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    restoreTsconfig();
    restoreMoved();
    process.exit(130);
  });
}

let buildFailed = false;
try {
  execSync("npx next build", {
    stdio: "inherit",
    env: { ...process.env, CAPACITOR_STATIC: "1" },
  });
} catch {
  buildFailed = true;
} finally {
  restoreTsconfig();
  restoreMoved();
}

if (buildFailed) {
  process.exit(1);
}

if (!existsSync(outDir)) {
  console.error("Expected out/ after next build (static export).");
  process.exit(1);
}

for (const { name } of MOVED_FOR_BUILD) {
  if (!existsSync(path.join(outDir, name))) continue;
  console.error(
    `out/${name}/ exists after the build — it was meant to be left out of the bundle.`,
  );
  process.exit(1);
}

cpSync(outDir, wwwDir, { recursive: true });

/**
 * Which version this bundle is, written where the Android build can read it.
 *
 * Gradle takes versionName from build.gradle and packages whatever happens to
 * be sitting in android/app/src/main/assets/public, and those two have no
 * reason to agree: the assets are only ever refreshed by `npx cap sync`. Run
 * gradle without it and the release is a new number wrapped around an old app,
 * which is silent — nothing in the build, the store or the app says so.
 *
 * It was not caught for five releases. 2.52, 2.53 and 2.54 all shipped a bundle
 * built on the 19th; a learner on "2.54" was running three weeks of code they
 * had never received, and the only visible symptom was an update banner for a
 * version they already had.
 *
 * So the bundle says what it is, and app/build.gradle refuses to build a
 * release around one that disagrees.
 */
const appVersion = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
writeFileSync(path.join(wwwDir, "build-version.txt"), appVersion + "\n");
console.log(`Static web bundle copied to www/ (from out/), version ${appVersion}.`);
