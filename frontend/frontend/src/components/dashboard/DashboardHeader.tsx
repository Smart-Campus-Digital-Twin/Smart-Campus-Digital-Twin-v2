"use client";
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePrefersReducedMotion } from "@/app/hooks/usePrefersReducedMotion";
import { Zone, STATUS_COLORS } from "./DashboardTypes";

interface DashboardHeaderProps {
  campusLoad: number;
  campusOcc: number;
  activeZonesCount: number;
  criticalCount: number;
  zones: Zone[];
  isMobile?: boolean;
}

export default function DashboardHeader({
  campusLoad,
  campusOcc,
  activeZonesCount,
  criticalCount,
  zones,
  isMobile = false,
}: DashboardHeaderProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [showPanel, setShowPanel] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Close panel on outside click (exclude both the panel and the toggle button)
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const outsidePanel  = !panelRef.current  || !panelRef.current.contains(target);
      const outsideButton = !buttonRef.current || !buttonRef.current.contains(target);
      if (outsidePanel && outsideButton) setShowPanel(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPanel]);

  const alertZones = [...zones].sort((a, b) => {
    const order = { critical: 0, busy: 1, normal: 2 };
    return order[a.status] - order[b.status];
  });

  const nonNormalZones = alertZones.filter((z) => z.status !== "normal");

  return (
    <header
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        justifyContent: "space-between",
        alignItems: isMobile ? "flex-start" : "flex-end",
        background: "rgba(11, 102, 106, 0.15)",
        backdropFilter: "blur(10px)",
        padding: isMobile ? "10px 14px" : "24px 30px",
        borderRadius: isMobile ? 16 : 24,
        border: "1px solid rgba(151, 254, 237, 0.2)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        gap: isMobile ? 16 : 24,
        position: "relative",
      }}
    >
      <div>
        <p
          style={{
            fontSize: isMobile ? 9 : 11,
            color: "#97FEED",
            fontWeight: 800,
            letterSpacing: "2px",
            textTransform: "uppercase",
            opacity: 0.8,
          }}
        >
          Group I3 • University of Moratuwa
        </p>
        <h1
          style={{
            fontSize: isMobile ? 24 : 42,
            fontWeight: 900,
            color: "#fff",
            letterSpacing: "-1.5px",
            margin: "4px 0",
            textShadow: "0 4px 20px rgba(151, 254, 237, 0.3)",
          }}
        >
          Smart Campus <span style={{ color: "#97FEED" }}>Twin Control</span>
        </h1>
        {!isMobile && (
          <p style={{ color: "rgba(151, 254, 237, 0.6)", fontSize: 13, fontWeight: 500 }}>
            Real-time 3D campus infrastructure monitoring — occupancy · temperature · energy states
          </p>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, auto)",
          gap: isMobile ? 8 : 16,
          width: isMobile ? "100%" : "auto",
        }}
      >
        {[
          { label: "CAMPUS ENERGY", value: `${campusLoad.toFixed(1)} kW` },
          { label: "AVG OCCUPANCY", value: `${campusOcc}%` },
          { label: "ACTIVE ZONES",  value: `${activeZonesCount}` },
        ].map((stat, i) => (
          <div
            key={i}
            role="region"
            aria-label={`${stat.label}: ${stat.value}`}
            style={{
              background: "rgba(7, 25, 82, 0.4)",
              border: "1px solid rgba(151, 254, 237, 0.2)",
              padding: isMobile ? "8px 12px" : "12px 20px",
              borderRadius: 16,
              minWidth: isMobile ? 0 : 140,
            }}
          >
            <p style={{ fontSize: isMobile ? 8 : 9, fontWeight: 800, color: "rgba(151,254,237,0.5)", marginBottom: 4 }}>
              {stat.label}
            </p>
            <p style={{ fontSize: isMobile ? 14 : 18, fontWeight: 800, color: "#97FEED" }}>
              {stat.value}
            </p>
          </div>
        ))}

        {/* Clickable ALERTS card */}
        <div>
          <button
            ref={buttonRef}
            onClick={() => setShowPanel((v) => !v)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: criticalCount > 0 ? "rgba(232,93,36,0.15)" : "rgba(7,25,82,0.4)",
              border: `1px solid ${criticalCount > 0 ? "rgba(235,9,9,0.6)" : "rgba(151,254,237,0.2)"}`,
              padding: isMobile ? "8px 12px" : "12px 20px",
              borderRadius: 16,
              minWidth: isMobile ? 0 : 140,
              cursor: "pointer",
              animation: criticalCount > 0 && !prefersReducedMotion ? "alertPulse 1.8s ease-in-out infinite" : "none",
              boxShadow: criticalCount > 0 ? "0 0 20px rgba(235,9,9,0.15)" : showPanel ? "0 0 16px rgba(151,254,237,0.2)" : "none",
              outline: showPanel ? "1px solid rgba(151,254,237,0.4)" : "none",
              transition: prefersReducedMotion ? "none" : "background 0.4s, border 0.4s, box-shadow 0.4s",
            }}
          >
            <p style={{ fontSize: isMobile ? 8 : 9, fontWeight: 800, color: "rgba(151,254,237,0.5)", marginBottom: 4 }}>
              ALERTS
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {criticalCount > 0 && (
                <span
                  style={{
                    width: 8, height: 8, borderRadius: "50%", background: "#eb0909", flexShrink: 0,
                    animation: !prefersReducedMotion ? "dotFlash 0.9s ease-in-out infinite" : "none",
                  }}
                />
              )}
              <p style={{ fontSize: isMobile ? 14 : 18, fontWeight: 800, color: criticalCount > 0 ? "#eb0909" : "#97FEED" }}>
                {criticalCount > 0 ? `${criticalCount} critical` : "None"}
              </p>
            </div>
          </button>

        </div>

        {/* Alert panel — rendered via portal into document.body so it always
            appears above the Three.js WebGL canvas regardless of z-index */}
        {mounted && showPanel && createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: isMobile ? 80 : 100,
              right: isMobile ? 16 : 32,
              zIndex: 99999,
              width: isMobile ? "calc(100vw - 32px)" : 420,
              maxHeight: "60vh",
              background: "rgba(7, 20, 60, 0.97)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(151,254,237,0.2)",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Panel header */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(151,254,237,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 800, color: "#97FEED", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                  Live Anomaly & Alert Status
                </p>
                <p style={{ fontSize: 10, color: "rgba(151,254,237,0.45)", marginTop: 2 }}>
                  {nonNormalZones.length} zone{nonNormalZones.length !== 1 ? "s" : ""} with elevated status
                </p>
              </div>
              <button
                onClick={() => setShowPanel(false)}
                style={{ background: "rgba(151,254,237,0.08)", border: "1px solid rgba(151,254,237,0.2)", color: "#97FEED", width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 800, lineHeight: 1 }}
              >✕</button>
            </div>

            {/* Zone list */}
            <div style={{ overflowY: "auto", flex: 1, padding: "8px 0" }}>
              {alertZones.length === 0 ? (
                <p style={{ color: "rgba(151,254,237,0.4)", fontSize: 12, textAlign: "center", padding: "24px 0" }}>No zone data yet</p>
              ) : (
                alertZones.map((zone) => (
                  <div
                    key={zone.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "9px 18px",
                      borderBottom: "1px solid rgba(151,254,237,0.05)",
                      background: zone.status === "critical" ? "rgba(235,9,9,0.06)" : zone.status === "busy" ? "rgba(245,166,35,0.05)" : "transparent",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: STATUS_COLORS[zone.status], boxShadow: zone.status !== "normal" ? `0 0 6px ${STATUS_COLORS[zone.status]}` : "none" }} />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#e2e8f0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {zone.name}
                    </span>
                    <div style={{ display: "flex", gap: 10, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                      <span style={{ color: zone.temperatureC > 32 ? "#FF4B2B" : "rgba(151,254,237,0.6)" }}>{zone.temperatureC.toFixed(1)}°C</span>
                      <span style={{ color: zone.occupancy > 80 ? "#F5A623" : "rgba(151,254,237,0.6)" }}>{zone.occupancy}%</span>
                      {zone.anomalyCount > 0 && (
                        <span style={{ color: "#FF4B2B", background: "rgba(255,75,43,0.15)", padding: "1px 6px", borderRadius: 4 }}>⚠ {zone.anomalyCount}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase", padding: "2px 8px", borderRadius: 6, flexShrink: 0, background: zone.status === "critical" ? "rgba(235,9,9,0.2)" : zone.status === "busy" ? "rgba(245,166,35,0.2)" : "rgba(53,162,159,0.15)", color: STATUS_COLORS[zone.status], border: `1px solid ${STATUS_COLORS[zone.status]}44` }}>
                      {zone.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
      </div>

      <style>{`
        @keyframes alertPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 20px rgba(235,9,9,0.3); }
          50%       { opacity: 0.7; box-shadow: 0 0 35px rgba(235,9,9,0.7); }
        }
        @keyframes dotFlash {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
      `}</style>
    </header>
  );
}
