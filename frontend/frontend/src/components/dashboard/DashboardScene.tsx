import React from "react";
import { OrbitControls } from "@react-three/drei";
import { Zone, CAMPUS_LAYOUT } from "./DashboardTypes";
import Ground from "./GroundComponent";
import Roads from "./RoadsComponent";
import CampusTrees from "../CampusTrees";
import CampusFurniture from "../CampusFurniture";
import Building from "./BuildingComponent";
import FirstPersonController from "./FirstPersonController";
import EnvironmentLighting from "./EnvironmentLighting";

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
      <EnvironmentLighting />

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
