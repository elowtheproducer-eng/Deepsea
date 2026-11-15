/**
 * Touch-First Multi-Touch Pointer Router (v2.1 §2 & v2.2 §7).
 * - Uses Pointer Events + setPointerCapture + getCoalescedEvents() for 120Hz touch precision.
 * - Keeps stick & lever >= 32dp from screen edges so Android back-gesture doesn't steal touches.
 * - Floating Move Stick (56dp radius, 12% deadzone, out = in^1.4 curve).
 * - Right-edge Fixed Vertical Lever (double-tap to latch, tap to release).
 * - Hidden keyboard/mouse fallback writing to the exact same `input` object.
 */

import { input, notifyHudImmediate, STATE } from '../core/state';

type Role = 'stick' | 'lever' | 'look' | 'ui';

const STICK_RADIUS_PX = 56;
const DEADZONE = 0.12;
const EDGE_MARGIN_PX = 36; // >= 32dp safe from Android back gesture

export function triggerHaptic(ms: number | number[] = 12) {
  if (!STATE.settings.haptics) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    // Ignore on unsupported browsers
  }
}

export function attachTouchAndKeyboardControls(
  surfaceEl: HTMLElement,
  onFirstUserGesture?: () => void
): () => void {
  const roles = new Map<number, Role>();
  const stickBase = new Map<number, { x: number; y: number }>();
  const lookLast = new Map<number, { x: number; y: number }>();
  let lastLeverTapTime = 0;
  let gyroAttached = false;
  let lastGyroBeta: number | null = null;
  let lastGyroGamma: number | null = null;

  // Pinch tracking when pinchFov is enabled and no control pointer is active
  const lookPointers = new Map<number, { x: number; y: number }>();
  let lastPinchDist: number | null = null;

  const keys = new Set<string>();

  function updatePointersVisual() {
    input.pointers = [];
    roles.forEach((role, id) => {
      if (role === 'ui') return;
      if (role === 'stick') {
        input.pointers.push({
          id,
          role,
          x: input.stickKnobX,
          y: input.stickKnobY,
          originX: input.stickBaseX,
          originY: input.stickBaseY,
        });
      } else if (role === 'look') {
        const pt = lookLast.get(id);
        if (pt) {
          input.pointers.push({ id, role, x: pt.x, y: pt.y, originX: pt.x, originY: pt.y });
        }
      } else if (role === 'lever') {
        const pt = lookLast.get(id);
        if (pt) {
          input.pointers.push({ id, role, x: pt.x, y: pt.y, originX: pt.x, originY: pt.y });
        }
      }
    });
  }

  function getLeverRect(w: number, h: number) {
    const leftHanded = STATE.settings.leftHanded;
    const leverW = 68;
    const leverH = Math.min(200, h * 0.44);
    const centerY = h * 0.5;
    const xMin = leftHanded ? EDGE_MARGIN_PX : w - EDGE_MARGIN_PX - leverW;
    const xMax = xMin + leverW;
    return { xMin, xMax, yMin: centerY - leverH * 0.5, yMax: centerY + leverH * 0.5, centerY, halfH: leverH * 0.5 };
  }

  function pickRole(clientX: number, clientY: number, target: EventTarget | null): Role {
    if (target instanceof HTMLElement && target.closest('[data-ui-interactive="true"]')) {
      return 'ui';
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const leftHanded = STATE.settings.leftHanded;

    // 1. Vertical lever zone (right edge normally, left edge if left-handed, >= 36px from screen border)
    const lever = getLeverRect(w, h);
    if (clientX >= lever.xMin && clientX <= lever.xMax && clientY >= lever.yMin && clientY <= lever.yMax) {
      return 'lever';
    }

    // 2. Floating Move Stick zone: left ~45% x lower 70% (mirrored if left-handed)
    const inStickX = leftHanded
      ? clientX >= w * 0.55 && clientX <= w - EDGE_MARGIN_PX
      : clientX >= EDGE_MARGIN_PX && clientX <= w * 0.45;
    const inStickY = clientY >= h * 0.28 && clientY <= h - 76; // leave bottom speed strip clear

    if (inStickX && inStickY && !input.stickActive) {
      return 'stick';
    }

    return 'look';
  }

  function applyStickDelta(dx: number, dy: number) {
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, STICK_RADIUS_PX);
    const nx = dist > 1e-4 ? (dx / dist) * (clampedDist / STICK_RADIUS_PX) : 0;
    const ny = dist > 1e-4 ? (dy / dist) * (clampedDist / STICK_RADIUS_PX) : 0;

    const mag = Math.min(1, Math.hypot(nx, ny));
    if (mag < DEADZONE) {
      input.move.x = 0;
      input.move.y = 0;
    } else {
      const remapped = (mag - DEADZONE) / (1 - DEADZONE);
      const curved = Math.pow(remapped, 1.4);
      const scale = curved / mag;
      input.move.x = nx * scale;
      input.move.y = -ny * scale; // screen-up = forward (+1)
    }
    input.stickKnobX = input.stickBaseX + (dist > 1e-4 ? (dx / dist) * clampedDist : 0);
    input.stickKnobY = input.stickBaseY + (dist > 1e-4 ? (dy / dist) * clampedDist : 0);
  }

  const onPointerDown = (e: PointerEvent) => {
    input.lastTouchMs = performance.now();
    onFirstUserGesture?.();

    const role = pickRole(e.clientX, e.clientY, e.target);
    if (role === 'ui') return;

    roles.set(e.pointerId, role);
    try {
      surfaceEl.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without capture
    }

    if (role === 'stick') {
      const baseX = STATE.settings.fixedStick
        ? STATE.settings.leftHanded
          ? window.innerWidth - 130
          : 130
        : e.clientX;
      const baseY = STATE.settings.fixedStick ? window.innerHeight - 170 : e.clientY;
      stickBase.set(e.pointerId, { x: baseX, y: baseY });
      input.stickActive = true;
      input.stickBaseX = baseX;
      input.stickBaseY = baseY;
      applyStickDelta(e.clientX - baseX, e.clientY - baseY);
    } else if (role === 'lever') {
      const now = performance.now();
      const lever = getLeverRect(window.innerWidth, window.innerHeight);
      if (now - lastLeverTapTime < 300) {
        input.vertLatched = !input.vertLatched;
        triggerHaptic(18);
      } else if (input.vertLatched) {
        input.vertLatched = false;
      }
      lastLeverTapTime = now;
      input.leverActive = true;
      lookLast.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const raw = (lever.centerY - e.clientY) / lever.halfH;
      input.vert = Math.max(-1, Math.min(1, raw));
    } else if (role === 'look') {
      lookLast.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (lookPointers.size === 2) {
        const pts = Array.from(lookPointers.values());
        lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    }

    updatePointersVisual();
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    const role = roles.get(e.pointerId);
    if (!role || role === 'ui') return;
    input.lastTouchMs = performance.now();

    if (role === 'stick') {
      const base = stickBase.get(e.pointerId);
      if (base) applyStickDelta(e.clientX - base.x, e.clientY - base.y);
    } else if (role === 'lever') {
      const lever = getLeverRect(window.innerWidth, window.innerHeight);
      lookLast.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const raw = (lever.centerY - e.clientY) / lever.halfH;
      input.vert = Math.max(-1, Math.min(1, raw));
    } else if (role === 'look') {
      // High-rate coalesced events for smooth 120Hz touch look (v2.2 §7)
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      const evList = events.length > 0 ? events : [e];
      let last = lookLast.get(e.pointerId) || { x: e.clientX, y: e.clientY };

      for (let i = 0; i < evList.length; i++) {
        const ev = evList[i];
        const dx = ev.clientX - last.x;
        const dy = ev.clientY - last.y;
        input.lookDx += dx;
        input.lookDy += dy;
        last = { x: ev.clientX, y: ev.clientY };
      }
      lookLast.set(e.pointerId, last);
      lookPointers.set(e.pointerId, last);

      if (STATE.settings.pinchFov && !input.stickActive && !input.leverActive && lookPointers.size === 2) {
        const pts = Array.from(lookPointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastPinchDist !== null) {
          input.pinchDelta += (lastPinchDist - dist) * 0.08;
        }
        lastPinchDist = dist;
      }
    }

    updatePointersVisual();
    e.preventDefault();
  };

  const endPointer = (e: PointerEvent) => {
    const role = roles.get(e.pointerId);
    if (!role) return;
    roles.delete(e.pointerId);

    if (role === 'stick') {
      stickBase.delete(e.pointerId);
      input.stickActive = false;
      input.move.x = 0;
      input.move.y = 0;
    } else if (role === 'lever') {
      lookLast.delete(e.pointerId);
      input.leverActive = false;
      if (!input.vertLatched) {
        input.vert = 0;
      }
    } else if (role === 'look') {
      lookLast.delete(e.pointerId);
      lookPointers.delete(e.pointerId);
      if (lookPointers.size < 2) lastPinchDist = null;
    }

    updatePointersVisual();
  };

  // Hidden keyboard fallback writing to the same `input` contract
  const syncKeysToInput = () => {
    if (input.stickActive) return;
    let mx = 0;
    let my = 0;
    if (keys.has('w') || keys.has('arrowup')) my += 1;
    if (keys.has('s') || keys.has('arrowdown')) my -= 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    const len = Math.hypot(mx, my);
    input.move.x = len > 1 ? mx / len : mx;
    input.move.y = len > 1 ? my / len : my;

    if (!input.leverActive && !input.vertLatched) {
      let vy = 0;
      if (keys.has(' ') || keys.has('e')) vy += 1;
      if (keys.has('c') || keys.has('q')) vy -= 1;
      input.vert = vy;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    input.lastTouchMs = performance.now();
    keys.add(k);
    syncKeysToInput();
    if (k === 't') {
      input.torchToggle = true;
    }
    if (k === 'f') {
      input.sonarPulse = true;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.key.toLowerCase());
    syncKeysToInput();
  };

  const onBlur = () => {
    keys.clear();
    roles.clear();
    stickBase.clear();
    lookLast.clear();
    lookPointers.clear();
    input.move.x = 0;
    input.move.y = 0;
    if (!input.vertLatched) input.vert = 0;
    input.stickActive = false;
    input.leverActive = false;
    updatePointersVisual();
    notifyHudImmediate();
  };

  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  const onDeviceOrientation = (e: DeviceOrientationEvent) => {
    if (!STATE.settings.gyroLook) {
      lastGyroBeta = null;
      lastGyroGamma = null;
      return;
    }
    if (e.beta === null || e.gamma === null) return;
    if (lastGyroBeta !== null && lastGyroGamma !== null) {
      const db = e.beta - lastGyroBeta;
      const dg = e.gamma - lastGyroGamma;
      input.lookDx += dg * 2.5;
      input.lookDy += db * 2.5;
    }
    lastGyroBeta = e.beta;
    lastGyroGamma = e.gamma;
  };

  if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', onDeviceOrientation);
    gyroAttached = true;
  }

  surfaceEl.addEventListener('pointerdown', onPointerDown, { passive: false });
  surfaceEl.addEventListener('pointermove', onPointerMove, { passive: false });
  surfaceEl.addEventListener('pointerup', endPointer);
  surfaceEl.addEventListener('pointercancel', endPointer);
  surfaceEl.addEventListener('lostpointercapture', endPointer);
  surfaceEl.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    surfaceEl.removeEventListener('pointerdown', onPointerDown);
    surfaceEl.removeEventListener('pointermove', onPointerMove);
    surfaceEl.removeEventListener('pointerup', endPointer);
    surfaceEl.removeEventListener('pointercancel', endPointer);
    surfaceEl.removeEventListener('lostpointercapture', endPointer);
    surfaceEl.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (gyroAttached) {
      window.removeEventListener('deviceorientation', onDeviceOrientation);
    }
  };
}
