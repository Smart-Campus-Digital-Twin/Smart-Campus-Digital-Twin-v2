import React from "react";
import { Sphere } from "@react-three/drei";

interface SkyObjectsProps {
  skyMode: "day" | "evening" | "night";
}

export default function SkyObjects({ skyMode }: SkyObjectsProps) {
  if (skyMode === "day") {
    // Bright sun - visible in the sky
    return (
      <group position={[15, 25, -10]}>
        {/* Sun core */}
        <Sphere args={[2.5, 32, 32]}>
          <meshBasicMaterial color="#FDB813" toneMapped={false} />
        </Sphere>
        {/* Sun glow */}
        <Sphere args={[3.5, 32, 32]}>
          <meshBasicMaterial color="#FFE066" transparent opacity={0.4} toneMapped={false} />
        </Sphere>
        {/* Outer glow */}
        <Sphere args={[5, 32, 32]}>
          <meshBasicMaterial color="#FFEB99" transparent opacity={0.2} toneMapped={false} />
        </Sphere>
      </group>
    );
  }

  if (skyMode === "evening") {
    // Setting sun - lower position, orange/red
    return (
      <group position={[20, 15, -8]}>
        {/* Sun core */}
        <Sphere args={[3, 32, 32]}>
          <meshBasicMaterial color="#FF6B35" toneMapped={false} />
        </Sphere>
        {/* Sun glow */}
        <Sphere args={[4.5, 32, 32]}>
          <meshBasicMaterial color="#FF8C42" transparent opacity={0.5} toneMapped={false} />
        </Sphere>
        {/* Outer glow */}
        <Sphere args={[6, 32, 32]}>
          <meshBasicMaterial color="#FFB366" transparent opacity={0.25} toneMapped={false} />
        </Sphere>
      </group>
    );
  }

  // Night - Moon with craters and glow
  return (
    <group position={[-15, 28, -12]}>
      {/* Moon glow */}
      <Sphere args={[3, 32, 32]}>
        <meshBasicMaterial color="#6b8cae" transparent opacity={0.25} toneMapped={false} />
      </Sphere>
      {/* Main moon */}
      <Sphere args={[2, 32, 32]}>
        <meshStandardMaterial
          color="#E8E8E8"
          emissive="#6b8cae"
          emissiveIntensity={0.6}
          roughness={0.9}
          toneMapped={false}
        />
      </Sphere>
      {/* Craters - visible details */}
      <Sphere args={[0.4, 16, 16]} position={[0.6, 0.4, 1.8]}>
        <meshStandardMaterial color="#B8B8B8" roughness={1} />
      </Sphere>
      <Sphere args={[0.35, 16, 16]} position={[-0.7, -0.2, 1.8]}>
        <meshStandardMaterial color="#C0C0C0" roughness={1} />
      </Sphere>
      <Sphere args={[0.3, 16, 16]} position={[0.2, -0.8, 1.8]}>
        <meshStandardMaterial color="#B0B0B0" roughness={1} />
      </Sphere>
      <Sphere args={[0.25, 16, 16]} position={[-0.3, 0.7, 1.8]}>
        <meshStandardMaterial color="#C8C8C8" roughness={1} />
      </Sphere>
    </group>
  );
}
