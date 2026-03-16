import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { geoPath, geoEquirectangular, type GeoPermissibleObjects } from "d3-geo";
import * as topojson from "topojson-client";
import type { GeometryCollection } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";

// ── Constants ──

const RADIUS = 1.6;
const EXTRUDE = 0.038; // how much land is raised above ocean
const GEO_DETAIL = 40; // icosahedron detail — balance between low-poly look and continent accuracy

// Rotate the globe group so Europe faces the camera initially.
// latLngToVec3 maps the front face (max +Z) to lng=90° (India).
// Europe sits at ~lng=10°, so we rotate 80° around Y to bring it forward.
const GROUP_ROTATION_Y = (80 * Math.PI) / 180;

// ISO 3166-1 numeric → language code
const COUNTRY_LANG: Record<string, string> = {
  "724": "es", // Spain
  "250": "fr", // France
  "276": "de", // Germany
  "392": "ja", // Japan
  "380": "it", // Italy
  "620": "pt", // Portugal
  "840": "en", // United States
};

// Vibrant country fills — saturated for the supported countries
const LANG_FILL: Record<string, string> = {
  es: "#ef4444",
  fr: "#3b82f6",
  de: "#eab308",
  ja: "#f43f5e",
  it: "#f97316",
  pt: "#a855f7",
  en: "#f97316",
};

// Glow border color for supported countries
const LANG_STROKE: Record<string, string> = {
  es: "#fca5a5",
  fr: "#93c5fd",
  de: "#fde047",
  ja: "#fda4af",
  it: "#fed7aa",
  pt: "#c4b5fd",
  en: "#fdba74",
};

// Flag positions — spread apart, staggered heights
const FLAG_PINS: Array<{
  code: string;
  lat: number;
  lng: number;
  poleH: number;
}> = [
  { code: "es", lat: 38, lng: -4, poleH: 0.38 },
  { code: "fr", lat: 47, lng: 2, poleH: 0.46 },
  { code: "de", lat: 52, lng: 10, poleH: 0.42 },
  { code: "ja", lat: 36, lng: 138, poleH: 0.40 },
  { code: "it", lat: 42, lng: 13, poleH: 0.35 },
  { code: "pt", lat: 39, lng: -9, poleH: 0.33 },
  { code: "en", lat: 40, lng: -100, poleH: 0.44 },
];

// ── Coordinate helpers ──

