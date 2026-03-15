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
const EXTRUDE = 0.055; // how much land is raised above ocean
const GEO_DETAIL = 28; // icosahedron detail — balance between low-poly look and continent accuracy

// ISO 3166-1 numeric → language code
const COUNTRY_LANG: Record<string, string> = {
  "724": "es", // Spain
  "250": "fr", // France
  "276": "de", // Germany
  "392": "ja", // Japan
  "380": "it", // Italy
  "620": "pt", // Portugal
};

// Vibrant country fills — saturated for the supported countries
const LANG_FILL: Record<string, string> = {
  es: "#ef4444",
  fr: "#3b82f6",
  de: "#eab308",
  ja: "#f43f5e",
  it: "#14b8a6",
  pt: "#a855f7",
};

// Glow border color for supported countries
const LANG_STROKE: Record<string, string> = {
  es: "#fca5a5",
  fr: "#93c5fd",
  de: "#fde047",
  ja: "#fda4af",
  it: "#5eead4",
  pt: "#c4b5fd",
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

  // Ocean — deep vibrant blue
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

  return { color: colorCanvas, displacement: tempCanvas };
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
  const userDragging = useRef(false);

  // Disable raycasting on earth mesh so flags can be clicked
  useEffect(() => {
    if (earthRef.current) {
      earthRef.current.raycast = () => {};
    }
  }, []);

  const { earthTex, dispTex } = useMemo(() => {
    const { color, displacement } = createEarthTextures(2048, 1024);
    const ct = new THREE.CanvasTexture(color);
    ct.minFilter = THREE.LinearFilter;
    const dt = new THREE.CanvasTexture(displacement);
    dt.minFilter = THREE.LinearFilter;
    return { earthTex: ct, dispTex: dt };
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

        // Compute target camera position:
        // Get the 3D surface position of the target on the globe.
        // The globe group may have been rotated by user dragging (OrbitControls
        // moves camera, not group, but just in case), so use unrotated coords.
        // The flag pins use the same latLngToVec3 and they display correctly,
        // so we know this function gives the right world position (before group rot).
        const surfacePos = latLngToVec3(zoomTarget.lat, zoomTarget.lng, RADIUS);
        // The direction from origin toward that point is where the camera should be.
        // Place camera along that direction, at our desired zoom distance.
        const dir = surfacePos.clone().normalize();
        const zoomDist = 2.8;
        zoomTargetCamPos.current = dir.multiplyScalar(zoomDist);
      }

      const elapsed = clock.getElapsedTime() - zoomStart.current;
      const duration = 1.2;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out

      // Spherical interpolation from initial camera pos to target camera pos
      // This creates a smooth arc rather than a linear cut-through-the-globe path
      const startDir = zoomInitialCamPos.current.clone().normalize();
      const endDir = zoomTargetCamPos.current.clone().normalize();

      // Slerp the direction
      const qStart = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        startDir
      );
      const qEnd = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        endDir
      );
      const qCurrent = qStart.clone().slerp(qEnd, ease);
      const currentDir = new THREE.Vector3(0, 0, 1).applyQuaternion(qCurrent);

      // Lerp the distance
      const startDist = zoomInitialCamPos.current.length();
      const endDist = zoomTargetCamPos.current.length();
      const currentDist = startDist + (endDist - startDist) * ease;

      camera.position.copy(currentDir.multiplyScalar(currentDist));
      camera.lookAt(0, 0, 0);
    } else {
      zoomStart.current = null;
    }
  });

  return (
    <>
      <group ref={groupRef}>
        {/* Earth — low-poly faceted with raised continents */}
        <mesh ref={earthRef}>
          <icosahedronGeometry args={[RADIUS, GEO_DETAIL]} />
          <meshStandardMaterial
            map={earthTex}
            displacementMap={dispTex}
            displacementScale={EXTRUDE}
            flatShading
            roughness={0.75}
            metalness={0.05}
            emissive="#0f172a"
            emissiveIntensity={0.2}
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
        onStart={() => {
          userDragging.current = true;
        }}
        onEnd={() => {
          userDragging.current = false;
        }}
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
  return (
    <div className={className} style={{ width: "100%", height: "100%", ...style }}>
      <Canvas
        camera={{ position: [0, 0, 5.0], fov: 45 }}
        style={{ background: "transparent", touchAction: "none" }}
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
