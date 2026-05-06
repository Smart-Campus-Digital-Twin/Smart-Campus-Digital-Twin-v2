"use client";

import { useEffect, useState, useMemo } from "react";
import { Floor } from "./FloorData";

type Props = {
  floor: Floor;
  floorNumber: number;
  minFloor?: number;
  maxFloor: number;
  goUp: () => void;
  goDown: () => void;
  isMobile?: boolean;
  buildingId: string;
};

type RoomStats = {
  temp: number | null;
  occ: number | null;
  anomaly: boolean;
};

type RoomApiData = {
  room_id: string;
  floor: number;
  temperature: number;
  occupancy: number;
  energy: number;
};

export default function FloorPlan2D({
  floor,
  floorNumber,
  minFloor = 0,
  maxFloor,
  goUp,
  goDown,
  isMobile = false,
  buildingId,
}: Props) {
  const [stats, setStats] = useState<Record<string, RoomStats>>({});
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);
  const [isMobileView, setIsMobileView] = useState(isMobile);
  const [dynamicScale, setDynamicScale] = useState(isMobile ? 0.4 : 1.25);
  const [userZoom, setUserZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  const bounds = useMemo(
    () => ({
      minX: Math.min(...floor.rooms.map((r) => r.x), 0),
      maxX: Math.max(...floor.rooms.map((r) => r.x + r.width), 800),
      minY: Math.min(...floor.rooms.map((r) => r.y), 0),
      maxY: Math.max(...floor.rooms.map((r) => r.y + r.height), 500),
    }),
    [floor.rooms],
  );

  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 1024;
      setIsMobileView(isMobile);

      const paddingW = isMobile ? 5 : 40;
      const paddingH = isMobile ? 5 : 60;
      const availableWidth = window.innerWidth - paddingW * 2;
      const availableHeight =
        (isMobile ? window.innerHeight * 0.7 : window.innerHeight * 0.8) -
        paddingH * 2;

      const contentWidth = bounds.maxX - bounds.minX;
      const contentHeight = bounds.maxY - bounds.minY;

      const scaleW = availableWidth / contentWidth;
      const scaleH = availableHeight / contentHeight;

      let scale = Math.min(scaleW, scaleH);
      if (!isMobile) scale = Math.min(scale, 1.25);

      setDynamicScale(scale);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [bounds.maxX, bounds.minX, bounds.maxY, bounds.minY]);

  const SCALE = dynamicScale * userZoom;
  const planWidth = (bounds.maxX - bounds.minX) * SCALE;
  const planHeight = (bounds.maxY - bounds.minY) * SCALE;

  // Fetch live sensor data from the campus API
  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/campus/buildings/${buildingId}/rooms`);
        if (!res.ok) return;
        const data: RoomApiData[] = await res.json();

        const next: Record<string, RoomStats> = {};
        for (const room of data) {
          next[room.room_id] = {
            temp: room.temperature,
            occ: room.occupancy,
            anomaly: room.temperature > 32,
          };
        }
        if (!cancelled) setStats(next);
      } catch {
        // API unavailable — leave existing stats intact
      }
    };

    fetchStats();
    const timer = setInterval(fetchStats, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [buildingId]);

  const getRoomBackground = (type: string, isHovered: boolean, isOpenArea: boolean) => {
    if (isOpenArea) return "linear-gradient(135deg, rgba(144,238,144,0.3) 0%, rgba(53,162,159,0.4) 100%)";
    if (isHovered) return "linear-gradient(135deg, rgba(151,254,237,0.4) 0%, rgba(11,102,106,0.8) 100%)";
    switch (type) {
      case "lab":        return "linear-gradient(135deg, rgba(30,80,160,0.75) 0%, rgba(7,25,82,0.9) 100%)";
      case "office":     return "linear-gradient(135deg, rgba(20,100,60,0.75) 0%, rgba(7,40,30,0.9) 100%)";
      case "server_room":return "linear-gradient(135deg, rgba(60,20,100,0.85) 0%, rgba(20,10,40,0.95) 100%)";
      case "library":    return "linear-gradient(135deg, rgba(120,80,20,0.75) 0%, rgba(60,30,5,0.9) 100%)";
      default:           return "linear-gradient(135deg, rgba(11,102,106,0.75) 0%, rgba(7,25,82,0.9) 100%)";
    }
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        position: "relative",
        borderRadius: isMobileView ? "8px" : "24px",
        background: "rgba(11, 102, 106, 0.05)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(151, 254, 237, 0.15)",
        boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.5)",
        padding: isMobileView ? "5px" : "40px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        transition: "all 0.3s ease",
        overflow: "hidden",
        touchAction: "pan-x pan-y",
      }}
    >
      {/* Zoom Controls */}
      <div
        style={{
          position: "absolute",
          top: isMobileView ? 10 : 20,
          right: isMobileView ? 10 : 20,
          zIndex: 100,
          display: "flex",
          gap: "8px",
        }}
      >
        <button
          onClick={() => setUserZoom((prev) => Math.min(prev + 0.2, 3))}
          style={{
            width: 32, height: 32, borderRadius: "6px",
            background: "rgba(7, 25, 82, 0.8)", color: "#97FEED",
            border: "1px solid #97FEED33", fontWeight: "bold", cursor: "pointer",
          }}
        >+</button>
        <button
          onClick={() => setUserZoom((prev) => Math.max(prev - 0.2, 0.5))}
          style={{
            width: 32, height: 32, borderRadius: "6px",
            background: "rgba(7, 25, 82, 0.8)", color: "#97FEED",
            border: "1px solid #97FEED33", fontWeight: "bold", cursor: "pointer",
          }}
        >-</button>
        <button
          onClick={() => setUserZoom(1)}
          style={{
            padding: "0 8px", height: 32, borderRadius: "6px",
            background: "rgba(7, 25, 82, 0.8)", color: "#97FEED",
            border: "1px solid #97FEED33", fontSize: "10px",
            fontWeight: "bold", cursor: "pointer",
          }}
        >RESET</button>
      </div>

      <div
        style={{
          width: "100%",
          height: isMobileView ? "75vh" : "100%",
          overflow: "auto",
          display: "flex",
          justifyContent: userZoom > 1 ? "flex-start" : "center",
          alignItems: userZoom > 1 ? "flex-start" : "center",
          cursor: isPanning ? "grabbing" : "grab",
          WebkitOverflowScrolling: "touch",
        }}
        onMouseDown={(e) => {
          const c = e.currentTarget;
          setIsPanning(true);
          c.dataset.panStartX = String(e.clientX);
          c.dataset.panStartY = String(e.clientY);
          c.dataset.panScrollLeft = String(c.scrollLeft);
          c.dataset.panScrollTop = String(c.scrollTop);
        }}
        onMouseMove={(e) => {
          if (!isPanning) return;
          const c = e.currentTarget;
          const sx = Number(c.dataset.panStartX);
          const sy = Number(c.dataset.panStartY);
          const sl = Number(c.dataset.panScrollLeft);
          const st = Number(c.dataset.panScrollTop);
          if (isNaN(sx) || isNaN(sy) || isNaN(sl) || isNaN(st)) return;
          c.scrollLeft = sl - (e.clientX - sx);
          c.scrollTop  = st - (e.clientY - sy);
        }}
        onMouseUp={(e) => {
          setIsPanning(false);
          const c = e.currentTarget;
          delete c.dataset.panStartX; delete c.dataset.panStartY;
          delete c.dataset.panScrollLeft; delete c.dataset.panScrollTop;
        }}
        onMouseLeave={(e) => {
          setIsPanning(false);
          const c = e.currentTarget;
          delete c.dataset.panStartX; delete c.dataset.panStartY;
          delete c.dataset.panScrollLeft; delete c.dataset.panScrollTop;
        }}
      >
        <div
          style={{
            width: floor.planImage ? "100%" : Math.max(planWidth, 200),
            height: floor.planImage ? "100%" : Math.max(planHeight, 200),
            position: "relative",
            flexShrink: 0,
            margin: userZoom > 1 ? "20px" : "0",
          }}
        >
          {floor.planImage ? (
            <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", justifyContent: "center" }}>
              <img
                src={floor.planImage}
                alt={`Floor ${floorNumber} Plan`}
                style={{
                  maxWidth: userZoom > 1 ? "none" : "100%",
                  maxHeight: userZoom > 1 ? "none" : isMobileView ? "60vh" : "70vh",
                  width: userZoom > 1 ? `${100 * userZoom}%` : "auto",
                  borderRadius: isMobileView ? "8px" : "16px",
                  objectFit: "contain",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                  border: "1px solid rgba(151, 254, 237, 0.2)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          ) : (
            floor.rooms.map((room) => {
              const isHovered   = hoveredRoom === room.id;
              const isStairs    = room.type === "stairs";
              const isFree      = room.type === "free";
              const isOpenArea  = room.name === "Open Area";
              const roomStats   = stats[room.id];
              const hasData     = !isStairs && !isFree && !isOpenArea && roomStats != null;

              return (
                <div
                  key={room.id}
                  onMouseEnter={() => setHoveredRoom(room.id)}
                  onMouseLeave={() => setHoveredRoom(null)}
                  style={{
                    position: "absolute",
                    left: (room.x - bounds.minX) * SCALE,
                    top:  (room.y - bounds.minY) * SCALE,
                    width:  room.width  * SCALE,
                    height: room.height * SCALE,
                    borderRadius: "0px",
                    border: isHovered
                      ? "2.5px solid #97FEED"
                      : "1.5px solid rgba(0, 0, 0, 0.8)",
                    background: isStairs
                      ? "linear-gradient(135deg, #FFD166 0%, #F5A623 100%)"
                      : isFree
                        ? "rgba(255, 255, 255, 0.05)"
                        : getRoomBackground(room.type, isHovered, isOpenArea),
                    boxShadow: isHovered
                      ? "0 0 30px rgba(151, 254, 237, 0.5)"
                      : "0 6px 20px rgba(0,0,0,0.3)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    padding: "4px",
                    transition: "all 0.3s ease",
                    cursor: "pointer",
                    zIndex: isHovered ? 10 : 1,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ textAlign: "center", color: isHovered ? "#97FEED" : "#fff", textShadow: "0 2px 4px rgba(0,0,0,0.3)" }}>
                    {/* Room name */}
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: isMobileView
                          ? `${Math.min(9, Math.max(6, room.width * SCALE * 0.07))}px`
                          : `clamp(10px, ${room.width * SCALE * 0.12}px, 15px)`,
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                        lineHeight: 1.0,
                        wordBreak: "break-word",
                        whiteSpace: "normal",
                        width: "100%",
                        padding: "0 1px",
                        display: room.width * SCALE < 15 ? "none" : "block",
                        textShadow: "0 1px 1px rgba(0,0,0,0.8)",
                      }}
                    >
                      {room.name || "UNNAMED"}
                    </div>

                    {/* Sensor readings */}
                    {hasData && (
                      <div
                        style={{
                          fontSize: isMobileView
                            ? `${Math.min(8, Math.max(5, room.width * SCALE * 0.06))}px`
                            : `clamp(9px, ${room.width * SCALE * 0.1}px, 13px)`,
                          marginTop: isMobileView ? 1 : 6,
                          fontWeight: 600,
                          opacity: isHovered ? 1 : 0.85,
                          display: room.height * SCALE < 35 ? "none" : "block",
                          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                        }}
                      >
                        {roomStats.temp !== null && (
                          <div style={{ color: roomStats.temp > 30 ? "#FF4B2B" : "#97FEED" }}>
                            {roomStats.temp.toFixed(1)}°C
                          </div>
                        )}
                        {roomStats.occ !== null && (
                          <div style={{ color: roomStats.occ > 100 ? "#F5A623" : "#97FEED" }}>
                            {Math.round(roomStats.occ)} ppl
                          </div>
                        )}
                        {roomStats.anomaly && (
                          <div
                            style={{
                              color: "#FF4B2B",
                              fontWeight: 800,
                              marginTop: 2,
                              textShadow: "0 0 6px rgba(255,75,43,0.8)",
                              display: room.height * SCALE < 60 ? "none" : "block",
                            }}
                          >
                            ⚠ ANOMALY
                          </div>
                        )}
                      </div>
                    )}

                    {/* No live data yet */}
                    {!isStairs && !isFree && !isOpenArea && !roomStats && room.width * SCALE > 40 && room.height * SCALE > 35 && (
                      <div style={{ fontSize: `clamp(8px, ${room.width * SCALE * 0.08}px, 11px)`, opacity: 0.45, marginTop: 4 }}>
                        --
                      </div>
                    )}

                    {/* Stairs navigation buttons */}
                    {isStairs && (
                      <div style={{ display: "flex", gap: isMobileView ? "4px" : "8px", marginTop: isMobileView ? "4px" : "10px" }}>
                        {floorNumber < maxFloor && (
                          <button
                            onClick={(e) => { e.stopPropagation(); goUp(); }}
                            style={{
                              padding: isMobileView ? "6px 10px" : "6px 12px",
                              cursor: "pointer", borderRadius: "4px", border: "none",
                              background: "#071952", color: "#97FEED",
                              fontWeight: "bold", fontSize: isMobileView ? 9 : 10,
                            }}
                          >UP</button>
                        )}
                        {floorNumber > minFloor && (
                          <button
                            onClick={(e) => { e.stopPropagation(); goDown(); }}
                            style={{
                              padding: isMobileView ? "6px 10px" : "6px 12px",
                              cursor: "pointer", borderRadius: "4px", border: "none",
                              background: "#071952", color: "#97FEED",
                              fontWeight: "bold", fontSize: isMobileView ? 9 : 10,
                            }}
                          >DN</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
