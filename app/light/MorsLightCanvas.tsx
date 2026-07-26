"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { InteractionManager } from "three/addons/interaction/InteractionManager.js";
import { COLOR_PRESETS, INITIAL_LIGHT, type LightingSettings } from "./config";
import { MorsPageSurface, type StageMode } from "./MorsPageSurface";
import { installThreeHtmlTextureCompatibility, type HtmlCanvas } from "./three-html-compatibility";

type LightRig = {
  spot: THREE.SpotLight;
  bulbLight: THREE.PointLight;
  bulbMaterial: THREE.MeshStandardMaterial;
  glowMaterial: THREE.SpriteMaterial;
  undersideMaterial: THREE.MeshStandardMaterial;
};

type Side = "white" | "black";
type PieceKind = "king" | "queen" | "bishop" | "knight" | "rook" | "pawn";

type PieceDefinition = {
  id: string;
  side: Side;
  kind: PieceKind;
  movement: number;
  file: string;
  targetHeight: number;
  secret?: boolean;
};

type ChessPiece = PieceDefinition & {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  sleepPosition: THREE.Vector3;
  groundPosition: THREE.Vector3;
  currentBase: THREE.Vector3;
  sleepQuaternion: THREE.Quaternion;
  uprightQuaternion: THREE.Quaternion;
  exposure: number;
  awake: boolean;
  progress: number;
  springVelocity: number;
  beam: number;
  lastLitAt: number;
  supportVertices: Float32Array;
  discovered: boolean;
  rippleAge: number;
  labelAge: number;
  ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  labelMaterial: THREE.SpriteMaterial;
};

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const BASE_LIGHT_DIRECTION = DOWN.clone();
const PIECE_KINDS: PieceKind[] = ["king", "queen", "bishop", "knight", "rook", "pawn"];
const TARGET_HEIGHTS: Record<PieceKind, number> = {
  king: 2.7,
  queen: 2.45,
  bishop: 2.18,
  knight: 2.2,
  rook: 1.9,
  pawn: 1.52,
};
const STAGE_MODES: StageMode[] = ["UPRIGHT", "WHITE FORMATION", "BLACK FORMATION", "DUEL"];
const PIECE_SIDES: Record<PieceKind, Side> = {
  king: "black",
  queen: "black",
  bishop: "white",
  knight: "white",
  rook: "black",
  pawn: "white",
};

const STANDARD_PIECES: PieceDefinition[] = PIECE_KINDS.map((kind, index) => {
  const side = PIECE_SIDES[kind];
  return { id: kind, side, kind, movement: index + 1, file: `${side}_${kind}.glb`, targetHeight: TARGET_HEIGHTS[kind] };
});
const PIECE_DEFINITIONS: PieceDefinition[] = [
  ...STANDARD_PIECES,
  { id: "secret", side: "black", kind: "bishop", movement: 7, file: "black_bishop.glb", targetHeight: TARGET_HEIGHTS.bishop, secret: true },
];

