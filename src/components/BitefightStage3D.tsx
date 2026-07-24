"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { BitefightPlayer } from "@/lib/types";

type FighterSide = "left" | "right";

type ArmRig = {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  shoulderRest: number;
  elbowRest: number;
  punchStartedAt: number;
  punchQueued: boolean;
};

type RobotRig = {
  root: THREE.Group;
  headLift: THREE.Group;
  punchArm: ArmRig;
  guardArm: ArmRig;
  facing: 1 | -1;
  baseX: number;
  baseHeadY: number;
  hitStartedAt: number;
  headPopStartedAt: number;
  winner: boolean;
  knockedOut: boolean;
};

type PunchPose = {
  lead: number;
  rear: number;
  amount: number;
};

type StageRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rigs: [RobotRig, RobotRig];
  frameId: number;
  resizeObserver: ResizeObserver;
  reduceMotion: boolean;
  disposed: boolean;
};

const BLUE = {
  shell: 0x19a9d2,
  dark: 0x08779e,
  deep: 0x07536f,
};

const RED = {
  shell: 0xe82e3d,
  dark: 0xae1425,
  deep: 0x710d1b,
};

const PUNCH_DURATION_MS = 420;
const DUPLICATE_PUNCH_SIGNAL_MS = 48;
const FIGHTER_CENTER_X = 1.52;
const LEAD_PUNCH_SHOULDER_ANGLE = -0.13;
const LEAD_PUNCH_ELBOW_ANGLE = -0.02;
const REAR_PUNCH_SHOULDER_ANGLE = -0.1;
const REAR_PUNCH_ELBOW_ANGLE = -0.02;

function glossy(color: number, roughness = 0.24): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0.04,
    clearcoat: 0.92,
    clearcoatRoughness: 0.16,
  });
}

function matte(color: number, roughness = 0.72): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.03 });
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(...position);
  result.rotation.set(...rotation);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function rounded(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  return mesh(
    new RoundedBoxGeometry(width, height, depth, 4, radius),
    material,
    position,
  );
}

function cylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  segments = 14,
): THREE.Mesh {
  const delta = new THREE.Vector3().subVectors(end, start);
  const result = mesh(
    new THREE.CylinderGeometry(radius, radius, delta.length(), segments),
    material,
  );
  result.position.copy(start).add(end).multiplyScalar(0.5);
  result.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  return result;
}

function createLogoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 260;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#101827";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#fff3a6";
  context.lineWidth = 18;
  context.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "900 105px Arial Black, Arial";
  context.lineWidth = 12;
  context.strokeStyle = "#101827";
  context.strokeText("BITE", 320, 79);
  context.fillStyle = "#f43b45";
  context.fillText("BITE", 320, 79);
  context.strokeText("FIGHT", 320, 174);
  context.fillStyle = "#35b7dd";
  context.fillText("FIGHT", 320, 174);
  context.font = "900 28px Arial Black, Arial";
  context.fillStyle = "#fff6bf";
  context.fillText("R O B O T   B O U T", 320, 232);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createRing(scene: THREE.Scene): void {
  const yellow = glossy(0xffd928, 0.32);
  const yellowLight = glossy(0xffe95a, 0.38);
  const yellowDark = glossy(0xd6a900, 0.4);
  const whiteRope = matte(0xf4f1dd, 0.88);

  const shadow = mesh(
    new THREE.CylinderGeometry(4.2, 4.6, 0.16, 64),
    new THREE.MeshStandardMaterial({
      color: 0x050608,
      roughness: 1,
      transparent: true,
      opacity: 0.66,
    }),
    [0, -0.12, 0.12],
  );
  shadow.receiveShadow = true;
  scene.add(shadow);

  scene.add(rounded(7.15, 0.72, 4.3, 0.18, yellow, [0, 0.34, 0]));
  scene.add(rounded(6.72, 0.22, 3.82, 0.15, yellowLight, [0, 0.78, 0]));

  for (let index = -7; index <= 7; index++) {
    scene.add(
      rounded(0.09, 0.49, 0.06, 0.025, yellowDark, [
        index * 0.42,
        0.3,
        2.17,
      ]),
    );
  }

  const platformGeometry = new THREE.CylinderGeometry(1.2, 1.33, 0.12, 48);
  for (const x of [-FIGHTER_CENTER_X, FIGHTER_CENTER_X]) {
    scene.add(mesh(platformGeometry, yellowLight, [x, 0.92, 0]));
    const grip = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 1.02, 40),
      new THREE.MeshStandardMaterial({
        color: 0xe7c126,
        roughness: 0.65,
        side: THREE.DoubleSide,
      }),
    );
    grip.rotation.x = -Math.PI / 2;
    grip.position.set(x, 0.988, 0);
    grip.receiveShadow = true;
    scene.add(grip);
  }

  const postPositions: Array<[number, number]> = [
    [-3.08, -1.63],
    [3.08, -1.63],
    [-3.08, 1.63],
    [3.08, 1.63],
  ];
  for (const [x, z] of postPositions) {
    scene.add(
      mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.72, 18), yellow, [
        x,
        1.67,
        z,
      ]),
    );
    scene.add(
      mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 22), yellowLight, [
        x,
        2.55,
        z,
      ]),
    );
  }

  for (const y of [1.34, 1.77, 2.2]) {
    scene.add(
      cylinderBetween(
        new THREE.Vector3(-3.02, y, -1.63),
        new THREE.Vector3(3.02, y, -1.63),
        0.025,
        whiteRope,
      ),
    );
    scene.add(
      cylinderBetween(
        new THREE.Vector3(-3.02, y, 1.63),
        new THREE.Vector3(3.02, y, 1.63),
        0.025,
        whiteRope,
      ),
    );
    scene.add(
      cylinderBetween(
        new THREE.Vector3(-3.08, y, -1.57),
        new THREE.Vector3(-3.08, y, 1.57),
        0.025,
        whiteRope,
      ),
    );
    scene.add(
      cylinderBetween(
        new THREE.Vector3(3.08, y, -1.57),
        new THREE.Vector3(3.08, y, 1.57),
        0.025,
        whiteRope,
      ),
    );
  }

  const logoMaterial = new THREE.MeshBasicMaterial({
    map: createLogoTexture(),
    toneMapped: false,
  });
  const logo = mesh(new THREE.PlaneGeometry(1.5, 0.61), logoMaterial, [
    0,
    0.38,
    2.18,
  ]);
  logo.castShadow = false;
  scene.add(logo);

  for (const [x, color] of [
    [-4.0, RED.shell],
    [4.0, BLUE.shell],
  ] as const) {
    scene.add(rounded(0.78, 0.5, 1.0, 0.13, glossy(color), [x, 0.24, 0.82]));
    scene.add(
      mesh(
        new THREE.CylinderGeometry(0.22, 0.28, 1.55, 24),
        glossy(color),
        [x, 1.1, 0.82],
      ),
    );
    scene.add(
      mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 0.42, 24),
        yellowLight,
        [x, 2.06, 0.82],
      ),
    );
    scene.add(
      mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.1, 24),
        yellow,
        [x, 2.3, 0.82],
      ),
    );
  }

  const floor = mesh(
    new THREE.PlaneGeometry(24, 18),
    new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 1 }),
    [0, -0.22, 0],
    [-Math.PI / 2, 0, 0],
  );
  floor.receiveShadow = true;
  scene.add(floor);
}

