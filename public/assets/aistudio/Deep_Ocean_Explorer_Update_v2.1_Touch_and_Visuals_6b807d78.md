# Deep Ocean Explorer — Update v2.1 ("Touch-First + Photon-Budget Visuals")

> **Companion to `Deep_Ocean_Explorer_Blueprint_v2.md`.** The Blueprint stays the source of truth *except* where this file overrides it (see §0.2). Where this file is silent, follow the Blueprint.
> Pseudo-code and shader sketches here specify *behaviour and structure*, not final syntax. Numbers marked ⚠️ are starting values to be tuned on the real phone.

---

## 0. READ THIS FIRST (note to the coding assistant)

### 0.1 Situation

The project owner plays and tests **on a phone** (touch only, landscape). The first build (Phase 1 + UI skeleton) was written as a desktop app: **WASD + mouse-drag flight, keyboard hints on screen, no touch input at all.** Blueprint §9.2 already specified the touch layout; it was skipped. This update fixes that, repairs several engine bugs found in a code audit, and raises the visual density substantially.

Current repo: Vite + React 19 + Three.js r187 + Tailwind 4. Files: `src/App.tsx`, `src/ocean/oceanRenderer.ts`, `src/terrain/terrainManager.ts`, `src/world/coords.ts`, `src/types.ts`, `src/ui/{HudOverlay,QuickWheel,ExpeditionBoard,DebugTuningPanel}.tsx`, `src/data/destinations.json`.

### 0.2 What this file overrides in Blueprint v2

| Blueprint section | Override |
|---|---|
| §9.2 Touch layout | **Touch is now the primary input.** Keyboard/mouse remain as an invisible fallback; they must never be advertised in the HUD. |
| §9A "empty screen" | Enforced strictly: max 5 persistent on-screen elements (§2.2 below). The current HUD (big top bar, bottom-left info box, bottom-right "CONTROLS" box) is **removed**. |
| §12 Performance tiers | **Replaced** by the higher-density tiers in §4.2. |
| §5 / §15 Terrain | Terrain is a **GPU geometry clipmap** (§4.3), not a CPU-rebuilt plane. |
| §20.1 Continuation Protocol | Still applies exactly. Phases are now U1–U6 (§5). |

### 0.3 Rules for every response

1. The user tests **on a phone**. Every feature must work with thumbs only. If you add a button, it has a 48 dp hit area.
2. Output **complete files**, never "rest unchanged".
3. Keep working code working: don't delete QuickWheel / ExpeditionBoard / DebugTuningPanel, but make them touch-correct (§2.7).
4. No `Math.random()` in anything world-related (Blueprint §20.6). Use the deterministic integer hash (§4.3.4).
5. Do not ask permission between phases. Print `✅ PHASE Un COMPLETE` with 3–5 lines on how to test it **on a phone**, then continue.
6. If you assume something, list it in a short note at the top of your reply.

---

## 1. Audit of the current repo (what is wrong, and where)

| ID | Where | Problem | Fix lives in |
|---|---|---|---|
| **F1** | `App.tsx` input | Only `keydown/keyup` + `mousedown/mousemove`. No Pointer/Touch events. On a phone nothing moves, and the page can scroll/zoom. No `touch-action: none`. | §2 |
| **F2** | `HudOverlay.tsx` | Shows "WASD / Arrow Keys", "Space / C", "Menu (Tab)". Large panels top and bottom break the empty-screen rule. | §2.2, §2.7 |
| **F3** | `App.tsx` `animate()` | Calls `setCameraState(...)` **every frame** while moving or looking → the whole React tree re-renders at 60 Hz. Will stutter on phones. | §3.1 |
| **F4** | `App.tsx` | `camera.position.set(0, 0, 0)` every frame, while the sea surface sits at `y = 0` and the seabed at `y = -depth`. Changing `h` only changes the HUD number; **diving does not change what you see.** | §3.2 |
| **F5** | `App.tsx` | `hFov` (meant as *horizontal*) is assigned straight to Three's `camera.fov`, which is *vertical*. On a 20:9 phone, "100°" becomes ≈139° horizontal. Violates Blueprint §9.1. | §3.3 |
| **F6** | `terrainManager.ts` | `updateHeights()` rewrites 16,641 vertices (4 noise octaves each) **and runs `computeVertexNormals()` on the CPU every frame**. Noise is sampled in *degrees* at `0.01` frequency, so across the 10 km patch the input changes by ~0.001 → the seabed is effectively **flat**. Only 128×128 cells (~32k triangles, 78 m per cell), flat-shaded. This is why it looks minimal. | §4.3 |
| **F7** | `App.tsx`, `oceanRenderer.ts` | Constant ambient light (0.8), constant sun (2.0) and constant `FogExp2(0.0015)` at every depth. `OceanRenderer.update()` computes `turbidity` and never uses it. Violates Blueprint §6.2 / §6.4 (darkness is the design). | §3.4 |
| **F8** | `oceanRenderer.ts` | `Math.random()` in marine snow; 3,000 particles updated on the CPU every frame; respawn logic uses `camPos.y`, which is always 0. | §4.6 |
| **F9** | `oceanRenderer.ts` | Sea surface is a static 5 km flat plane (64×64), `MeshStandardMaterial`, no Gerstner waves, doesn't follow the camera (you can fly out of it). | §3.5 |
| **F10** | `App.tsx` | `antialias: true` with pixel ratio up to 2 on a phone burns fill-rate; no adaptive resolution; no context-loss handling; no wake lock; uses `h-screen` (`100vh`) which is wrong on mobile browsers. | §2.6, §4.2 |

