export type Room = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "room" | "lab" | "office" | "stairs" | "free" | "server_room" | "library";
};

export type Floor = {
  floorNumber: number;
  rooms: Room[];
  planImage?: string;
};

export const SUMANADASA_FLOORS: Floor[] = [
  {
    floorNumber: 0,
    rooms: [
      { id: "sumanadasa-f1-cls-a", name: "Classroom A", x: 50, y: 50, width: 340, height: 200, type: "room" },
      { id: "sumanadasa-f1-cls-b", name: "Classroom B", x: 410, y: 50, width: 340, height: 200, type: "room" },
      { id: "sumanadasa-f1-lab", name: "Main Lab", x: 50, y: 270, width: 340, height: 180, type: "lab" },
      { id: "sumanadasa-f1-office", name: "Dept Office", x: 410, y: 270, width: 340, height: 180, type: "office" },
      { id: "sumanadasa-f1-stairs-1", name: "Stairs 1", x: 315, y: 150, width: 60, height: 70, type: "stairs" },
      { id: "sumanadasa-f1-stairs-2", name: "Stairs 2", x: 315, y: 270, width: 60, height: 70, type: "stairs" },
    ],
  },
  {
    floorNumber: 1,
    rooms: [
      { id: "sumanadasa-f2-seminar", name: "Seminar Room", x: 10, y: 10, width: 80, height: 120, type: "room" },
      { id: "sumanadasa-f2-codegen-lab", name: "CodeGen Lab", x: 90, y: 10, width: 80, height: 120, type: "lab" },
      { id: "sumanadasa-f2-sysco-lounge", name: "Sysco LABS Lounge", x: 170, y: 10, width: 110, height: 120, type: "room" },
      { id: "sumanadasa-f2-insight-hub", name: "Insight Hub", x: 280, y: 10, width: 110, height: 120, type: "lab" },
      { id: "sumanadasa-f2-network-lab", name: "Network Lab", x: 390, y: 10, width: 80, height: 120, type: "lab" },
      { id: "sumanadasa-f2-embedded-lab", name: "Embedded Lab", x: 470, y: 10, width: 70, height: 120, type: "lab" },
      { id: "sumanadasa-f2-hpc-lab", name: "HPC Lab", x: 540, y: 10, width: 60, height: 120, type: "lab" },
      { id: "sumanadasa-f2-intellisense-lab", name: "IntelliSense Lab", x: 600, y: 10, width: 80, height: 120, type: "lab" },
      { id: "sumanadasa-f2-l3-lab", name: "L3 Lab", x: 680, y: 10, width: 110, height: 120, type: "lab" },
      { id: "sumanadasa-f2-studio", name: "Studio", x: 10, y: 130, width: 80, height: 100, type: "room" },
      { id: "sumanadasa-f2-oldcodegen-lab", name: "OLD CodeGen Lab", x: 10, y: 230, width: 80, height: 100, type: "lab" },
      { id: "sumanadasa-f2-open-area-n", name: "Open Area", x: 110, y: 150, width: 200, height: 190, type: "room" },
      { id: "sumanadasa-f2-open-area-s", name: "Open Area", x: 410, y: 150, width: 300, height: 190, type: "room" },
      { id: "sumanadasa-f2-stairs-1", name: "Stairs 1", x: 315, y: 150, width: 60, height: 70, type: "stairs" },
      { id: "sumanadasa-f2-stairs-2", name: "Stairs 2", x: 315, y: 270, width: 60, height: 70, type: "stairs" },
      { id: "sumanadasa-f2-instructor-room", name: "Instructor Room", x: 740, y: 130, width: 50, height: 240, type: "office" },
      { id: "sumanadasa-f2-server", name: "Server Room", x: 10, y: 330, width: 80, height: 160, type: "server_room" },
      { id: "sumanadasa-f2-ice-room", name: "ICE Room", x: 90, y: 370, width: 100, height: 120, type: "office" },
      { id: "sumanadasa-f2-staff-room", name: "Staff Room", x: 190, y: 370, width: 200, height: 120, type: "office" },
      { id: "sumanadasa-f2-ra-lab", name: "RA Lab", x: 390, y: 370, width: 100, height: 120, type: "lab" },
      { id: "sumanadasa-f2-gtn-lab", name: "GTN Lab", x: 490, y: 370, width: 130, height: 120, type: "lab" },
      { id: "sumanadasa-f2-research-lab", name: "Research Lab", x: 620, y: 370, width: 170, height: 120, type: "lab" },
    ],
  },
  {
    floorNumber: 2,
    rooms: [
      { id: "sumanadasa-f3-cls-a", name: "Classroom A", x: 50, y: 50, width: 340, height: 200, type: "room" },
      { id: "sumanadasa-f3-cls-b", name: "Classroom B", x: 410, y: 50, width: 340, height: 200, type: "room" },
      { id: "sumanadasa-f3-lab", name: "Main Lab", x: 50, y: 270, width: 340, height: 180, type: "lab" },
      { id: "sumanadasa-f3-office", name: "Dept Office", x: 410, y: 270, width: 340, height: 180, type: "office" },
      { id: "sumanadasa-f3-stairs-1", name: "Stairs 1", x: 315, y: 150, width: 60, height: 70, type: "stairs" },
      { id: "sumanadasa-f3-stairs-2", name: "Stairs 2", x: 315, y: 270, width: 60, height: 70, type: "stairs" },
    ],
  },
  {
    floorNumber: 3,
    rooms: [
      { id: "sumanadasa-f4-cls-a", name: "Classroom A", x: 50, y: 50, width: 340, height: 200, type: "room" },
      { id: "sumanadasa-f4-cls-b", name: "Classroom B", x: 410, y: 50, width: 340, height: 200, type: "room" },
      { id: "sumanadasa-f4-lab", name: "Main Lab", x: 50, y: 270, width: 340, height: 180, type: "lab" },
      { id: "sumanadasa-f4-office", name: "Dept Office", x: 410, y: 270, width: 340, height: 180, type: "office" },
      { id: "sumanadasa-f4-stairs-1", name: "Stairs 1", x: 315, y: 150, width: 60, height: 70, type: "stairs" },
      { id: "sumanadasa-f4-stairs-2", name: "Stairs 2", x: 315, y: 270, width: 60, height: 70, type: "stairs" },
    ],
  },
];