function createArm(
  parent: THREE.Group,
  position: [number, number, number],
  shell: THREE.Material,
  dark: THREE.Material,
  shoulderRest: number,
  elbowRest: number,
): ArmRig {
  const shoulder = new THREE.Group();
  shoulder.position.set(...position);
  // Arm geometry is modeled along local +X. Rotate that axis onto the
  // robot's local +Z so both shoulders punch in the direction the body faces.
  shoulder.rotation.y = -Math.PI / 2;
  shoulder.rotation.z = shoulderRest;
  parent.add(shoulder);

  shoulder.add(
    mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.2, 28),
      dark,
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    ),
  );
  shoulder.add(
    mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.225, 24),
      shell,
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    ),
  );
  shoulder.add(rounded(0.55, 0.2, 0.24, 0.075, shell, [0.27, 0, 0]));
  for (const x of [0.11, 0.27, 0.43]) {
    shoulder.add(
      mesh(new THREE.SphereGeometry(0.029, 12, 8), dark, [x, -0.105, 0.105]),
    );
  }

  const elbow = new THREE.Group();
  elbow.position.x = 0.52;
  elbow.rotation.z = elbowRest;
  shoulder.add(elbow);
  elbow.add(
    mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.24, 24),
      dark,
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    ),
  );
  elbow.add(rounded(0.58, 0.2, 0.24, 0.075, shell, [0.29, 0, 0]));
  elbow.add(rounded(0.2, 0.27, 0.31, 0.08, dark, [0.64, 0, 0]));
  elbow.add(rounded(0.38, 0.38, 0.44, 0.12, shell, [0.83, 0.01, 0]));
  elbow.add(rounded(0.22, 0.09, 0.32, 0.035, dark, [0.86, 0.16, 0.01]));

  return {
    shoulder,
    elbow,
    shoulderRest,
    elbowRest,
    punchStartedAt: Number.NEGATIVE_INFINITY,
    punchQueued: false,
  };
}

function createRobot(
  scene: THREE.Scene,
  side: FighterSide,
  colors: typeof BLUE,
): RobotRig {
  const facing: 1 | -1 = side === "left" ? 1 : -1;
  const baseX =
    side === "left" ? -FIGHTER_CENTER_X : FIGHTER_CENTER_X;
  const root = new THREE.Group();
  root.position.set(baseX, 0.92, 0);
  root.rotation.y = side === "left" ? 1.2 : -1.2;
  root.scale.setScalar(1.07);
  scene.add(root);

  const shell = glossy(colors.shell);
  const dark = glossy(colors.dark, 0.28);
  const deep = glossy(colors.deep, 0.32);
  const joint = glossy(0x27303c, 0.3);
  const visor = glossy(0x0b1119, 0.18);
  const bolt = new THREE.MeshStandardMaterial({
    color: 0x9aa5ae,
    metalness: 0.76,
    roughness: 0.22,
  });

  for (const x of [-0.29, 0.29]) {
    root.add(rounded(0.47, 0.18, 0.72, 0.09, deep, [x, 0.09, 0.04]));
    root.add(rounded(0.29, 0.57, 0.36, 0.1, shell, [x, 0.43, 0]));
    root.add(
      mesh(
        new THREE.CylinderGeometry(0.21, 0.21, 0.38, 24),
        dark,
        [x, 0.72, 0.02],
        [Math.PI / 2, 0, 0],
      ),
    );
    root.add(
      mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.4, 20),
        bolt,
        [x, 0.72, 0.02],
        [Math.PI / 2, 0, 0],
      ),
    );
    root.add(rounded(0.34, 0.5, 0.4, 0.1, shell, [x, 0.93, 0]));
  }

  root.add(
    mesh(new THREE.CylinderGeometry(0.47, 0.54, 0.26, 32), dark, [0, 1.14, 0]),
  );
  root.add(
    mesh(new THREE.CylinderGeometry(0.48, 0.59, 0.78, 28), shell, [
      0,
      1.53,
      0,
    ]),
  );
  root.add(rounded(0.74, 0.43, 0.18, 0.1, dark, [0, 1.52, 0.42]));
  root.add(rounded(0.5, 0.08, 0.06, 0.03, deep, [0, 1.56, 0.53]));

  const headLift = new THREE.Group();
  const baseHeadY = 2.12;
  headLift.position.set(0, baseHeadY, 0);
  root.add(headLift);
  headLift.add(
    mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.34, 20), joint, [0, -0.25, 0]),
  );
  headLift.add(rounded(0.76, 0.57, 0.64, 0.13, shell));
  headLift.add(rounded(0.82, 0.16, 0.69, 0.08, dark, [0, 0.29, 0]));
  headLift.add(rounded(0.62, 0.12, 0.09, 0.035, visor, [0, 0.11, 0.33]));
  headLift.add(rounded(0.18, 0.22, 0.13, 0.04, dark, [0, -0.01, 0.38]));
  headLift.add(rounded(0.57, 0.13, 0.13, 0.04, deep, [0, -0.25, 0.32]));
  for (const x of [-0.21, 0.21]) {
    headLift.add(
      mesh(new THREE.SphereGeometry(0.045, 14, 10), bolt, [x, -0.24, 0.4]),
    );
  }
  headLift.add(
    mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.1, 24),
      dark,
      [0.41, 0, 0],
      [0, 0, Math.PI / 2],
    ),
  );
  headLift.add(
    mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.1, 24),
      dark,
      [-0.41, 0, 0],
      [0, 0, Math.PI / 2],
    ),
  );

  // These are the robot's actual left and right shoulder joints. The
  // camera-side arm starts on the outer shoulder; the rear arm starts on the
  // opposite shoulder instead of sharing the same opponent-facing hinge.
  const punchArm = createArm(
    root,
    [-facing * 0.46, 1.8, 0],
    shell,
    dark,
    -1.15,
    1.85,
  );
  const guardArm = createArm(
    root,
    [facing * 0.46, 1.7, 0],
    shell,
    dark,
    -1.6,
    2,
  );

  return {
    root,
    headLift,
    punchArm,
    guardArm,
    facing,
    baseX,
    baseHeadY,
    hitStartedAt: Number.NEGATIVE_INFINITY,
    headPopStartedAt: Number.NEGATIVE_INFINITY,
    winner: false,
    knockedOut: false,
  };
}