---

## 2. Touch-first controls (U1)

### 2.1 Principles

* **Fly where you look.** Stick-forward thrusts along the full 3D look direction (including pitch). Look down + push forward = dive. This removes most need for a vertical control.
* Two thumbs, always reachable: **left thumb = move**, **right thumb = look**. A vertical lever is available at the right edge for pure up/down.
* Roll is auto-levelled (horizon stays up).
* Everything fades to ~30% opacity after 4 s of no touch and comes back on touch.
* Keyboard/mouse write into the **same input fields** as touch (§2.5) so there is one movement code path.

### 2.2 Layout (landscape; max 5 persistent elements)

```
┌───────────────────────────────────────────────────────────────┐
│ [depth ribbon]                                     [menu ☰]   │
│                                                               │
│                   (drag anywhere here = look)                 │
│                                                               │
│   ◯  MOVE stick (floating)                            ┌─┐     │
│  left ~45% of screen, lower 70%                       │▲│     │
│                                                       │ │ VERT│
│  [🔦][CRAWL|CRUISE|WARP] speed slider ═══●═══         │▼│     │
└───────────────────────────────────────────────────────────────┘
```

The five persistent elements: **(1)** depth ribbon (tiny, top-left), **(2)** menu button (top-right), **(3)** move stick, **(4)** vertical lever, **(5)** speed strip (mode chips + slider + torch icon at its left end).

### 2.3 Specs

| Control | Behaviour |
|---|---|
| **Move stick** | **Floating:** appears where the left thumb lands inside the left ~45% × lower 70% zone; base radius 56 dp; output clamped to the unit disk; **dead zone 12%**, then remap to 0–1; response curve `out = in^1.4` for fine control. Lifting the thumb sets thrust to 0 (inertia then coasts per the Inertia setting). Optional "Fixed stick" setting. Up = forward, down = back, left/right = strafe. |
| **Vertical lever** | Right edge, ~64 × 200 dp, fixed. Spring-return by default; double-tap the lever to **latch** (stays pushed) / tap again to release. Maps to world-up/down (not camera-relative). |
| **Look** | Drag in any area not claimed by stick/lever/UI. Base **0.12°/px** (CSS px). Scale sensitivity by `hFov / 100` so narrow FOV looks slower. Smooth with `1 − exp(−dt/0.03)`. Pitch clamp ±89°. Settings: sensitivity slider, invert-Y, optional **gyro look** (`DeviceOrientationEvent`; on iOS call `requestPermission()` from a tap). |
| **Speed strip** | Three mode chips + one slider (each mode keeps its own value, Blueprint §9.3). Slider hit area 48 dp tall, visible thumb 28 dp. Double-tap thumb = reset to default. A small ± stepper at each end for fine tuning. |
| **Torch icon** | Tap = toggle torch. Long-press = open torch quick settings (power / colour / focus). |
| **FOV** | Slider in Menu → View (80–120°). Optional two-finger **pinch** adjusts FOV *only when no control pointer is active* (default OFF; setting). |
| **Left-hand layout** | Mirrors stick/lever zones. Setting in Menu → System. |
| **Level flight toggle** | Menu → System: "Stick ignores pitch" for people who prefer plane-style flat movement. Default OFF. |

### 2.4 Pointer routing (use Pointer Events, not Touch/Mouse)