function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lng * (Math.PI / 180);
  return new THREE.Vector3(
    -(r * Math.sin(phi) * Math.cos(theta)),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

// ── Earth textures (color + displacement) ──

function createEarthTextures(w: number, h: number): {
  color: HTMLCanvasElement;
  displacement: HTMLCanvasElement;
  landMask: HTMLCanvasElement;
} {
  const countries = topojson.feature(
    worldAtlas as any,
    (worldAtlas as any).objects.countries as GeometryCollection
  );

  const proj = geoEquirectangular()
    .scale(w / (2 * Math.PI))
    .translate([w / 2, h / 2]);

  // ── Color texture ──
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = w;
  colorCanvas.height = h;
  const cCtx = colorCanvas.getContext("2d")!;

  // Ocean — deep blue
  cCtx.fillStyle = "#1d4ed8";
  cCtx.fillRect(0, 0, w, h);

  // Subtle ocean grid
  const colorPath = geoPath(proj, cCtx);
  cCtx.strokeStyle = "rgba(59, 130, 246, 0.2)";
  cCtx.lineWidth = 0.5;
  for (let lat = -80; lat <= 80; lat += 20) {
    cCtx.beginPath();
    colorPath({
      type: "LineString",
      coordinates: Array.from({ length: 361 }, (_, i) => [i - 180, lat]),
    } as GeoPermissibleObjects);
    cCtx.stroke();
  }
  for (let lng = -180; lng < 180; lng += 20) {
    cCtx.beginPath();
    colorPath({
      type: "LineString",
      coordinates: Array.from({ length: 181 }, (_, i) => [lng, i - 90]),
    } as GeoPermissibleObjects);
    cCtx.stroke();
  }

  // Glow pass for supported countries
  cCtx.save();
  cCtx.filter = "blur(10px)";
  for (const f of countries.features) {
    const lang = COUNTRY_LANG[String(f.id)];
    if (!lang) continue;
    cCtx.beginPath();
    colorPath(f as GeoPermissibleObjects);
    cCtx.fillStyle = LANG_FILL[lang];
    cCtx.globalAlpha = 0.4;
    cCtx.fill();
  }
  cCtx.restore();
  cCtx.globalAlpha = 1;

  // All countries — sharp pass
  for (const f of countries.features) {
    const id = String(f.id);
    const lang = COUNTRY_LANG[id];
    cCtx.beginPath();
    colorPath(f as GeoPermissibleObjects);

    if (lang) {
      cCtx.fillStyle = LANG_FILL[lang];
      cCtx.strokeStyle = LANG_STROKE[lang];
      cCtx.lineWidth = 1.5;
    } else {
      cCtx.fillStyle = "#22c55e"; // bright green for all land
      cCtx.strokeStyle = "#16a34a";
      cCtx.lineWidth = 0.6;
    }
    cCtx.fill();
    cCtx.stroke();
  }

  // ── Displacement texture ── (white = raised land, black = ocean)
  const dispCanvas = document.createElement("canvas");
  dispCanvas.width = w;
  dispCanvas.height = h;
  const dCtx = dispCanvas.getContext("2d")!;

  // Ocean = black (no displacement)
  dCtx.fillStyle = "#000000";
  dCtx.fillRect(0, 0, w, h);

  const dispPath = geoPath(proj, dCtx);

  // Land = white (max displacement)
  dCtx.fillStyle = "#ffffff";
  for (const f of countries.features) {
    dCtx.beginPath();
    dispPath(f as GeoPermissibleObjects);
    dCtx.fill();
  }

  // Slight blur to soften coastline transitions
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tCtx = tempCanvas.getContext("2d")!;
  tCtx.filter = "blur(3px)";
  tCtx.drawImage(dispCanvas, 0, 0);

  return { color: colorCanvas, displacement: tempCanvas, landMask: dispCanvas };
}

// ── Flag texture (canvas drawn) ──

function createFlagTex(code: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 150;
  c.height = 100;
  const ctx = c.getContext("2d")!;

  switch (code) {
    case "es":
      ctx.fillStyle = "#c60b1e";
      ctx.fillRect(0, 0, 150, 25);
      ctx.fillStyle = "#ffc400";
      ctx.fillRect(0, 25, 150, 50);
      ctx.fillStyle = "#c60b1e";
      ctx.fillRect(0, 75, 150, 25);
      break;
    case "fr":
      ctx.fillStyle = "#002395";
      ctx.fillRect(0, 0, 50, 100);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(50, 0, 50, 100);
      ctx.fillStyle = "#ed2939";
      ctx.fillRect(100, 0, 50, 100);
      break;
    case "de":
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 150, 33);
      ctx.fillStyle = "#dd0000";
      ctx.fillRect(0, 33, 150, 34);
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(0, 67, 150, 33);
      break;
    case "ja":
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 150, 100);
      ctx.fillStyle = "#bc002d";
      ctx.beginPath();
      ctx.arc(75, 50, 28, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "it":
      ctx.fillStyle = "#009246";
      ctx.fillRect(0, 0, 50, 100);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(50, 0, 50, 100);
      ctx.fillStyle = "#ce2b37";
      ctx.fillRect(100, 0, 50, 100);
      break;
    case "pt":
      ctx.fillStyle = "#006600";
      ctx.fillRect(0, 0, 60, 100);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(60, 0, 90, 100);
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.arc(60, 50, 16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "en": {
      // US flag — simplified stripes + blue canton
      const stripeH = 100 / 13;
      for (let i = 0; i < 13; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#b22234" : "#ffffff";
        ctx.fillRect(0, i * stripeH, 150, stripeH);
      }
      // Blue canton
      ctx.fillStyle = "#3c3b6e";
      ctx.fillRect(0, 0, 60, 54);
      // Stars (simplified grid of dots)
      ctx.fillStyle = "#ffffff";
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 6; col++) {
          ctx.beginPath();
          ctx.arc(5 + col * 10, 5 + row * 10, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  return t;
}

// ── Wind shader ──

const WIND_VERT = `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float inf = pow(uv.x, 1.5);
    float t = uTime;
    p.z += sin(t*3.0 + uv.x*8.0) * 0.07 * inf;
    p.z += sin(t*5.5 + uv.x*13.0 + uv.y*5.0) * 0.03 * inf;
    p.y += sin(t*2.5 + uv.x*7.0) * 0.015 * inf;
    p.x += sin(t*1.8 + uv.x*4.0) * 0.01 * inf;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FLAG_FRAG = `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    float facing = gl_FrontFacing ? 1.0 : 0.8;
    gl_FragColor = c * facing;
  }
`;

// ── Atmosphere glow ──

function Atmosphere() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          }`,
        fragmentShader: `
          varying vec3 vNormal;
          void main() {
            float i = pow(0.6 - dot(vNormal, vec3(0,0,1)), 2.0);
            gl_FragColor = vec4(0.3, 0.5, 1.0, 1.0) * i * 1.5;
          }`,
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );
  return (
    <mesh material={mat}>
      <icosahedronGeometry args={[RADIUS * 1.18, 16]} />
    </mesh>
  );
}

// ── Flag pin ──

interface FlagPinProps {
  code: string;
  lat: number;
  lng: number;
  poleH: number;
  isSelected: boolean;
  onClick: () => void;
}

function FlagPin({ code, lat, lng, poleH, isSelected, onClick }: FlagPinProps) {
  // Position flags on the raised land surface (RADIUS + EXTRUDE)
  const surfacePos = useMemo(() => latLngToVec3(lat, lng, RADIUS + EXTRUDE), [lat, lng]);
  const normal = useMemo(() => surfacePos.clone().normalize(), [surfacePos]);
  const quat = useMemo(() => {
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      normal
    );
  }, [normal]);

  const flagTex = useMemo(() => createFlagTex(code), [code]);
  const flagMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { map: { value: flagTex }, uTime: { value: 0 } },
        vertexShader: WIND_VERT,
        fragmentShader: FLAG_FRAG,
        side: THREE.DoubleSide,
        transparent: true,
      }),
    [flagTex]
  );

  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    flagMat.uniforms.uTime.value = clock.getElapsedTime();
  });

  // Always render — no visibility culling
  const fw = 0.18;
  const fh = 0.12;

  return (
    <group ref={groupRef} position={surfacePos} quaternion={quat}>
      {/* Pole */}
      <mesh position={[0, poleH / 2, 0]}>
        <cylinderGeometry args={[0.006, 0.006, poleH, 6]} />
        <meshBasicMaterial color={isSelected || hovered ? "#ffffff" : "#d4d4d8"} />
      </mesh>

      {/* Flag cloth */}
      <mesh
        material={flagMat}
        position={[fw / 2 + 0.003, poleH - fh / 2 - 0.005, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <planeGeometry args={[fw, fh, 24, 14]} />
      </mesh>

      {/* Invisible click target — larger hit area around the flag */}
      <mesh
        position={[fw / 2, poleH * 0.6, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <boxGeometry args={[fw * 1.6, poleH * 0.8, 0.06]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Pole cap */}
      <mesh position={[0, poleH + 0.008, 0]}>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshBasicMaterial
          color={isSelected ? "#60a5fa" : "#e4e4e7"}
        />
      </mesh>

      {/* Base glow */}
      <pointLight
        position={[0, 0.02, 0]}
        color={isSelected ? "#60a5fa" : "#ffffff"}
        intensity={isSelected || hovered ? 0.5 : 0.15}
        distance={0.35}
      />
    </group>
  );
}

// ── Globe mesh ──

interface GlobeMeshProps {
  selectedLanguageCode: string | null;
  onLanguageClick: (code: string) => void;
  zoomTarget: { lat: number; lng: number } | null;
}

function GlobeMesh({ selectedLanguageCode, onLanguageClick, zoomTarget }: GlobeMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const earthRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(true);

  // Disable raycasting on earth mesh so flags can be clicked
  useEffect(() => {
    if (earthRef.current) {
      earthRef.current.raycast = () => {};
    }
  }, []);

  const { earthGeo } = useMemo(() => {
    const { color: colorCanvas, landMask } = createEarthTextures(2048, 1024);

    // Color data
    const cCtx = colorCanvas.getContext("2d")!;
    const colorData = cCtx.getImageData(0, 0, colorCanvas.width, colorCanvas.height);
    const CW = colorCanvas.width, CH = colorCanvas.height;

    // Sharp land mask (unblurred) — white = land, black = ocean
    const mCtx = landMask.getContext("2d")!;
    const maskData = mCtx.getImageData(0, 0, landMask.width, landMask.height);
    const MW = landMask.width, MH = landMask.height;

    const base = new THREE.IcosahedronGeometry(RADIUS, GEO_DETAIL);
    const geo = base.toNonIndexed();
    base.dispose();

    const pos = geo.attributes.position;
    const faceCount = pos.count / 3;
    const colorArr = new Float32Array(pos.count * 3);

    for (let f = 0; f < faceCount; f++) {
      const vi0 = f * 3, vi1 = f * 3 + 1, vi2 = f * 3 + 2;
      // Face centroid
      const cx = (pos.getX(vi0) + pos.getX(vi1) + pos.getX(vi2)) / 3;
      const cy = (pos.getY(vi0) + pos.getY(vi1) + pos.getY(vi2)) / 3;
      const cz = (pos.getZ(vi0) + pos.getZ(vi1) + pos.getZ(vi2)) / 3;
      const clen = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const lat = Math.asin(cy / clen) * 180 / Math.PI;
      const lng = Math.atan2(cz, -cx) * 180 / Math.PI;

      // Land/ocean: sample centroid + all 3 vertices, majority vote.
      // Centroid-only misses thin peninsulas like Italy whose face centroids fall in the sea.
      const samplePoints: [number, number, number][] = [
        [cx, cy, cz],
        [pos.getX(vi0), pos.getY(vi0), pos.getZ(vi0)],
        [pos.getX(vi1), pos.getY(vi1), pos.getZ(vi1)],
        [pos.getX(vi2), pos.getY(vi2), pos.getZ(vi2)],
      ];
      let landVotes = 0;
      for (const [sx, sy, sz] of samplePoints) {
        const slen = Math.sqrt(sx * sx + sy * sy + sz * sz);
        const slat = Math.asin(sy / slen) * 180 / Math.PI;
        const slng = Math.atan2(sz, -sx) * 180 / Math.PI;
        const spx = Math.max(0, Math.min(MW - 1, Math.floor(((slng + 180) / 360) * MW)));
        const spy = Math.max(0, Math.min(MH - 1, Math.floor(((90 - slat) / 180) * MH)));
        if (maskData.data[(spy * MW + spx) * 4] > 128) landVotes++;
      }
      const isLand = landVotes >= 2; // majority of 4 samples

      // Move ALL 3 vertices of this face to the same radius — no slanting, no bleed
      const targetR = isLand ? RADIUS + EXTRUDE : RADIUS;
      for (const vi of [vi0, vi1, vi2]) {
        const vx = pos.getX(vi), vy = pos.getY(vi), vz = pos.getZ(vi);
        const vlen = Math.sqrt(vx * vx + vy * vy + vz * vz);
        pos.setX(vi, (vx / vlen) * targetR);
        pos.setY(vi, (vy / vlen) * targetR);
        pos.setZ(vi, (vz / vlen) * targetR);
      }

      // Color from color canvas
      const cpx = Math.max(0, Math.min(CW - 1, Math.floor(((lng + 180) / 360) * CW)));
      const cpy = Math.max(0, Math.min(CH - 1, Math.floor(((90 - lat) / 180) * CH)));
      const ci = (cpy * CW + cpx) * 4;
      const rc = colorData.data[ci] / 255;
      const gc = colorData.data[ci + 1] / 255;
      const bc = colorData.data[ci + 2] / 255;
      colorArr[vi0 * 3] = rc; colorArr[vi0 * 3 + 1] = gc; colorArr[vi0 * 3 + 2] = bc;
      colorArr[vi1 * 3] = rc; colorArr[vi1 * 3 + 1] = gc; colorArr[vi1 * 3 + 2] = bc;
      colorArr[vi2 * 3] = rc; colorArr[vi2 * 3 + 1] = gc; colorArr[vi2 * 3 + 2] = bc;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    return { earthGeo: geo };
  }, []);

  // Pull camera back on narrow viewports so globe doesn't clip edges
  const { size } = useThree();
  useEffect(() => {
    if (!zoomTarget) {
      const z = size.width < 640 ? 5.8 : 5.0;
      camera.position.setZ(z);
      camera.updateProjectionMatrix();
    }
  }, [size.width, zoomTarget, camera]);

  const zoomStart = useRef<number | null>(null);
  const zoomInitialCamPos = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 5));
  const zoomTargetCamPos = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 5));

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    if (zoomTarget) {
      if (zoomStart.current === null) {
        zoomStart.current = clock.getElapsedTime();
        zoomInitialCamPos.current = camera.position.clone();
        const localPos = latLngToVec3(zoomTarget.lat, zoomTarget.lng, RADIUS);
        const worldDir = localPos
          .clone()
          .normalize()
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), GROUP_ROTATION_Y);
        const zoomDist = 3.0;
        zoomTargetCamPos.current = worldDir.multiplyScalar(zoomDist);
      }

      const elapsed = clock.getElapsedTime() - zoomStart.current;
      const t = Math.min(elapsed / 2.0, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      const startDir = zoomInitialCamPos.current.clone().normalize();
      const endDir = zoomTargetCamPos.current.clone().normalize();
      const qStart = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), startDir);
      const qEnd = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), endDir);
      const currentDir = new THREE.Vector3(0, 0, 1).applyQuaternion(qStart.clone().slerp(qEnd, ease));

      const startDist = zoomInitialCamPos.current.length();
      const endDist = zoomTargetCamPos.current.length();
      camera.position.copy(currentDir.multiplyScalar(startDist + (endDist - startDist) * ease));
      camera.lookAt(0, 0, 0);
    } else {
      zoomStart.current = null;
    }
  });

  return (
    <>
      <group ref={groupRef} rotation={[0, GROUP_ROTATION_Y, 0]}>
        {/* Earth — vertex colors + manual binary height per face (no displacement map bleed) */}
        <mesh ref={earthRef} geometry={earthGeo}>
          <meshStandardMaterial
            vertexColors
            flatShading
            roughness={0.72}
            metalness={0.05}
            emissive="#0f172a"
            emissiveIntensity={0.15}
          />
        </mesh>

        {/* Atmosphere */}
        <Atmosphere />

        {/* Flags — always rendered */}
        {FLAG_PINS.map((fp) => (
          <FlagPin
            key={fp.code}
            code={fp.code}
            lat={fp.lat}
            lng={fp.lng}
            poleH={fp.poleH}
            isSelected={selectedLanguageCode === fp.code}
            onClick={() => onLanguageClick(fp.code)}
          />
        ))}
      </group>

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        rotateSpeed={0.5}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI * 0.15}
        maxPolarAngle={Math.PI * 0.85}
        enabled={!zoomTarget}
        autoRotate={autoRotateEnabled && !zoomTarget}
        autoRotateSpeed={0.6}
        onStart={() => setAutoRotateEnabled(false)}
      />
    </>
  );
}