function punchAmount(elapsed: number): number {
  if (elapsed < 0 || elapsed > PUNCH_DURATION_MS) return 0;
  const normalized = elapsed / PUNCH_DURATION_MS;
  if (normalized < 0.22) {
    const out = normalized / 0.22;
    return 1 - (1 - out) ** 3;
  }
  if (normalized < 0.48) return 1;
  const back = (normalized - 0.48) / 0.52;
  return 1 - back * back;
}

function queueArmPunch(arm: ArmRig, now: number): void {
  const elapsed = now - arm.punchStartedAt;
  const active = elapsed >= 0 && elapsed <= PUNCH_DURATION_MS;
  if (!active) {
    arm.punchStartedAt = now;
    arm.punchQueued = false;
    return;
  }
  if (elapsed > DUPLICATE_PUNCH_SIGNAL_MS) {
    arm.punchQueued = true;
  }
}

function queuedPunchAmount(
  arm: ArmRig,
  now: number,
  reduceMotion: boolean,
): number {
  if (reduceMotion) {
    arm.punchQueued = false;
    return 0;
  }
  const elapsed = now - arm.punchStartedAt;
  if (elapsed > PUNCH_DURATION_MS && arm.punchQueued) {
    arm.punchStartedAt = now;
    arm.punchQueued = false;
    return 0;
  }
  return punchAmount(elapsed);
}

function readPunchPose(
  rig: RobotRig,
  now: number,
  reduceMotion: boolean,
): PunchPose {
  const lead = queuedPunchAmount(rig.punchArm, now, reduceMotion);
  const rear = queuedPunchAmount(rig.guardArm, now, reduceMotion);
  return { lead, rear, amount: Math.max(lead, rear) };
}

function impactAmount(elapsed: number): number {
  if (elapsed < 0 || elapsed > 430) return 0;
  const normalized = elapsed / 430;
  return Math.sin(normalized * Math.PI) * (1 - normalized * 0.38);
}

function popAmount(elapsed: number, reduceMotion: boolean): number {
  if (elapsed < 0) return 0;
  if (reduceMotion) return 1;
  const normalized = Math.min(1, elapsed / 620);
  return 1 - Math.exp(-7 * normalized) * Math.cos(normalized * Math.PI * 4.5);
}