```ts
// src/input/touchControls.ts  (reference sketch)
type Role = 'stick' | 'lever' | 'look' | 'ui';
const roles = new Map<number, Role>();             // pointerId -> role

canvasOrOverlay.addEventListener('pointerdown', e => {
  const role = pickRole(e.clientX, e.clientY);     // zones from §2.2; 'ui' if over a button/slider
  if (role === 'ui') return;                       // let normal UI handle it
  roles.set(e.pointerId, role);
  el.setPointerCapture(e.pointerId);               // keep receiving moves outside the element
  begin(role, e);                                  // stick: record base point; look: record last point
  e.preventDefault();
}, { passive: false });

pointermove: switch(roles.get(e.pointerId)) {
  'stick': input.move = clampDisk((e.clientX - base.x, e.clientY - base.y) / STICK_RADIUS_PX) -> deadzone -> curve
  'lever': input.vert = clamp((leverCenterY - e.clientY) / LEVER_HALF_PX, -1, 1)
  'look' : input.lookDx += e.movementX ?? (e.clientX - last.x); input.lookDy += ...   // consumed once per frame
}
pointerup / pointercancel / lostpointercapture: roles.delete(id); zero that role's output (lever: unless latched)
```

Multi-touch is mandatory: stick + look + lever may all be active at once. Each role binds to its own `pointerId`.

### 2.5 Input → state contract

```ts
// src/core/state.ts
export const input = { move: {x:0, y:0}, vert: 0, lookDx: 0, lookDy: 0, torchToggle: false };
// touchControls.ts AND the keyboard fallback write ONLY to `input`.
// The render loop reads `input`, zeroes lookDx/lookDy after use, and never touches React.
```

Keyboard fallback (hidden, not shown in HUD): `WASD` → `input.move`, `Space/C` → `input.vert`, mouse-drag → look, `T` → torch.

### 2.6 Mobile web hygiene (all required)

* `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`
* CSS on the app root and canvas: `touch-action: none; overscroll-behavior: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;` Use `height: 100dvh` (not `100vh`). Respect `env(safe-area-inset-*)` for the corner controls.
* `contextmenu` → `preventDefault()` on the canvas.
* `manifest.json` with `display: "fullscreen"`, `orientation: "landscape"`, plus a **"Go fullscreen"** action on the first tap (Fullscreen API needs a gesture). Registered as installable PWA.
* **Screen Wake Lock** while flying (re-acquire on `visibilitychange`).
* **Haptics** via `navigator.vibrate` where supported (guard it): breach, torch toggle, sonar ping, entering Warp. Setting to disable.
* `visibilitychange` → pause the loop and audio; handle `webglcontextlost` / `webglcontextrestored` (rebuild resources).
* Re-measure on `resize` **and** `orientationchange`; update projection with the *horizontal→vertical* FOV conversion (§3.3).

### 2.7 Making the existing UI touch-correct

* **HUD:** delete `HudOverlay.tsx`'s three big panels; replace with `TouchHud.tsx` (the five elements in §2.2). Glance bar (lat/lon/depth/time) appears only when the menu button is tapped (L1, Blueprint §9A.1).
* **QuickWheel:** keep six spokes, but each spoke is a ≥ 56 dp tap target; remove "(Tab)" text; no hover-only states (`hover:` classes are fine as decoration, never as the only affordance).
* **Sliders in modals:** 48 dp hit height; add ± steppers.
* **ExpeditionBoard:** full-screen sheet with vertically scrollable cards (`touch-action: pan-y` inside it); "Dive here" button ≥ 48 dp; close = X in the corner **and** swipe down.
* **DebugTuningPanel:** opens by **long-pressing the menu button for 1.5 s** (no keyboard needed). Scrollable.
* Replace `window.addEventListener('mousemove'|'keydown', ...)` idle detection in the HUD with `pointerdown`.

### 2.8 Acceptance tests (on the phone)

| # | Test | Expected |
|---|---|---|
| T1 | Open the app, rotate to landscape | Fullscreen-capable, no page scroll, no pinch-zoom, no text selection, no long-press menu |
| T2 | Left thumb stick + right thumb look simultaneously | Both work at the same time; no stuck input after lifting either thumb |
| T3 | Look down 45° and push stick forward | Dive along the look direction |
| T4 | Lever up/down, double-tap latch | Pure vertical movement; latch holds; tap releases |
| T5 | Change FOV 80→120 | Smooth; matches the *horizontal* value (§3.3) |
| T6 | Each speed mode's slider | Own value per mode; Crawl 0 = hold perfectly still |
| T7 | Idle 5 s | Controls fade to ~30%; any touch restores them |
| T8 | Open Menu → every spoke, Expedition Board, Debug (long-press) | All reachable and operable with thumbs |
| T9 | Lock phone and unlock | Loop resumes; no black canvas |

---

## 3. Engine fixes (U2)

### 3.1 Move simulation state out of React (fixes F3)

```ts
// src/core/state.ts — one mutable object, read/written by the loop and input only
export const STATE = { cam: { east: 0, north: 0, h: 30.48, yaw: 0, pitch: -0.15, vel: new Vec3() /* f64 numbers */ },
                       originLatLon: { lat: 0, lon: -20 }, /* … speed modes, torch, sonar, view … */ };
// HUD gets a throttled snapshot (~8 Hz) via a tiny external store (useSyncExternalStore) — NOT setState per frame.
// React state is only for menus and settings.
```