const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function MorsLightCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageSourceRef = useRef<HTMLDivElement>(null);
  const lightRigRef = useRef<LightRig | null>(null);
  const activeColorRef = useRef(new THREE.Color());
  const wakeRef = useRef<(() => void) | null>(null);
  const resetMotionRef = useRef<(() => void) | null>(null);
  const resetStageRef = useRef<(() => void) | null>(null);
  const [lighting, setLighting] = useState<LightingSettings>(INITIAL_LIGHT);
  const lightingRef = useRef(lighting);
  const [awakenedCount, setAwakenedCount] = useState(0);
  const [discoveredPieces, setDiscoveredPieces] = useState<string[]>([]);
  const [combo, setCombo] = useState(0);
  const [finaleActive, setFinaleActive] = useState(false);
  const [activePiece, setActivePiece] = useState("");
  const [stageMode, setStageMode] = useState<StageMode>("SCATTERED");
  const [htmlCanvasReady, setHtmlCanvasReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    canvasRef.current?.setAttribute("layoutsubtree", "");
    void import("three-html-render/polyfill")
      .then(({ installHtmlInCanvasPolyfill }) => {
        if (!active) return;
        installHtmlInCanvasPolyfill();
        installThreeHtmlTextureCompatibility();
        setHtmlCanvasReady(true);
      })
      .catch((polyfillError: unknown) => {
        console.error("HTML-in-Canvas could not be initialized.", polyfillError);
        if (active) setError("HTML-in-Canvas is not available in this browser.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!htmlCanvasReady) return;
    const canvas = canvasRef.current as HtmlCanvas;
    const pageSource = pageSourceRef.current as HTMLDivElement;
    if (!canvas || !pageSource) return;

    let disposed = false;
    let animationFrame = 0;
    let resizeFrame = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let stableFrames = 0;
    let pulling = false;
    let pullPointerId = -1;
    let lastPointerTime = 0;
    let pullStrength = 0;
    let beamPointerId = -1;
    let beamStartX = 0;
    let beamStartY = 0;
    let beamStartAngle = INITIAL_LIGHT.angle;
    let beamDragged = false;
    let localMode: StageMode = "SCATTERED";
    let awakeTotal = 0;
    let discoveredTotal = 0;
    let comboValue = 0;
    let lastDiscoveryTime = -Infinity;
    let finaleUntil = 0;
    let comboTimer = 0;
    let finaleTimer = 0;
    let lastFormationChange = 0;
    let previousLampX = 0;

    const fixedStep = 1 / 120;
    const ropeLength = 1.22;
    const pageTopToAnchor = 1.18;
    const gravity = new THREE.Vector3(0, -9.81, 0);
    const anchor = new THREE.Vector3(0, 4.72, 1.18);
    const position = new THREE.Vector3(0.16, anchor.y - ropeLength, anchor.z + 0.08);
    const previous = position.clone().add(new THREE.Vector3(0.018, 0, -0.012));
    const aimTarget = new THREE.Vector3(0, 0.3, 0.08);
    const pointerVelocity = new THREE.Vector3();
    const lastPointerTarget = aimTarget.clone();
    const pieces: ChessPiece[] = [];

    const temp = new THREE.Vector3();
    const tempB = new THREE.Vector3();
    const tempC = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const ropeDirection = new THREE.Vector3();
    const lightDirection = new THREE.Vector3();
    const currentLightDirection = BASE_LIGHT_DIRECTION.clone();
    const midpoint = new THREE.Vector3();
    const swingQuaternion = new THREE.Quaternion();
    const lampQuaternion = new THREE.Quaternion();
    const cableQuaternion = new THREE.Quaternion();
    const pointer = new THREE.Vector2();
    const lampNdc = new THREE.Vector3();
    const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.08);
    const raycaster = new THREE.Raycaster();
    const beamOrigin = new THREE.Vector3();
    const pieceWorld = new THREE.Vector3();
    const toPiece = new THREE.Vector3();
    const targetBase = new THREE.Vector3();
    const lightTint = new THREE.Color(INITIAL_LIGHT.color);
    const supportDirection = new THREE.Vector3();
    const supportQuaternion = new THREE.Quaternion();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (rendererError) {
      console.error(rendererError);
      const timer = window.setTimeout(() => !disposed && setError("This experience needs WebGL to render the chess stage."), 0);
      return () => { disposed = true; window.clearTimeout(timer); };
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 80);
    camera.position.set(0, 0.2, 13.6);

    const pageGroup = new THREE.Group();
    pageGroup.position.set(0, -0.35, -1.05);
    scene.add(pageGroup);

    const pageTexture = new THREE.HTMLTexture(pageSource);
    pageTexture.colorSpace = THREE.SRGBColorSpace;
    pageTexture.minFilter = THREE.LinearFilter;
    pageTexture.magFilter = THREE.LinearFilter;
    pageTexture.generateMipmaps = false;
    const pageGeometry = new THREE.PlaneGeometry(1, 1);
    const pageMaterial = new THREE.MeshStandardMaterial({
      map: pageTexture, color: 0xadb4c1, roughness: 0.96, metalness: 0,
      transparent: true, alphaTest: 0.005, side: THREE.FrontSide,
    });
    const pageMesh = new THREE.Mesh(pageGeometry, pageMaterial);
    pageGroup.add(pageMesh);

    const stageGroup = new THREE.Group();
    stageGroup.position.set(0, -2.75, 0.2);
    scene.add(stageGroup);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x09263b, roughness: 0.72, metalness: 0.08 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 18), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.02, 2.8);
    floor.receiveShadow = true;
    stageGroup.add(floor);

    scene.add(new THREE.HemisphereLight(0x52617a, 0x09080b, 0.34));
    const edgeLight = new THREE.DirectionalLight(0x8399bd, 0.34);
    edgeLight.position.set(-5.2, 5.8, 6.8);
    scene.add(edgeLight);

    const lampRoot = new THREE.Group();
    scene.add(lampRoot);
    const ceilingCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.3, 0.11, 24),
      new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.64, metalness: 0.7 }),
    );
    ceilingCap.position.copy(anchor).add(new THREE.Vector3(0, 0.08, 0));
    scene.add(ceilingCap);
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x121318, roughness: 0.5, metalness: 0.55 }),
    );
    scene.add(cable);
    const shadeGroup = new THREE.Group();
    lampRoot.add(shadeGroup);
    const shadeProfile = [
      new THREE.Vector2(0.08, 0.08), new THREE.Vector2(0.18, 0.02),
      new THREE.Vector2(0.43, -0.1), new THREE.Vector2(0.82, -0.25),
      new THREE.Vector2(1.08, -0.36), new THREE.Vector2(1.1, -0.41),
    ];
    const shadeMaterial = new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.36, metalness: 0.74, side: THREE.DoubleSide });
    const shade = new THREE.Mesh(new THREE.LatheGeometry(shadeProfile, 48), shadeMaterial);
    shade.castShadow = true;
    shadeGroup.add(shade);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.095, 0.027, 8, 48),
      new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.28, metalness: 0.82 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.397;
    shadeGroup.add(rim);
    const undersideMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(INITIAL_LIGHT.color).multiplyScalar(0.18), emissive: INITIAL_LIGHT.color,
      emissiveIntensity: 0.42, roughness: 0.92, side: THREE.DoubleSide,
    });
    const underside = new THREE.Mesh(new THREE.CircleGeometry(1.055, 48), undersideMaterial);
    underside.rotation.x = Math.PI / 2;
    underside.position.y = -0.385;
    shadeGroup.add(underside);
    const connector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.12, 0.2, 20),
      new THREE.MeshStandardMaterial({ color: 0x9c6744, roughness: 0.44, metalness: 0.66 }),
    );
    connector.position.y = 0.08;
    shadeGroup.add(connector);
    const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffd7ad, emissive: INITIAL_LIGHT.color, emissiveIntensity: 3.2, roughness: 0.2 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), bulbMaterial);
    bulb.scale.y = 1.2;
    bulb.position.y = -0.33;
    shadeGroup.add(bulb);

    const glowTexture = createGlowTexture();
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture, color: INITIAL_LIGHT.color, transparent: true, opacity: 0.86,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.y = -0.36;
    glow.scale.set(0.96, 0.96, 0.96);
    shadeGroup.add(glow);

    const spot = new THREE.SpotLight(INITIAL_LIGHT.color, 1, 18, THREE.MathUtils.degToRad(INITIAL_LIGHT.angle), 0.82, 2);
    spot.power = INITIAL_LIGHT.brightness;
    spot.position.set(0, -0.35, 0);
    spot.target.position.set(0, -7, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0005;
    spot.shadow.normalBias = 0.035;
    shadeGroup.add(spot, spot.target);
    const bulbLight = new THREE.PointLight(INITIAL_LIGHT.color, 1, 3.2, 2);
    bulbLight.power = 36;
    bulbLight.position.set(0, -0.35, 0);
    shadeGroup.add(bulbLight);
    lightRigRef.current = { spot, bulbLight, bulbMaterial, glowMaterial, undersideMaterial };

    const interactions = new InteractionManager();
    interactions.connect(renderer, camera);
    interactions.add(pageMesh);

    function createGlowTexture() {
      const textureCanvas = document.createElement("canvas");
      textureCanvas.width = 64;
      textureCanvas.height = 64;
      const context = textureCanvas.getContext("2d");
      if (context) {
        const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(0.16, "rgba(255,222,172,.8)");
        gradient.addColorStop(0.46, "rgba(255,170,94,.22)");
        gradient.addColorStop(1, "rgba(255,140,70,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
      }
      const texture = new THREE.CanvasTexture(textureCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function createPieceLabelTexture(piece: PieceDefinition) {
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 512;
      labelCanvas.height = 112;
      const context = labelCanvas.getContext("2d");
      if (context) {
        context.beginPath();
        context.roundRect(2, 2, 508, 108, 28);
        context.fillStyle = "rgba(5,7,11,.58)";
        context.fill();
        context.strokeStyle = "rgba(255,255,255,.15)";
        context.lineWidth = 2;
        context.stroke();
        context.fillStyle = piece.side === "white" ? "rgba(243,233,203,.74)" : "rgba(155,184,232,.74)";
        context.beginPath();
        context.roundRect(20, 19, 6, 74, 3);
        context.fill();
        context.fillStyle = "rgba(255,255,255,.46)";
        context.font = "500 18px ui-monospace, monospace";
        context.fillText(`DISCOVERY 0${piece.movement}`, 48, 40);
        context.fillStyle = "#ffffff";
        context.font = "700 28px ui-monospace, monospace";
        context.fillText(`${piece.secret ? "SECRET" : piece.kind.toUpperCase()} / FOUND`, 48, 79);
      }
      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function getSleepPosition(index: number) {
      const scatter = [
        [-5.0, 0.18],
        [-3.65, 1.62],
        [-5.45, 1.78],
        [4.45, 1.78],
        [3.55, 0.12],
        [4.65, 1.38],
        [-5.18, 6.25, -0.28],
      ];
      if (index === 6) return new THREE.Vector3(scatter[index][0], scatter[index][1], scatter[index][2]);
      return new THREE.Vector3(scatter[index][0], 0, scatter[index][1]);
    }

    function getFormationPosition(piece: ChessPiece, mode: StageMode, result: THREE.Vector3) {
      if (mode === "SCATTERED" || mode === "UPRIGHT") {
        return result.copy(piece.secret && piece.discovered ? piece.groundPosition : piece.sleepPosition);
      }
      const column = piece.movement - 1;
      if (mode === "HUNT COMPLETE") {
        return result.set(-3.6 + column * 1.2, 0, 0.34 + Math.abs(column - 3) * 0.18);
      }
      const x = -4.35 + column * 1.23;
      if (mode === "WHITE FORMATION") {
        const isLead = piece.side === "white";
        return result.set(x + (isLead ? 0 : 0.35), 0, isLead ? 1.25 : -0.05);
      }
      if (mode === "BLACK FORMATION") {
        const isLead = piece.side === "black";
        return result.set(x + (isLead ? 0 : 0.35), 0, isLead ? 1.25 : -0.05);
      }
      if (mode === "DUEL") {
        const sideSign = piece.side === "white" ? -1 : 1;
        return result.set(sideSign * (0.45 + column * 0.78) - 1.05, 0, 0.45 + Math.abs(column - 2.5) * 0.13);
      }
      return result.set(x + (piece.side === "white" ? 0.28 : 0), 0, piece.side === "white" ? 1.25 : 0.05);
    }

    async function loadChessPieces() {
      const loader = new GLTFLoader();
      await Promise.all(PIECE_DEFINITIONS.map(async (definition, index) => {
        const gltf = await loader.loadAsync(`${ASSET_BASE}/chess/${definition.file}`);
        if (disposed) return;
        const model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const scale = definition.targetHeight / Math.max(size.y, 0.001);
        model.scale.setScalar(scale);
        model.updateWorldMatrix(true, true);
        const supportData: number[] = [];
        const supportVertex = new THREE.Vector3();
        const materials: THREE.MeshStandardMaterial[] = [];
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.updateWorldMatrix(true, false);
          const positionAttribute = object.geometry.getAttribute("position");
          for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
            supportVertex.fromBufferAttribute(positionAttribute, vertexIndex).applyMatrix4(object.matrixWorld);
            supportData.push(supportVertex.x, supportVertex.y, supportVertex.z);
          }
          const material = new THREE.MeshStandardMaterial({
            color: definition.side === "white" ? 0xe9e2ca : 0x171a21,
            roughness: definition.side === "white" ? 0.42 : 0.32,
            metalness: definition.side === "white" ? 0.05 : 0.2,
            emissive: 0x000000,
            emissiveIntensity: 0,
          });
          object.material = material;
          object.castShadow = true;
          object.receiveShadow = true;
          materials.push(material);
        });
        const group = new THREE.Group();
        group.add(model);
        const sleepPosition = getSleepPosition(index);
        const groundPosition = definition.secret ? new THREE.Vector3(-0.25, 0, 1.28) : sleepPosition.clone();
        const restingAngles = [
          [-0.18, 0.35, 1.47],
          [0.28, 1.12, -1.61],
          [-0.34, 2.18, 1.34],
          [0.17, -0.62, -1.42],
          [0.4, 2.72, 1.66],
          [-0.25, 1.54, -1.31],
          [0.18, 0.82, 1.46],
        ];
        const [restX, restY, restZ] = restingAngles[index];
        const sleepQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(restX, restY, restZ));
        group.position.copy(sleepPosition);
        group.quaternion.copy(sleepQuaternion);
        stageGroup.add(group);
        const rippleMaterial = new THREE.MeshBasicMaterial({
          color: INITIAL_LIGHT.color, transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        const ripple = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.5, 56), rippleMaterial);
        ripple.rotation.x = -Math.PI / 2;
        ripple.position.set(sleepPosition.x, 0.012, sleepPosition.z);
        stageGroup.add(ripple);
        const labelMaterial = new THREE.SpriteMaterial({
          map: createPieceLabelTexture(definition), transparent: true, opacity: 0,
          depthWrite: false, depthTest: false,
        });
        const label = new THREE.Sprite(labelMaterial);
        label.scale.set(1.48, 0.33, 1);
        label.renderOrder = 8;
        stageGroup.add(label);
        pieces.push({
          ...definition, group, materials, sleepPosition, groundPosition, currentBase: sleepPosition.clone(),
          sleepQuaternion, uprightQuaternion: new THREE.Quaternion(), exposure: 0,
          awake: false, progress: 0, springVelocity: 0, beam: 0, lastLitAt: 0,
          supportVertices: new Float32Array(supportData), discovered: false, rippleAge: 99, labelAge: 99,
          ripple, label, labelMaterial,
        });
      }));
      pieces.sort((a, b) => PIECE_DEFINITIONS.findIndex((item) => item.id === a.id) - PIECE_DEFINITIONS.findIndex((item) => item.id === b.id));
    }

    function resize() {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, width < 760 ? 1.25 : 1.5);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const sourceWidth = pageSource.offsetWidth || 1440;
      const sourceHeight = pageSource.offsetHeight || 810;
      const portrait = height > width * 1.16;
      const pageWidth = portrait ? 7.2 : 12.8;
      const pageHeight = pageWidth * (sourceHeight / sourceWidth);
      pageMesh.scale.set(pageWidth, pageHeight, 1);
      pageGroup.position.y = portrait ? -0.62 : -0.38;
      stageGroup.position.y = pageGroup.position.y - pageHeight / 2 + (portrait ? 1.28 : 0.95);
      stageGroup.scale.setScalar(portrait ? 0.58 : 1);
      anchor.set(0, pageGroup.position.y + pageHeight / 2 + pageTopToAnchor, portrait ? 1.1 : 1.18);
      ceilingCap.position.copy(anchor);
      ceilingCap.position.y += 0.08;
      if (!pulling) {
        const constrained = temp.copy(position).sub(anchor);
        if (constrained.lengthSq() < 0.001) constrained.copy(DOWN);
        constrained.normalize().multiplyScalar(ropeLength);
        position.copy(anchor).add(constrained);
        previous.copy(position);
      }
      const fitHeight = pageHeight + 3.1;
      const fitWidth = pageWidth + 1.25;
      const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
      const distanceForHeight = fitHeight / (2 * Math.tan(halfFov));
      const distanceForWidth = fitWidth / (2 * Math.tan(halfFov) * camera.aspect);
      const cameraDistance = Math.max(distanceForHeight, distanceForWidth);
      camera.position.set(0, pageGroup.position.y - (portrait ? 0.78 : 0.62), cameraDistance);
      camera.lookAt(0, pageGroup.position.y + (portrait ? -0.04 : 0.06), 0);
      camera.updateMatrixWorld();
      interactions.update();
      canvas.requestPaint?.();
      wake();
    }

    function updateRig() {
      ropeDirection.copy(position).sub(anchor).normalize();
      midpoint.copy(anchor).add(position).multiplyScalar(0.5);
      cable.position.copy(midpoint);
      cable.scale.set(1, ropeLength, 1);
      cableQuaternion.setFromUnitVectors(UP, ropeDirection);
      cable.quaternion.copy(cableQuaternion);
      if (pulling) {
        lightDirection.copy(aimTarget).sub(position).normalize();
        currentLightDirection.lerp(lightDirection, 0.32).normalize();
      } else {
        swingQuaternion.setFromUnitVectors(DOWN, ropeDirection);
        lightDirection.copy(BASE_LIGHT_DIRECTION).applyQuaternion(swingQuaternion).normalize();
        currentLightDirection.lerp(lightDirection, 0.14).normalize();
      }
      lampQuaternion.setFromUnitVectors(DOWN, currentLightDirection);
      lampRoot.position.copy(position);
      lampRoot.quaternion.copy(lampQuaternion);
    }

    function stepPhysics() {
      velocity.copy(position).sub(previous).multiplyScalar(pulling ? 0.985 : 0.9948);
      previous.copy(position);
      position.add(velocity).addScaledVector(gravity, fixedStep * fixedStep);
      if (pulling) {
        tempB.copy(aimTarget).sub(anchor).normalize();
        tempB.lerp(DOWN, 1 - pullStrength * 0.82).normalize();
        tempC.copy(tempB).multiplyScalar(ropeLength).add(anchor).sub(position);
        temp.copy(position).sub(anchor).normalize();
        tempC.addScaledVector(temp, -tempC.dot(temp));
        position.addScaledVector(tempC, 52 * fixedStep * fixedStep);
      }
      temp.copy(position).sub(anchor);
      if (temp.lengthSq() < 1e-8) temp.copy(DOWN);
      temp.normalize().multiplyScalar(ropeLength);
      position.copy(anchor).add(temp);
      velocity.copy(position).sub(previous);
      if (pulling) stableFrames = 0;
      else if (velocity.lengthSq() < 0.000000014) stableFrames += 1;
      else stableFrames = 0;
    }

    function triggerFinale(now: number) {
      finaleUntil = now + 4200;
      localMode = "HUNT COMPLETE";
      setStageMode("HUNT COMPLETE");
      setFinaleActive(true);
      awakeTotal = pieces.length;
      setAwakenedCount(awakeTotal);
      setActivePiece("ALL PIECES / LIGHT HUNT COMPLETE");
      for (const candidate of pieces) {
        candidate.awake = true;
        candidate.lastLitAt = finaleUntil;
        candidate.springVelocity = Math.max(candidate.springVelocity, 0.035);
        candidate.rippleAge = 0;
        candidate.labelAge = 0;
      }
      window.clearTimeout(finaleTimer);
      finaleTimer = window.setTimeout(() => {
        if (!disposed) setFinaleActive(false);
      }, 4200);
    }

    function wakePiece(piece: ChessPiece) {
      if (piece.awake) return;
      const now = performance.now();
      piece.awake = true;
      piece.lastLitAt = now;
      piece.springVelocity = 0.025 + Math.min(0.075, Math.abs(velocity.x) * 5);
      piece.rippleAge = 0;
      piece.labelAge = 0;
      awakeTotal += 1;
      setAwakenedCount(awakeTotal);
      setActivePiece(`${piece.secret ? "SECRET" : piece.kind.toUpperCase()} / MOVEMENT ${String(piece.movement).padStart(2, "0")}`);
      if (!piece.discovered) {
        piece.discovered = true;
        discoveredTotal += 1;
        comboValue = now - lastDiscoveryTime < 2600 ? comboValue + 1 : 1;
        lastDiscoveryTime = now;
        setCombo(comboValue);
        setDiscoveredPieces(pieces.filter((candidate) => candidate.discovered).map((candidate) => candidate.id));
        window.clearTimeout(comboTimer);
        comboTimer = window.setTimeout(() => {
          comboValue = 0;
          if (!disposed) setCombo(0);
        }, 2800);
        if (discoveredTotal === pieces.length) triggerFinale(now);
      }
      if (awakeTotal === pieces.length) {
        if (localMode !== "HUNT COMPLETE") {
          localMode = "UPRIGHT";
          setStageMode("UPRIGHT");
          window.setTimeout(() => !disposed && setActivePiece("ALL PIECES / BOARD AWAKE"), 700);
        }
      }
    }

    function sleepPiece(piece: ChessPiece) {
      if (!piece.awake) return;
      piece.awake = false;
      piece.exposure = 0;
      piece.springVelocity = -0.025 - Math.min(0.065, Math.abs(velocity.x) * 4);
      awakeTotal = Math.max(0, awakeTotal - 1);
      localMode = "SCATTERED";
      setAwakenedCount(awakeTotal);
      setStageMode("SCATTERED");
      setActivePiece(`${piece.secret ? "SECRET" : piece.kind.toUpperCase()} / RETURNING TO REST`);
    }

    function updatePieces(delta: number, time: number) {
      if (!pieces.length) return false;
      let moving = false;
      spot.getWorldPosition(beamOrigin);
      lightTint.set(lightingRef.current.color);
      const angleLimit = spot.angle * 1.16;
      const brightnessFactor = THREE.MathUtils.clamp(lightingRef.current.brightness / 1450, 0.2, 2);

      for (const piece of pieces) {
        piece.group.getWorldPosition(pieceWorld);
        pieceWorld.y += piece.targetHeight * stageGroup.scale.y * 0.45;
        toPiece.copy(pieceWorld).sub(beamOrigin);
        const distance = toPiece.length();
        toPiece.normalize();
        const angle = Math.acos(THREE.MathUtils.clamp(toPiece.dot(currentLightDirection), -1, 1));
        const inside = lightingRef.current.enabled && angle < angleLimit && distance < 12;
        const beam = inside ? Math.pow(1 - angle / angleLimit, 1.35) : 0;
        piece.beam = THREE.MathUtils.damp(piece.beam, beam, 8, delta);

        if (beam > 0.14) piece.lastLitAt = time;
        if (piece.awake && time >= finaleUntil && time - piece.lastLitAt > 850) sleepPiece(piece);

        if (!piece.awake) {
          const secretLocked = piece.secret && discoveredTotal < pieces.length - 1;
          if (secretLocked) piece.exposure = 0;
          else if (beam > 0.14) piece.exposure += delta * beam * brightnessFactor;
          else piece.exposure = Math.max(0, piece.exposure - delta * 0.16);
          const threshold = piece.kind === "king" ? 0.68 : piece.kind === "pawn" ? 0.34 : 0.46;
          if (piece.exposure >= threshold) wakePiece(piece);
        }

        const targetProgress = piece.awake ? 1 : 0;
        if (piece.awake || piece.progress > 0.001) {
          const stiffness = piece.kind === "king" ? 7.2 : piece.kind === "queen" ? 9.2 : 10.4;
          piece.springVelocity += (targetProgress - piece.progress) * stiffness * delta;
          piece.springVelocity *= Math.exp(-(piece.kind === "pawn" ? 4.35 : 4.65) * delta);
          piece.progress += piece.springVelocity * delta;
          if (piece.progress > 1.08) piece.springVelocity -= (piece.progress - 1) * stiffness * delta;
          if (piece.progress < -0.08) piece.springVelocity -= piece.progress * stiffness * delta;
          if (Math.abs(targetProgress - piece.progress) < 0.002 && Math.abs(piece.springVelocity) < 0.006) {
            piece.progress = targetProgress;
            piece.springVelocity = 0;
          } else moving = true;

          if (piece.awake) getFormationPosition(piece, localMode, targetBase);
          else targetBase.copy(piece.secret && piece.discovered ? piece.groundPosition : piece.sleepPosition);
          const beforeDistance = piece.currentBase.distanceToSquared(targetBase);
          piece.currentBase.lerp(targetBase, 1 - Math.exp(-delta * 2.05));
          if (beforeDistance > 0.00003) moving = true;
        }

        if (piece.awake && beam <= 0.14) moving = true;

        const rawProgress = THREE.MathUtils.clamp(piece.progress, 0, 1);
        const personalityProgress = piece.kind === "king" ? Math.pow(rawProgress, 1.35) : rawProgress;
        const eased = 1 - Math.pow(1 - personalityProgress, 3);
        piece.group.position.copy(piece.currentBase);
        piece.group.quaternion.copy(piece.sleepQuaternion).slerp(piece.uprightQuaternion, eased);
        const flourish = Math.sin(Math.PI * eased) * (1 - eased * 0.25);
        if (piece.awake && rawProgress < 1) {
          if (piece.kind === "queen") piece.group.rotateY(flourish * Math.PI * 0.9);
          if (piece.kind === "bishop") piece.group.position.x += flourish * (piece.side === "white" ? 0.3 : -0.3);
          if (piece.kind === "knight") piece.group.position.y += Math.sin(Math.PI * eased) * 0.52;
          if (piece.kind === "rook") piece.group.position.y += Math.sin(Math.PI * eased) * 0.18;
          if (piece.kind === "pawn") piece.group.rotateZ(Math.sin(eased * Math.PI * 6) * (1 - eased) * 0.22);
        }
        if (!piece.awake && piece.beam > 0.08) {
          piece.group.rotateY(Math.sin(time * 0.015 + piece.movement) * piece.beam * 0.035);
          moving = true;
        }

        // Use the actual mesh vertices for the support point. A box-based test
        // leaves curved pieces visibly hovering above the floor.
        supportQuaternion.copy(piece.group.quaternion).invert();
        supportDirection.copy(UP).applyQuaternion(supportQuaternion);
        let lowestPoint = Infinity;
        for (let vertexIndex = 0; vertexIndex < piece.supportVertices.length; vertexIndex += 3) {
          lowestPoint = Math.min(lowestPoint,
            piece.supportVertices[vertexIndex] * supportDirection.x
            + piece.supportVertices[vertexIndex + 1] * supportDirection.y
            + piece.supportVertices[vertexIndex + 2] * supportDirection.z,
          );
        }
        piece.group.position.y += Math.max(0, -lowestPoint) + 0.006;

        piece.rippleAge += delta;
        piece.ripple.position.set(piece.currentBase.x, 0.012, piece.currentBase.z);
        piece.ripple.material.color.copy(lightTint);
        if (piece.rippleAge < 1.55) {
          const rippleProgress = piece.rippleAge / 1.55;
          piece.ripple.scale.setScalar(0.7 + rippleProgress * 3.1);
          piece.ripple.material.opacity = Math.pow(1 - rippleProgress, 1.4) * 0.72;
          moving = true;
        } else {
          piece.ripple.material.opacity = 0;
        }

        piece.labelAge += delta;
        const labelRemaining = THREE.MathUtils.clamp(1 - piece.labelAge, 0, 1);
        const labelTargetOpacity = piece.awake
          ? THREE.MathUtils.smoothstep(labelRemaining, 0, 0.28) * 0.88
          : 0;
        piece.labelMaterial.opacity = piece.labelAge >= 1
          ? 0
          : THREE.MathUtils.damp(piece.labelMaterial.opacity, labelTargetOpacity, 8, delta);
        piece.label.position.set(
          piece.currentBase.x + (piece.side === "white" ? 0.72 : -0.72),
          0.62 + rawProgress * Math.min(1.1, piece.targetHeight * 0.46),
          piece.currentBase.z + 0.12,
        );
        if (piece.awake && piece.labelAge < 1) moving = true;
        if (Math.abs(piece.labelMaterial.opacity - labelTargetOpacity) > 0.01) moving = true;

        for (const material of piece.materials) {
          material.emissive.copy(lightTint);
          material.emissiveIntensity = piece.beam * (piece.awake ? 0.22 : 0.48);
        }
      }
      return moving;
    }

    function maybeAdvanceFormation(time: number) {
      if (time < finaleUntil + 850 || awakeTotal !== pieces.length || pulling || time - lastFormationChange < 1200) {
        previousLampX = position.x;
        return;
      }
      const crossedCenter = previousLampX * position.x <= 0 && Math.abs(position.x - previousLampX) > 0.006;
      if (crossedCenter && Math.abs(velocity.x) > 0.007) {
        const currentIndex = Math.max(0, STAGE_MODES.indexOf(localMode));
        localMode = STAGE_MODES[(currentIndex + 1) % STAGE_MODES.length];
        setStageMode(localMode);
        setActivePiece(`${localMode} / SWING TRIGGERED`);
        lastFormationChange = time;
      }
      previousLampX = position.x;
    }

    function animate(time: number) {
      animationFrame = 0;
      if (disposed) return;
      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      accumulator = Math.min(accumulator + delta, fixedStep * 5);
      while (accumulator >= fixedStep) {
        stepPhysics();
        accumulator -= fixedStep;
      }
      updateRig();
      const piecesMoving = updatePieces(delta, time);
      maybeAdvanceFormation(time);
      interactions.update();
      renderer.render(scene, camera);
      if (pulling || stableFrames < 80 || piecesMoving) animationFrame = requestAnimationFrame(animate);
    }

    function wake() {
      stableFrames = 0;
      if (!animationFrame && !disposed) {
        lastTime = performance.now();
        animationFrame = requestAnimationFrame(animate);
      }
    }
    wakeRef.current = wake;

    function pointerNdc(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    }

    function updatePointerTarget(event: PointerEvent) {
      pointerNdc(event);
      if (!raycaster.ray.intersectPlane(interactionPlane, aimTarget)) return false;
      lampNdc.copy(position).project(camera);
      const distanceX = (pointer.x - lampNdc.x) * camera.aspect;
      const distanceY = pointer.y - lampNdc.y;
      pullStrength = THREE.MathUtils.smoothstep(Math.hypot(distanceX, distanceY), 0.08, 1.15);
      return true;
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button === 2) {
        beamPointerId = event.pointerId;
        beamStartX = event.clientX;
        beamStartY = event.clientY;
        beamStartAngle = lightingRef.current.angle;
        beamDragged = false;
        pageSource.classList.add("is-adjusting-beam");
        return;
      }
      if (event.button !== 0 || beamPointerId !== -1 || !updatePointerTarget(event)) return;
      pulling = true;
      pullPointerId = event.pointerId;
      lastPointerTime = performance.now();
      lastPointerTarget.copy(aimTarget);
      pointerVelocity.set(0, 0, 0);
      canvas.classList.add("is-pulling-light");
      wake();
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerId === beamPointerId) {
        const movementX = event.clientX - beamStartX;
        const movementY = event.clientY - beamStartY;
        if (!beamDragged && Math.hypot(movementX, movementY) >= 4) beamDragged = true;
        if (beamDragged) {
          const nextAngle = THREE.MathUtils.clamp(Math.round(beamStartAngle + movementX * 0.14), 16, 58);
          setLighting((current) => current.angle === nextAngle ? current : { ...current, angle: nextAngle });
          wake();
        }
        return;
      }
      if (!pulling || event.pointerId !== pullPointerId || !updatePointerTarget(event)) return;
      const now = performance.now();
      const elapsed = Math.max(0.008, Math.min(0.05, (now - lastPointerTime) / 1000));
      temp.copy(aimTarget).sub(lastPointerTarget).multiplyScalar(1 / elapsed);
      pointerVelocity.lerp(temp, 0.34);
      lastPointerTarget.copy(aimTarget);
      lastPointerTime = now;
      wake();
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerId === beamPointerId) {
        const shouldCycleColor = !beamDragged && event.type !== "pointercancel";
        beamPointerId = -1;
        beamDragged = false;
        pageSource.classList.remove("is-adjusting-beam");
        if (shouldCycleColor) {
          setLighting((current) => {
            const currentIndex = COLOR_PRESETS.findIndex((color) => color === current.color.toLowerCase());
            return { ...current, color: COLOR_PRESETS[(currentIndex + 1) % COLOR_PRESETS.length] };
          });
        }
        wake();
        return;
      }
      if (!pulling || event.pointerId !== pullPointerId) return;
      velocity.copy(position).sub(previous).multiplyScalar(1 / fixedStep);
      temp.copy(position).sub(anchor).normalize();
      pointerVelocity.addScaledVector(temp, -pointerVelocity.dot(temp)).clampLength(0, 6);
      velocity.addScaledVector(pointerVelocity, THREE.MathUtils.lerp(0.055, 0.12, pullStrength));
      tempB.copy(anchor).addScaledVector(DOWN, ropeLength).sub(position);
      tempB.addScaledVector(temp, -tempB.dot(temp));
      if (tempB.lengthSq() > 0.0001) velocity.addScaledVector(tempB.normalize(), THREE.MathUtils.lerp(0.32, 1.6, pullStrength));
      velocity.clampLength(0, 4.25);
      previous.copy(position).addScaledVector(velocity, -fixedStep);
      pulling = false;
      pullPointerId = -1;
      pullStrength = 0;
      canvas.classList.remove("is-pulling-light");
      wake();
    }

    function resetMotion() {
      pulling = false;
      pullPointerId = -1;
      pullStrength = 0;
      position.copy(anchor).addScaledVector(DOWN, ropeLength);
      previous.copy(position);
      previousLampX = position.x;
      pointerVelocity.set(0, 0, 0);
      currentLightDirection.copy(BASE_LIGHT_DIRECTION);
      canvas.classList.remove("is-pulling-light");
      beamPointerId = -1;
      beamDragged = false;
      pageSource.classList.remove("is-adjusting-beam");
      wake();
    }

    function resetStage() {
      awakeTotal = 0;
      localMode = "SCATTERED";
      lastFormationChange = performance.now();
      discoveredTotal = 0;
      comboValue = 0;
      finaleUntil = 0;
      window.clearTimeout(comboTimer);
      window.clearTimeout(finaleTimer);
      for (const piece of pieces) {
        piece.exposure = 0;
        piece.awake = false;
        piece.progress = 0;
        piece.springVelocity = 0;
        piece.beam = 0;
        piece.lastLitAt = 0;
        piece.discovered = false;
        piece.rippleAge = 99;
        piece.labelAge = 99;
        piece.ripple.material.opacity = 0;
        piece.labelMaterial.opacity = 0;
        piece.currentBase.copy(piece.sleepPosition);
        piece.group.position.copy(piece.sleepPosition);
        piece.group.quaternion.copy(piece.sleepQuaternion);
      }
      setAwakenedCount(0);
      setDiscoveredPieces([]);
      setCombo(0);
      setFinaleActive(false);
      setActivePiece("");
      setStageMode("SCATTERED");
      wake();
    }
    resetMotionRef.current = resetMotion;
    resetStageRef.current = resetStage;

    function resetEverything() {
      resetMotion();
      resetStage();
      setLighting(INITIAL_LIGHT);
    }
    function onResize() { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); }
    function onPaint() { wake(); }
    function onContextMenu(event: MouseEvent) { event.preventDefault(); }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("dblclick", resetEverything);
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", onResize, { passive: true });
    canvas.addEventListener("paint", onPaint);

    void Promise.all([document.fonts.ready, loadChessPieces()])
      .then(() => {
        if (disposed) return;
        canvas.requestPaint?.();
        resize();
        updateRig();
        setReady(true);
        wake();
      })
      .catch((loadError: unknown) => {
        console.error("Chess models could not be loaded.", loadError);
        if (!disposed) setError("The chess pieces could not be loaded. Please refresh the stage.");
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(resizeFrame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("dblclick", resetEverything);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("paint", onPaint);
      interactions.disconnect();
      wakeRef.current = null;
      resetMotionRef.current = null;
      resetStageRef.current = null;
      lightRigRef.current = null;
      window.clearTimeout(comboTimer);
      window.clearTimeout(finaleTimer);
      for (const piece of pieces) {
        piece.labelMaterial.map?.dispose();
        piece.labelMaterial.dispose();
      }
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      pageTexture.dispose();
      glowTexture.dispose();
      glowMaterial.dispose();
      renderer.dispose();
    };
  }, [htmlCanvasReady]);

  useEffect(() => {
    lightingRef.current = lighting;
    const rig = lightRigRef.current;
    if (!rig) return;
    const color = activeColorRef.current.set(lighting.color);
    const effectiveBrightness = lighting.enabled ? lighting.brightness : 0;
    rig.spot.color.copy(color);
    rig.spot.power = effectiveBrightness;
    rig.spot.angle = THREE.MathUtils.degToRad(lighting.angle);
    rig.bulbLight.color.copy(color);
    rig.bulbLight.power = lighting.enabled ? Math.max(18, lighting.brightness * 0.026) : 0;
    rig.bulbMaterial.emissive.copy(color);
    rig.bulbMaterial.emissiveIntensity = lighting.enabled ? 2.4 + lighting.brightness / 850 : 0.04;
    rig.glowMaterial.color.copy(color);
    rig.glowMaterial.opacity = lighting.enabled ? 0.52 + lighting.brightness / 4200 : 0;
    rig.undersideMaterial.color.copy(color).multiplyScalar(0.18);
    rig.undersideMaterial.emissive.copy(color);
    rig.undersideMaterial.emissiveIntensity = lighting.enabled ? 0.22 + lighting.brightness / 7250 : 0.03;
    const canvas = canvasRef.current as HtmlCanvas | null;
    canvas?.requestPaint?.();
    wakeRef.current?.();
  }, [lighting]);

  function updateLighting(patch: Partial<LightingSettings>) {
    setLighting((current) => ({ ...current, ...patch }));
  }

  function resetExperience() {
    setLighting(INITIAL_LIGHT);
    resetMotionRef.current?.();
    resetStageRef.current?.();
  }

  return (
    <main className={`experience-shell${ready ? " is-ready" : ""}`}
      aria-label="Chess Stage interactive light experience" aria-busy={!ready && !error}>
      <canvas ref={canvasRef} className="webgl-canvas" aria-label="Interactive hanging light and chess pieces">
        <MorsPageSurface sourceRef={pageSourceRef} lighting={lighting} awakenedCount={awakenedCount} pieceTotal={PIECE_DEFINITIONS.length}
          discoveredPieces={discoveredPieces} combo={combo} finaleActive={finaleActive}
          activePiece={activePiece} stageMode={stageMode} onLightingChange={updateLighting} onReset={resetExperience} />
      </canvas>
      <div className={`scene-status${ready || error ? " is-hidden" : ""}`} aria-live="polite"><span /> LOADING CHESS PIECES</div>
      {error ? <div className="scene-error">{error}</div> : null}
    </main>
  );
}
