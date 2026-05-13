import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

type OccupancyPoint = {
  hour: string;
  value: number;
};

type OccupancySeries = {
  actual: OccupancyPoint[];
  predicted: OccupancyPoint[];
};

type CanteenForecast = {
  kind: "canteen";
  id: string;
  name: string;
  capacity: number;
  series: OccupancySeries;
};

type FloorForecast = {
  floor: number;
  label: string;
  capacity: number;
  series: OccupancySeries;
};

type LibraryForecast = {
  kind: "library";
  id: string;
  name: string;
  floors: FloorForecast[];
};

type LocationForecast = CanteenForecast | LibraryForecast;

const formatLocalHour = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Colombo",
  }).format(date);

const formatLocalLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Colombo",
  }).format(date);

const buildSeries = (actual: number[], predicted: number[], now = new Date()): OccupancySeries => {
  const actualSeries = actual.map((value, index) => {
    const stamp = new Date(now);
    stamp.setHours(now.getHours() - (actual.length - 1 - index));
    return { hour: formatLocalLabel(stamp), value };
  });

  const predictedSeries = predicted.map((value, index) => {
    const stamp = new Date(now);
    stamp.setHours(now.getHours() + (index + 1));
    return { hour: formatLocalLabel(stamp), value };
  });

  return {
    actual: actualSeries,
    predicted: predictedSeries,
  };
};

const CONGESTION_LOCATIONS: Record<string, LocationForecast> = {
  "Goda canteen": {
    kind: "canteen",
    id: "Goda canteen",
    name: "Goda Canteen",
    capacity: 160,
    series: buildSeries([48, 62, 84, 108, 126, 138], [132, 118, 96, 76]),
  },
  Sentra: {
    kind: "canteen",
    id: "Sentra",
    name: "Sentra Court",
    capacity: 140,
    series: buildSeries([38, 50, 64, 82, 98, 108], [102, 92, 76, 58]),
  },
  canteen: {
    kind: "canteen",
    id: "canteen",
    name: "L Canteen",
    capacity: 110,
    series: buildSeries([26, 38, 48, 62, 76, 82], [78, 68, 56, 44]),
  },
  wala_canteen: {
    kind: "canteen",
    id: "wala_canteen",
    name: "Wala Canteen",
    capacity: 80,
    series: buildSeries([14, 20, 28, 38, 48, 52], [50, 44, 36, 28]),
  },
  library: {
    kind: "library",
    id: "library",
    name: "Library",
    floors: [
      {
        floor: 1,
        label: "Floor 1 - Reading Hall",
        capacity: 180,
        series: buildSeries([58, 72, 90, 112, 126, 138], [132, 124, 112, 100]),
      },
      {
        floor: 2,
        label: "Floor 2 - Study Area",
        capacity: 150,
        series: buildSeries([46, 58, 76, 92, 106, 114], [110, 102, 94, 84]),
      },
      {
        floor: 3,
        label: "Floor 3 - Research Lounge",
        capacity: 120,
        series: buildSeries([28, 34, 44, 54, 62, 68], [66, 60, 54, 46]),
      },
    ],
  },
};

const LEVEL_COLORS: Record<"Low" | "Medium" | "High", string> = {
  Low: "#35A29F",
  Medium: "#F5A623",
  High: "#E85D24",
};