Positions are doubles in metres east/north/height from `originLatLon` (rebase every ~50 km, Blueprint §3). Derive lat/lon for display only.

### 3.2 Real floating origin (fixes F4)

* Render camera is at `(0, STATE.cam.h, 0)` in scene space. Terrain, sea surface and snow are positioned **relative to the camera in XZ** (snapped, §4.3), and use true heights in Y.
* Diving from `h = +30.48` to `h = −300` must visibly move you through the surface and down toward the seabed.
* The sea surface follows the camera XZ (snapped to its wave-grid cell) so you can never leave it.

### 3.3 Correct FOV (fixes F5)

```ts
function applyFov(camera, aspect, hFovDeg, dt, state) {
  const target = clamp(hFovDeg, 80, 120);
  state.fovSmooth += (target - state.fovSmooth) * (1 - Math.exp(-dt / 0.12));
  const h = THREE.MathUtils.degToRad(state.fovSmooth);
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);       // vertical FOV for Three.js
  camera.fov = THREE.MathUtils.radToDeg(v);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
```

Never let any speed effect push horizontal FOV outside 80–120°.

### 3.4 Depth-aware light and fog (fixes F7)

Create one shared uniform block `WATER` (updated once per frame) used by **every** material: `uKd` (vec3 per-channel attenuation from Blueprint §6.2 `ABSORB` + water-type scatter), `uSunColorAtDepth` (vec3), `uSunDir`, `uTorch*` (position, direction, inner/outer cos, colour×lumens), `uDepth`, `uVisOmni`, `uVisCone` (§4.4).

* Delete the constant `AmbientLight`, `DirectionalLight` and `FogExp2`. Shade in the shaders with: `lit = albedo * (sunLight(depth)·N·shadowless + torchLight) ; final = lit * exp(-uKd * dist) + inscatter` (Blueprint §6.2 `underwaterColor`).
* Background/sky colour is a function of depth and sun elevation (bright cyan near the surface → black by ~300–500 m). Below the sunlit zone **ambient = 0** (Blueprint §6.4.1).
* Torch is evaluated analytically in the shader (Blueprint §6.4.3 `torchLightAt`), offset ~0.3 m below/right of the camera.

### 3.5 Sea surface (fixes F9)

* One mesh (e.g. 256×256 grid, camera-following, snapped to its cell) with a **Gerstner vertex shader** (6–8 waves, sea-state slider), Fresnel + sun glint, foam from the displacement Jacobian.
* **Seen from below:** render the underside with **Snell's window** (a bright circle of sky ≈97° wide overhead; total internal reflection outside it shows the dark water). Cheap and a strong "wow" moment when you dive.
* Breach transition per Blueprint §6.1 (waterline effect + haptic + low-pass sweep).

---

## 4. The visual push (U3–U6)

### 4.1 Honest framing

I cannot measure on the owner's phone from here, so the numbers below are **starting targets**. The real mechanism is the **Density Governor** (§4.4.4): it measures frame time on the device and raises or lowers geometry density automatically. "Polycount" = whatever the phone sustains at the target fps, starting much higher than Blueprint §12.

### 4.2 New quality tiers (replaces Blueprint §12)

Triangle figures are the **worst case before culling**; §4.4 usually removes a large share of them.

| Tier | Target | Clipmap grid N × rings | Terrain tris (≈1.5·N²·rings) | Scene tris target | Draw calls | Marine snow | Notes |
|---|---|---|---|---|---|---|---|
| Phone Low | 30 fps | 192 × 5 | ~0.28 M | ~0.6 M | ≤ 150 | 12k | no volumetric torch, simple caustics |
| **Phone Std** | 45 fps | 256 × 6 | ~0.6 M | ~1.5 M | ≤ 220 | 24k | half-res volumetric torch |
| **Phone High** (flagship) | 60 fps | 384 × 7 | ~1.5 M | ~3 M | ≤ 260 | 40k | + bloom, god-rays |
| Desktop Ultra | 60+ fps | 512 × 8 | ~3.1 M | ~6 M+ | ≤ 500 | 100k | full effects |

(Old Blueprint caps were 150k / 400k / 1.5M terrain verts. Phone High now matches the old *desktop* High.)

Mobile-GPU rules that apply to every tier:

