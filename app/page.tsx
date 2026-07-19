"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GamePhase = "intro" | "playing" | "paused" | "won" | "lost";
type Side = "left" | "right";
type MascotId = "morrow" | "brass" | "lark" | "veil" | "hush";
type EnemyId = MascotId | "glitch";
type Positions = Record<MascotId, number>;
type Aggression = Record<EnemyId, number>;
type MascotMotion = "idle" | "threat" | "attack" | "static";
type MascotPose = "front" | "left" | "right" | "away" | "low";
type WindowAttackerId = "veil" | "hush";
type WindowApproaching = Record<WindowAttackerId, boolean>;
type WindowApproach = { progress: number; durationMs: number; lastTick: number };
type ScreenAttack = { remainingMs: number; toggles: number; lastTick: number };
type ThreatNotice = { id: string; tone: "watch" | "danger" | "lock"; title: string; detail: string };
type Sfx = "start" | "ui" | "camera" | "door" | "light" | "thump" | "win" | "jumpscare";
type AudioEngine = {
  ctx: AudioContext;
  master: GainNode;
  ambient: AudioScheduledSourceNode[];
  ambientGain?: GainNode;
};
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};
type BatteryPreset = 1 | 1.5 | 2 | "custom";

const NIGHT_SECONDS = 180;
const STANDARD_BATTERY_CAPACITY = 100;
const IDLE_BATTERY_DRAIN_PER_SECOND = 5 / NIGHT_SECONDS;
const SCREEN_ATTACK_DURATION_MS = 10000;
const SCREEN_DEFENSE_TOGGLES = 6;

const CAMERAS = [
  { id: "stage", code: "CAM 01", name: "主舞台", x: 50, y: 7 },
  { id: "dining", code: "CAM 02", name: "宴会厅", x: 22, y: 25 },
  { id: "arcade", code: "CAM 03", name: "游戏区", x: 78, y: 25 },
  { id: "storage", code: "CAM 04", name: "储藏间", x: 10, y: 48 },
  { id: "westHall", code: "CAM 05", name: "西走廊", x: 25, y: 68 },
  { id: "eastHall", code: "CAM 06", name: "东走廊", x: 75, y: 68 },
  { id: "gallery", code: "CAM 07", name: "肖像展廊", x: 50, y: 27 },
  { id: "workshop", code: "CAM 08", name: "维修间", x: 90, y: 48 },
  { id: "atrium", code: "CAM 09", name: "玻璃前厅", x: 50, y: 52 },
] as const;

type CameraId = (typeof CAMERAS)[number]["id"];

function getCameraShortcut(event: KeyboardEvent) {
  const codeMatch = event.code.match(/^(?:Digit|Numpad)([1-9])$/);
  const digit = codeMatch?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null);
  return digit ? Number(digit) : null;
}

const PATHS: Record<MascotId, string[]> = {
  morrow: ["stage", "dining", "storage", "westHall", "leftDoor"],
  brass: ["stage", "arcade", "eastHall", "rightDoor"],
  lark: ["stage", "dining", "arcade", "eastHall", "rightDoor"],
  veil: ["stage", "gallery", "atrium", "frontWindow"],
  hush: ["workshop", "atrium", "frontWindow"],
};

const ROUTE_POSES: Record<MascotId, MascotPose[]> = {
  morrow: ["left", "away", "right", "low", "front"],
  brass: ["right", "away", "left", "front"],
  lark: ["away", "left", "right", "low", "front"],
  veil: ["low", "right", "away", "right"],
  hush: ["away", "left", "left"],
};

const MAP_POINTS: Record<string, { x: number; y: number }> = {
  ...Object.fromEntries(CAMERAS.map((camera) => [camera.id, { x: camera.x, y: camera.y }])),
  leftDoor: { x: 36, y: 84 },
  frontWindow: { x: 50, y: 84 },
  rightDoor: { x: 64, y: 84 },
  office: { x: 50, y: 96 },
};

const MAP_CONNECTIONS = [
  ["stage", "dining"], ["stage", "arcade"], ["stage", "gallery"],
  ["dining", "storage"], ["dining", "arcade"],
  ["storage", "westHall"], ["arcade", "eastHall"], ["arcade", "workshop"],
  ["gallery", "atrium"], ["workshop", "atrium"],
  ["westHall", "leftDoor"], ["eastHall", "rightDoor"],
  ["atrium", "frontWindow"],
  ["leftDoor", "office"], ["frontWindow", "office"], ["rightDoor", "office"],
] as const;

const MASCOTS: Record<EnemyId, { name: string; label: string }> = {
  morrow: { name: "暮先生", label: "月面领班" },
  brass: { name: "黄铜兔", label: "失谐乐手" },
  lark: { name: "青羽雀", label: "报幕员" },
  veil: { name: "帷幕夫人", label: "窥窗访客" },
  hush: { name: "静默侍者", label: "动作封锁者" },
  glitch: { name: "失真偶", label: "屏幕寄生体" },
};
const ENEMY_IDS: EnemyId[] = ["morrow", "brass", "lark", "veil", "hush", "glitch"];

const DEFENSE_GUIDES: Record<EnemyId, { route: string; cue: string; defense: string }> = {
  morrow: { route: "主舞台 -> 西侧路线 -> 左门", cue: "CAM 05 出现或左廊传来近距动静", defense: "关左闸门；听到撞击声后再开启" },
  brass: { route: "主舞台 -> 游戏区 -> 右门", cue: "CAM 06 出现或右廊亮起剪影", defense: "关右闸门；撞击后会退回舞台" },
  lark: { route: "宴会厅 -> 游戏区 -> 右门", cue: "右侧路线会连续出现运动信号", defense: "与黄铜兔相同，使用右闸门阻挡" },
  veil: { route: "肖像展廊 -> 玻璃前厅 -> 前窗", cue: "离开 CAM 09 后，前窗会出现接近轮廓", defense: "抵达前窗时放下帘幕，撞击后即可升起" },
  hush: { route: "维修间 -> 玻璃前厅 -> 前窗", cue: "离开 CAM 09 后接近；抵达时触发动作封锁", defense: "立刻停止操作 5-10 秒；暂停安全，其他操作致命" },
  glitch: { route: "保安室桌面电脑", cue: "NO SIGNAL 突然出现抽搐面孔，持续 10 秒", defense: "在倒计时结束前切换电脑电源 6 次；成功后进入冷却" },
};

const AGGRESSION_PRESETS: Aggression[] = [
  { morrow: 3, brass: 2, lark: 1, veil: 2, hush: 1, glitch: 2 },
  { morrow: 8, brass: 7, lark: 6, veil: 7, hush: 5, glitch: 6 },
  { morrow: 17, brass: 15, lark: 14, veil: 16, hush: 13, glitch: 15 },
];

const INITIAL_POSITIONS: Positions = { morrow: 0, brass: 0, lark: 0, veil: 0, hush: 0 };
const INITIAL_COOLDOWNS: Record<MascotId, number> = { morrow: 0, brass: 0, lark: 0, veil: 0, hush: 0 };
const WINDOW_ATTACKER_IDS: WindowAttackerId[] = ["veil", "hush"];
const INITIAL_APPROACH_PROGRESS: Record<WindowAttackerId, number> = { veil: 0, hush: 0 };
const INITIAL_WINDOW_APPROACHING: WindowApproaching = { veil: false, hush: false };

function isWindowAttacker(id: MascotId): id is WindowAttackerId {
  return id === "veil" || id === "hush";
}

function formatClock(remaining: number) {
  const hour = Math.min(6, Math.floor((NIGHT_SECONDS - remaining) / 30));
  return `${hour === 0 ? 12 : hour} AM`;
}

function getDefenseCooldown(desire: number) {
  return 4500 + (20 - desire) * 450;
}

function getWindowApproachDuration(desire: number) {
  return 10000 - desire * 200;
}

function getScreenAttackCooldown(desire: number) {
  return 9000 + (20 - desire) * 650 + Math.random() * 6000;
}

function Mascot({ id, small = false, motion = "idle", pose = "front" }: { id: MascotId; small?: boolean; motion?: MascotMotion; pose?: MascotPose }) {
  return (
    <div className={`mascot mascot-${id} motion-${motion} pose-${pose} ${small ? "mascot-small" : ""}`} aria-label={MASCOTS[id].name}>
      <div className="mascot-rig">
        <div className="mascot-ears"><i /><i /></div>
        <div className="mascot-head">
          <span className="eye eye-left" />
          <span className="eye eye-right" />
          <span className="mascot-mouth" />
        </div>
        <div className="mascot-neck" />
        <div className="mascot-body"><span className="chest-mark" /></div>
        <div className="mascot-arm arm-left" />
        <div className="mascot-arm arm-right" />
      </div>
    </div>
  );
}