const getCongestionLevel = (value: number, capacity: number) => {
  const ratio = capacity > 0 ? value / capacity : 0;
  if (ratio >= 0.8) return "High";
  if (ratio >= 0.5) return "Medium";
  return "Low";
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function CombinedLineChart({ actual, predicted }: OccupancySeries) {
  const labels = [...actual.map((point) => point.hour), ...predicted.map((point) => point.hour)];
  const totalPoints = labels.length;
  const width = 900;
  const height = 260;
  const pad = 36;
  const xStep = totalPoints > 1 ? (width - pad * 2) / (totalPoints - 1) : 0;

  const toX = (index: number) => pad + index * xStep;
  const maxValue = Math.max(...actual.map((point) => point.value), ...predicted.map((point) => point.value), 1);
  const toY = (value: number) => pad + ((maxValue - value) / maxValue) * (height - pad * 2);
  const guideValues = [0, Math.round(maxValue * 0.25), Math.round(maxValue * 0.5), Math.round(maxValue * 0.75), maxValue];

  const actualPoints = actual.map((point, index) => ({ index, value: point.value }));
  const predictedPoints = predicted.map((point, index) => ({
    index: actual.length + index,
    value: point.value,
  }));
  const predictedPathPoints = actualPoints.length > 0
    ? [{ index: actualPoints[actualPoints.length - 1].index, value: actualPoints[actualPoints.length - 1].value }, ...predictedPoints]
    : predictedPoints;

  const buildPath = (points: Array<{ index: number; value: number }>) =>
    points
      .map((point, idx) => `${idx === 0 ? "M" : "L"} ${toX(point.index)} ${toY(point.value)}`)
      .join(" ");

  const actualPath = buildPath(actualPoints);
  const predictedPath = buildPath(predictedPathPoints);
  const nowIndex = Math.max(actual.length - 1, 0);

  return (
    <div
      style={{
        background: "rgba(7, 25, 82, 0.45)",
        border: "1px solid rgba(151, 254, 237, 0.25)",
        borderRadius: 16,
        padding: "18px 18px 14px",
        boxShadow: "0 14px 30px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#97FEED" }}>
          <span style={{ width: 18, height: 2, background: "#97FEED" }} />
          Actual
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#35A29F" }}>
          <span style={{ width: 18, height: 2, background: "#35A29F", borderTop: "2px dashed #35A29F" }} />
          Predicted
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "260px" }}>
        {guideValues.map((value) => (
          <line
            key={value}
            x1={pad}
            x2={width - pad}
            y1={toY(value)}
            y2={toY(value)}
            stroke="rgba(151, 254, 237, 0.12)"
            strokeWidth={1}
          />
        ))}
        <line
          x1={toX(nowIndex)}
          x2={toX(nowIndex)}
          y1={pad}
          y2={height - pad}
          stroke="rgba(151, 254, 237, 0.25)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <path
          d={actualPath}
          fill="none"
          stroke="#97FEED"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={predictedPath}
          fill="none"
          stroke="#35A29F"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="6 6"
        />
      </svg>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${totalPoints}, minmax(0, 1fr))`,
          gap: 4,
          marginTop: 8,
          fontSize: 11,
          color: "#97FEED",
          textAlign: "center",
        }}
      >
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "#CBD5F5", textAlign: "right" }}>
        Counts scale, not percentage.
      </div>
    </div>
  );
}

export default async function CongestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ floor?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  let decodedId = id;
  try {
    decodedId = decodeURIComponent(id);
  } catch {
    decodedId = id;
  }

  const location = CONGESTION_LOCATIONS[decodedId];
  if (!location) {
    return notFound();
  }

  const selectedFloorNumber = location.kind === "library"
    ? clamp(Number(resolvedSearchParams.floor ?? 1), 1, location.floors.length)
    : 1;
  const selectedFloor = location.kind === "library"
    ? location.floors.find((floor) => floor.floor === selectedFloorNumber) ?? location.floors[0]
    : undefined;
  let series: OccupancySeries;
  if (location.kind === "library") {
    series = selectedFloor?.series ?? location.floors[0].series;
  } else {
    series = location.series;
  }
  const currentPoint = series.actual[series.actual.length - 1];
  const predictedNext = series.predicted[0] ?? currentPoint;
  const currentCapacity = location.kind === "library" ? selectedFloor?.capacity ?? location.floors[0].capacity : location.capacity;
  const congestionLevel = getCongestionLevel(currentPoint.value, currentCapacity);
  const locationPath = encodeURIComponent(decodedId);
  const currentLocalTime = formatLocalHour(new Date());

  const summaryCardStyle = {
    background: "rgba(7, 25, 82, 0.45)",
    border: "1px solid rgba(151, 254, 237, 0.25)",
    borderRadius: 14,
    padding: "14px 16px",
    boxShadow: "0 12px 24px rgba(0,0,0,0.35)",
  } as const;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at center, #0B666A 0%, #071952 100%)",
        color: "#E2E8F0",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "120px 24px 72px",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "#97FEED",
            textDecoration: "none",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            fontSize: 12,
          }}
        >
          <ArrowLeft size={16} />
          Back to campus
        </Link>
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12 }}>
            <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", margin: 0, color: "#F8FAFC" }}>
              {location.name}
            </h1>
            {location.kind === "library" && selectedFloor ? (
              <span style={{ fontSize: 14, color: "#97FEED", fontWeight: 600 }}>
                {selectedFloor.label}
              </span>
            ) : null}
          </div>
          {location.kind === "library" ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {location.floors.map((floor) => {
                const active = floor.floor === selectedFloorNumber;
                return (
                  <Link
                    key={floor.floor}
                    href={`/congestion/${locationPath}?floor=${floor.floor}`}
                    style={{
                      textDecoration: "none",
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: active ? "1px solid #97FEED" : "1px solid rgba(151, 254, 237, 0.25)",
                      color: active ? "#071952" : "#97FEED",
                      background: active ? "#97FEED" : "rgba(7, 25, 82, 0.35)",
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    Floor {floor.floor}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        <section style={{ marginTop: 24 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            <div style={summaryCardStyle}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "#97FEED" }}>
                Current Occupancy
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#F8FAFC", marginTop: 6 }}>
                {currentPoint.value} people
              </div>
              <div style={{ fontSize: 12, color: "#CBD5F5", marginTop: 4 }}>
                As of {currentPoint.hour} local time
              </div>
            </div>
            <div style={summaryCardStyle}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "#97FEED" }}>
                Predicted Occupancy
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#F8FAFC", marginTop: 6 }}>
                {predictedNext.value} people
              </div>
              <div style={{ fontSize: 12, color: "#CBD5F5", marginTop: 4 }}>
                Next hour at {predictedNext.hour} local time
              </div>
            </div>
            <div style={summaryCardStyle}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "#97FEED" }}>
                Current Congestion Level
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: LEVEL_COLORS[congestionLevel], marginTop: 6 }}>
                {congestionLevel}
              </div>
              <div style={{ fontSize: 12, color: "#CBD5F5", marginTop: 4 }}>
                Based on current occupancy vs capacity
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <div style={{ marginBottom: 10, fontSize: 12, color: "#CBD5F5" }}>
            Live local time: {currentLocalTime}
          </div>
          <CombinedLineChart actual={series.actual} predicted={series.predicted} />
        </section>
      </div>
    </div>
  );
}