* Renderer: `antialias: false`; **dynamic resolution** (render scale 0.6–1.0 × `devicePixelRatio`, capped at 2) driven by the governor; cheap post-AA only if it's affordable.
* Avoid sub-pixel triangles: target **≥ ~8 px² per triangle** at the finest ring. Mobile GPUs choke on micro-triangles. §4.4.2 picks cell sizes so this holds.
* Static geometry only for terrain (buffers created **once**; positions are computed in the vertex shader). No per-frame buffer rewrites, no per-frame allocations.
* Use `InstancedMesh` (or `BatchedMesh`) for everything repeated. Merge static sub-meshes. Keep draw calls inside the tier cap.
* Procedural materials only (no texture downloads) — see §4.5.

### 4.3 Terrain: GPU geometry clipmap (fixes F6)

#### 4.3.1 Structure

* **K nested square rings** (K and N from the tier). Ring *j* has grid cell size `cell0 · 2^j` and spans `±(N/2) · cell0 · 2^j` metres. Ring 0 is a full square; rings ≥1 have the inner ¼-hole where the finer ring sits.
* Each ring is **one static indexed grid mesh**, built once, split into **12 angular sectors** (separate meshes or index ranges with bounding spheres) so §4.4.3 can cull by torch cone and range. Rough draw-call count: K rings × 12 sectors ≈ 60–100.
* Per-ring uniforms: `uCell`, `uSnapRel` (ring centre, **snapped to `2·cell` in world space on the CPU in f64**, then expressed relative to the floating origin so the number is small). Snapping in *world* space prevents vertex "swimming".
* Vertex attribute: `aGrid` (integer grid coords). Vertex shader computes `local = uSnapRel + aGrid * uCell` and displaces Y.
* **Geomorphing:** blend each ring's outer ~25% toward the coarser ring's height so there are no LOD pops; add a small skirt (drop ≈ 2 cells) at ring borders to hide any cracks.
* Fog/absorption (§3.4) hides the remaining transitions.

#### 4.3.2 Height function (macro + mid + micro, all in **metres**)

Fix the scale bug (F6): noise is evaluated in **metres in world space**, not degrees.

| Band | Wavelengths | Technique | Amplitude |
|---|---|---|---|
| Macro | ≥ 450 m | later: sampled from the GEBCO tile texture; now: analytic basins/shelf/trench in metres (the existing `getSeabedDepth` idea, rescaled) | 100s–1000s m |
| Mid | 20–450 m | ridged multifractal (abyssal hills, canyon walls) | 5–80 m |
| Micro | 0.12–20 m | Worley/cellular (pillow basalt), ridged rocks, anisotropic ripples/dunes on sediment | 0.05–3 m |

* **The starting preset must have obvious relief within 1–2 km** (hills, a slope, a canyon edge). Otherwise this will look flat again.
* Each octave's amplitude is scaled by a slope/TID-style mask (Blueprint §5.2/§5.4): more procedural detail where the data is guesswork.
* Use **value/gradient noise with analytic derivatives** so one evaluation returns height *and* gradient. The vertex shader outputs a normal without extra samples; the fragment shader adds a per-pixel micro-normal from 2 octaves that fades with distance (hides aliasing).
* **Nyquist LOD:** ring *j* evaluates only octaves with wavelength ≥ `4 · cell_j`. Coarse rings run few octaves; ring 0 runs the most (cap ≈ 10 octaves per vertex).
* Micro amplitude is capped (≈ 3 m) so the CPU `heightAt()` (proximity brake, spawning) can ignore it. The CPU twin of macro+mid must use the **same hash and the same octave constants** so GPU and CPU agree.

#### 4.3.3 The "exact lattice" trick (keeps noise stable far from the origin)

32-bit floats break world-space noise far from the origin (shimmer, stair-steps). Don't pass big world coordinates to the GPU. Instead:

```ts
// CPU (f64), per octave i with frequency f_i, whenever the floating origin changes:
A  = originWorld * f_i;            // f64 vec2
I_i = floor(A);                    // integer lattice offset  -> uniform ivec2 uOrigInt[i]
F_i = A - I_i;                     // fractional part          -> uniform vec2  uOrigFrac[i]
```

```glsl
// GPU, per octave:
vec2  q    = local * f_i + uOrigFrac[i];     // small numbers → float-safe
ivec2 cell = uOrigInt[i] + ivec2(floor(q));  // exact integer lattice cell
vec2  t    = fract(q);                       // interpolation weight
// corner hash uses `cell` (integers), so values are identical no matter where the origin is
```

#### 4.3.4 Deterministic hash (CPU and GPU twins)

```glsl
uint pcg(uint v){ uint s = v*747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hash2(ivec2 c){ return float(pcg(uint(c.x) * 1597334677u ^ pcg(uint(c.y) + 0x9E3779B9u) ^ SEED)) * (1.0/4294967295.0); }
```

The TS twin uses `Math.imul` and `>>> 0` to produce identical bits. `SEED` is the fixed `WORLD_SEED` constant.

#### 4.3.5 Material (procedural, texture-free)