// ── Public component ──

interface GlobeProps {
  selectedLanguageCode: string | null;
  onLanguageClick: (code: string) => void;
  zoomTarget?: { lat: number; lng: number } | null;
  className?: string;
  style?: React.CSSProperties;
}

export function Globe({
  selectedLanguageCode,
  onLanguageClick,
  zoomTarget = null,
  className = "",
  style,
}: GlobeProps) {
  // Expand to fullscreen during zoom so the sphere isn't clipped by the container boundary
  const containerStyle: React.CSSProperties = zoomTarget
    ? { position: "fixed", inset: 0, zIndex: 60 }
    : { width: "100%", height: "100%", ...style };

  return (
    <div className={zoomTarget ? "globe-zoom-enter" : className} style={containerStyle}>
      <Canvas
        camera={{ position: [0, 0, 5.0], fov: 45 }}
        style={{ background: zoomTarget ? "#09090b" : "transparent", touchAction: "none" }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 3, 5]} intensity={1.2} color="#ffffff" />
        <directionalLight position={[-3, -2, 4]} intensity={0.4} color="#93c5fd" />
        <directionalLight position={[0, 5, -3]} intensity={0.3} color="#a5b4fc" />
        <GlobeMesh
          selectedLanguageCode={selectedLanguageCode}
          onLanguageClick={onLanguageClick}
          zoomTarget={zoomTarget}
        />
      </Canvas>
    </div>
  );
}
