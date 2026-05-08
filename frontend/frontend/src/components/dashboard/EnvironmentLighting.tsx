"use client";

import React, { useState, useEffect } from "react";
import { Stars } from "@react-three/drei";

export default function EnvironmentLighting() {
  const [isNight, setIsNight] = useState(false);

  useEffect(() => {
    const checkTime = () => {
      const currentHour = new Date().getHours();
      // Night is from 18:00 (6 PM) to 5:59 AM (before 6 AM)
      /*if (true) {
        setIsNight(true);
      }// debugging */
      
      if (currentHour >= 18 || currentHour < 6) {
        setIsNight(true);
      } else {
        setIsNight(false);
      }// */
    };

    // Check immediately
    checkTime();

    // Check every 1 minute so it updates instantly when testing
    const interval = setInterval(checkTime, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {isNight ? (
        <>
          <color attach="background" args={["#121629"]} />
          <fog attach="fog" args={["#121629", 25, 75]} />

          <ambientLight intensity={0.5} color="#8090c0" />
          
          {/* Moon light */}
          <directionalLight
            position={[-15, 25, -15]}
            intensity={0.8}
            color="#cceeff"
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0004}
            shadow-camera-near={0.5}
            shadow-camera-far={80}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
          />
          
          {/* Subdued fill light */}
          <directionalLight
            position={[10, 10, 10]}
            intensity={0.3}
            color="#6677aa"
          />
          
          <hemisphereLight args={["#202a50", "#0a1020", 0.6]} />

          <Stars radius={60} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
        </>
      ) : (
        <>
          <color attach="background" args={["#c0d4ee"]} />
          <fog attach="fog" args={["#c0d4ee", 30, 70]} />

          <ambientLight intensity={1.1} />

          {/* Sun light */}
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
        </>
      )}
    </>
  );
}
