/**
 * Deep Ocean Explorer — Root Orchestrator (v2.2 Redmi Note 13 Pro+ 5G + v2.1 Touch & Visuals)
 * Single tile-friendly WebGL2 render pass, floating-origin world coords,
 * GPU geometry clipmap terrain, Analytic Beam scatter, Gerstner sea surface + Snell's window,
 * off-thread SpawnWorker & TileWorker, DensityGovernor divisor pacing, and zero-GC loop.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CONFIG } from './core/config';
import {
  applyDestination,
  getRelativeEastNorth,
  governor,
  input,
  notifyHudImmediate,
  notifyHudIfDue,
  rebaseOriginIfNeeded,
  STATE,
} from './core/state';
import { computeReach, deriveMinCell, getWaterKdMultiplier, speedFromSlider, sunlightBlueAtDepth } from './core/reach';
import { localMetersToLatLon } from './world/coords';
import { heightAt } from './terrain/heightfield';
import { ClipmapTerrain } from './terrain/clipmap';
import { OceanRenderer } from './ocean/oceanRenderer';
import { createWaterUniforms } from './shaders/waterCommon.glsl';
import { HeroWreckObject, WreckSpec } from './features/wreckGenerator';
import { LifeSystem } from './life/lifeSystem';
import { OceanAudioEngine } from './audio/oceanAudio';
import { attachTouchAndKeyboardControls, triggerHaptic } from './input/touchControls';
import { TouchHud } from './ui/TouchHud';
import { QuickWheel, SpokeName } from './ui/QuickWheel';
import { ExpeditionBoard } from './ui/ExpeditionBoard';
import { DebugTuningPanel } from './ui/DebugTuningPanel';
import { Destination } from './types';
import destinationsData from './data/destinations.json';
import featuresData from './data/features.mini.json';

const DESTINATIONS = destinationsData as Destination[];
const WRECK_SPECS: WreckSpec[] = (featuresData as Array<{
  id: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  depthM: number;
  dims?: { lengthM: number; beamM: number };
}>)
  .filter((f) => f.type === 'wreck' && f.dims)
  .map((f, idx) => ({
    id: f.id,
    name: f.name,
    lat: f.lat,
    lon: f.lon,
    lengthM: f.dims!.lengthM,
    beamM: f.dims!.beamM,
    draftM: Math.max(8, f.dims!.beamM * 0.65),
    broken: f.id === 'wreck:titanic',
    seed: 1009 + idx * 97,
  }));

// Pre-allocated scratch vectors (zero GC inside animation loop)
const _torchPos = new THREE.Vector3();
const _torchDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

function computeVerticalFovDeg(hFovDeg: number, aspect: number): number {
  const halfH = THREE.MathUtils.degToRad(hFovDeg) * 0.5;
  const halfV = Math.atan(Math.tan(halfH) / Math.max(0.5, aspect));
  return THREE.MathUtils.radToDeg(halfV * 2);
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);

  const autostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [showExpeditionBoard, setShowExpeditionBoard] = useState(!autostart);
  const [hasStartedOnce, setHasStartedOnce] = useState(autostart);
  const [showQuickWheel, setShowQuickWheel] = useState(false);
  const [quickWheelSpoke, setQuickWheelSpoke] = useState<SpokeName>('LIGHT');
  const [showDebug, setShowDebug] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const pausedRef = useRef(!autostart);
  const actionsRef = useRef<{
    unlockAudio: () => void;
    triggerSonar: () => void;
    dropGlowStick: () => void;
    takePhoto: () => void;
    setWireframe: (wf: boolean) => void;
    renderOneFrame: () => void;
  }>({
    unlockAudio: () => {},
    triggerSonar: () => {},
    dropGlowStick: () => {},
    takePhoto: () => {},
    setWireframe: () => {},
    renderOneFrame: () => {},
  });

  // Keep body data-state & pause ref synced with active modals
  useEffect(() => {
    const isMenuOpen = showExpeditionBoard || showDebug || showQuickWheel;
    pausedRef.current = showExpeditionBoard || showDebug;
    if (showExpeditionBoard && !hasStartedOnce) {
      document.body.dataset.state = 'title';
    } else if (isMenuOpen) {
      document.body.dataset.state = 'paused';
    } else {
      document.body.dataset.state = 'playing';
      actionsRef.current.renderOneFrame();
    }
  }, [showExpeditionBoard, showDebug, showQuickWheel, hasStartedOnce]);

  // Title screen Enter / Space start handshake
  useEffect(() => {
    if (!showExpeditionBoard || hasStartedOnce) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyDestination(DESTINATIONS[0], false);
        setHasStartedOnce(true);
        setShowExpeditionBoard(false);
        actionsRef.current.unlockAudio();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showExpeditionBoard, hasStartedOnce]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    input.lastTouchMs = performance.now();

    // Software WebGL probe (SwiftShader / llvmpipe / headless Chromium guard)
    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param) ?? '');
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.info.autoReset = false;

    const applyRendererResolution = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const dpr = isSoftwareGl
        ? 1
        : Math.min(window.devicePixelRatio || 1, 2.0) * governor.renderScale;
      renderer.setPixelRatio(Math.max(0.5, dpr));
      renderer.setSize(w, h, false);
    };
    applyRendererResolution();

    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.matrixWorldAutoUpdate = false;

    const aspect = (container.clientWidth || window.innerWidth) / Math.max(1, container.clientHeight || window.innerHeight);
    const camera = new THREE.PerspectiveCamera(
      computeVerticalFovDeg(STATE.cam.hFov, aspect),
      aspect,
      0.25,
      8500
    );

    const waterUniforms = createWaterUniforms();
    const clipmap = new ClipmapTerrain(waterUniforms);
    scene.add(clipmap.root);

    const ocean = new OceanRenderer(scene, waterUniforms, governor.snowCount);
    const life = new LifeSystem(waterUniforms);
    scene.add(life.group);

    // Hero Wrecks (built once, positioned relative to camera when nearby)
    const wrecks = WRECK_SPECS.map((spec) => {
      const w = new HeroWreckObject(spec, waterUniforms);
      w.group.visible = false;
      scene.add(w.group);
      return w;
    });

    // Chemical glow-sticks pool
    const glowStickGroup = new THREE.Group();
    glowStickGroup.matrixAutoUpdate = false;
    scene.add(glowStickGroup);
    const glowGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.55, 8);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
    const glowSticks: Array<{ mesh: THREE.Mesh; east: number; y: number; north: number }> = [];

    // Audio & TileWorker (#2)
    const audio = new OceanAudioEngine();
    const tileWorker = new Worker(new URL('./workers/tileWorker.ts', import.meta.url), {
      type: 'module',
    });
    let nextTileReqId = 1;
    tileWorker.onmessage = (e) => {
      const d = e.data;
      if (typeof d.seabedY === 'number') {
        STATE.seabedDepthM = STATE.view.seaLevel - d.seabedY;
      }
      if (d.nearestFeature) {
        STATE.nearFeature = d.nearestFeature;
      }
    };

    // Context loss safety
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    // Pre-warm shaders async on real hardware
    if (!isSoftwareGl && typeof renderer.compileAsync === 'function') {
      renderer.compileAsync(scene, camera).catch(() => {});
    }

    // Touch & keyboard input attachment
    const detachControls = attachTouchAndKeyboardControls(renderer.domElement, () => {
      audio.unlock();
    });

    // Wake Lock helper for Redmi screen-on during dives
    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch {
        // Ignore if denied
      }
    };
    requestWakeLock();

    const onVisibilityChange = () => {
      const hidden = document.visibilityState === 'hidden';
      audio.setPaused(hidden);
      if (!hidden) requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onResize = () => {
      applyRendererResolution();
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / Math.max(1, h);
      camera.fov = computeVerticalFovDeg(STATE.cam.hFov, camera.aspect);
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // Wire actions for UI panels
    let simTimeSec = 0;
    actionsRef.current = {
      unlockAudio: () => audio.unlock(),
      triggerSonar: () => {
        STATE.sonar.active = true;
        STATE.sonar.originX = STATE.camEast;
        STATE.sonar.originZ = STATE.camNorth;
        STATE.sonar.radius = 0;
        STATE.sonar.startTimeSec = simTimeSec;
        audio.playSonarPing();
        triggerHaptic([12, 30, 12]);
      },
      dropGlowStick: () => {
        if (STATE.torch.glowSticksCount <= 0) return;
        STATE.torch.glowSticksCount--;
        const seabedY = heightAt(STATE.camEast, STATE.camNorth, STATE.originLat, STATE.originLon, 6);
        const stickY = Math.max(seabedY + 0.3, STATE.cam.h - 1.2);
        const mesh = new THREE.Mesh(glowGeo, glowMat);
        glowStickGroup.add(mesh);
        glowSticks.push({
          mesh,
          east: STATE.camEast + _forward.x * 2.5,
          y: stickY,
          north: STATE.camNorth + _forward.z * 2.5,
        });
        triggerHaptic(10);
      },
      takePhoto: () => {
        renderer.render(scene, camera);
        const srcCanvas = renderer.domElement;
        const out = document.createElement('canvas');
        out.width = srcCanvas.width;
        out.height = srcCanvas.height;
        const ctx = out.getContext('2d');
        if (ctx) {
          ctx.drawImage(srcCanvas, 0, 0);
          const ll = localMetersToLatLon(STATE.originLat, STATE.originLon, STATE.camEast, STATE.camNorth);
          const depth = Math.round(STATE.view.seaLevel - STATE.cam.h);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
          ctx.fillRect(16, out.height - 48, 340, 32);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '600 13px monospace';
          ctx.fillText(
            `${ll.lat.toFixed(4)}°, ${ll.lon.toFixed(4)}° · Depth ${depth} m`,
            26,
            out.height - 27
          );
          const link = document.createElement('a');
          link.download = `deep-ocean-${Date.now()}.png`;
          link.href = out.toDataURL('image/png');
          link.click();
        }
        setToastMsg('Snapshot saved with coordinates & depth.');
        setTimeout(() => setToastMsg(null), 2200);
      },
      setWireframe: (wf: boolean) => clipmap.setWireframe(wf),
      renderOneFrame: () => {},
    };

    // Main loop state
    let frameId = 0;
    let disposed = false;
    let rafCount = 0;
    let lastSimMs = performance.now();
    let lastTileQueryMs = 0;
    let lastRenderScale = governor.renderScale;
    let wasUnderwater = STATE.cam.h < STATE.view.seaLevel;
    let darkAdaptTimer = 0;
    let lastSoakMinute = 0;
    let renderImmediateRequested = true;

    actionsRef.current.renderOneFrame = () => {
      renderImmediateRequested = true;
    };

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function stepAndRender(nowMs: number) {
      const frameStart = performance.now();
      const rawDt = (nowMs - lastSimMs) / 1000;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      lastSimMs = nowMs;
      simTimeSec += dt;

      // Sync audio enable setting
      audio.setEnabled(STATE.settings.audio);

      // Process one-shot toggles
      if (input.torchToggle) {
        input.torchToggle = false;
        STATE.torch.on = !STATE.torch.on;
        triggerHaptic(12);
      }
      if (input.sonarPulse) {
        input.sonarPulse = false;
        actionsRef.current.triggerSonar();
      }

      // Apply camera look deltas (from coalesced pointer events / gyro / mouse)
      const lookSens = 0.0028;
      STATE.cam.yaw -= input.lookDx * lookSens;
      STATE.cam.pitch = Math.max(-1.48, Math.min(1.48, STATE.cam.pitch - input.lookDy * lookSens));
      input.lookDx = 0;
      input.lookDy = 0;

      if (Math.abs(input.pinchDelta) > 0.01) {
        STATE.cam.hFov = Math.max(80, Math.min(120, STATE.cam.hFov + input.pinchDelta));
        input.pinchDelta = 0;
      }

      const curAsp = (container.clientWidth || window.innerWidth) / Math.max(1, container.clientHeight || window.innerHeight);
      const targetVFov = computeVerticalFovDeg(STATE.cam.hFov, curAsp);
      if (Math.abs(camera.fov - targetVFov) > 0.05) {
        camera.fov = targetVFov;
        camera.updateProjectionMatrix();
      }

      // Compute movement velocity vector in world XZ + Y
      const speedMs = speedFromSlider(STATE.speedMode, STATE.sliders[STATE.speedMode]);
      const isWarp = STATE.speedMode === 'WARP';

      _euler.set(STATE.cam.pitch, STATE.cam.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(_euler);
      camera.position.set(0, STATE.cam.h, 0);
      camera.updateMatrix();
      camera.updateMatrixWorld();

      _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      if (STATE.settings.levelFlight) {
        _forward.y = 0;
        if (_forward.lengthSq() > 1e-6) _forward.normalize();
      }
      _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _right.y = 0;
      if (_right.lengthSq() > 1e-6) _right.normalize();

      const moveForward = input.move.y;
      const moveStrafe = input.move.x;
      const moveVert = input.vert;

      let vx = (_forward.x * moveForward + _right.x * moveStrafe) * speedMs;
      let vz = (_forward.z * moveForward + _right.z * moveStrafe) * speedMs;
      let vy = (_forward.y * moveForward + moveVert) * speedMs;

      // Proximity Brake near seabed (when enabled and not in WARP)
      if (STATE.proximityBrake && !isWarp) {
        const groundY = heightAt(STATE.camEast, STATE.camNorth, STATE.originLat, STATE.originLon, 6);
        const clearance = STATE.cam.h - groundY;
        if (clearance < 8.0 && vy < 0) {
          const factor = Math.max(0, (clearance - 1.4) / 6.6);
          vy *= factor;
        }
        if (STATE.cam.h + vy * dt < groundY + 1.2) {
          STATE.cam.h = groundY + 1.2;
          if (vy < 0) vy = 0;
        }
      }

      STATE.camEast += vx * dt;
      STATE.cam.h = Math.max(-11500, Math.min(2500, STATE.cam.h + vy * dt));
      STATE.camNorth += vz * dt;
      rebaseOriginIfNeeded();

      const depthM = STATE.view.seaLevel - STATE.cam.h;
      const isUnderwater = depthM > 0;
      if (isUnderwater !== wasUnderwater) {
        wasUnderwater = isUnderwater;
        audio.playBreach(isUnderwater);
        triggerHaptic([16, 30, 16]);
      }
      audio.updateDepth(depthM);

      // Update expanding sonar ring
      if (STATE.sonar.active) {
        STATE.sonar.radius += 260 * dt;
        if (STATE.sonar.radius > 1100) {
          STATE.sonar.active = false;
          STATE.sonar.radius = 0;
        }
      }

      // Compute Photon-Budget Reach
      const reach = computeReach({
        depthM,
        timeOfDay: STATE.view.timeOfDay,
        waterType: STATE.view.waterType,
        torchOn: STATE.torch.on,
        torchPower: STATE.torch.power,
        torchFocus: STATE.torch.focus,
        sonarActive: STATE.sonar.active,
        sonarRadius: STATE.sonar.radius,
        isWarp,
      });
      STATE.reach = reach;

      // Update camera far plane to stay tight to reach + sky
      camera.far = Math.max(600, Math.min(8500, reach.coarse * 2.2 + 500));
      camera.updateProjectionMatrix();

      // Update shared WATER uniforms
      const kdMult = getWaterKdMultiplier(STATE.view.waterType);
      waterUniforms.uTime.value = simTimeSec;
      waterUniforms.uDepth.value = depthM;
      waterUniforms.uSeaLevel.value = STATE.view.seaLevel;
      waterUniforms.uKd.value.set(CONFIG.absorbR * kdMult, CONFIG.absorbG * kdMult, CONFIG.absorbB * kdMult);

      const sunTheta = ((STATE.view.timeOfDay - 6) / 12) * Math.PI;
      waterUniforms.uSunDir.value
        .set(Math.cos(sunTheta) * 0.65, Math.max(-0.4, Math.sin(sunTheta)), 0.38)
        .normalize();

      const sunSurface = Math.max(0.03, Math.sin(sunTheta) * 0.95 + 0.05);
      waterUniforms.uSunColorAtDepth.value.set(sunSurface, sunSurface * 0.98, sunSurface * 0.94);

      if (STATE.view.waterType === 'Coastal') {
        waterUniforms.uWaterScatterColor.value.set(0.02, 0.14, 0.13);
      } else if (STATE.view.waterType === 'Murky') {
        waterUniforms.uWaterScatterColor.value.set(0.04, 0.11, 0.07);
      } else {
        waterUniforms.uWaterScatterColor.value.set(0.014, 0.09, 0.17);
      }

      waterUniforms.uReachOmni.value = reach.omni;
      waterUniforms.uReachCone.value = reach.cone;
      waterUniforms.uReachCoarse.value = reach.coarse;

      // Torch position offset slightly down-right from eyes so backscatter cone reads with volume
      _torchPos.set(0.32, -0.28, -0.15).applyQuaternion(camera.quaternion);
      _torchPos.y += STATE.cam.h;
      _torchDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

      const powerLum =
        STATE.torch.power === 'Low'
          ? 0.45
          : STATE.torch.power === 'Search'
          ? 2.2
          : STATE.torch.power === 'Flood'
          ? 1.65
          : 1.0;
      const lum = CONFIG.torchLumensStd * powerLum;
      if (STATE.torch.color === 'Blue-Green') {
        waterUniforms.uTorchColorLumens.value.set(lum * 0.45, lum * 1.0, lum * 0.95);
      } else if (STATE.torch.color === 'Red') {
        waterUniforms.uTorchColorLumens.value.set(lum * 1.0, lum * 0.22, lum * 0.16);
      } else {
        waterUniforms.uTorchColorLumens.value.set(lum, lum * 0.97, lum * 0.92);
      }

      waterUniforms.uTorchOn.value =
        STATE.torch.on && !STATE.overlays.disableTorchVolume ? 1.0 : 0.0;
      waterUniforms.uTorchPos.value.copy(_torchPos);
      waterUniforms.uTorchDir.value.copy(_torchDir);
      const innerDeg = 10 + STATE.torch.focus * 20;
      const outerDeg = innerDeg + 12 + STATE.torch.focus * 10;
      waterUniforms.uCosInner.value = Math.cos(THREE.MathUtils.degToRad(innerDeg));
      waterUniforms.uCosOuter.value = Math.cos(THREE.MathUtils.degToRad(outerDeg));

      waterUniforms.uSnowDensity.value = CONFIG.snowDensity;
      waterUniforms.uCausticsEnabled.value =
        governor.caustics && depthM < 45 && depthM > -5 ? 1.0 : 0.0;
      waterUniforms.uSonarActive.value = STATE.sonar.active ? 1.0 : 0.0;
      waterUniforms.uSonarOrigin.value.set(
        STATE.sonar.originX - STATE.camEast,
        STATE.cam.h,
        STATE.sonar.originZ - STATE.camNorth
      );
      waterUniforms.uSonarRadius.value = STATE.sonar.radius;
      waterUniforms.uSurveyView.value = STATE.sonar.surveyView ? 1.0 : 0.0;

      // Dark adaptation ramp in deep midnight zone
      const sunFrac = sunlightBlueAtDepth(depthM, CONFIG.absorbB * kdMult, STATE.view.timeOfDay);
      if (depthM > 200 && sunFrac < 0.02) {
        darkAdaptTimer = Math.min(CONFIG.tDark, darkAdaptTimer + dt);
      } else {
        darkAdaptTimer = Math.max(0, darkAdaptTimer - dt * 12);
      }
      waterUniforms.uDarkAdaptation.value = darkAdaptTimer / Math.max(1, CONFIG.tDark);
      waterUniforms.uDarknessFidelity.value = CONFIG.darknessFidelity;
      waterUniforms.uWaveSteepness.value = CONFIG.waveSteepness;
      waterUniforms.uSpeedFactor.value = Math.min(1, speedMs / 30);

      // Apply stepped Governor LOD changes cleanly
      if (Math.abs(lastRenderScale - governor.renderScale) > 0.01) {
        lastRenderScale = governor.renderScale;
        applyRendererResolution();
      }
      clipmap.rebuild(governor.clipmapN, governor.clipmapRings, governor.beamSteps);
      ocean.setBeamSteps(governor.beamSteps);
      ocean.setSnowCount(governor.snowCount);
      ocean.setSnowVisible(!STATE.overlays.disableSnow && !isWarp);

      const minCell = deriveMinCell(Math.max(0, depthM), governor.targetFps);
      clipmap.update({
        camera,
        camEast: STATE.camEast,
        camNorth: STATE.camNorth,
        camH: STATE.cam.h,
        originLat: STATE.originLat,
        originLon: STATE.originLon,
        reach,
        minCell,
        maxCell: 8.0,
        torchPos: _torchPos,
        torchDir: _torchDir,
        sonar: STATE.sonar,
        verticalExag: CONFIG.verticalExag,
        detailAmp: CONFIG.detailAmplitude,
        microEnabled: !STATE.overlays.disableMicroDetail,
        seaLevel: STATE.view.seaLevel,
        isWarp,
      });

      ocean.update(camera, STATE.camEast, STATE.camNorth, STATE.cam.h);

      life.update({
        timeSec: simTimeSec,
        camEast: STATE.camEast,
        camNorth: STATE.camNorth,
        camH: STATE.cam.h,
        originLat: STATE.originLat,
        originLon: STATE.originLon,
        reachMeters: reach.coarse,
        timeOfDay: STATE.view.timeOfDay,
        seed: CONFIG.seed,
        showActors: !STATE.overlays.disableActors,
        showScaleCubes: STATE.overlays.scaleCubes,
        showTorchGizmo: STATE.overlays.torchGizmo,
        camera,
        isWarp,
      });

      // Position Hero Wrecks when within 6 km
      for (let i = 0; i < wrecks.length; i++) {
        const w = wrecks[i];
        const rel = getRelativeEastNorth(w.spec.lat, w.spec.lon);
        const dist = Math.hypot(rel.east, rel.north);
        if (dist < 6000 && !isWarp) {
          w.group.visible = true;
          const seabedY = heightAt(
            STATE.camEast + rel.east,
            STATE.camNorth + rel.north,
            STATE.originLat,
            STATE.originLon,
            6
          );
          w.setRelativePosition(rel.east, seabedY - 1.5, rel.north, STATE.cam.h);
        } else {
          w.group.visible = false;
        }
      }

      // Position glow-sticks relative to camera
      for (let i = 0; i < glowSticks.length; i++) {
        const g = glowSticks[i];
        g.mesh.position.set(g.east - STATE.camEast, g.y, g.north - STATE.camNorth);
      }

      // Periodic off-thread TileWorker query (~1 Hz)
      if (nowMs - lastTileQueryMs > 950) {
        lastTileQueryMs = nowMs;
        const ll = localMetersToLatLon(STATE.originLat, STATE.originLon, STATE.camEast, STATE.camNorth);
        tileWorker.postMessage({
          requestId: nextTileReqId++,
          lat: ll.lat,
          lon: ll.lon,
          camEast: STATE.camEast,
          camNorth: STATE.camNorth,
          originLat: STATE.originLat,
          originLon: STATE.originLon,
        });
      }

      // Single tile-friendly render pass
      renderer.info.reset();
      const submitStart = performance.now();
      renderer.render(scene, camera);
      const submitMs = performance.now() - submitStart;
      const frameMs = performance.now() - frameStart;

      governor.recordFrame(frameMs, submitMs, nowMs);
      STATE.triangles = renderer.info.render.triangles;
      STATE.calls = renderer.info.render.calls;
      STATE.activeRings = clipmap.activeRingsCount;
      STATE.visibleSectors = clipmap.visibleSectorsCount;
      STATE.cell0Meters = clipmap.cell0Meters;

      // Record 1-minute thermal soak log
      const minute = Math.floor((nowMs - STATE.sessionStartMs) / 60000);
      if (minute > lastSoakMinute) {
        lastSoakMinute = minute;
        const ll = localMetersToLatLon(STATE.originLat, STATE.originLon, STATE.camEast, STATE.camNorth);
        STATE.soakLog.push({
          minute,
          timestampIso: new Date().toISOString(),
          fpsAvg: governor.getTelemetry({
            triangles: STATE.triangles,
            calls: STATE.calls,
            activeRings: STATE.activeRings,
            visibleSectors: STATE.visibleSectors,
            cell0Meters: STATE.cell0Meters,
            reachOmni: reach.omni,
            reachCone: reach.cone,
          }).fps,
          emaFrameMs: governor.emaFrameMs,
          emaSubmitMs: governor.emaSubmitMs,
          renderScale: governor.renderScale,
          clipmapN: governor.clipmapN,
          throttled: governor.throttled,
          depthM,
          lat: ll.lat,
          lon: ll.lon,
        });
      }

      notifyHudIfDue(nowMs);
    }

    function tick() {
      if (disposed) return;
      const nowMs = performance.now();
      governor.recordRafTick(nowMs);
      rafCount++;

      // Pause rendering when full-screen opaque Expedition Board or Debug menu covers canvas
      if (pausedRef.current && !renderImmediateRequested) {
        lastSimMs = nowMs;
        if (isSoftwareGl) {
          frameId = window.setTimeout(tick, 180);
        } else {
          frameId = requestAnimationFrame(tick);
        }
        return;
      }

      if (!isSoftwareGl && !renderImmediateRequested) {
        const div = governor.getDivisor();
        if (rafCount % div !== 0) {
          frameId = requestAnimationFrame(tick);
          return;
        }
      }

      renderImmediateRequested = false;
      stepAndRender(nowMs);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      stepAndRender(performance.now());
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      detachControls();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      wakeLock?.release().catch(() => {});
      tileWorker.terminate();
      audio.dispose();
      clipmap.dispose();
      ocean.dispose();
      life.dispose();
      wrecks.forEach((w) => w.dispose());
      glowGeo.dispose();
      glowMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleSelectDestination = (dest: Destination, startAtSurface: boolean) => {
    applyDestination(dest, startAtSurface);
    notifyHudImmediate();
    setHasStartedOnce(true);
    setShowExpeditionBoard(false);
    actionsRef.current.unlockAudio();
    actionsRef.current.renderOneFrame();
  };

  return (
    <main className="relative w-screen h-[100dvh] overflow-hidden bg-black">
      {/* Dedicated WebGL Mount Container */}
      <div
        ref={mountRef}
        data-testid="ocean-canvas-container"
        className="absolute inset-0 w-full h-full"
      />

      {/* L0 Minimal Touch HUD (<= 5 elements) */}
      {!showExpeditionBoard && !showDebug && (
        <TouchHud
          onOpenQuickWheel={() => {
            setQuickWheelSpoke('LIGHT');
            setShowQuickWheel(true);
          }}
          onOpenTorchQuick={() => {
            setQuickWheelSpoke('LIGHT');
            setShowQuickWheel(true);
          }}
          onOpenDebug={() => setShowDebug(true)}
          onOpenExpeditionBoard={() => setShowExpeditionBoard(true)}
        />
      )}

      {/* L1/L2 Quick Wheel & Glance Bar */}
      <QuickWheel
        isOpen={showQuickWheel}
        initialSpoke={quickWheelSpoke}
        onClose={() => setShowQuickWheel(false)}
        onOpenExpeditionBoard={() => setShowExpeditionBoard(true)}
        onOpenDebug={() => setShowDebug(true)}
        onTriggerSonar={() => actionsRef.current.triggerSonar()}
        onDropGlowStick={() => actionsRef.current.dropGlowStick()}
        onTakePhoto={() => actionsRef.current.takePhoto()}
      />

      {/* Expedition Board */}
      <ExpeditionBoard
        isOpen={showExpeditionBoard}
        canClose={hasStartedOnce}
        onClose={() => setShowExpeditionBoard(false)}
        onSelectDestination={handleSelectDestination}
      />

      {/* Hidden Engineering Debug & Tuning Panel */}
      <DebugTuningPanel
        isOpen={showDebug}
        onClose={() => setShowDebug(false)}
        onApplyTerrainWireframe={(wf) => actionsRef.current.setWireframe(wf)}
      />

      {/* Snapshot Toast */}
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-slate-950 border border-sky-400/40 text-xs font-medium text-sky-200">
          {toastMsg}
        </div>
      )}

      {/* WebGL Context Lost Recovery */}
      {contextLost && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-6 text-center">
          <div className="max-w-sm space-y-2">
            <h2 className="text-base font-bold text-white">Graphics Context Paused</h2>
            <p className="text-xs text-slate-400">
              Restoring WebGL2 ocean renderer automatically.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
