# 🏫 Smart Campus Digital Twin (Group I3)

> Interactive 3D visualization and real-time operations dashboard for modern campus infrastructure management.

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)
![Three.js](https://img.shields.io/badge/Three.js-Black?style=for-the-badge&logo=three.js)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css)

## 📌 Project Overview
This repository contains the interactive frontend implementation for the **Group I3 Smart Campus Digital Twin** project. It leverages WebGL to deliver high-performance 3D visualization right inside the browser, rendering building architectures and syncing their real-time telemetry datasets.

The system allows continuous monitoring of critical facility components like energy loads, environmental temperatures, and spatial occupancies to empower preemptive management and resource optimizations.

## ✨ Core Features
*   🌐 **3D Campus Visualization**: Rendered interactively utilizing WebGL, React Three Fiber, and Three.js.
*   📊 **Real-time Telemetry Dashboard**: Floating panels displaying actively synced statuses of individual campus zones.
*   🎨 **Custom Interactive Theme**: UI and UX built around a sleek dark-teal theme (`#071952`, `#0B666A`, `#35A29F`, and `#97FEED`).
*   ⚡ **Dynamic Status Adapting**: Automatically tags environments as `Normal`, `Busy`, or `Critical` depending on energy, temperature, and occupancy thresholds.
*   🖱️ **Spatial Interaction**: Orbit tools allowing 360-degree views, pan & zoom functionality, and direct mesh clicks to fetch data.

## 🧰 Technology Stack
*   **Framework**: Next.js 15 (App Router)
*   **UI / Styling**: Tailwind CSS v4, Lucide React (Icons)
*   **3D Engine**: Three.js
*   **React 3D Integrations**: `@react-three/fiber`, `@react-three/drei`

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation & Run

1. Clone this repository directly to your machine.
```bash
git clone https://github.com/lakaThabrew/Smart_Campus_Digital_Twin.git
```

2. Navigate into the frontend ecosystem:
```bash
cd "Smart_Campus_Digital_Twin/frontend"
```

3. Install the NPM dependencies:
```bash
npm install
```

4. Spin up the Next.js development server:
```bash
npm run dev
```

5. Access the Digital Twin Dashboard by launching your browser and navigating to:
```text
http://localhost:3000
```

## 🤝 Project Sub-Group 
**Group I3** (Sys Eng & Interaction) 

---
*Developed as a course requirement to simulate next-generation Cyber-Physical Systems.*
