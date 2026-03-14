import { useRef, useMemo, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { LANGUAGES } from "../lib/cities";

// Convert lat/lng to 3D sphere coordinates
function latLngToVector3(
  lat: number,
  lng: number,
  radius: number
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Generate evenly-distributed dots on a sphere surface
function generateGlobeDots(count: number, radius: number): Float32Array {
  const positions = new Float32Array(count * 3);
  // Use fibonacci sphere for even distribution
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * i) / goldenRatio;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  return positions;
}

interface CityMarkerProps {
  lat: number;
  lng: number;
  radius: number;
  isSelected: boolean;
  isHighlighted: boolean;
  name: string;
  flag: string;
  onClick: () => void;
}

function CityMarker({
  lat,
  lng,
  radius,
  isSelected,
  isHighlighted,
  onClick,
}: CityMarkerProps) {
  const pos = useMemo(
    () => latLngToVector3(lat, lng, radius),
    [lat, lng, radius]
  );
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 1.5;
    }
    if (meshRef.current) {
      const targetScale = hovered || isSelected ? 1.6 : isHighlighted ? 1.2 : 0.8;
      meshRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        delta * 6
      );
    }
  });

  const color = isSelected ? "#ffffff" : isHighlighted ? "#e2e8f0" : "#64748b";

  return (
    <group position={pos}>
      <mesh
        ref={meshRef}
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
        <sphereGeometry args={[0.03, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {(isSelected || isHighlighted) && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.05, 0.065, 32]} />
          <meshBasicMaterial
            color={isSelected ? "#ffffff" : "#94a3b8"}
            transparent
            opacity={isSelected ? 0.9 : 0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

interface GlobeMeshProps {
  selectedLanguageCode: string | null;
  selectedCityId: string | null;
  onCityClick: (languageCode: string, cityId: string) => void;
}

function GlobeMesh({
  selectedLanguageCode,
  selectedCityId,
  onCityClick,
}: GlobeMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const radius = 1.8;

  const dotPositions = useMemo(() => generateGlobeDots(3000, radius), [radius]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.08;
    }
  });

  const cities = useMemo(() => {
    const result: Array<{
      languageCode: string;
      cityId: string;
      name: string;
      flag: string;
      lat: number;
      lng: number;
    }> = [];
    for (const lang of LANGUAGES) {
      for (const city of lang.cities) {
        result.push({
          languageCode: lang.code,
          cityId: city.id,
          name: city.name,
          flag: lang.flag,
          lat: city.lat,
          lng: city.lng,
        });
      }
    }
    return result;
  }, []);

  const dotGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(dotPositions, 3)
    );
    return geo;
  }, [dotPositions]);

  return (
    <group ref={groupRef}>
      {/* Globe dots */}
      <points geometry={dotGeometry}>
        <pointsMaterial
          color="#94a3b8"
          size={0.015}
          sizeAttenuation
          transparent
          opacity={0.6}
        />
      </points>

      {/* Equator & meridian rings for subtle structure */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.002, radius + 0.002, 128]} />
        <meshBasicMaterial
          color="#334155"
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* City markers */}
      {cities.map((city) => (
        <CityMarker
          key={`${city.languageCode}-${city.cityId}`}
          lat={city.lat}
          lng={city.lng}
          radius={radius + 0.01}
          name={city.name}
          flag={city.flag}
          isHighlighted={selectedLanguageCode === city.languageCode}
          isSelected={
            selectedLanguageCode === city.languageCode &&
            selectedCityId === city.cityId
          }
          onClick={() => onCityClick(city.languageCode, city.cityId)}
        />
      ))}
    </group>
  );
}

interface GlobeProps {
  selectedLanguageCode: string | null;
  selectedCityId: string | null;
  onCityClick: (languageCode: string, cityId: string) => void;
  className?: string;
}

export function Globe({
  selectedLanguageCode,
  selectedCityId,
  onCityClick,
  className = "",
}: GlobeProps) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 45 }}
        style={{ background: "transparent" }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.5} />
        <GlobeMesh
          selectedLanguageCode={selectedLanguageCode}
          selectedCityId={selectedCityId}
          onCityClick={onCityClick}
        />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          rotateSpeed={0.4}
          autoRotate={false}
          minPolarAngle={Math.PI * 0.3}
          maxPolarAngle={Math.PI * 0.7}
        />
      </Canvas>
    </div>
  );
}