function animateRobot(
  rig: RobotRig,
  pose: PunchPose,
  opponentPunch: number,
  now: number,
  elapsedSeconds: number,
  reduceMotion: boolean,
): void {
  const leadPunch = pose.lead;
  const rearPunch = pose.rear;
  const punch = pose.amount;
  const impact = reduceMotion ? 0 : impactAmount(now - rig.hitStartedAt);
  const pop = rig.knockedOut
    ? popAmount(now - rig.headPopStartedAt, reduceMotion)
    : 0;
  const idle = reduceMotion ? 0 : Math.sin(elapsedSeconds * 2.6 + rig.baseX) * 0.012;
  const victory =
    rig.winner && !reduceMotion
      ? Math.abs(Math.sin(elapsedSeconds * 5.2)) * 0.06
      : 0;

  rig.root.position.x =
    rig.baseX +
    rig.facing * punch * 0.08 -
    rig.facing * impact * 0.14;
  rig.root.position.y = 0.92 + idle + victory;
  rig.root.rotation.z =
    rig.facing * punch * -0.045 + rig.facing * impact * -0.09;
  const mutualPunchLane = rig.facing * opponentPunch * 0.12;
  rig.punchArm.shoulder.rotation.z = THREE.MathUtils.lerp(
    rig.punchArm.shoulderRest,
    LEAD_PUNCH_SHOULDER_ANGLE - mutualPunchLane,
    leadPunch,
  );
  rig.punchArm.elbow.rotation.z = THREE.MathUtils.lerp(
    rig.punchArm.elbowRest,
    LEAD_PUNCH_ELBOW_ANGLE,
    leadPunch,
  );
  const leadReach = 0.95;
  const rearReach = 0.6;
  rig.punchArm.elbow.scale.x = 1 + leadPunch * leadReach;
  rig.guardArm.shoulder.rotation.z = THREE.MathUtils.lerp(
    rig.guardArm.shoulderRest +
      (reduceMotion ? 0 : Math.sin(elapsedSeconds * 3.1) * 0.025),
    REAR_PUNCH_SHOULDER_ANGLE - mutualPunchLane,
    rearPunch,
  );
  rig.guardArm.elbow.rotation.z = THREE.MathUtils.lerp(
    rig.guardArm.elbowRest,
    REAR_PUNCH_ELBOW_ANGLE,
    rearPunch,
  );
  rig.guardArm.elbow.scale.x = 1 + rearPunch * rearReach;
  rig.headLift.position.y =
    rig.baseHeadY + Math.max(0, pop) * 0.72 + impact * 0.07;
  rig.headLift.rotation.z =
    rig.facing * Math.max(0, pop) * -0.12 +
    rig.facing * impact * -0.1;
}

function addLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xe9f5ff, 0x18202a, 2.15));

  const key = new THREE.DirectionalLight(0xffffff, 4.3);
  key.position.set(-4.5, 8, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const redRim = new THREE.PointLight(0xff5164, 22, 10, 2);
  redRim.position.set(4, 3.8, -2);
  scene.add(redRim);
  const blueRim = new THREE.PointLight(0x3cc8ff, 24, 10, 2);
  blueRim.position.set(-4, 3.8, -2);
  scene.add(blueRim);
}