Triplanar-free (heightfield uses XZ) layered rock/sediment shader: base colour from strata noise; **sediment on up-facing slopes** (`N.y` high), bare rock on steep faces; ripples on flat sediment; wet-dark crevices (cavity from height noise). Everything shaded with the water/torch model from §3.4, so colour only appears near the light.

### 4.4 THE TRICK: Photon-Budget LOD ("only build what the light can reach")

**Idea.** In water, *nothing is visible beyond a physically computable distance*, and in the deep the only visible volume is the torch cone (plus sonar pulses). A normal renderer spends geometry as if it could see to the horizon. We instead make **one function, `reach()`, the single source of truth** for how far we can see and drive *everything* from it: fog, far plane, which clipmap rings exist, how fine they are, which sectors are drawn, spawn radius, snow shell size. Geometry is then concentrated on the few metres that can actually receive photons, so the same triangle budget buys **5–20× the density** (⚠️ expectation, verify with the overlay) and LOD transitions hide inside real fog.

#### 4.4.1 `reach()` — the visibility contract

```ts
interface Reach { omni: number; cone: number; coneHalfAngle: number; coarse: number }  // metres, radians

function computeReach(s): Reach {
  // Beam attenuation of the BEST-transmitted channel (blue) = absorption + scattering.
  const K = ABSORB.b + SCATTER[s.view.waterType];            // SCATTER ⚠️: Clear 0.03 · Coastal 0.15 · Murky 0.5  (1/m)
  const contrastRange = Math.log(20) / K;                    // distance where contrast falls to ~5%  (Clear ≈ 70 m)

  const sun = sunlightBlueAtDepth(s);                        // 0..1 via Beer-Lambert (§6.2), includes sun elevation
  const omniDay = contrastRange * smoothstep(T_DARK, 40 * T_DARK, sun);   // fades out toward the dark zone
  const omni = Math.max(omniDay, s.bioluminescenceReach /* ≈ 3–8 m near glowing things */);

  const torchReach = s.torch.on ? solveTorchReach(s) : 0;    // distance where torchLightAt() on a ~20% albedo surface < eye threshold (bisection, 8 iters)
  const cone  = Math.max(torchReach, omni);
  const coarse = s.sonar.active ? s.sonar.range : cone;      // sonar draws terrain *outline only* out to its range
  return { omni, cone, coneHalfAngle: s.torch.outerAngle, coarse };
}
```

Compute once per frame (cheap), put `omni`/`cone` in the `WATER` uniforms.

#### 4.4.2 Fit the clipmap to the light

Instead of a fixed `cell0`, **fit the rings to what is visible**:

```ts
const reachMax = Math.max(reach.cone, reach.coarse);
const cell0 = clamp(reachMax * 1.1 / ((N / 2) * 2 ** (K - 1)), MIN_CELL /* ≈ 0.03 m ⚠️ */, MAX_CELL /* ≈ 0.5 m */);
for (const ring of rings) ring.enabled = ring.innerRadius < reachMax;     // rings fully beyond reach cost nothing
```

Example (Phone Std, N = 256, K = 6, clear daylight, reach ≈ 70 m): `cell0 ≈ 70·1.1/(128·32) ≈ 1.9 cm` → clamped to 3 cm: rings 0–4 are active; **~3 cm cells right under you** instead of 78 m cells. In the deep with a 25 m torch: rings 0–3 only. `MIN_CELL` guards the ≥ 8 px² rule (re-derive from the render resolution and FOV if you change it).

#### 4.4.3 Cull by cone as well as range

Per frame, for each ring sector (bounding sphere):

```ts
const visible = ring.enabled && frustumTest(sector)
             && (insideSphere(sector, camPos, reach.omni)                 // lit by ambient / bioluminescence
                 || insideCone(sector, torchPos, torchDir, reach.coneHalfAngle + margin, reach.cone)
                 || (sonar.active && withinRange(sector, reach.coarse)));  // sonar outline pass (cheap shader)
sector.visible = visible;
```

In the dark the torch cone is a small fraction of the sphere around you, so most sectors are skipped.

#### 4.4.4 Density Governor (spend the savings)

```ts
// once per frame, smoothed; hysteresis so it doesn't flap
const ft = emaFrameTimeMs;                         // exponential moving average
if (ft > targetMs * 1.10 && cooldown == 0) levelDown();   // 1) drop render scale, 2) drop N, 3) drop octaves, 4) drop snow/actors
if (ft < targetMs * 0.80 && cooldown == 0) levelUp();     // reverse order
// Thermal-aware: if over budget for >20 s, drop one whole tier and wait 60 s before trying up.
// Because §4.4.3 culls so much, the governor can run N (ring grid size) and instance counts much higher than a static-LOD renderer.
```

