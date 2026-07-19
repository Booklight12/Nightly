import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/have/nightly", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>午夜值守<\/title>/i);
  assert.match(html, /午夜值守/);
  assert.match(html, /安心模式/);
  assert.match(html, /猎杀欲望/);
  assert.match(html, /开始值守/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the gameplay systems in the shipped client", async () => {
  const [page, layout, packageJson, globals, manifestSource, nginx, installScript] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../deploy/nightly.nginx.conf", import.meta.url), "utf8"),
    readFile(new URL("../deploy/install.sh", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.match(page, /const MAP_CONNECTIONS/);
  assert.match(page, /markerEnd="url\(#route-arrow\)"/);
  assert.match(page, /safeModeRef\.current/);
  assert.match(page, /const AGGRESSION_PRESETS/);
  assert.match(page, /const DEFENSE_GUIDES/);
  assert.match(page, /防守档案/);
  assert.match(page, /停止操作 5-10 秒/);
  assert.match(page, /min="0"/);
  assert.match(page, /max="20"/);
  assert.match(page, /aggressionRef\.current\[id\]/);
  assert.match(page, /const updateAllAggression/);
  assert.match(page, /\(\?:Digit\|Numpad\)\(\[1-9\]\)/);
  assert.match(page, /cameraOpen && cameraShortcut !== null/);
  assert.match(page, /key === "w"/);
  assert.match(page, /aria-keyshortcuts=\{side === "left" \? "A" : "D"\}/);
  assert.match(page, /aria-keyshortcuts="W"/);
  assert.match(page, /camera-key/);
  assert.match(page, /const IDLE_BATTERY_DRAIN_PER_SECOND = 5 \/ NIGHT_SECONDS/);
  assert.match(page, /type BatteryPreset = 1 \| 1\.5 \| 2 \| "custom"/);
  assert.match(page, /标准 100%：整夜待机仅风扇消耗 5% 电量/);
  assert.match(page, /setBattery\(batteryCapacity\)/);
  assert.match(page, /battery \/ batteryCapacity/);
  assert.match(page, /min="0\.5"/);
  assert.match(page, /max="10"/);
  assert.match(page, /type EnemyId = MascotId \| "glitch"/);
  assert.match(page, /const SCREEN_ATTACK_DURATION_MS = 10000/);
  assert.match(page, /const SCREEN_DEFENSE_TOGGLES = 6/);
  assert.match(page, /glitch: \{ name: "失真偶", label: "屏幕寄生体" \}/);
  assert.match(page, /function getScreenAttackCooldown/);
  assert.match(page, /Math\.random\(\) \* 6000/);
  assert.match(page, /phase !== "playing" \|\| safeMode/);
  assert.match(page, /screenAttackRef\.current \? baseUsage \* 2 : baseUsage/);
  assert.match(page, /next\.toggles >= SCREEN_DEFENSE_TOGGLES/);
  assert.match(page, /screenCooldownRef\.current = Date\.now\(\) \+ getScreenAttackCooldown/);
  assert.match(page, /失真偶攻击/);
  assert.match(page, /className="glitch-face"/);
  assert.match(page, /攻击期间耗电翻倍/);
  assert.match(page, /const \[deathCause, setDeathCause\]/);
  assert.match(page, /finish\("lost", id\)/);
  assert.match(page, /finish\("lost", "glitch"\)/);
  assert.match(page, /finish\("lost", "hush"\)/);
  assert.match(page, /死于/);
  assert.match(page, /MASCOTS\[deathCause\]\.name/);
  assert.match(page, /createStereoPanner\(\)/);
  assert.match(page, /spatialOutput\.pan\.value/);
  assert.match(page, /noiseSource\.loop = true/);
  assert.match(page, /noiseHighpass\.type = "highpass"/);
  assert.match(page, /noiseLowpass\.type = "lowpass"/);
  assert.match(page, /fanPulse\.frequency\.value = 7\.4/);
  assert.match(page, /playSfx\("door", side === "left" \? -0\.88 : 0\.88\)/);
  assert.match(page, /nightly-threat-radar/);
  assert.match(page, /role="switch"/);
  assert.match(page, /threatRadarEnabled && threatNotices\.length > 0/);
  assert.match(page, /key === "c" && computerOn/);
  assert.match(page, /if \(!next\) setCameraOpen\(false\)/);
  assert.match(page, /disabled=\{!computerOn \|\| \(battery <= 0 && !safeMode\)\}/);
  assert.match(page, /电脑已关闭，无法打开监控器/);
  assert.match(page, /\/Android\/i/);
  assert.match(page, /requestAndroidLandscape/);
  assert.match(page, /orientation-gate/);
  assert.match(page, /lock\?\.\("landscape"\)/);
  assert.match(page, /setShowLandscapeAction/);
  assert.match(page, /}, 5000\)/);
  assert.match(page, /全屏横向/);
  assert.match(page, /同时调整所有怪物猎杀欲望/);
  assert.match(page, /同时降低所有怪物猎杀欲望/);
  assert.match(page, /同时提高所有怪物猎杀欲望/);
  assert.match(page, /所有怪物猎杀欲望设为 0/);
  assert.match(page, /所有怪物猎杀欲望设为 20/);
  assert.match(page, /getDefenseCooldown/);
  assert.match(page, /cooldownsRef\.current\[id\]/);
  assert.match(page, /next\[id\] = 0/);
  assert.match(page, /lowpass\.type = "lowpass"/);
  assert.match(page, /fan-rotor/);
  assert.match(page, /motion="threat"/);
  assert.match(page, /motion="attack"/);
  assert.match(page, /const ROUTE_POSES/);
  assert.match(page, /pose=\{ROUTE_POSES\[id\]\[positions\[id\]\]\}/);
  assert.match(page, /office-light-rig/);
  assert.match(page, /camera-light-rig/);
  assert.match(page, /function RoomDressing/);
  assert.match(page, /<RoomDressing camera=\{camera\}/);
  assert.match(page, /corridor-scene/);
  assert.match(page, /door-threat-unlit/);
  assert.match(page, /windowAttackers/);
  assert.match(page, /window-lamp/);
  assert.match(page, /window-exterior/);
  assert.match(page, /window-stalker/);
  assert.match(page, /getWindowApproachDuration/);
  assert.match(page, /windowApproachProgress\[id\]/);
  assert.match(page, /windowApproaching\[id\]/);
  assert.match(page, /isWindowAttacker\(id\) && windowApproaching\[id\]/);
  assert.match(page, /location: "windowApproach"/);
  assert.match(page, /<CameraScene camera=\{selectedCamera\} positions=\{positions\} windowApproaching=\{windowApproaching\}/);
  assert.match(page, /}, 100\)/);
  assert.match(page, /aggression-overlay/);
  assert.doesNotMatch(page, /scene-prop prop-a/);
  assert.match(page, /"paused"/);
  assert.match(page, /const pauseGame/);
  assert.match(page, /phaseRef\.current !== "playing"/);
  assert.match(page, /const controlsLocked = windowLocked && !safeMode/);
  assert.match(page, /threat-radar/);
  assert.match(page, /关闭.*闸门，撞击后再开启/);
  assert.match(page, /phase === "playing" \|\| phase === "paused"/);
  assert.match(page, /setPositions\(\{ \.\.\.INITIAL_POSITIONS \}\)/);
  assert.match(page, /frontWindow/);
  assert.match(page, /gallery/);
  assert.match(page, /workshop/);
  assert.match(page, /atrium/);
  assert.match(page, /curtainDownRef\.current/);
  assert.match(page, /windowLocked && !safeMode/);
  assert.match(page, /triggerForbiddenAction/);
  assert.match(page, /remainingMs:\s*5000 \+ Math\.random\(\) \* 5000/);
  assert.match(page, /return \{ \.\.\.current, hush: 0 \}/);
  assert.match(page, /继续值守/);
  assert.match(page, /退出到标题/);
  assert.match(page, /playSfx/);
  assert.match(page, /monster-pin/);
  assert.match(globals, /\.monster-pin[^}]*pointer-events:\s*none/);
  assert.match(globals, /\.threat-radar/);
  assert.match(globals, /\.defense-guide/);
  assert.match(globals, /--look-x/);
  assert.match(globals, /doorImpact/);
  assert.match(globals, /\.fan-rotor[^}]*animation:\s*fanSpin/);
  assert.match(globals, /servoHeadIdle/);
  assert.match(globals, /threatHead/);
  assert.match(globals, /cameraLightSweep/);
  for (const room of ["stage", "dining", "arcade", "storage", "westHall", "eastHall", "gallery", "workshop", "atrium"]) {
    assert.match(globals, new RegExp(`\\.dressing-${room}`));
  }
  assert.match(globals, /\.pose-away/);
  assert.match(globals, /\.pose-left/);
  assert.match(globals, /\.pose-right/);
  assert.match(globals, /windowLampFlicker/);
  assert.match(globals, /\.door-threat-unlit/);
  assert.match(page, /if \(!atWindow && !windowApproaching\[id\]\) return \[\]/);
  assert.match(page, /34 - depth \* 41/);
  assert.match(page, /0\.18 \+ depth \* 0\.7/);
  assert.match(globals, /\.window-stalker[^}]*width:\s*152px[^}]*height:\s*270px/);
  assert.match(globals, /\.window-hall-floor/);
  assert.match(globals, /\.window-hall-back/);
  assert.match(globals, /\.hall-floor/);
  assert.match(globals, /\.hall-back/);
  assert.match(globals, /\.window-curtain/);
  assert.match(globals, /\.curtain-control/);
  assert.match(globals, /\.control-key/);
  assert.match(globals, /\.camera-key/);
  assert.match(globals, /\.battery-settings/);
  assert.match(globals, /\.battery-presets/);
  assert.match(globals, /\.glitch-face/);
  assert.match(globals, /\.death-cause/);
  assert.match(globals, /\.glitch-jumpscare-face/);
  assert.match(globals, /@keyframes faceTwitch/);
  assert.match(globals, /\.power-panel\.overload/);
  assert.match(globals, /\.threat-radar-setting/);
  assert.match(globals, /\.setting-switch/);
  assert.match(globals, /\.camera-toggle:disabled/);
  assert.match(globals, /orientation:\s*landscape/);
  assert.match(globals, /pointer:\s*coarse/);
  assert.equal(manifest.orientation, "landscape");
  assert.equal(manifest.start_url, "/have/nightly");
  assert.match(nginx, /alias \/opt\/nightly\/assets\//);
  assert.match(nginx, /Cache-Control "no-store" always/);
  assert.match(installScript, /current\/dist\/client\/assets/);
  assert.match(installScript, /cp -a dist\/client\/assets\/\./);
  assert.doesNotMatch(globals, /\.doorway-lit\s*\{[^}]*radial-gradient/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