export default function BitefightStage3D({
  players,
  winnerDiscordUserId,
  hitPlayerId,
}: {
  players: [BitefightPlayer, BitefightPlayer];
  winnerDiscordUserId: string | null;
  hitPlayerId: string | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<StageRuntime | null>(null);
  const idsRef = useRef<[string, string]>([
    players[0].discordUserId,
    players[1].discordUserId,
  ]);
  const punchesRef = useRef<[number, number]>([
    players[0].punches,
    players[1].punches,
  ]);
  const healthRef = useRef<[number, number]>([
    players[0].health,
    players[1].health,
  ]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
      renderer.setClearColor(0x10151d, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.domElement.className = "h-full w-full";
      renderer.domElement.setAttribute("aria-hidden", "true");
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x10151d);
      scene.fog = new THREE.Fog(0x10151d, 10, 20);
      const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 40);
      addLighting(scene);
      createRing(scene);
      const rigs: [RobotRig, RobotRig] = [
        createRobot(scene, "left", BLUE),
        createRobot(scene, "right", RED),
      ];
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      const resize = () => {
        const { width, height } = mount.getBoundingClientRect();
        if (width < 1 || height < 1) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        const compact = width < 560;
        camera.fov = compact ? 40 : 35;
        camera.position.set(0, compact ? 4.45 : 4.15, compact ? 9.7 : 8.35);
        camera.lookAt(0, compact ? 1.12 : 1.25, 0);
        camera.updateProjectionMatrix();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
      resize();

      const runtime: StageRuntime = {
        renderer,
        scene,
        camera,
        rigs,
        frameId: 0,
        resizeObserver,
        reduceMotion,
        disposed: false,
      };
      runtimeRef.current = runtime;
      const startedAt = performance.now();
      let announcedReady = false;
      const renderFrame = (now: number) => {
        if (runtime.disposed) return;
        const elapsedSeconds = (now - startedAt) / 1_000;
        const leftPose = readPunchPose(rigs[0], now, reduceMotion);
        const rightPose = readPunchPose(rigs[1], now, reduceMotion);
        animateRobot(
          rigs[0],
          leftPose,
          rightPose.amount,
          now,
          elapsedSeconds,
          reduceMotion,
        );
        animateRobot(
          rigs[1],
          rightPose,
          leftPose.amount,
          now,
          elapsedSeconds,
          reduceMotion,
        );
        renderer.render(scene, camera);
        if (!announcedReady) {
          announcedReady = true;
          setReady(true);
        }
        runtime.frameId = requestAnimationFrame(renderFrame);
      };
      runtime.frameId = requestAnimationFrame(renderFrame);

      return () => {
        runtime.disposed = true;
        cancelAnimationFrame(runtime.frameId);
        resizeObserver.disconnect();
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const material of materials) {
            if ("map" in material) {
              const map = material.map as THREE.Texture | null;
              map?.dispose();
            }
            material.dispose();
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
        runtimeRef.current = null;
      };
    } catch {
      queueMicrotask(() => setLoadError(true));
    }
  }, []);

  useEffect(() => {
    idsRef.current = [
      players[0].discordUserId,
      players[1].discordUserId,
    ];
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const now = performance.now();
    players.forEach((player, index) => {
      const previousPunches = punchesRef.current[index];
      if (player.punches > previousPunches) {
        for (
          let punchNumber = previousPunches + 1;
          punchNumber <= player.punches;
          punchNumber += 1
        ) {
          const arm =
            punchNumber % 2 === 1
              ? runtime.rigs[index].punchArm
              : runtime.rigs[index].guardArm;
          const visualDelay = Math.min(punchNumber - previousPunches - 1, 4) * 65;
          queueArmPunch(arm, now + visualDelay);
        }
      }
      if (player.health < healthRef.current[index]) {
        runtime.rigs[index].hitStartedAt = now;
      }
    });
    punchesRef.current = [players[0].punches, players[1].punches];
    healthRef.current = [players[0].health, players[1].health];
  }, [players]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !hitPlayerId) return;
    const index = idsRef.current.indexOf(hitPlayerId);
    if (index >= 0) runtime.rigs[index].hitStartedAt = performance.now();
  }, [hitPlayerId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const now = performance.now();
    runtime.rigs.forEach((rig, index) => {
      const isWinner = winnerDiscordUserId === idsRef.current[index];
      const isKnockedOut = winnerDiscordUserId !== null && !isWinner;
      if (isKnockedOut && !rig.knockedOut) {
        rig.headPopStartedAt = now;
      }
      rig.winner = isWinner;
      rig.knockedOut = isKnockedOut;
      if (!isKnockedOut) {
        rig.headPopStartedAt = Number.NEGATIVE_INFINITY;
      }
    });
  }, [winnerDiscordUserId]);

  return (
    <div
      ref={mountRef}
      className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_50%_15%,#293340_0,#10151d_64%)]"
    >
      {!ready && !loadError && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] font-black tracking-[0.28em] text-white/30 uppercase">
          Loading 3D arena
        </div>
      )}
      {loadError && (
        <div className="grid h-full place-items-center px-6 text-center text-sm text-white/60">
          The 3D arena could not start on this device. The Punch button still
          works.
        </div>
      )}
    </div>
  );
}
