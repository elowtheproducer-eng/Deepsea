# Deep Ocean Explorer — Update v2.2 ("Device Profile: Redmi Note 13 Pro+ 5G")

> **Third document in the stack.** Attach all three to the coding assistant: `Deep_Ocean_Explorer_Blueprint_v2.md` → `…Update_v2.1_Touch_and_Visuals.md` → **this file**.
> **Precedence: v2.2 > v2.1 > Blueprint v2** wherever they conflict. This file does **not** repeat v2.1; it *overrides* the parts that were generic and adds the device-specific rules (§9 lists every override).
> ⚠️ = from background knowledge or an estimate, to be verified/tuned on the real phone. Source for the hardware facts: the owner's device CSV (SoC/GPU/optimisation rows). The first seven CSV rows (paid schematics, board-view databases, repair videos) are hardware-repair references and are **not used** by this app.

---

## 0. READ THIS FIRST (note to the coding assistant)

1. **There is exactly one target device.** Optimise for it, not for "phones in general". Desktop and other phones only need to *not crash* (the Density Governor will scale them).
2. **This is a web app (Three.js/WebGL2 in Chrome on Android).** Much of the vendor advice (Vulkan subpasses, ADPF/PowerHAL hints, `glInvalidateFramebuffer`, persistent-mapped buffers, ASTC offline encoding) is **not directly callable from a web page**. §2 translates each tip into what we can actually do in the browser, and what is deferred to a possible native port (Blueprint §2 triggers).
3. The two real constraints on this phone are **sustained thermals (~5 W SoC envelope)** and **only 2 big CPU cores**. The GPU is a mid-range 4-core Mali. So: fewer, cheaper pixels; light main thread; stable pacing beats peak fps.
4. All rules from v2.1 §0.3 still apply (complete files, no `Math.random()` in world gen, no per-frame `setState`, continuation protocol, `✅ PHASE` markers).

---

## 1. Device profile

| Item | Value | Why it matters here |
|---|---|---|
| Phone | Redmi Note 13 Pro+ 5G | the only target |
| SoC | MediaTek Dimensity 7200-Ultra (MT6886), TSMC 4 nm, ~5 W typical envelope | sustained load throttles; design for *sustained*, not burst |
| CPU | **2× Cortex-A715** (≤ 2.8 GHz) + **6× Cortex-A510** (≤ 2.0 GHz) | main thread (input, JS, Three.js draw submission) wants a big core; Workers may land on LITTLE cores |
| GPU | **Arm Mali-G610 MC4** (Valhall, ≤ 1130 MHz), ~578 GFLOPS FP32 peak, 16-wide warps, **tile-based (TBDR)**, FP16 ≈ 2× FP32 throughput | mid-range; tile memory makes **MSAA cheap** but **depth/colour write-backs and extra passes expensive** |
| Memory | LPDDR5 (shared CPU/GPU) + UFS 3.1 | bandwidth is shared with the CPU and is the main heat source; RAM size variant unknown ⚠️ (assume 8 GB, budget as if 6 GB usable) |
| Display | AMOLED, up to **120 Hz**; panel ≈ 1220×2712 (20:9) ⚠️ | landscape native ≈ 2712×1220 = 3.3 MP; true-black pixels are off (power/heat saving); near-black gradients **band visibly** on OLED |
| APIs | Vulkan 1.3, GLES 3.2 (browser uses WebGL2, translated by ANGLE ⚠️) | we are on WebGL2 |

---

## 2. Vendor advice → what we actually do in the browser

