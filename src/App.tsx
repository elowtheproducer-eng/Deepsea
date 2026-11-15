/**
 * Deep Ocean Explorer — Main App (Phase 1 + UI skeleton + Expedition Board)
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CameraState, TorchState, SonarState, ViewState, Destination } from './types';
import { TerrainManager } from './terrain/terrainManager';
import { OceanRenderer } from './ocean/oceanRenderer';
import { HudOverlay } from './ui/HudOverlay';
import { QuickWheel } from './ui/QuickWheel';
import { ExpeditionBoard } from './ui/ExpeditionBoard';
import { DebugTuningPanel } from './ui/DebugTuningPanel';
import { geoToEcef, ecefToGeo } from './world/coords';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  // App UI State
  const [showExpeditionBoard, setShowExpeditionBoard] = useState(true);
  const [showQuickWheel, setShowQuickWheel] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // Flight & Camera State
  const [cameraState, setCameraState] = useState<CameraState>({
    lat: 0.0,
    lon: -20.0,
    h: 30.48, // 100 ft above surface start
    pitch: -0.15,
    yaw: 0,
    roll: 0,
    hFov: 100,
    speedMode: 'CRUISE',
    sliders: {
      CRAWL: 0.2,
      CRUISE: 0.45,
      WARP: 0.35,
    },
    inertia: 0.3,
    proximityBrake: true,
    ghostMode: false,
  });

  const [torchState, setTorchState] = useState<TorchState>({
    on: true,
    power: 'Std',
    color: 'White',
    focus: 45,
    glowSticksCount: 5,
    strobeBeacon: false,
  });

  const [sonarState, setSonarState] = useState<SonarState>({
    active: false,
    surveyView: false,
    range: 1000,
    hydrophone: false,
  });

  const [viewState, setViewState] = useState<ViewState>({
    projection: 'Rectilinear',
    vignette: true,
    timeOfDay: 12.0,
    seaLevel: 0,
    verticalExaggeration: 1,
    waterType: 'Clear',
  });

  // Keep ref for render loop access
  const cameraStateRef = useRef(cameraState);
  cameraStateRef.current = cameraState;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Three.js Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000511);
    scene.fog = new THREE.FogExp2(0x001122, 0.0015);

    const camera = new THREE.PerspectiveCamera(
      cameraState.hFov,
      container.clientWidth / container.clientHeight,
      0.1,
      50000
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x003355, 0.8);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
    sunLight.position.set(100, 500, 100);
    scene.add(sunLight);

    // Terrain & Ocean
    const terrain = new TerrainManager();
    scene.add(terrain.mesh);

    const ocean = new OceanRenderer(scene);

    // Keyboard & Mouse Controls
    const keys: Record<string, boolean> = {};
    const handleKeyDown = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = true;
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowQuickWheel((s) => !s);
      }
      if (e.key.toLowerCase() === 't') {
        setTorchState((s) => ({ ...s, on: !s.on }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Mouse look
    let isMouseDown = false;
    let mouseX = 0;
    let mouseY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isMouseDown = true;
        mouseX = e.clientX;
        mouseY = e.clientY;
      }
    };
    const handleMouseUp = () => {
      isMouseDown = false;
    };
    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDown) return;
      const dx = e.clientX - mouseX;
      const dy = e.clientY - mouseY;
      mouseX = e.clientX;
      mouseY = e.clientY;

      setCameraState((s) => ({
        ...s,
        yaw: s.yaw - dx * 0.003,
        pitch: Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, s.pitch - dy * 0.003)),
      }));
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    const clock = new THREE.Clock();
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const state = cameraStateRef.current;

      // Speed calculation based on mode & slider
      let speed = 0;
      const sliderVal = state.sliders[state.speedMode];
      if (state.speedMode === 'CRAWL') {
        speed = sliderVal === 0 ? 0 : 5.0 * sliderVal * sliderVal;
      } else if (state.speedMode === 'CRUISE') {
        speed = 1.0 * Math.pow(500.0 / 1.0, sliderVal);
      } else {
        // WARP
        speed = 500.0 * Math.pow(5000000.0 / 500.0, sliderVal);
      }

      // Movement input vector
      const moveDir = new THREE.Vector3(0, 0, 0);
      if (keys['w'] || keys['arrowup']) moveDir.z -= 1;
      if (keys['s'] || keys['arrowdown']) moveDir.z += 1;
      if (keys['a'] || keys['arrowleft']) moveDir.x -= 1;
      if (keys['d'] || keys['arrowright']) moveDir.x += 1;
      if (keys[' '] || keys['e']) moveDir.y += 1;
      if (keys['c'] || keys['q']) moveDir.y -= 1;
      moveDir.normalize();

      // Update lat/lon/h based on movement
      if (moveDir.lengthSq() > 0) {
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
        const up = new THREE.Vector3(0, 1, 0);

        const worldDelta = forward
          .clone()
          .multiplyScalar(-moveDir.z * speed * delta)
          .add(right.clone().multiplyScalar(moveDir.x * speed * delta))
          .add(up.clone().multiplyScalar(moveDir.y * speed * delta));

        // Convert delta meters to approx lat/lon offset
        const dLat = worldDelta.z * 9e-6;
        const dLon = worldDelta.x * 9e-6 / Math.cos(THREE.MathUtils.degToRad(state.lat));
        const dh = worldDelta.y;

        setCameraState((s) => ({
          ...s,
          lat: Math.max(-89, Math.min(89, s.lat + dLat)),
          lon: ((s.lon + dLon + 180) % 360) - 180,
          h: s.h + dh,
        }));
      }

      // Update camera FOV smoothly
      if (Math.abs(camera.fov - state.hFov) > 0.1) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, state.hFov, 0.1);
        camera.updateProjectionMatrix();
      }

      // Update camera orientation and position in scene
      camera.rotation.order = 'YXZ';
      camera.rotation.y = state.yaw;
      camera.rotation.x = state.pitch;
      camera.rotation.z = state.roll;

      // Camera is at origin (floating origin), terrain & ocean shift around camera
      camera.position.set(0, 0, 0);

      terrain.updateHeights(state.lon * 111000, state.lat * 111000);
      ocean.update(delta, camera.position, -state.h);

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleSelectDestination = (dest: Destination) => {
    setCameraState((s) => ({
      ...s,
      lat: dest.start.lat,
      lon: dest.start.lon,
      h: dest.start.h,
      yaw: THREE.MathUtils.degToRad(dest.start.heading),
      pitch: -0.1,
      speedMode: dest.suggested.mode,
      hFov: dest.suggested.fov,
    }));
    setTorchState((s) => ({ ...s, power: dest.suggested.torch, on: true }));
    setViewState((s) => ({
      ...s,
      timeOfDay: parseFloat(dest.suggested.timeOfDay.split(':')[0]) || 12,
    }));
  };

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden select-none">
      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" />

      {/* UI Overlays */}
      <HudOverlay
        cameraState={cameraState}
        torchState={torchState}
        sonarState={sonarState}
        viewState={viewState}
        onOpenQuickWheel={() => setShowQuickWheel(true)}
        onOpenExpeditionBoard={() => setShowExpeditionBoard(true)}
      />

      {/* Quick Wheel Modal */}
      <QuickWheel
        isOpen={showQuickWheel}
        onClose={() => setShowQuickWheel(false)}
        torchState={torchState}
        setTorchState={setTorchState}
        sonarState={sonarState}
        setSonarState={setSonarState}
        viewState={viewState}
        setViewState={setViewState}
        cameraState={cameraState}
        setCameraState={setCameraState}
        onOpenExpeditionBoard={() => setShowExpeditionBoard(true)}
        onOpenDebug={() => setShowDebug(true)}
      />

      {/* Expedition Board Modal */}
      <ExpeditionBoard
        isOpen={showExpeditionBoard}
        onClose={() => setShowExpeditionBoard(false)}
        onSelectDestination={handleSelectDestination}
      />

      {/* Debug Tuning Panel */}
      <DebugTuningPanel
        isOpen={showDebug}
        onClose={() => setShowDebug(false)}
        cameraState={cameraState}
        setCameraState={setCameraState}
        viewState={viewState}
        setViewState={setViewState}
        torchState={torchState}
        setTorchState={setTorchState}
      />
    </div>
  );
};