function RoomDressing({ camera }: { camera: CameraId }) {
  switch (camera) {
    case "stage":
      return (
        <div className="room-dressing dressing-stage" aria-hidden="true">
          <span className="stage-curtain curtain-left" /><span className="stage-curtain curtain-right" />
          <span className="stage-valance" /><span className="stage-sign" />
          <span className="stage-platform" /><i /><i /><i /><i /><i />
        </div>
      );
    case "dining":
      return (
        <div className="room-dressing dressing-dining" aria-hidden="true">
          <span className="dining-bunting" /><span className="dining-counter" />
          <span className="dining-table table-a" /><span className="dining-table table-b" /><span className="dining-table table-c" />
        </div>
      );
    case "arcade":
      return (
        <div className="room-dressing dressing-arcade" aria-hidden="true">
          <span className="arcade-sign" /><span className="arcade-cabinet cabinet-a" /><span className="arcade-cabinet cabinet-b" />
          <span className="arcade-cabinet cabinet-c" /><span className="arcade-cabinet cabinet-d" /><span className="arcade-carpet" />
        </div>
      );
    case "storage":
      return (
        <div className="room-dressing dressing-storage" aria-hidden="true">
          <span className="storage-shelf shelf-a" /><span className="storage-shelf shelf-b" />
          <span className="storage-crates" /><span className="storage-cart" /><span className="storage-lamp" />
        </div>
      );
    case "westHall":
    case "eastHall":
      return (
        <div className={`room-dressing dressing-hall dressing-${camera}`} aria-hidden="true">
          <span className="camera-hall-door" /><span className="camera-hall-pipes" />
          <span className="camera-hall-poster" /><span className="camera-hall-floor" /><span className="camera-hall-light" />
        </div>
      );
    case "gallery":
      return (
        <div className="room-dressing dressing-gallery" aria-hidden="true">
          <span className="gallery-rail" /><span className="gallery-frame frame-a" /><span className="gallery-frame frame-b" />
          <span className="gallery-frame frame-c" /><span className="gallery-frame frame-d" /><span className="gallery-bench" />
        </div>
      );
    case "workshop":
      return (
        <div className="room-dressing dressing-workshop" aria-hidden="true">
          <span className="workshop-pegboard" /><span className="workshop-tools" /><span className="workshop-bench" />
          <span className="workshop-pipe" /><span className="workshop-parts" /><span className="workshop-lamp" />
        </div>
      );
    case "atrium":
      return (
        <div className="room-dressing dressing-atrium" aria-hidden="true">
          <span className="atrium-glass" /><span className="atrium-door" /><span className="atrium-bench bench-left" />
          <span className="atrium-bench bench-right" /><span className="atrium-planter" /><span className="atrium-reflection" />
        </div>
      );
  }
}

function CameraScene({ camera, positions, windowApproaching }: { camera: CameraId; positions: Positions; windowApproaching: WindowApproaching }) {
  const occupants = (Object.keys(positions) as MascotId[]).filter(
    (id) => PATHS[id][positions[id]] === camera && !(isWindowAttacker(id) && windowApproaching[id]),
  );

  return (
    <div className={`camera-scene scene-${camera}`}>
      <div className="camera-light-rig"><i /><i /><span /></div>
      <div className="scene-depth" />
      <RoomDressing camera={camera} />
      <div className="scene-label">{CAMERAS.find((cam) => cam.id === camera)?.name}</div>
      <div className={`occupants occupants-${occupants.length}`}>
        {occupants.map((id) => <Mascot key={id} id={id} pose={ROUTE_POSES[id][positions[id]]} />)}
      </div>
      {occupants.length === 0 && <div className="empty-feed">NO MOTION DETECTED</div>}
    </div>
  );
}

