import React from "react";
import { OrbitControls } from "@react-three/drei";
import { Zone, CAMPUS_LAYOUT } from "./DashboardTypes";
import Ground from "./GroundComponent";
import Roads from "./RoadsComponent";
import CampusTrees from "../CampusTrees";
import CampusFurniture from "../CampusFurniture";
import Building from "./BuildingComponent";
import FirstPersonController from "./FirstPersonController";

interface DashboardSceneProps {
  zones: Zone[];
  selectedId: string;
  onSelect: (id: string) => void;
  walkMode: boolean;
  isMobile?: boolean;
  runMode?: boolean;
}

export default function DashboardScene({
  zones,
  selectedId,
  onSelect,
  walkMode,
  isMobile = false,
  runMode = false,
}: DashboardSceneProps) {
  return (
    <>
      <color attach="background" args={["#c0d4ee"]} />
      <fog attach="fog" args={["#c0d4ee", 30, 70]} />

      <ambientLight intensity={1.1} />
      <directionalLight
        position={[12, 20, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-near={0.5}
        shadow-camera-far={70}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />
      <directionalLight
        position={[-10, 12, -8]}
        intensity={0.35}
        color="#ddeeff"
      />
      <hemisphereLight args={["#c8daf0", "#3a7030", 0.5]} />

      <Ground />
      <Roads />
      <CampusTrees />
      <CampusFurniture />

      {CAMPUS_LAYOUT.map((layout) => {
        const zone = zones.find((z) => z.id === layout.id);
        if (!zone) return null;
        return (
          <Building
            key={layout.id}
            layout={layout}
            zone={zone}
            selected={selectedId === layout.id}
            onClick={() => onSelect(layout.id)}
          />
        );
      })}

      {walkMode ? (
        <FirstPersonController
          enabled={walkMode}
          isMobile={isMobile}
          runMode={runMode}
        />
      ) : (
        <OrbitControls
          makeDefault
          enablePan
          enableRotate
          enableZoom
          panSpeed={isMobile ? 0.9 : 1.5}
          rotateSpeed={isMobile ? 0.6 : 1}
          zoomSpeed={isMobile ? 0.8 : 1}
          minDistance={isMobile ? 5 : 6}
          maxDistance={isMobile ? 50 : 38}
          maxPolarAngle={Math.PI / (isMobile ? 2.05 : 2.15)}
          autoRotate={false}
          target={[1, 0, 1]}
        />
      )}
    </>
  );
}
