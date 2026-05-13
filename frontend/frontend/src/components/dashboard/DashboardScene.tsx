import React from "react";
import { OrbitControls } from "@react-three/drei";
import { Zone, CAMPUS_LAYOUT } from "./DashboardTypes";
import Ground from "./GroundComponent";
import Roads from "./RoadsComponent";
import CampusTrees from "../CampusTrees";
import CampusFurniture from "../CampusFurniture";
import Building from "./BuildingComponent";
import FirstPersonController from "./FirstPersonController";
import SkyObjects from "./SkyObjects";

interface DashboardSceneProps {
  zones: Zone[];
  selectedId: string;
  onSelect: (id: string) => void;
  walkMode: boolean;
  isMobile?: boolean;
  runMode?: boolean;
  skyMode?: "day" | "evening" | "night";
}

export default function DashboardScene({
  zones,
  selectedId,
  onSelect,
  walkMode,
  isMobile = false,
  runMode = false,
  skyMode = "day",
}: DashboardSceneProps) {
  // Sky and lighting configuration based on mode
  const skyConfig = {
    day: {
      background: "#c0d4ee",
      fog: "#c0d4ee",
      ambientIntensity: 1.1,
      sunIntensity: 1.5,
      sunColor: "#ffffff",
      fillIntensity: 0.35,
      fillColor: "#ddeeff",
      hemisphereTop: "#c8daf0",
      hemisphereBottom: "#3a7030",
      hemisphereIntensity: 0.5,
    },
    evening: {
      background: "#ff8c42",
      fog: "#ff8c42",
      ambientIntensity: 0.7,
      sunIntensity: 1.2,
      sunColor: "#ff6b35",
      fillIntensity: 0.25,
      fillColor: "#ff9966",
      hemisphereTop: "#ff8c42",
      hemisphereBottom: "#4a3020",
      hemisphereIntensity: 0.4,
    },
    night: {
      background: "#0a1128",
      fog: "#0a1128",
      ambientIntensity: 0.3,
      sunIntensity: 0.4,
      sunColor: "#6b8cae",
      fillIntensity: 0.15,
      fillColor: "#4a5f7f",
      hemisphereTop: "#1a2744",
      hemisphereBottom: "#0d1b2a",
      hemisphereIntensity: 0.2,
    },
  };

  const config = skyConfig[skyMode];
  return (
    <>
      <color attach="background" args={[config.background]} />
      <fog attach="fog" args={[config.fog, 30, 70]} />

      <ambientLight intensity={config.ambientIntensity} />
      <directionalLight
        position={[12, 20, 10]}
        intensity={config.sunIntensity}
        color={config.sunColor}
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
        intensity={config.fillIntensity}
        color={config.fillColor}
      />
      <hemisphereLight args={[config.hemisphereTop, config.hemisphereBottom, config.hemisphereIntensity]} />

      <SkyObjects skyMode={skyMode} />

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