Expose the current level, scene triangle count, draw calls, `omni`, `cone`, active rings and visible sectors in a debug overlay (§6).

#### 4.4.5 Why this is safe (design rules)

* The same `reach()` drives fog density (`K`), so what you *can't* see is genuinely cut. No "pop-in" surprise: geometry appears while still inside fog/dark.
* Sonar and the Honest-Map survey view use the `coarse` radius, so the world is still *navigable* in the dark.
* Warp mode (Blueprint §9.4) overrides: `reach` is ignored, the governor jumps to the coarsest rings, micro octaves off.

### 4.5 Content density (instanced, shader-animated)

Budgets are per tier (use the lower end on Phone Std):

| Content | Technique | Budget (Phone Std → High) |
|---|---|---|
| Rocks, boulders, sponges, tube worms | `InstancedMesh`, 3–4 mesh variants (200–1,500 tris each), placement from the deterministic hash in world cells | 5k → 15k instances near, ring-limited by `reach` |
| Corals / kelp / seagrass | Instanced branched meshes, vertex-shader sway | 3k → 10k |
| Fish & schools | `InstancedMesh`, 300–2,000 tris, **vertex-shader swim** (spine sine-bend), cell-spawned (Blueprint §8.4); mesh → simplified → impostor → glow-dot chain | 150 → 600 full-detail actors |
| Large animals (whale, shark, giant squid) | Hero meshes 20k–80k tris, GPU-skinned or shader-bend | 1–3 at once |
| **Wrecks** | Parametric hull (Blueprint §7.2.1) + **greebles** (ribs, plates, rails, portholes, hatches) as instanced detail; hero wrecks 150k–400k tris | 1 hero + ≤ 5 parametric |
| Marine snow | **GPU particles** (§4.6), no CPU loop | 24k → 40k |

All spawn radii are clamped by `reach.omni` / `reach.cone`: nothing is generated in the dark outside the light.

### 4.6 Lighting and effects (cheap but rich)

* **Marine snow (fixes F8):** a single `Points`/instanced quad draw; positions computed **in the vertex shader** from a hashed particle id, time, current vector and a camera-centred shell (`size = reach`-scaled); no `Math.random()`, no CPU updates. Streaks stretch with speed in Warp. Density follows a depth curve.
* **Volumetric torch beam:** raymarch inside the cone only, **half-res**, 16 steps (Phone Std) / 24 (High), blue-noise jitter, Henyey-Greenstein phase `g = 0.6`, modulated by snow density (Blueprint §6.4.3 backscatter). Composite with a bilateral/depth-aware upsample.
* **Bioluminescence:** emissive instances + a cheap quarter-res bloom (Phone High and up).
* **Caustics:** animated procedural pattern projected along the sun vector, fading out by ~40 m, shallow only.
* **God-rays:** screen-space radial blur or a few additive cone billboards; shallow only; skip on Phone Low.
* **Eyeshine** on large-eyed animals within the torch cone (Blueprint §6.4.3).
* **Particulate/dust motes** in the torch beam are the same snow system, boosted near the cone axis.

---

## 5. Phases (each shippable and testable on the phone)

| Phase | Goal | Contents | Acceptance |
|---|---|---|---|
| **U1** | Touch-first flight | §2 in full + F1/F2/F3/F10 hygiene + `TouchHud` + STATE refactor (§3.1) | §2.8 tests T1–T9 pass |
| **U2** | Real camera + water | §3.2–3.5: floating origin, correct FOV, depth-aware light/fog (delete constant lights/fog), Gerstner surface with Snell's window, breach haptic | Diving visibly moves you through the surface; red gone by ~15 m; dark blue by ~200 m; looking up from underwater shows Snell's window |
| **U3** | GPU clipmap terrain | §4.3: rings, sectors, morphing, exact-lattice noise, relief preset, CPU `heightAt()` twin | Visible hills/canyon within 1–2 km; no seams or pops; no CPU mesh rebuilds; steady fps in Cruise |
| **U4** | Photon-Budget LOD | §4.4: `reach()`, fitted clipmap, cone/range culling, Density Governor, debug overlay | Overlay shows tri count rising in the lit volume and falling outside; ≥ 3 cm cells under you in clear shallows; governor holds the tier's fps target |
| **U5** | Look & atmosphere | §4.5 materials (strata/sediment), GPU marine snow, half-res volumetric torch, caustics, Snell/god-rays by tier | Torch shows colour only within a few metres; beam has visible backscatter; snow drifts |
| **U6** | Instanced density | §4.5 rocks/coral/sponges, a fish-school test, one parametric hero wreck with greebles | Hundreds of instances within draw-call cap; sizes correct against the 1 m / 10 m grid-cube overlay |