// Faculty of IT — 4 academic floors (1-4) + server room floor (5)
// Room IDs match simulator topology: faculty-it-f{n}-{suffix}
const _itAcademicFloor = (n: number): Floor => ({
  floorNumber: n,
  rooms: [
    { id: `faculty-it-f${n}-cls-a`,  name: "Classroom A", x: 10,  y: 10,  width: 375, height: 220, type: "room" },
    { id: `faculty-it-f${n}-cls-b`,  name: "Classroom B", x: 395, y: 10,  width: 375, height: 220, type: "room" },
    { id: `faculty-it-f${n}-lab-1`,  name: "Lab 1",       x: 10,  y: 240, width: 255, height: 220, type: "lab" },
    { id: `faculty-it-f${n}-lab-2`,  name: "Lab 2",       x: 275, y: 240, width: 255, height: 220, type: "lab" },
    { id: `faculty-it-f${n}-office`, name: "Staff Office", x: 540, y: 240, width: 230, height: 220, type: "office" },
  ],
});

export const IT_FLOORS: Floor[] = [
  _itAcademicFloor(1),
  _itAcademicFloor(2),
  _itAcademicFloor(3),
  _itAcademicFloor(4),
  {
    floorNumber: 5,
    rooms: [
      { id: "faculty-it-f5-server", name: "Server Room", x: 195, y: 90, width: 400, height: 300, type: "server_room" },
    ],
  },
];

// Library — 3 floors, each with one sensor room matching simulator topology
// Room IDs: library-f{n}-{suffix}
export const LIBRARY_FLOORS: Floor[] = [
  {
    floorNumber: 1,
    rooms: [
      { id: "library-f1-reading-hall", name: "Reading Hall", x: 10, y: 10, width: 780, height: 460, type: "library" },
    ],
  },
  {
    floorNumber: 2,
    rooms: [
      { id: "library-f2-study-area", name: "Study Area", x: 10, y: 10, width: 780, height: 460, type: "library" },
    ],
  },
  {
    floorNumber: 3,
    rooms: [
      { id: "library-f3-research-lounge", name: "Research Lounge", x: 10, y: 10, width: 780, height: 460, type: "library" },
    ],
  },
];

export const BUILDING_DATA: Record<
  string,
  { name: string; floors: Floor[]; minFloor: number; maxFloor: number; influxBuildingId: string }
> = {
  cse: {
    name: "Sumanadasa Building",
    floors: SUMANADASA_FLOORS,
    minFloor: 0,
    maxFloor: 3,
    influxBuildingId: "sumanadasa",
  },
  it: {
    name: "Faculty of IT",
    floors: IT_FLOORS,
    minFloor: 1,
    maxFloor: 5,
    influxBuildingId: "faculty-it",
  },
  library: {
    name: "Library",
    floors: LIBRARY_FLOORS,
    minFloor: 1,
    maxFloor: 3,
    influxBuildingId: "library",
  },
};