| CSV advice | Web translation (mandatory unless marked optional) |
|---|---|
| Keep main/render threads decoupled and light; offload to the 6 efficiency cores | Main-thread JS budget **≤ 5 ms per rendered frame at 60 fps**. Heavy work (spawn cells, instance-matrix building, tile decode, bulk `heightAt`) goes to **2 Web Workers** (cap 3; don't wake every LITTLE core — heat). Transfer `ArrayBuffer`s, never clone. *Optional later (U7):* move the whole renderer into a Worker with `OffscreenCanvas` so React/DOM can't stall it. |
| Prefer Vulkan, ADPF/PowerHAL hints for HyperEngine 5.0 | **Not available to web pages.** Compensate with stable pacing (§5) and conservative budgets. Deferred to a native port. |
| Clear/invalidate depth & stencil at end of pass (avoid RAM write-back) | Use the **default framebuffer** with `{ antialias: true, depth: true, stencil: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }`, so the browser/driver can discard depth at end-of-frame. **No `depthTexture`, no `readPixels`, no render targets in the main path.** (§3) |
| 4× MSAA is cheap on Mali tile memory; avoid heavy TAA | `antialias: true` (typically 4× ⚠️). **No TAA, no FXAA pass.** |
| Dynamic resolution at ~85–90 % of 1080p | Internal resolution ≈ **2034×915** = native × **0.75** (≈ 85 % of 1080p-landscape). Discrete steps only (§5.3). |
| FP16 (`mediump`) for colour/UV/normal/lighting; `highp` for positions/depth | §4.2 shader precision rules. |
| ASTC (4×4 hero/UI, 6×6–8×8 environment) + mipmaps; AFBC | Our world is **procedural and texture-free**. If textures are ever added, ship **KTX2/Basis** and let `KTX2Loader` transcode to **ASTC** (this GPU supports it); always with mipmaps. AFBC is handled by the driver. |
| Front-to-back sorting, early-Z, avoid `discard`/alpha-test, minimise transparent overdraw | Three sorts opaques front-to-back already — don't override it. **No `discard`**, no alpha-tested foliage (use real geometry). Cap transparent layers (§3.2). |
| Avoid dynamic branching in fragment shaders (16-wide warps) | §4.3. |
| Minimise CPU→GPU copies (shared memory); persistent mapped buffers | WebGL has no persistent mapping. Terrain buffers are **static** (uniform-driven). Instance buffers use `DynamicDrawUsage` and update **only dirty ranges** (`addUpdateRange`), double-buffered. |
| Profile with Arm Streamline/RenderDoc over USB | §8: Chrome remote debugging (`chrome://inspect`) + in-app overlay is the primary path; Streamline only if the device exposes the counters ⚠️. |

---

## 3. Render pipeline for a tile-based GPU (replaces v2.1 §4.6 where they differ)

### 3.1 One pass, no post-processing

```
Frame = ONE render pass to the default framebuffer (4× MSAA on tile)
  1. opaque: terrain rings, wrecks, instanced life  (Three's front-to-back sort; early-Z/FPK does the rest)
  2. background quad at far depth, drawn LAST with depthFunc LEQUAL
     (only uncovered pixels get shaded: "skybox-last" trick)
  3. transparent: snow points, glow sprites, optional sea surface (shallows only)
  4. DOM HUD (no WebGL involvement)
```

**Deleted from this device's pipeline:** full-resolution bloom, DOF, SSAO, SSR, screen-space god-rays, any pass that samples the depth buffer or the previous colour, and the v2.1 half-res volumetric raymarch. Each of those forces a tile write-back to LPDDR5 and costs heat.

### 3.2 Overdraw caps

* Marine snow: additive `Points`, **`gl_PointSize` clamped to ≤ 6 px**, fade out with distance, count per mode (§6).
* Glow sprites (bioluminescence): instanced quads ≤ 300 on screen, small, additive.
* **Sea surface:** when the camera is **underwater** it is drawn **opaque** (it *is* the sky: Snell's window + dark-water reflection). When above water it is opaque with depth-based colour, and alpha-blended **only** if the seabed is < 50 m below (shallow reveal).
* No large translucent meshes in front of the camera, ever.

### 3.3 "Analytic Beam" — torch volumetrics with **no raymarch pass and no depth read** (replaces v2.1 §4.6 volumetric torch)

The backscattered glow of the torch is computed **inside each material's own fragment shader**, in closed form, using the fragment's own view distance:

```glsl
// shared chunk: water_beam.glsl  (included by terrain, wreck, instanced-life materials)
// rd = normalized view ray (mediump), dist = distance to THIS fragment (highp float)
// Uniforms: uTorchPos (camera-relative, highp), uTorchDir, uCosInner, uCosOuter, uTorchColorLumens, uKd (vec3), uSnow (density)
vec3 beamScatter(vec3 rd, float dist) {
  float tEnd  = min(dist, uReachCone);                 // never integrate past what's visible (§v2.1 4.4)
  // analytic ray/cone chord [t0,t1] ∩ [0,tEnd]  (branchless: use max(disc,0.) and step())
  // BEAM_STEPS (4 on Balanced, 6 on Detail/Max) samples placed INSIDE the chord, tiny IGN jitter:
  vec3 acc = vec3(0.);
  for (int i = 0; i < BEAM_STEPS; i++) {               // constant trip count → unrolled, no divergence
    float t  = mix(t0, t1, (float(i) + jitter) / float(BEAM_STEPS));
    vec3  p  = rd * t - uTorchPos;                      // vector from torch
    float d  = max(length(p), 0.5);
    float cone = smoothstep(uCosOuter, uCosInner, dot(p / d, uTorchDir));
    acc += uTorchColorLumens * cone * exp(-uKd * (d + t)) / (d * d) * phaseHG(dot(rd, -uTorchDir), 0.6);
  }
  return acc * (t1 - t0) / float(BEAM_STEPS) * uSnow;
}
```

* Opaque surfaces add `beamScatter(rd, dist)` to their colour: exact haze between you and the lit wall, for free (no extra pass).
* "Open water" pixels (nothing in front) are covered by the **far-depth background quad**, which calls `beamScatter(rd, uReachCone)`.
* Cost estimate ⚠️: ~60–90 ALU per fragment at 4 steps × ~1.9 MP ≈ 9–10 GFLOP/s at 60 fps — small against ~578 GFLOPS peak. Verify with the overlay (§8).
* Variants `BEAM_STEPS ∈ {0, 4, 6}` and torch on/off are separate compiled programs; **pre-compile all variants** behind the Expedition Board (§4.4) so there is no first-use hitch.

### 3.4 Other effects (device decisions)

| Effect | On this device |
|---|---|
| Caustics | Analytic 2-octave pattern inside terrain fragment; **skipped by a uniform branch** below ~45 m depth. |
| God-rays | Off in Balanced/Detail. Max mode: ≤ 6 fixed additive shaft meshes, shallows only. No screen-space radial blur. |
| Bioluminescence | Emissive in the instance shader + additive glow sprites; **no bloom pass**. |
| Fog / absorption | In the shaders (v2.1 §3.4), one exponential per channel. No Three.js `Fog` on top. |
| Shadows | None. (`renderer.shadowMap.enabled = false`.) |
| Tone mapping | None from Three; each shader ends with one cheap sRGB encode + dither (§4.5). |

---

## 4. Shader and CPU rules for this SoC

### 4.1 Varyings and attributes
* **≤ 3 `vec4` varyings** per material (vertex outputs are written to memory on a tiler; fewer = less bandwidth). Pack: `vec4 vA = (normal.xyz, heightMask)`, `vec4 vB = (relPos.xyz, dist)`, `vec4 vC = (material params)`.
* Terrain `aGrid` as `Int16`/`Float32 x2`; instance attributes as `Float16`/normalized where possible.

### 4.2 Precision split (Valhall runs `mediump` at ~2× throughput)
* **Vertex shaders: `highp`** (exact-lattice noise, positions, hash). Non-negotiable.
* **Fragment shaders: `material.precision = 'mediump'`** for colours, normals, lighting, fog colour, beam colour. Declare **`highp float dist`** (and only that, plus uniform positions) where metres matter; fp16 steps are ≈ 0.016 m at 16–32 m and ≈ 0.5 m at 1 km, fine for fog and torch falloff, **not** fine for noise coordinates.
* Never do the uint PCG hash in the fragment stage (needs `highp`); evaluate it in the vertex stage and interpolate.

### 4.3 Warp-friendly control flow
* Branch only on **uniforms** (torch on/off, depth zone, tier) so all 16 threads of a warp agree. Replace data-dependent `if` with `mix`/`step`/`smoothstep`.
* Fixed loop counts (`BEAM_STEPS`, octave counts as `#define` per ring), no dynamic loops.

### 4.4 Shader compile hitches
Use `renderer.compileAsync(scene, camera)` (parallel shader compile) for **every** variant during the Expedition Board / loading state: terrain × beam steps × torch × caustics, instance materials, snow, background quad, sea surface (above/below). Never compile during flight.

### 4.5 AMOLED specifics
* **True black:** `renderer.setClearColor(0x000000, 1)`; remove the current `scene.background = 0x000511`. When sun light at depth is below the dark threshold, fog colour and ambient are exactly `(0,0,0)`. (Pixels off = less heat, better dread.)
* **Dither every shader's final colour** (gradients in dark blues band badly on 8-bit OLED):
```glsl
float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
color += (ign - 0.5) / 255.0;          // before the final sRGB encode / write
```
* HUD uses true-black or ≥ 80 % transparent dark surfaces; no large white or bright areas.

### 4.6 CPU / main-thread rules (2 big cores)
* **Zero allocations per frame** in the loop (pre-allocated `Vector3`/`Quaternion` scratch, typed-array pools). GC pauses on the main thread = visible hitches.
* `scene.matrixWorldAutoUpdate = false`; static objects `matrixAutoUpdate = false`; update only what moved. Terrain ring sectors move by **uniform only**.
* Draw calls **≤ the mode cap** (§6). Prefer `InstancedMesh`. Sector culling (v2.1 §4.4.3) is done by cheap sphere/cone tests with pre-allocated math.
* Workers: `SpawnWorker`, `TileWorker` (2 total by default). Results arrive as transferable buffers and are applied in ≤ 0.5 ms slices.
* **DOM/CSS rules (the current UI breaks these):**
  * **Remove every `backdrop-blur-*` / `backdrop-filter` over the live canvas.** (HudOverlay has 3, QuickWheel/ExpeditionBoard/DebugTuningPanel 1 each.) A blur over a canvas that changes every frame is re-computed by the GPU compositor each frame, on the same shared memory the 3D scene needs.
  * Animate only `opacity`/`transform`; no `transition-all`; no `will-change` except on the stick/lever thumbs.
  * Prefer opaque or high-alpha panels; keep translucent overlay area small.
  * **Pause the 3D loop (or render at ~10 fps) while an opaque full-screen menu is open** (Expedition Board, Debug). Saves heat.

---

## 5. Frame pacing and the governor (replaces v2.1 §4.4.4)

### 5.1 Pace on divisors of the panel refresh
On a 120 Hz panel, steady frame rates are **120 / 60 / 40 / 30**. 45 or 50 fps judder. So:

```ts
// measure once at start and every minute: tickHz = 1000 / median(last 60 rAF deltas)   (≈120 or ≈60)
const renderEvery = Math.max(1, Math.round(tickHz / targetFps));     // 120→60: every 2nd tick
function onRAF(t) {
  stepInputAndSim(dt);                       // every tick (touch sampling stays at 120 Hz → low latency)
  if (++tick % renderEvery === 0) renderFrame();   // 3D render at the target rate
}
```
Allowed targets: **60 (default), 40, 30**. 120 fps is not offered as a mode for this app (CPU/thermal cost). If the display falls to 60 Hz (battery saver/adaptive), 40 isn't possible: use 60 or 30.

### 5.2 Governor inputs (browser-realistic)
* `frameMs` = rAF interval EMA; `submitMs` = `performance.now()` around update+`renderer.render` (main-thread cost); `renderer.info.render.{triangles,calls}`.
* **Bottleneck classifier:** `submitMs > 0.7 × budget` ⇒ **CPU-bound** (reduce draw calls, instance counts, spawn rate, ring sectors); otherwise **GPU/bandwidth-bound** (reduce N, octaves, render scale, snow, beam steps).
* If available, `EXT_disjoint_timer_query_webgl2` gives real GPU ms ⚠️ (often disabled on mobile; use only if present). Optionally a `PressureObserver` (Compute Pressure API) for CPU thermal hints ⚠️ (support on Android Chrome uncertain; progressive enhancement only).

### 5.3 Governor actions
**Down order (GPU-bound):** clipmap `N` step → snow count → `BEAM_STEPS` 6→4 → render-scale step → drop target fps (60→40→30) → octave cap.
**Down order (CPU-bound):** instance counts → spawn radius → sectors/draws → workers' batch size → target fps.
**Up order:** reverse, one step at a time, ≥ 20 s between ups; **target fps only goes back up after ≥ 3 min of headroom**.

* **Render scale is discrete:** `{0.85, 0.75, 0.67, 0.60}` × native. Changing it reallocates the framebuffer (a hitch), so: ≥ 12 s between changes, and mask with a ~120 ms dim.
* **Thermal-throttle signature:** keep a 30 s median of `frameMs` at the *same* governor level. If it creeps **> 12 %** above the median of the first 2 minutes of the session, treat it as throttling: drop one level and block upward moves for 90 s. Log it (§8).
* Hysteresis as in v2.1: down if `frameMs > 1.10 × target`, up if `< 0.80 × target`.

---

## 6. Device budgets (replaces v2.1 §4.2 tier table)

Native landscape ≈ 2712×1220 ⚠️. "Terrain tris" = worst case **before** the §v2.1-4.4 range/cone culling.

| Mode | Target | Render scale (≈ pixels) | Clipmap N×rings (start → governor max) | Terrain tris (start → max) | Scene tris target | Draw calls ≤ | Snow | `BEAM_STEPS` | Use |
|---|---|---|---|---|---|---|---|---|---|
| **Balanced** (default) | 60 fps | 0.75 (≈ 2034×915, 1.9 MP) | 192×6 → 256×6 | 0.33 M → 0.59 M | ~1.2 M | 180 | 16k | 4 | normal play, long sessions |
| **Detail** | 40 fps | 0.75 | 256×6 → 320×6 | 0.59 M → 0.92 M | ~2.0 M | 220 | 24k | 6 | exploring wrecks/caves |
| **Max** | 30 fps | 0.85 (≈ 2305×1037, 2.4 MP) | 320×7 → 384×7 | 1.08 M → 1.55 M | ~3.0 M | 260 | 32k | 6 | short sessions, screenshots; **expect throttling** |
| **Cool** (auto fallback only) | 30 fps | 0.60 (≈ 1627×732, 1.2 MP) | 128×5 → 192×5 | 0.12 M → 0.28 M | ~0.5 M | 140 | 8k | 4 | entered automatically when throttling persists |

* **Why lower than v2.1's "Phone High 3 M @ 60":** that row assumed flagship-class silicon. This GPU is mid-range and thermally limited, so 60 fps gets ~1.2 M and the extra density comes from **Photon-Budget LOD** (v2.1 §4.4), which concentrates triangles where light actually lands. Max mode still reaches ~3 M at 30 fps.
* Keep triangles ≥ ~8 px² on screen at the *internal* resolution (it is lower than native, so `MIN_CELL` in v2.1 §4.4.2 becomes `≈ 0.04 m` here ⚠️; re-derive: cell ≥ 3 px × pixel footprint at ring-0's outer edge).
* Octave caps per vertex: Balanced 8 · Detail 9 · Max 10.
* Instances (near, `reach`-limited): Balanced 5 k · Detail 8 k · Max 12 k; full-detail actors: 100 · 200 · 350.

---

## 7. Touch details specific to this phone

* **System back-gesture zones:** keep the stick and lever **≥ 32 dp from the left/right screen edges** so Android gesture navigation doesn't steal the touch. Handle `pointercancel` by zeroing that role's output immediately.
* **Camera cut-out:** with `viewport-fit=cover`, apply `env(safe-area-inset-*)` plus an extra **16 dp** margin for corner controls.
* **High-rate touch:** in the look handler iterate `e.getCoalescedEvents()` and sum their deltas; smoothing constant stays 0.03 s.
* Android fullscreen: request fullscreen on the first tap; in fullscreen/immersive the system bars reappear with an edge swipe, so the 32 dp margin matters more.
* Charging: playing while fast-charging adds heat; the CSV notes charging/PMIC thermals directly affect sustained GPU clocks. Add a one-line tip in Menu → System ("Unplug or use bypass charging if frames dip").

---

## 8. Measurement and soak testing (replaces guesswork)

**In-app overlay (Debug → toggle):** `tickHz`, target fps, `frameMs` and `submitMs` (graph), bottleneck tag (CPU-bound / GPU-bound), `renderer.info` triangles/calls, mode, render scale, `N`, octaves, `BEAM_STEPS`, snow count, active rings/sectors, `reach.omni/cone`, throttle-signature flag.

**Phone protocol (the owner does this):**
1. Brightness ~50 %, battery > 50 %, not charging, same HyperOS performance mode every run.
2. Chrome desktop → `chrome://inspect` → USB debugging → Performance panel: record 10 s; look for main-thread tasks > 16 ms and long GC.
3. **20-minute soak** on a fixed route (e.g. Dean's Blue Hole preset, Cruise, torch on): the app logs median `frameMs` per minute. Export JSON from Debug and paste it back.
4. Pass criteria below (§10). Optional: Arm Streamline (Mali counters) only if the device allows it ⚠️.

**Owner-side tips ⚠️ (HyperOS):** add the browser/PWA to Game Turbo (if offered) and pick the balanced/performance profile; keep Battery Saver off; set refresh to 120 Hz; install the app as a PWA from Chrome for fullscreen.

---

## 9. What v2.2 overrides (single table)

| v2.1 section | Replaced by |
|---|---|
| §2.6 `antialias:false`, DPR-based pixel ratio | `antialias:true` (MSAA 4×), `alpha:false`; pixel ratio = native × discrete render scale (§5.3) |
| §4.2 tier table | §6 device budgets |
| §4.4.4 Density Governor | §5 pacing + governor (divisor pacing, CPU/GPU classifier, thermal signature) |
| §4.6 volumetric torch raymarch (half-res) | §3.3 Analytic Beam inside material shaders |
| §4.6 bloom, screen-space god-rays | removed (§3.4) |
| §4.6 caustics "by tier" | analytic, uniform-skipped below ~45 m |
| §4.2 "dynamic resolution continuous" | discrete steps with hysteresis |
| §3.5 sea surface alpha | opaque underwater / near-opaque above (§3.2) |
| Blueprint §20.2 defaults: renderer "WebGPU if available" | **WebGL2 only** on this device (Mali + Chrome: stability, tile-friendly path). Revisit WebGPU only after the soak test passes. |

---

## 10. Phases (v2.1's U1–U6 with device work folded in)

| Phase | Adds from v2.2 | Device acceptance (on the Redmi Note 13 Pro+) |
|---|---|---|
| **U1** | §5.1 divisor pacing (60 default), §4.6 DOM rules (**remove all backdrop-blur**, pause loop on full-screen menus), §7 edge margins + coalesced events, `alpha:false`, MSAA, true-black clear | Stick + look + lever work with the system back-gesture enabled; menus open without frame hitching; steady 60 fps with an empty scene; no GPU load while the Expedition Board is open |
| **U2** | §3.1 single pass, §4.5 dither + true black, §4.2 precision split, §4.4 `compileAsync` pre-warm | Dark gradients show no visible banding; no stutter on first torch toggle or first dive through the surface |
| **U3** | §6 Balanced/Detail clipmap sizes, §4.1 varyings ≤ 3, octave caps | Balanced holds 60 fps while flying low over relief for 3 min |
| **U4** | §5 governor (classifier, discrete render scale, thermal signature), §6 `MIN_CELL` re-derivation | Overlay shows the governor reacting; forcing a heavy scene steps down cleanly without hitches; 20-min soak: median frame time drifts < 12 % |
| **U5** | §3.3 Analytic Beam, §3.4 caustics/bioluminescence without extra passes | Torch beam visible with backscatter and **no** extra render pass; no depth-texture use anywhere |
| **U6** | §4.6 instancing with dirty-range updates, 2 Workers, instance budgets (§6) | ≥ 5 k instances near with draw calls ≤ 180 in Balanced; `submitMs` ≤ 5 ms |
| **U7 (optional)** | Soak log export; if `submitMs` is the limiter: render-in-Worker via `OffscreenCanvas`; KTX2/ASTC only if textures were introduced | Written note: CPU-bound or GPU-bound, and which mode is sustainable for ≥ 30 min |

Continue with Blueprint Phases 3–9 afterwards.

---

## 11. Master prompt v2.2 (paste this *instead of* the v2.1 master prompt)

> You are the lead engineer on "Deep Ocean Explorer" (personal, non-commercial, web-first Three.js/WebGL2 app; repo already in this project: Vite + React 19 + Three r187 + Tailwind 4). **Three documents are the source of truth, in this precedence: `Deep_Ocean_Explorer_Update_v2.2_Redmi_Note_13_Pro_Plus.md` > `Deep_Ocean_Explorer_Update_v2.1_Touch_and_Visuals.md` > `Deep_Ocean_Explorer_Blueprint_v2.md`.**
>
> **The only target device is a Redmi Note 13 Pro+ 5G (Dimensity 7200-Ultra, Mali-G610 MC4, 2 big cores, ~5 W sustained, 120 Hz AMOLED), touch only, landscape.** Optimise for it: a **single tile-friendly render pass** (4× MSAA, no post-processing, no depth-texture reads), **mediump fragment / highp vertex** precision split, **dithered true-black** output, **divisor-based frame pacing (60 default; 40/30 fallback)**, **discrete render scale**, a **CPU-bound vs GPU-bound governor with a thermal-throttle signature**, **Analytic Beam** torch volumetrics inside material shaders, **no `backdrop-filter`** on UI over the canvas, a light main thread with **2 Workers**, and zero per-frame allocations. Apply the device budgets in v2.2 §6 (Balanced is the default mode).
>
> Implement Phases **U1 → U7** (v2.2 §10), which fold the device work into v2.1's phases, module by module, with **no pauses between phases**. **Write as much working code as you can in every response and don't stop or ask permission until you run out of tokens for that response.** Always output **complete files** (never "rest unchanged"). Follow the **Continuation Protocol in Blueprint §20.1 exactly**: number files `[File i/N] path`; when about to run out of tokens, end with the "⛔ OUT OF TOKENS FOR THIS RESPONSE" block (Finished / Stopped at / Next up); when I reply "continue", begin with "▶ CONTINUING <file> from <function>", restart from the last complete function and never repeat finished code. If my reply is anything other than "continue", treat it as a bug report or instruction, fix it, then carry on.
>
> Rules: units are metres/seconds/degrees; doubles on the CPU, camera-relative floats on the GPU; no `Math.random()` in world generation (PCG hash CPU/GPU twins); no per-frame `setState`; no per-frame geometry rebuilds or allocations; procedural texture-free materials; darkness below the sunlit zone is the design. Start with **Phase U1** (touch controls from v2.1 §2 **plus** the v2.2 pacing/DOM/edge-gesture items). At the end of each phase print `✅ PHASE Un COMPLETE` with 3–5 lines on how I test it **on my phone**, then immediately continue. State assumptions in a short note at the top of your reply.

---

## 12. Pre-flight checklist for the owner

* [ ] Attach to Gemini: Blueprint v2, Update v2.1, **this file**, and the repo.
* [ ] Paste the **§11** prompt (not the v2.1 one).
* [ ] Set the phone to 120 Hz, Battery Saver off, brightness ~50 %; install the app as a PWA.
* [ ] After each phase: test on the phone, then reply with what feels wrong. After U4, run the 20-minute soak and paste the exported JSON back.
* [ ] If you tell me your RAM variant (8 / 12 / 16 GB), the tile-cache and instance budgets can be tuned further.