After U6, continue with Blueprint Phases 3–9 as written (GEBCO tiles replace the analytic macro band; the clipmap and `reach()` carry over unchanged).

---

## 6. Debug / tuning additions (touch-operable, hidden by long-press on the menu button)

* Overlay toggles: FPS + frame-time graph · scene triangles · draw calls · render scale · governor level · `omni` / `cone` / `coarse` (m) · active rings & visible sectors · cell0 (cm) · torch cone gizmo · 1 m / 10 m scale cubes · **pointer visualiser** (shows stick/look/lever touches and their roles).
* Buttons: force tier (Low/Std/High/Ultra) · freeze governor · disable terrain micro-detail · disable snow · disable torch volume · seed override · teleport (lat, lon, depth) · export/import settings JSON (copy to clipboard) · screenshot + state JSON (so the owner can paste exact conditions back).

---

## 7. Known gotchas for this update

* Don't create/destroy terrain geometry per frame. Move rings by changing **uniforms** only.
* Snap ring centres in **world space (f64 on the CPU)**, not in camera-relative space.
* Never pass large world coordinates into shaders; use the exact-lattice scheme (§4.3.3).
* Pointer Events need `setPointerCapture` or look-drag will drop when the finger leaves the element.
* `touch-action: none` on the canvas/overlay, but `pan-y` inside scrollable modals.
* Don't call `setState` in `requestAnimationFrame`. HUD snapshot ≤ 10 Hz.
* Don't use `100vh`; use `100dvh`.
* Keep `reach` consistent with the fog `K`. If they diverge you will see either popping geometry or wasted triangles.
* Don't add ambient light below ~300 m "to help". Darkness is the design.

---

## 8. Pre-flight checklist for the owner

* [ ] Attach to Gemini: Blueprint v2, **this file**, and the current repo (already in the AI Studio project).
* [ ] Paste the master prompt in §9 first.
* [ ] After each `✅ PHASE Un COMPLETE`, test on the phone using the listed steps and reply with what feels wrong ("too fast", "stick drifts", "looks flat"). Use Debug → Export settings to send exact values.
* [ ] If fps is poor, tell it the phone model; the governor starting tier can be set manually.

---

## 9. Master prompt to paste into Gemini

> You are the lead engineer continuing "Deep Ocean Explorer" (personal, non-commercial, web-first Three.js app; repo already in this project: Vite + React 19 + Three r187 + Tailwind 4). **Two documents are the source of truth: `Deep_Ocean_Explorer_Blueprint_v2.md` and `Deep_Ocean_Explorer_Update_v2.1_Touch_and_Visuals.md`. Where they conflict, Update v2.1 wins (see its §0.2).**
>
> **The owner plays on a phone, touch only, landscape.** The current build only supports WASD and mouse-drag; that is a bug. Make touch the primary input exactly as specified in Update §2 (floating move stick, right-edge vertical lever, drag-look, speed strip with per-mode sliders, torch icon, ≤ 5 persistent HUD elements, Pointer Events with multi-touch). Keyboard/mouse stays only as a hidden fallback that writes to the same input object.
>
> Then fix the audited defects F1–F10 (Update §1), and implement the visual push: GPU geometry clipmap terrain with exact-lattice world-space noise (§4.3), the **Photon-Budget LOD** system (`reach()`-driven ring fitting, cone/range culling, Density Governor; §4.4), the new quality tiers (§4.2), GPU marine snow, half-res volumetric torch and depth-aware lighting (§3.4, §4.6), and instanced content density (§4.5).
>
> Work through **Phases U1 → U6** (Update §5) in order, module by module, with **no pauses between phases**. **Write as much working code as you can in every response and don't stop or ask permission until you run out of tokens for that response.** Always output **complete files** (never "rest unchanged"). Follow the **Continuation Protocol in Blueprint §20.1 exactly**: number files `[File i/N] path`, and when you are about to run out of tokens end with the "⛔ OUT OF TOKENS FOR THIS RESPONSE" block (Finished / Stopped at / Next up). When I reply "continue", begin with "▶ CONTINUING <file> from <function>", restart from the last complete function, and never repeat finished code. If my reply is anything other than "continue", treat it as a bug report or instruction, fix it, then carry on.
>
> Rules: units are metres/seconds/degrees internally; doubles on the CPU, camera-relative floats on the GPU; **no `Math.random()` in world generation** (use the PCG hash, CPU/GPU twins); no per-frame `setState`; no per-frame geometry rebuilds; procedural materials only; darkness below the sunlit zone is the design. Start with **Phase U1**. At the end of each phase print `✅ PHASE Un COMPLETE` with 3–5 lines on how I can test it **on my phone**, then immediately start the next phase. State assumptions in a short note at the top of your reply.