function SideConsole({
  side,
  doorClosed,
  lightOn,
  threat,
  onDoor,
  onLight,
}: {
  side: Side;
  doorClosed: boolean;
  lightOn: boolean;
  threat?: MascotId;
  onDoor: () => void;
  onLight: () => void;
}) {
  return (
    <aside className={`side-console side-${side}`}>
      <div className={`doorway ${doorClosed ? "doorway-closed" : ""} ${lightOn ? "doorway-lit" : ""}`}>
        <div className="corridor-scene" aria-hidden="true">
          <div className="hall-back"><i /><span /></div>
          <div className="hall-wall hall-wall-left" />
          <div className="hall-wall hall-wall-right" />
          <div className="hall-ceiling"><i /><i /><i /></div>
          <div className="hall-pipes"><i /><i /></div>
          <div className="hall-poster"><i /><span /></div>
          <div className="hall-floor" />
          <div className="hall-light-cone" />
        </div>
        <div className="door-slat" />
        {threat && <div className={`door-threat ${lightOn ? "door-threat-lit" : "door-threat-unlit"}`}><Mascot id={threat} small motion="threat" pose={side === "left" ? "right" : "left"} /></div>}
      </div>
      <div className="switch-stack">
        <span className="side-code">{side === "left" ? "L" : "R"}</span>
        <button
          type="button"
          className={`switch-button door-button ${doorClosed ? "active danger" : ""}`}
          onClick={onDoor}
          aria-pressed={doorClosed}
          aria-label={`${side === "left" ? "左" : "右"}侧闸门`}
          aria-keyshortcuts={side === "left" ? "A" : "D"}
        >
          <span className="switch-icon door-icon" />
          <b>闸门</b>
          <kbd className="control-key">{side === "left" ? "A" : "D"}</kbd>
        </button>
        <button
          type="button"
          className={`switch-button light-button ${lightOn ? "active" : ""}`}
          onClick={onLight}
          aria-pressed={lightOn}
          aria-label={`${side === "left" ? "左" : "右"}侧照明`}
        >
          <span className="switch-icon light-icon" />
          <b>照明</b>
        </button>
      </div>
    </aside>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<GamePhase>("intro");
  const [difficulty, setDifficulty] = useState(1);
  const [remaining, setRemaining] = useState(NIGHT_SECONDS);
  const [battery, setBattery] = useState(100);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<CameraId>("stage");
  const [doors, setDoors] = useState<Record<Side, boolean>>({ left: false, right: false });
  const [lights, setLights] = useState<Record<Side, boolean>>({ left: false, right: false });
  const [positions, setPositions] = useState<Positions>({ ...INITIAL_POSITIONS });
  const [curtainDown, setCurtainDown] = useState(false);
  const [computerOn, setComputerOn] = useState(true);
  const [screenAttack, setScreenAttack] = useState<ScreenAttack | null>(null);
  const [windowApproachProgress, setWindowApproachProgress] = useState<Record<WindowAttackerId, number>>({ ...INITIAL_APPROACH_PROGRESS });
  const [windowApproaching, setWindowApproaching] = useState<WindowApproaching>({ ...INITIAL_WINDOW_APPROACHING });
  const [staticBurst, setStaticBurst] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [safeMode, setSafeMode] = useState(false);
  const [threatRadarEnabled, setThreatRadarEnabled] = useState(true);
  const [batteryPreset, setBatteryPreset] = useState<BatteryPreset>(1);
  const [customBatteryMultiplier, setCustomBatteryMultiplier] = useState(3);
  const [aggressionMenuOpen, setAggressionMenuOpen] = useState(false);
  const [aggression, setAggression] = useState<Aggression>({ ...AGGRESSION_PRESETS[1] });
  const [best, setBest] = useState(0);
  const [androidDevice, setAndroidDevice] = useState(false);
  const [portraitMode, setPortraitMode] = useState(false);
  const [showLandscapeAction, setShowLandscapeAction] = useState(false);
  const batteryMultiplier = batteryPreset === "custom" ? customBatteryMultiplier : batteryPreset;
  const batteryCapacity = Math.round(STANDARD_BATTERY_CAPACITY * batteryMultiplier);
  const audioRef = useRef<AudioEngine | null>(null);
  const phaseRef = useRef<GamePhase>("intro");
  const remainingRef = useRef(NIGHT_SECONDS);
  const doorsRef = useRef<Record<Side, boolean>>({ left: false, right: false });
  const bestRef = useRef(best);
  const soundOnRef = useRef(true);
  const safeModeRef = useRef(false);
  const curtainDownRef = useRef(false);
  const aggressionRef = useRef<Aggression>({ ...AGGRESSION_PRESETS[1] });
  const cooldownsRef = useRef<Record<MascotId, number>>({ ...INITIAL_COOLDOWNS });
  const hushEncounterRef = useRef<{ remainingMs: number; lastTick: number } | null>(null);
  const windowApproachRef = useRef<Record<WindowAttackerId, WindowApproach | null>>({ veil: null, hush: null });
  const batteryCapacityRef = useRef(batteryCapacity);
  const screenAttackRef = useRef<ScreenAttack | null>(null);
  const screenCooldownRef = useRef(0);

  useEffect(() => {
    const storedBest = Number(window.localStorage.getItem("nightly-best") || 0);
    if (!Number.isFinite(storedBest)) return;
    const frame = window.requestAnimationFrame(() => setBest(storedBest));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const storedPreference = window.localStorage.getItem("nightly-threat-radar");
    if (storedPreference !== null) setThreatRadarEnabled(storedPreference !== "off");
  }, []);
  useEffect(() => {
    const orientation = window.matchMedia("(orientation: portrait)");
    const android = /Android/i.test(window.navigator.userAgent);
    const syncOrientation = () => {
      setAndroidDevice(android);
      setPortraitMode(orientation.matches);
    };
    syncOrientation();
    orientation.addEventListener("change", syncOrientation);
    window.addEventListener("resize", syncOrientation);
    return () => {
      orientation.removeEventListener("change", syncOrientation);
      window.removeEventListener("resize", syncOrientation);
    };
  }, []);
  useEffect(() => {
    if (!androidDevice || !portraitMode) {
      setShowLandscapeAction(false);
      return;
    }
    setShowLandscapeAction(false);
    const actionTimer = window.setTimeout(() => {
      if (window.matchMedia("(orientation: portrait)").matches) setShowLandscapeAction(true);
    }, 5000);
    return () => window.clearTimeout(actionTimer);
  }, [androidDevice, portraitMode]);
  useEffect(() => { remainingRef.current = remaining; }, [remaining]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { doorsRef.current = doors; }, [doors]);
  useEffect(() => { bestRef.current = best; }, [best]);
  useEffect(() => { safeModeRef.current = safeMode; }, [safeMode]);
  useEffect(() => { curtainDownRef.current = curtainDown; }, [curtainDown]);
  useEffect(() => { aggressionRef.current = aggression; }, [aggression]);
  useEffect(() => { batteryCapacityRef.current = batteryCapacity; }, [batteryCapacity]);
  useEffect(() => {
    if (!aggressionMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAggressionMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [aggressionMenuOpen]);
  useEffect(() => {
    soundOnRef.current = soundOn;
    const engine = audioRef.current;
    if (engine) engine.master.gain.setTargetAtTime(soundOn ? 0.52 : 0.0001, engine.ctx.currentTime, 0.03);
  }, [soundOn]);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) {
      void audioRef.current.ctx.resume();
      return audioRef.current;
    }
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtor();
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    master.gain.value = soundOnRef.current ? 0.52 : 0.0001;
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.22;
    master.connect(compressor).connect(ctx.destination);
    audioRef.current = { ctx, master, ambient: [] };
    return audioRef.current;
  }, []);

  const playSfx = useCallback((kind: Sfx, pan = 0) => {
    if (!soundOnRef.current) return;
    const { ctx, master } = ensureAudio();
    const now = ctx.currentTime;
    const spatialOutput = ctx.createStereoPanner();
    spatialOutput.pan.value = Math.max(-1, Math.min(1, pan));
    spatialOutput.connect(master);
    const tone = (frequency: number, duration: number, type: OscillatorType, level: number, delay = 0, endFrequency?: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + delay + duration);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(level, now + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
      oscillator.connect(gain).connect(spatialOutput);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + duration + 0.02);
    };
    const noise = (duration: number, level: number, filterFrequency: number, delay = 0) => {
      const frames = Math.ceil(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < frames; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        data[index] = last;
      }
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const lowpass = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = filterFrequency;
      filter.Q.value = 0.5;
      lowpass.type = "lowpass";
      lowpass.frequency.value = Math.min(4200, Math.max(700, filterFrequency * 1.45));
      lowpass.Q.value = 0.4;
      gain.gain.setValueAtTime(level * 0.42, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
      source.connect(filter).connect(lowpass).connect(gain).connect(spatialOutput);
      source.start(now + delay);
    };

    if (kind === "ui") {
      tone(410, 0.055, "square", 0.035); tone(760, 0.04, "sine", 0.025, 0.025);
    } else if (kind === "camera") {
      noise(0.16, 0.17, 2800); tone(178, 0.09, "square", 0.045, 0, 92);
    } else if (kind === "door") {
      noise(0.32, 0.14, 420); tone(84, 0.38, "sawtooth", 0.11, 0, 42); tone(133, 0.25, "square", 0.045, 0.04, 76);
    } else if (kind === "light") {
      noise(0.09, 0.1, 4200); tone(920, 0.05, "square", 0.045); tone(1260, 0.04, "sine", 0.025, 0.035);
    } else if (kind === "thump") {
      noise(0.2, 0.18, 150); tone(61, 0.32, "sine", 0.16, 0, 34); tone(93, 0.18, "sawtooth", 0.055);
    } else if (kind === "start") {
      noise(0.28, 0.08, 1600); [146, 184, 219].forEach((frequency, index) => tone(frequency, 0.24, "triangle", 0.045, index * 0.08));
    } else if (kind === "win") {
      [392, 494, 587, 784].forEach((frequency, index) => tone(frequency, 0.48, "sine", 0.065, index * 0.12));
    } else {
      noise(0.75, 0.32, 1700); noise(0.45, 0.22, 180, 0.03); tone(53, 0.8, "sawtooth", 0.2, 0, 27); tone(1380, 0.42, "square", 0.08, 0.04, 170);
    }
    window.setTimeout(() => spatialOutput.disconnect(), 1600);
  }, [ensureAudio]);

  const stopAmbient = useCallback(() => {
    const engine = audioRef.current;
    if (!engine) return;
    engine.ambient.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    engine.ambient = [];
    engine.ambientGain?.disconnect();
    engine.ambientGain = undefined;
  }, []);

  const startAmbient = useCallback(() => {
    if (!soundOnRef.current || phaseRef.current !== "playing") return;
    const engine = ensureAudio();
    if (engine.ambient.length > 0) return;
    const { ctx, master } = engine;
    const ambientGain = ctx.createGain();
    const hum = ctx.createOscillator();
    const undertone = ctx.createOscillator();
    const tremolo = ctx.createOscillator();
    const tremoloGain = ctx.createGain();
    const fanPulse = ctx.createOscillator();
    const fanPulseGain = ctx.createGain();
    const humGain = ctx.createGain();
    const undertoneGain = ctx.createGain();
    const noiseSource = ctx.createBufferSource();
    const noiseHighpass = ctx.createBiquadFilter();
    const noiseLowpass = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const noisePanner = ctx.createStereoPanner();
    const noiseFrames = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, noiseFrames, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < noiseFrames; index += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.025) / 1.025;
      noiseData[index] = brown * 3.2;
    }
    ambientGain.gain.value = 1;
    hum.type = "sine"; hum.frequency.value = 50;
    undertone.type = "triangle"; undertone.frequency.value = 25;
    tremolo.type = "sine"; tremolo.frequency.value = 0.37;
    fanPulse.type = "sine"; fanPulse.frequency.value = 7.4;
    humGain.gain.value = 0.009;
    undertoneGain.gain.value = 0.004;
    noiseGain.gain.value = 0.012;
    tremoloGain.gain.value = 0.0025;
    fanPulseGain.gain.value = 0.0035;
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    noiseHighpass.type = "highpass"; noiseHighpass.frequency.value = 70;
    noiseLowpass.type = "lowpass"; noiseLowpass.frequency.value = 1450;
    noiseLowpass.Q.value = 0.7;
    noisePanner.pan.value = -0.12;
    tremolo.connect(tremoloGain).connect(humGain.gain);
    fanPulse.connect(fanPulseGain).connect(noiseGain.gain);
    hum.connect(humGain).connect(ambientGain);
    undertone.connect(undertoneGain).connect(ambientGain);
    noiseSource.connect(noiseHighpass).connect(noiseLowpass).connect(noiseGain).connect(noisePanner).connect(ambientGain);
    ambientGain.connect(master);
    hum.start(); undertone.start(); tremolo.start(); fanPulse.start(); noiseSource.start();
    engine.ambient = [hum, undertone, tremolo, fanPulse, noiseSource];
    engine.ambientGain = ambientGain;
  }, [ensureAudio]);

  useEffect(() => {
    if (soundOn && phase === "playing") startAmbient();
    if (!soundOn) stopAmbient();
  }, [phase, soundOn, startAmbient, stopAmbient]);

  const requestAndroidLandscape = useCallback(async () => {
    if (!androidDevice) return;
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    } catch { /* Fullscreen support varies across Android browsers. */ }
    try {
      await (window.screen.orientation as LockableOrientation).lock?.("landscape");
    } catch { /* Orientation lock may require installed-app or fullscreen mode. */ }
  }, [androidDevice]);

  const resetGame = useCallback(() => {
    void requestAndroidLandscape();
    setRemaining(NIGHT_SECONDS);
    setBattery(batteryCapacity);
    setCameraOpen(false);
    setSelectedCamera("stage");
    setDoors({ left: false, right: false });
    setLights({ left: false, right: false });
    setPositions({ ...INITIAL_POSITIONS });
    setCurtainDown(false);
    setComputerOn(true);
    setScreenAttack(null);
    setWindowApproachProgress({ ...INITIAL_APPROACH_PROGRESS });
    setWindowApproaching({ ...INITIAL_WINDOW_APPROACHING });
    remainingRef.current = NIGHT_SECONDS;
    doorsRef.current = { left: false, right: false };
    cooldownsRef.current = { ...INITIAL_COOLDOWNS };
    hushEncounterRef.current = null;
    windowApproachRef.current = { veil: null, hush: null };
    screenAttackRef.current = null;
    screenCooldownRef.current = safeModeRef.current
      ? Number.POSITIVE_INFINITY
      : Date.now() + getScreenAttackCooldown(aggressionRef.current.glitch);
    setStaticBurst((value) => value + 1);
    phaseRef.current = "playing";
    setPhase("playing");
    playSfx("start");
    window.setTimeout(startAmbient, 180);
  }, [batteryCapacity, playSfx, requestAndroidLandscape, startAmbient]);

  const finish = useCallback((result: "won" | "lost") => {
    if (phaseRef.current !== "playing") return;
    if (result === "lost" && safeModeRef.current) return;
    stopAmbient();
    phaseRef.current = result;
    setPhase(result);
    setCameraOpen(false);
    setLights({ left: false, right: false });
    setScreenAttack(null);
    screenAttackRef.current = null;
    if (result === "won") {
      window.localStorage.setItem("nightly-best", "6");
      setBest(6);
      playSfx("win");
    } else {
      const reached = Math.floor((NIGHT_SECONDS - remainingRef.current) / 30);
      if (reached > bestRef.current) {
        window.localStorage.setItem("nightly-best", String(reached));
        setBest(reached);
      }
      playSfx("jumpscare");
    }
  }, [playSfx, stopAmbient]);

  const pauseGame = useCallback(() => {
    stopAmbient();
    setCameraOpen(false);
    phaseRef.current = "paused";
    setPhase("paused");
    playSfx("ui");
  }, [playSfx, stopAmbient]);

  const resumeGame = useCallback(() => {
    void requestAndroidLandscape();
    phaseRef.current = "playing";
    setPhase("playing");
    playSfx("ui");
    window.setTimeout(startAmbient, 100);
  }, [playSfx, requestAndroidLandscape, startAmbient]);

  const exitToTitle = useCallback(() => {
    stopAmbient();
    setCameraOpen(false);
    setLights({ left: false, right: false });
    setDoors({ left: false, right: false });
    setPositions({ ...INITIAL_POSITIONS });
    setCurtainDown(false);
    setComputerOn(true);
    setScreenAttack(null);
    setWindowApproachProgress({ ...INITIAL_APPROACH_PROGRESS });
    setWindowApproaching({ ...INITIAL_WINDOW_APPROACHING });
    cooldownsRef.current = { ...INITIAL_COOLDOWNS };
    hushEncounterRef.current = null;
    windowApproachRef.current = { veil: null, hush: null };
    screenAttackRef.current = null;
    screenCooldownRef.current = 0;
    phaseRef.current = "intro";
    setPhase("intro");
    playSfx("ui");
  }, [playSfx, stopAmbient]);

  useEffect(() => {
    if (androidDevice && portraitMode && phaseRef.current === "playing") pauseGame();
  }, [androidDevice, pauseGame, portraitMode]);

  useEffect(() => () => stopAmbient(), [stopAmbient]);

  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          window.setTimeout(() => finish("won"), 0);
          return 0;
        }
        return value - 1;
      });
      if (safeModeRef.current) {
        setBattery(batteryCapacityRef.current);
      } else {
        const baseUsage = IDLE_BATTERY_DRAIN_PER_SECOND + (cameraOpen ? 0.22 : 0) + (doors.left ? 0.34 : 0) +
          (doors.right ? 0.34 : 0) + (lights.left ? 0.25 : 0) + (lights.right ? 0.25 : 0) +
          (curtainDown ? 0.3 : 0);
        const usage = screenAttackRef.current ? baseUsage * 2 : baseUsage;
        setBattery((value) => {
          const next = Math.max(0, value - usage);
          if (next === 0) {
            setDoors({ left: false, right: false });
            setLights({ left: false, right: false });
            setCurtainDown(false);
            setCameraOpen(false);
          }
          return next;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cameraOpen, curtainDown, doors, finish, lights, phase]);

  useEffect(() => {
    if (phase !== "playing") return;
    const aiTimer = window.setInterval(() => {
      setPositions((current) => {
        const next = { ...current };
        const elapsedRatio = (NIGHT_SECONDS - remainingRef.current) / NIGHT_SECONDS;
        (Object.keys(next) as MascotId[]).forEach((id) => {
          if (id === "hush" && screenAttackRef.current) return;
          if (Date.now() < cooldownsRef.current[id]) return;
          if (isWindowAttacker(id) && windowApproachRef.current[id]) return;
          const path = PATHS[id];
          const atDestination = next[id] === path.length - 1;
          if (atDestination) {
            const destination = path.at(-1);
            if (id === "hush" && destination === "frontWindow") return;
            if (safeModeRef.current) {
              next[id] = 0;
              cooldownsRef.current[id] = Date.now() + getDefenseCooldown(aggressionRef.current[id]);
              playSfx("thump", 0);
              return;
            }
            if (destination === "frontWindow") {
              if (curtainDownRef.current) {
                next[id] = 0;
                cooldownsRef.current[id] = Date.now() + getDefenseCooldown(aggressionRef.current[id]);
                playSfx("thump", 0);
              } else {
                window.setTimeout(() => finish("lost"), 0);
              }
              return;
            }
            const side: Side = destination === "leftDoor" ? "left" : "right";
            if (doorsRef.current[side]) {
              next[id] = 0;
              cooldownsRef.current[id] = Date.now() + getDefenseCooldown(aggressionRef.current[id]);
              playSfx("thump", side === "left" ? -0.88 : 0.88);
            } else {
              window.setTimeout(() => finish("lost"), 0);
            }
            return;
          }
          const desire = aggressionRef.current[id];
          const moveChance = desire === 0 ? 0 : Math.min(0.92, 0.015 + desire * 0.036 + elapsedRatio * 0.08);
          if (Math.random() < moveChance) {
            if (isWindowAttacker(id) && next[id] === path.length - 2) {
              windowApproachRef.current[id] = {
                progress: 0,
                durationMs: getWindowApproachDuration(desire),
                lastTick: Date.now(),
              };
              window.setTimeout(() => {
                if (!windowApproachRef.current[id]) return;
                setWindowApproachProgress((current) => ({ ...current, [id]: 0 }));
                setWindowApproaching((current) => ({ ...current, [id]: true }));
              }, 0);
            } else {
              next[id] = Math.min(path.length - 1, next[id] + 1);
            }
          }
        });
        return next;
      });
    }, 3000);
    return () => window.clearInterval(aiTimer);
  }, [finish, phase, playSfx]);

  useEffect(() => {
    if (phase !== "playing") return;
    const startedAt = Date.now();
    WINDOW_ATTACKER_IDS.forEach((id) => {
      const approach = windowApproachRef.current[id];
      if (approach) approach.lastTick = startedAt;
    });
    const approachTimer = window.setInterval(() => {
      const now = Date.now();
      const completed: WindowAttackerId[] = [];
      const displayed = { ...INITIAL_APPROACH_PROGRESS };
      let hasActiveApproach = false;
      WINDOW_ATTACKER_IDS.forEach((id) => {
        const approach = windowApproachRef.current[id];
        if (!approach) return;
        hasActiveApproach = true;
        approach.progress = Math.min(1, approach.progress + (now - approach.lastTick) / approach.durationMs);
        approach.lastTick = now;
        displayed[id] = approach.progress;
        if (approach.progress >= 1) completed.push(id);
      });
      if (!hasActiveApproach) return;
      setWindowApproachProgress(displayed);
      if (completed.length === 0) return;
      completed.forEach((id) => { windowApproachRef.current[id] = null; });
      setWindowApproaching((current) => {
        const next = { ...current };
        completed.forEach((id) => { next[id] = false; });
        return next;
      });
      setPositions((current) => {
        const next = { ...current };
        completed.forEach((id) => {
          if (current[id] === PATHS[id].length - 2) next[id] = PATHS[id].length - 1;
        });
        return next;
      });
    }, 100);
    return () => window.clearInterval(approachTimer);
  }, [phase]);

  const windowLocked = PATHS.hush[positions.hush] === "frontWindow";

  useEffect(() => {
    if (!windowLocked) {
      hushEncounterRef.current = null;
      return;
    }
    if (!hushEncounterRef.current) {
      hushEncounterRef.current = {
        remainingMs: 5000 + Math.random() * 5000,
        lastTick: Date.now(),
      };
    }
    if (phase !== "playing") return;
    hushEncounterRef.current.lastTick = Date.now();
    const encounterTimer = window.setInterval(() => {
      const encounter = hushEncounterRef.current;
      if (!encounter) return;
      const now = Date.now();
      encounter.remainingMs -= now - encounter.lastTick;
      encounter.lastTick = now;
      if (encounter.remainingMs > 0) return;
      hushEncounterRef.current = null;
      setPositions((current) => {
        if (PATHS.hush[current.hush] !== "frontWindow") return current;
        cooldownsRef.current.hush = Date.now() + getDefenseCooldown(aggressionRef.current.hush);
        return { ...current, hush: 0 };
      });
      playSfx("thump", 0);
    }, 100);
    return () => window.clearInterval(encounterTimer);
  }, [phase, playSfx, windowLocked]);

  useEffect(() => {
    if (phase !== "playing" || safeMode) return;
    if (screenAttackRef.current) screenAttackRef.current.lastTick = Date.now();
    const screenTimer = window.setInterval(() => {
      const now = Date.now();
      const current = screenAttackRef.current;
      if (current) {
        const next = {
          ...current,
          remainingMs: current.remainingMs - (now - current.lastTick),
          lastTick: now,
        };
        if (next.remainingMs <= 0) {
          screenAttackRef.current = null;
          setScreenAttack(null);
          window.setTimeout(() => finish("lost"), 0);
          return;
        }
        screenAttackRef.current = next;
        setScreenAttack(next);
        return;
      }
      if (now < screenCooldownRef.current || windowLocked || windowApproaching.hush) return;
      const next: ScreenAttack = { remainingMs: SCREEN_ATTACK_DURATION_MS, toggles: 0, lastTick: now };
      screenAttackRef.current = next;
      setScreenAttack(next);
      setComputerOn(true);
      playSfx("camera", -0.45);
    }, 100);
    return () => window.clearInterval(screenTimer);
  }, [finish, phase, playSfx, safeMode, windowApproaching.hush, windowLocked]);

  useEffect(() => {
    if (phase !== "playing" && phase !== "paused") return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (phase === "paused") {
        if (event.key === "Escape" || key === "p") resumeGame();
        return;
      }
      if (key === "p") {
        pauseGame();
        return;
      }
      const cameraShortcut = getCameraShortcut(event);
      if (windowLocked && !safeMode) {
        if (event.key === "Escape") pauseGame();
        else if (key === "c" || key === "a" || key === "d" || key === "w" || cameraShortcut !== null) finish("lost");
        return;
      }
      if (key === "c" && computerOn && (battery > 0 || safeMode)) {
        setCameraOpen((open) => !open);
        setStaticBurst((value) => value + 1);
        playSfx("camera");
      }
      if (event.key.toLowerCase() === "a" && (battery > 0 || safeMode)) {
        setDoors((value) => ({ ...value, left: !value.left }));
        playSfx("door", -0.88);
      }
      if (event.key.toLowerCase() === "d" && (battery > 0 || safeMode)) {
        setDoors((value) => ({ ...value, right: !value.right }));
        playSfx("door", 0.88);
      }
      if (key === "w" && (battery > 0 || safeMode)) {
        setCurtainDown((value) => !value);
        playSfx("door");
      }
      if (cameraOpen && cameraShortcut !== null) {
        const camera = CAMERAS[cameraShortcut - 1];
        if (camera) {
          setSelectedCamera(camera.id);
          setStaticBurst((value) => value + 1);
          playSfx("camera");
        }
      }
      if (event.key === "Escape") {
        if (cameraOpen) setCameraOpen(false);
        else pauseGame();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [battery, cameraOpen, computerOn, finish, pauseGame, phase, playSfx, resumeGame, safeMode, windowLocked]);

  const currentCamera = CAMERAS.find((camera) => camera.id === selectedCamera)!;
  const threatAt = useMemo(() => {
    const result: Partial<Record<Side, MascotId>> = {};
    (Object.keys(positions) as MascotId[]).forEach((id) => {
      const location = PATHS[id][positions[id]];
      if (location === "leftDoor") result.left = id;
      if (location === "rightDoor") result.right = id;
    });
    return result;
  }, [positions]);
  const monsterLocations = useMemo(() => (Object.keys(positions) as MascotId[]).map((id) => {
    if (isWindowAttacker(id) && windowApproaching[id]) {
      const progress = Math.max(0.08, windowApproachProgress[id]);
      const from = MAP_POINTS.atrium;
      const to = MAP_POINTS.frontWindow;
      return {
        id,
        location: "windowApproach",
        point: {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        },
      };
    }
    const location = PATHS[id][positions[id]];
    return { id, location, point: MAP_POINTS[location] };
  }), [positions, windowApproachProgress, windowApproaching]);
  const windowThreat = (Object.keys(positions) as MascotId[]).find((id) => PATHS[id][positions[id]] === "frontWindow");
  const windowAttackers = WINDOW_ATTACKER_IDS.flatMap((id) => {
    const pathLength = PATHS[id].length;
    const atWindow = positions[id] === pathLength - 1;
    if (!atWindow && !windowApproaching[id]) return [];
    return [{
      id,
      progress: atWindow ? 1 : windowApproachProgress[id],
    }];
  });
  const usageBars = 1 + Number(cameraOpen) + Number(doors.left) + Number(doors.right) + Number(lights.left) + Number(lights.right) + Number(curtainDown);
  const batteryLevelPercent = Math.min(100, Math.max(0, (battery / batteryCapacity) * 100));
  const nightProgress = ((NIGHT_SECONDS - remaining) / NIGHT_SECONDS) * 100;
  const dangerActive = (phase === "playing" || phase === "paused") && Boolean(threatAt.left || threatAt.right || windowThreat);
  const controlsLocked = windowLocked && !safeMode;
  const threatNotices = useMemo(() => {
    const notices: ThreatNotice[] = [];
    (Object.keys(positions) as MascotId[]).forEach((id) => {
      const path = PATHS[id];
      const location = path[positions[id]];
      const nextLocation = path[positions[id] + 1];
      if (location === "leftDoor" || location === "rightDoor") {
        const side = location === "leftDoor" ? "左" : "右";
        notices.push({ id, tone: "danger", title: `${MASCOTS[id].name} / ${side}门`, detail: `关闭${side}闸门，撞击后再开启` });
      } else if (nextLocation === "leftDoor" || nextLocation === "rightDoor") {
        const side = nextLocation === "leftDoor" ? "左" : "右";
        notices.push({ id, tone: "watch", title: `${side}走廊活动`, detail: `开灯确认，准备${side}闸门` });
      }
    });
    WINDOW_ATTACKER_IDS.forEach((id) => {
      if (windowApproaching[id]) {
        const percent = Math.max(1, Math.round(windowApproachProgress[id] * 100));
        notices.push({
          id,
          tone: "watch",
          title: `${MASCOTS[id].name} / 前窗接近 ${percent}%`,
          detail: id === "veil" ? "观察轮廓，准备放下帘幕" : "抵达并封锁后停止所有操作",
        });
      }
    });
    if (PATHS.veil[positions.veil] === "frontWindow") {
      notices.push({ id: "veil-window", tone: "danger", title: "帷幕夫人 / 前窗", detail: "立即放下帘幕" });
    }
    if (windowLocked) {
      notices.push({
        id: "hush-window",
        tone: safeMode ? "watch" : "lock",
        title: safeMode ? "静默侍者 / 安心观察" : "静默侍者 / 动作封锁",
        detail: safeMode ? "攻击无效，等待其自行撤离" : "保持不动 5-10 秒；暂停是安全的",
      });
    }
    if (screenAttack && !safeMode) {
      notices.push({
        id: "glitch-screen",
        tone: "danger",
        title: `${MASCOTS.glitch.name} / 电脑入侵 ${Math.ceil(screenAttack.remainingMs / 1000)}s`,
        detail: `切换电源 ${screenAttack.toggles}/${SCREEN_DEFENSE_TOGGLES}；攻击期间耗电翻倍`,
      });
    }
    const priority: Record<ThreatNotice["tone"], number> = { watch: 0, danger: 1, lock: 2 };
    return notices.sort((left, right) => priority[right.tone] - priority[left.tone]).slice(0, 3);
  }, [positions, safeMode, screenAttack, windowApproachProgress, windowApproaching, windowLocked]);

  const triggerForbiddenAction = () => {
    if (windowLocked && !safeMode) {
      finish("lost");
      return true;
    }
    return false;
  };

  const toggleComputer = () => {
    if (triggerForbiddenAction() || (battery <= 0 && !safeMode)) return;
    setComputerOn((value) => {
      const next = !value;
      if (!next) setCameraOpen(false);
      return next;
    });
    playSfx("ui", -0.45);
    if (phaseRef.current !== "playing" || safeModeRef.current) return;
    const current = screenAttackRef.current;
    if (!current) return;
    const next = { ...current, toggles: current.toggles + 1, lastTick: Date.now() };
    if (next.toggles >= SCREEN_DEFENSE_TOGGLES) {
      screenAttackRef.current = null;
      setScreenAttack(null);
      setComputerOn(true);
      screenCooldownRef.current = Date.now() + getScreenAttackCooldown(aggressionRef.current.glitch);
      playSfx("thump", -0.45);
      return;
    }
    screenAttackRef.current = next;
    setScreenAttack(next);
  };

  const selectDifficulty = (level: number) => {
    const preset = AGGRESSION_PRESETS[level];
    setDifficulty(level);
    setAggression({ ...preset });
    aggressionRef.current = { ...preset };
    playSfx("ui");
  };

  const updateAggression = (id: EnemyId, value: number) => {
    const nextValue = Math.max(0, Math.min(20, value));
    setDifficulty(-1);
    setAggression((current) => {
      const next = { ...current, [id]: nextValue };
      aggressionRef.current = next;
      return next;
    });
  };

  const updateAllAggression = (value: number) => {
    const nextValue = Math.max(0, Math.min(20, value));
    const next: Aggression = {
      morrow: nextValue,
      brass: nextValue,
      lark: nextValue,
      veil: nextValue,
      hush: nextValue,
      glitch: nextValue,
    };
    setDifficulty(-1);
    setAggression(next);
    aggressionRef.current = next;
  };

  const toggleDoor = (side: Side) => {
    if (triggerForbiddenAction() || (battery <= 0 && !safeMode)) return;
    setDoors((value) => ({ ...value, [side]: !value[side] }));
    playSfx("door", side === "left" ? -0.88 : 0.88);
  };
  const toggleLight = (side: Side) => {
    if (triggerForbiddenAction() || (battery <= 0 && !safeMode)) return;
    setLights((value) => ({ ...value, [side]: !value[side] }));
    playSfx("light", side === "left" ? -0.92 : 0.92);
  };
  const toggleCurtain = () => {
    if (triggerForbiddenAction() || (battery <= 0 && !safeMode)) return;
    setCurtainDown((value) => !value);
    playSfx("door");
  };
  const pickCamera = (id: CameraId) => {
    if (triggerForbiddenAction()) return;
    setSelectedCamera(id);
    setStaticBurst((value) => value + 1);
    playSfx("camera");
  };

  const aggressionValues = Object.values(aggression);
  const averageAggression = Math.round(aggressionValues.reduce((sum, value) => sum + value, 0) / aggressionValues.length);
  const sharedAggression = aggressionValues.every((value) => value === aggressionValues[0]) ? aggressionValues[0] : averageAggression;
  const aggressionIsMixed = aggressionValues.some((value) => value !== aggressionValues[0]);

  return (
    <main className={`game-shell phase-${phase} ${safeMode ? "safe-mode" : ""} ${dangerActive ? "danger-active" : ""}`}>
      <div className="noise-layer" />
      {androidDevice && portraitMode && (
        <div className="orientation-gate" role="status" aria-live="polite">
          <span className="orientation-device" aria-hidden="true"><i /></span>
          <strong>请横屏继续</strong>
          {showLandscapeAction && (
            <button type="button" className="orientation-action" onClick={() => void requestAndroidLandscape()}>
              全屏横向
            </button>
          )}
        </div>
      )}

      {phase === "intro" && (
        <section className="intro-screen">
          <div className="intro-figure" aria-hidden="true"><Mascot id="morrow" /></div>
          <div className="intro-copy">
            <div className="eyebrow"><span className="live-dot" /> NIGHT SHIFT / 00:00</div>
            <h1>午夜值守</h1>
            <p className="subtitle">废弃的星光乐园仍在营业。今晚，监控室只归你一个人。</p>
            <div className="shift-card">
              <div><span>地点</span><strong>星光家庭乐园</strong></div>
              <div><span>时段</span><strong>12 AM - 6 AM</strong></div>
              <div><span>最高记录</span><strong>{best === 6 ? "已通关" : `${best || 0} AM`}</strong></div>
            </div>
            <div className="setup-grid">
              <div className="mode-column">
                <div className="difficulty-row" role="group" aria-label="难度预设">
                  {[0, 1, 2].map((level) => (
                    <button key={level} type="button" className={difficulty === level ? "selected" : ""} onClick={() => selectDifficulty(level)}>
                      {level === 0 ? "巡查" : level === 1 ? "夜班" : "噩梦"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={safeMode}
                  className={`safe-toggle ${safeMode ? "enabled" : ""}`}
                  onClick={() => { setSafeMode((value) => !value); playSfx("ui"); }}
                >
                  <span className="toggle-track"><i /></span>
                  <span><b>安心模式</b><small>∞ POWER / SAFE SHIFT</small></span>
                </button>
              </div>
              <button type="button" className="aggression-menu-button" onClick={() => { setAggressionMenuOpen(true); playSfx("ui"); }}>
                <span className="aggression-bars"><i /><i /><i /></span>
                <span><b>猎杀欲望</b><small>{difficulty === -1 ? "6 个目标 / 自定义" : `6 个目标 / 平均 ${Math.round(Object.values(aggression).reduce((sum, value) => sum + value, 0) / ENEMY_IDS.length)}`}</small></span>
                <strong>设置</strong>
              </button>
            </div>
            <section className={`battery-settings ${safeMode ? "disabled" : ""}`} aria-labelledby="battery-settings-title">
              <div className="battery-settings-heading">
                <span>
                  <b id="battery-settings-title">电量容量</b>
                  <small>标准 100%：整夜待机仅风扇消耗 5% 电量</small>
                </span>
                <output>{batteryCapacity}%</output>
              </div>
              <div className="battery-settings-controls">
                <div className="battery-presets" role="group" aria-label="电量容量倍数">
                  {([1, 1.5, 2] as const).map((multiplier) => (
                    <button
                      key={multiplier}
                      type="button"
                      className={batteryPreset === multiplier ? "selected" : ""}
                      onClick={() => { setBatteryPreset(multiplier); playSfx("ui"); }}
                      disabled={safeMode}
                    >
                      {multiplier === 1 ? "标准" : `${multiplier}×`}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={batteryPreset === "custom" ? "selected" : ""}
                    onClick={() => { setBatteryPreset("custom"); playSfx("ui"); }}
                    disabled={safeMode}
                  >
                    自定义
                  </button>
                </div>
                <label className={`custom-battery ${batteryPreset === "custom" ? "active" : ""}`}>
                  <span>倍数</span>
                  <input
                    type="number"
                    min="0.5"
                    max="10"
                    step="0.1"
                    value={customBatteryMultiplier}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value)) setCustomBatteryMultiplier(Math.min(10, Math.max(0.5, value)));
                    }}
                    disabled={safeMode || batteryPreset !== "custom"}
                    aria-label="自定义电量倍数"
                  />
                  <b>×</b>
                </label>
              </div>
            </section>
            <button type="button" className="start-button" onClick={resetGame}>
              <span>开始值守</span><i>ENTER</i>
            </button>
          </div>
          {aggressionMenuOpen && (
            <div className="aggression-overlay" role="dialog" aria-modal="true" aria-labelledby="aggression-title">
              <div className="aggression-menu">
                <button type="button" className="menu-close" onClick={() => setAggressionMenuOpen(false)} aria-label="关闭猎杀欲望菜单"><i /></button>
                <span className="menu-code">ANIMATRONIC BEHAVIOR / 0-20</span>
                <div className="aggression-heading">
                  <h2 id="aggression-title">猎杀欲望</h2>
                  <div><span>当前平均</span><strong>{averageAggression}</strong></div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={threatRadarEnabled}
                  className={`threat-radar-setting ${threatRadarEnabled ? "enabled" : ""}`}
                  onClick={() => {
                    setThreatRadarEnabled((current) => {
                      const next = !current;
                      window.localStorage.setItem("nightly-threat-radar", next ? "on" : "off");
                      return next;
                    });
                    playSfx("ui");
                  }}
                >
                  <span><b>威胁栏</b><small>顶部接近警报与防守提示</small></span>
                  <span className="setting-switch" aria-hidden="true"><i /></span>
                </button>
                <section className="aggression-bulk" aria-labelledby="aggression-bulk-title">
                  <div className="aggression-section-title">
                    <div><strong id="aggression-bulk-title">全体控制</strong><span>同步覆盖所有目标</span></div>
                    <div className="aggression-extremes">
                      <button type="button" onClick={() => { updateAllAggression(0); playSfx("ui"); }} aria-label="所有怪物猎杀欲望设为 0">
                        <i className="bulk-min-icon" aria-hidden="true" /><span>全部最小</span><b>0</b>
                      </button>
                      <button type="button" onClick={() => { updateAllAggression(20); playSfx("ui"); }} aria-label="所有怪物猎杀欲望设为 20">
                        <i className="bulk-max-icon" aria-hidden="true" /><span>全部最大</span><b>20</b>
                      </button>
                    </div>
                  </div>
                  <label className="aggression-master-row">
                    <span><b>统一调整</b><small>{aggressionIsMixed ? "当前为混合配置，拖动将统一数值" : "所有目标保持相同数值"}</small></span>
                    <div className="aggression-master-control">
                      <button type="button" onClick={() => { updateAllAggression(sharedAggression - 1); playSfx("ui"); }} aria-label="同时降低所有怪物猎杀欲望"><i aria-hidden="true" /></button>
                      <input
                        type="range"
                        min="0"
                        max="20"
                        step="1"
                        value={sharedAggression}
                        onChange={(event) => updateAllAggression(Number(event.target.value))}
                        onPointerUp={() => playSfx("ui")}
                        aria-label="同时调整所有怪物猎杀欲望"
                      />
                      <button type="button" className="increase" onClick={() => { updateAllAggression(sharedAggression + 1); playSfx("ui"); }} aria-label="同时提高所有怪物猎杀欲望"><i aria-hidden="true" /></button>
                    </div>
                    <output className={aggressionIsMixed ? "mixed" : ""}>{aggressionIsMixed ? `≈${averageAggression}` : sharedAggression}</output>
                  </label>
                </section>
                <div className="aggression-section-title aggression-individual-title">
                  <div><strong>单独调整</strong><span>覆盖某一个目标</span></div>
                </div>
                <div className="aggression-panel">
                  {ENEMY_IDS.map((id) => (
                    <label key={id} className={`aggression-row aggression-${id}`}>
                      <span><i />{MASCOTS[id].name}</span>
                      <input
                        type="range"
                        min="0"
                        max="20"
                        step="1"
                        value={aggression[id]}
                        onChange={(event) => updateAggression(id, Number(event.target.value))}
                        onPointerUp={() => playSfx("ui")}
                        aria-label={`${MASCOTS[id].name}猎杀欲望`}
                      />
                      <output>{aggression[id]}</output>
                    </label>
                  ))}
                </div>
                <section className="defense-manual" aria-labelledby="defense-manual-title">
                  <div className="aggression-section-title defense-manual-heading">
                    <div><strong id="defense-manual-title">防守档案</strong><span>预警信号与正确应对</span></div>
                  </div>
                  <div className="defense-guide-list">
                    {ENEMY_IDS.map((id) => (
                      <article key={id} className={`defense-guide defense-${id}`}>
                        <div className="defense-identity"><i /><span><b>{MASCOTS[id].name}</b><small>{MASCOTS[id].label}</small></span></div>
                        <dl>
                          <div><dt>路线</dt><dd>{DEFENSE_GUIDES[id].route}</dd></div>
                          <div><dt>预警</dt><dd>{DEFENSE_GUIDES[id].cue}</dd></div>
                          <div><dt>防守</dt><dd>{DEFENSE_GUIDES[id].defense}</dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </section>
                <button type="button" className="start-button" onClick={() => { setAggressionMenuOpen(false); playSfx("ui"); }}>确认配置</button>
              </div>
            </div>
          )}
          <footer className="intro-footer"><span>ORIGINAL WEB HORROR EXPERIENCE</span><b>NS-84</b></footer>
        </section>
      )}

      {(phase === "playing" || phase === "paused") && (
        <section
          className={`office-screen ${controlsLocked ? "controls-locked" : ""} ${lights.left ? "left-light-on" : ""} ${lights.right ? "right-light-on" : ""}`}
          onPointerMove={(event) => {
            if (cameraOpen || phase === "paused") return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
            const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
            event.currentTarget.style.setProperty("--look-x", x.toFixed(3));
            event.currentTarget.style.setProperty("--look-y", y.toFixed(3));
          }}
          onPointerLeave={(event) => {
            event.currentTarget.style.setProperty("--look-x", "0");
            event.currentTarget.style.setProperty("--look-y", "0");
          }}
        >
          <header className="hud-top">
            <div className="brand-lockup"><span className="brand-mark">N</span><div><b>午夜值守</b><small>SECURITY DESK / NS-84</small></div></div>
            <div className="night-clock"><strong>{formatClock(remaining)}</strong><span>第 1 夜</span></div>
            {safeMode && <div className="safe-badge"><b>∞</b><span>安心模式</span></div>}
            {controlsLocked && <div className="lock-badge"><i />动作封锁</div>}
            <button type="button" className="pause-button" onClick={pauseGame} aria-label="暂停游戏" title="暂停游戏">
              <span className="pause-icon" />
            </button>
            <button type="button" className="sound-toggle" onClick={() => setSoundOn((value) => !value)} aria-label="声音" aria-pressed={soundOn}>
              <span className={soundOn ? "sound-waves" : "sound-muted"} />
            </button>
            <div className="night-progress"><span style={{ width: `${nightProgress}%` }} /></div>
          </header>

          {threatRadarEnabled && threatNotices.length > 0 && (
            <div className="threat-radar" role="status" aria-live="polite" aria-label="敌人接近提示">
              {threatNotices.map((notice) => (
                <div key={notice.id} className={`threat-notice threat-${notice.tone}`}>
                  <i aria-hidden="true" />
                  <span><b>{notice.title}</b><small>{notice.detail}</small></span>
                </div>
              ))}
            </div>
          )}

          <div className="office-vignette" />
          <div className="ceiling-flicker" />
          <div className="parallax-dust" />
          <div className="office-light-rig"><i className="light-left" /><i className="light-right" /><i className="monitor-spill" /><span className="window-spill" /></div>

          <SideConsole
            side="left" doorClosed={doors.left} lightOn={lights.left} threat={threatAt.left}
            onDoor={() => toggleDoor("left")} onLight={() => toggleLight("left")}
          />
          <SideConsole
            side="right" doorClosed={doors.right} lightOn={lights.right} threat={threatAt.right}
            onDoor={() => toggleDoor("right")} onLight={() => toggleLight("right")}
          />

          <div className="office-center">
            <div className="office-backwall">
              <div className="poster poster-left"><span>SMILE</span><Mascot id="lark" small motion="static" /></div>
              <div className={`window ${curtainDown ? "curtain-down" : ""}`}>
                <div className="window-exterior" aria-hidden="true">
                  <div className="window-hall-back"><i /><span /></div>
                  <div className="window-hall-wall wall-a" />
                  <div className="window-hall-wall wall-b" />
                  <div className="window-hall-ceiling"><i /><i /><i /></div>
                  <div className="window-hall-floor" />
                  <div className="window-hall-pipe"><i /><i /></div>
                  <div className="window-hall-debris"><i /><i /><i /></div>
                </div>
                <i /><i /><i />
                <div className="window-lamp" aria-hidden="true"><i /><span /></div>
                {windowAttackers.map(({ id, progress }) => {
                  const depth = Math.pow(progress, 0.78);
                  const startX = id === "veil" ? 46 : 54;
                  const endX = id === "veil" ? 27 : 73;
                  return (
                    <div
                      key={id}
                      className={`window-stalker window-stalker-${id}`}
                      style={{
                        left: `${startX + (endX - startX) * depth}%`,
                        bottom: `${34 - depth * 41}%`,
                        opacity: 0.12 + depth * 0.62,
                        filter: `brightness(${0.14 + depth * 0.4}) contrast(1.5) blur(${(1 - depth) * 1.8}px)`,
                        transform: `translateX(-50%) scale(${0.18 + depth * 0.7})`,
                      }}
                    >
                      <Mascot id={id} motion={progress >= 0.66 ? "threat" : "idle"} pose={ROUTE_POSES[id][positions[id]]} />
                    </div>
                  );
                })}
                <div className="window-curtain"><span /><span /><b /></div>
              </div>
              <div className="poster poster-right"><span>STAY</span><Mascot id="brass" small motion="static" /></div>
            </div>
            <div className="desk">
              <button
                type="button"
                className={`desk-monitor ${computerOn ? "powered" : "powered-off"} ${screenAttack && !safeMode ? "under-attack" : ""}`}
                onClick={toggleComputer}
                aria-pressed={computerOn}
                aria-label={screenAttack && !safeMode ? `电脑电源，失真偶攻击，已切换 ${screenAttack.toggles} 次` : "电脑电源"}
              >
                <div className="monitor-glow" />
                {computerOn && screenAttack && !safeMode && (
                  <div className="glitch-face" aria-hidden="true"><i /><i /><b /></div>
                )}
                <span>{computerOn ? (screenAttack && !safeMode ? `CYCLE ${screenAttack.toggles}/${SCREEN_DEFENSE_TOGGLES}` : "NO SIGNAL") : "POWER OFF"}</span>
                {screenAttack && !safeMode && <small>{Math.ceil(screenAttack.remainingMs / 1000)}s</small>}
                <i className="monitor-power" aria-hidden="true" />
              </button>
              <div className="desk-fan"><div className="fan-rotor"><i /><i /><i /></div><b /></div>
              <div className="paper-cup" />
              <div className="paper-stack" />
            </div>
          </div>

          <button
            type="button"
            className={`curtain-control ${curtainDown ? "active" : ""}`}
            onClick={toggleCurtain}
            aria-pressed={curtainDown}
            aria-label={curtainDown ? "升起前窗帘幕" : "放下前窗帘幕"}
            aria-keyshortcuts="W"
          >
            <span className="curtain-icon"><i /><i /></span>
            <b>{curtainDown ? "升起帘幕" : "放下帘幕"}</b>
            <kbd className="control-key">W</kbd>
          </button>

          <div className={`power-panel ${screenAttack && !safeMode ? "overload" : ""}`}>
            <div className="power-readout"><span>{safeMode ? "安心供电" : `剩余 / ${batteryCapacity}%`}</span><strong>{safeMode ? "∞" : Math.ceil(battery)}{!safeMode && <i>%</i>}</strong></div>
            <div className="battery-track"><span style={{ width: `${safeMode ? 100 : batteryLevelPercent}%` }} /></div>
            <div className="usage-row"><span>{safeMode ? "系统托管" : screenAttack ? "耗电 ×2" : "耗电"}</span><div className="usage-bars">{[1, 2, 3, 4, 5, 6].map((bar) => <i key={bar} className={safeMode || bar <= usageBars ? "on" : ""} />)}</div></div>
          </div>

          <button
            type="button"
            className={`camera-toggle ${cameraOpen ? "open" : ""} ${!computerOn ? "unavailable" : ""}`}
            onClick={() => { if (computerOn && !triggerForbiddenAction() && (battery > 0 || safeMode)) { setCameraOpen((value) => !value); setStaticBurst((value) => value + 1); playSfx("camera"); } }}
            aria-label={!computerOn ? "电脑已关闭，无法打开监控器" : cameraOpen ? "关闭监控器" : "打开监控器"}
            disabled={!computerOn || (battery <= 0 && !safeMode)}
          >
            <span className="camera-toggle-icon" /><b>{!computerOn ? "电脑已关闭" : cameraOpen ? "放下监控器" : "查看监控器"}</b><i>C</i>
          </button>

          <div className={`camera-overlay ${cameraOpen ? "visible" : ""}`} aria-hidden={!cameraOpen}>
            <div key={staticBurst} className="static-flash" />
            <div className="signal-sweep" />
            <div className="lens-aberration" />
            <CameraScene camera={selectedCamera} positions={positions} windowApproaching={windowApproaching} />
            <div className="feed-hud">
              <div className="rec-label"><i /> REC <span>{currentCamera.code}</span></div>
              <div className="feed-time">{formatClock(remaining)} / CH-{currentCamera.code.slice(-2)}</div>
            </div>
            <div className="camera-map">
              <div className="map-title"><span>乐园路径网络</span><b>{safeMode ? "LIVE TRACKING" : "ROUTES ONLINE"}</b></div>
              <div className="map-grid">
                <svg className="map-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <marker id="route-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto">
                      <path d="M 0 0 L 6 3 L 0 6 z" />
                    </marker>
                  </defs>
                  {MAP_CONNECTIONS.map(([from, to]) => {
                    const start = MAP_POINTS[from];
                    const end = MAP_POINTS[to];
                    const selected = from === selectedCamera || to === selectedCamera;
                    return <line key={`${from}-${to}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} className={selected ? "selected" : ""} markerEnd="url(#route-arrow)" />;
                  })}
                </svg>
                {CAMERAS.map((camera, index) => (
                  <button
                    key={camera.id}
                    type="button"
                    className={camera.id === selectedCamera ? "active" : ""}
                    style={{ left: `${camera.x}%`, top: `${camera.y}%` }}
                    onClick={() => pickCamera(camera.id)}
                    aria-label={`${camera.code} ${camera.name}`}
                    aria-keyshortcuts={`${index + 1}`}
                  >
                    <span className="camera-channel">{camera.code.replace("CAM ", "")}</span>
                    <kbd className="camera-key">{index + 1}</kbd>
                    {!safeMode && (Object.keys(positions) as MascotId[]).some((id) => PATHS[id][positions[id]] === camera.id && !(isWindowAttacker(id) && windowApproaching[id])) && <i className="motion-alert" />}
                  </button>
                ))}
                <div className="door-node door-node-left" style={{ left: `${MAP_POINTS.leftDoor.x}%`, top: `${MAP_POINTS.leftDoor.y}%` }}>L</div>
                <div className="window-node" style={{ left: `${MAP_POINTS.frontWindow.x}%`, top: `${MAP_POINTS.frontWindow.y}%` }}>W</div>
                <div className="door-node door-node-right" style={{ left: `${MAP_POINTS.rightDoor.x}%`, top: `${MAP_POINTS.rightDoor.y}%` }}>R</div>
                <div className="office-node" style={{ left: `${MAP_POINTS.office.x}%`, top: `${MAP_POINTS.office.y}%` }}>办公室</div>
                {safeMode && monsterLocations.map(({ id, point }) => point && (
                  <span
                    key={id}
                    className={`monster-pin monster-pin-${id}`}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                    title={MASCOTS[id].name}
                  >
                    {id === "morrow" ? "M" : id === "brass" ? "B" : id === "lark" ? "L" : id === "veil" ? "V" : "H"}
                  </span>
                ))}
              </div>
              <div className="map-legend">
                <span><i className="legend-route" />可通行路线</span>
                {safeMode && <span><i className="legend-monster" />实时目标</span>}
              </div>
            </div>
          </div>

          {phase === "paused" && (
            <div className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
              <div className="pause-menu">
                <span className="pause-code">SHIFT SUSPENDED / NS-84</span>
                <h2 id="pause-title">暂停</h2>
                <div className="pause-stats">
                  <div><span>当前时间</span><strong>{formatClock(remaining)}</strong></div>
                  <div><span>剩余电量</span><strong>{safeMode ? "∞" : `${Math.ceil(battery)}%`}</strong></div>
                </div>
                <button type="button" className="start-button" onClick={resumeGame}>继续值守</button>
                <button type="button" className="pause-exit" onClick={exitToTitle}>退出到标题</button>
              </div>
            </div>
          )}
        </section>
      )}

      {(phase === "won" || phase === "lost") && (
        <section className={`result-screen result-${phase}`}>
          {phase === "lost" && <div className="jumpscare"><Mascot id={threatAt.left || threatAt.right || windowThreat || "morrow"} motion="attack" /></div>}
          <div className="result-card">
            <span className="result-code">{phase === "won" ? "SHIFT COMPLETE" : "CONNECTION LOST"}</span>
            <h2>{phase === "won" ? "6:00 AM" : "信号中断"}</h2>
            <p>{phase === "won" ? "晨光照进大厅，舞台上的东西终于停止移动。" : `你的记录停在 ${formatClock(remaining)}。监控档案已自动封存。`}</p>
            <div className="result-actions">
              <button type="button" className="start-button" onClick={resetGame}>再值一夜</button>
              <button type="button" className="text-button" onClick={exitToTitle}>返回标题</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
