# Deep Ocean Explorer — Blueprint v2 ("Abyssal Free-Roam")

> **Legend** — ✅ = confirmed in research for this document · ⚠️ = from background knowledge, **verify before shipping** (the build pipeline should overwrite these with fetched data wherever possible).
> Pseudo-code is language-agnostic (reads like TypeScript/Python). It specifies *behaviour*, not final syntax.

---

## 0. What changed from v1 (and why)

| # | v1 said | v2 says | Reason |
|---|---------|---------|--------|
| 1 | AWS Terrarium tiles "combine SRTM + GEBCO" | **AWS Terrain Tiles fill ocean with ETOPO1 at 1′ (~1.8 km), not GEBCO** ✅. Build our *own* tile pyramid from **GEBCO** (15″ ≈ 450 m) ✅ | Using Terrarium directly would make every seafloor ~4× blurrier than necessary. |
| 2 | Single HTML file | **Single-page app + separate data packs** | Wrecks, caves, species priors, and tiles can't live in one file. A tiny shell + CDN data is still "one click to run". |
| 3 | Local flat plane | **Globe-aware, double-precision world** with floating origin | Warp mode crosses ocean basins; a flat plane breaks. |
| 4 | Real data + noise | **"Honest Map" rendering**: GEBCO's Type-Identifier grid tells us which cells were really surveyed vs. satellite-guessed; procedural detail is used *most* where the data is guesswork | Turns a limitation into a signature feature. |
| 5 | Empty ocean | **Living, discoverable ocean**: wrecks, caves, blue holes, reefs, vents, seamounts, plausible fauna at true sizes | Your core ask. |
| 6 | One speed gear set | **Three speed modes (Crawl / Cruise / Warp), each with its own slider** + proximity brake | Your ask, with safety so warp doesn't feel broken. |
| 7 | Fixed FOV | **Live FOV 80–120°** with edge-distortion control | Your ask. |

**Core identity (unchanged):** a bodiless, weightless observer that starts 100 ft above real ocean, breaches the surface, and falls into the lightless abyss over *real* bathymetry, with procedural detail filling the gaps.

---

## 1. Design pillars

1. **Scale-Truth.** Real positions, real depths, real sizes. A blue whale is ~25–30 m, always. (Optional "vertical exaggeration" for terrain only, default 1×.)
2. **Honest Map.** The app always knows (and can show) what is *measured*, what is *inferred*, and what is *invented for fun*.
3. **Plausible, not fake.** Fauna and features follow hard constraints (depth, habitat, size). Fun is allowed *inside* plausibility, never outside it.
4. **Stateless world.** Everything is `f(seed, place, time)`. No saved world, no simulation to keep in sync, nothing to store.
5. **Zero-friction flight.** From crawling beside a 2 cm amphipod to crossing the Pacific in seconds, the controls never fight you.
6. **Respect.** Many wrecks are war graves. See §13.

---

## 2. Platform decision: Web first, Android native when triggered

**Recommendation: build the web version first (Three.js with WebGPU where available, WebGL2 fallback), wrapped for Android with Capacitor/PWA. Move to a native engine only if you hit the triggers below.**

Why: the hard part of this project is the *data pipeline and procedural systems*, which are engine-independent. A web build lets you iterate and share instantly, and ~80% of the experience is achievable. The baked data packs and generators carry over unchanged to a native port.

| Go native (Unity URP/Vulkan — my pick for mobile maturity; Godot 4 as the lighter open-source alternative) if… | Reason |
|---|---|
| Browser tab memory caps (often ~1–2 GB on phones) block tile/creature budgets | Native gives real memory control |
| You need compute-heavy boids (>50k agents), GPU skinning at scale, or marching-cubes caves near-real-time | Native Vulkan compute is more reliable than mobile WebGPU |
| You want large on-disk caches (multi-GB) | Browser quotas (OPFS/IndexedDB) are unpredictable on mobile |
| You want VR (Quest) or Android Auto/TV targets | Native XR paths |
| Thermal throttling makes 30 fps unstable on mid-range phones | Native gives finer control |

Unreal 5 gives the best fidelity but is heavy on phones; only consider it for a PC-first release.

**Target devices (v1):** Android 2022+ mid-range with Vulkan, 4 GB RAM; desktop Chrome/Edge/Firefox with WebGPU or WebGL2. Quality tiers (§12) handle the rest.

---

## 3. World model & coordinates

* Positions are **double-precision** on the CPU (JS numbers are doubles ✅-by-spec). The GPU only ever sees **camera-relative** floats (floating origin).
* Earth model: WGS84 ellipsoid → ECEF (metres). Local frame = **ENU tangent plane** at the camera ("up" = away from Earth centre). Flight is "free" in this frame; as you move far, the tangent frame re-bases.
* "Depth" = −(height above geoid-ish sea level). Surface is `h = 0` (v1's `Y = 0`).

```pseudo
struct WorldPos { lat: f64, lon: f64, h: f64 }          // h metres, 0 = sea level, negative = below
struct Camera   { ecef: vec3<f64>, orient: quat, hFov: f32 }

function toCameraRelative(objEcef: vec3<f64>, cam: Camera) -> vec3<f32>:
    return vec3<f32>(objEcef - cam.ecef)                 // subtract in f64, cast to f32 AFTER

function moveCamera(cam, localThrust: vec3, dt):
    enu = enuFrameAt(cam.ecef)                           // east/north/up basis
    worldDelta = enu * (cam.orient * localThrust) * dt
    cam.ecef += worldDelta                               // f64
    if distance(cam.ecef, lastRebase) > 50_000:          // re-base tangent frame
        rebase(cam)
```

**Start state:** `WorldPos{ lat: chosenPreset, lon: ..., h: +30.48 }`, pitched ~8° down. Default preset rotates: Mariana Trench / Cape Point canyon / Mid-Atlantic Ridge / Sodwana Bay (user setting; see §10).

---

## 4. Data strategy — what to bake, what to stream

### 4.1 Verdict (the short answer)

> **Bake everything the render loop needs. Stream only big, static tile pyramids from your own CDN. Use live third-party APIs only for optional enrichment, never for gameplay.**

| Layer | Strategy | Why |
|---|---|---|
| Bathymetry tiles | **Bake offline from GEBCO → own tile pyramid; stream tiles from your CDN (cache on device)** | Full 15″ grid is 43,200 × 86,400 = 3.73 billion points ✅ (~7.5 GB raw int16). Too big to bundle, easy to tile. |
| Surveyed-vs-guessed mask | **Bake** from GEBCO TID grid ✅ (it ships alongside the grid) | Tiny, drives "Honest Map". |
| Wrecks / caves / vents / seamounts / named features / coral polygons | **Bake into one compact `features` pack** (a few MB–tens of MB) | Fast, offline, versioned, immune to API outages and rate limits. |
| Species habitat priors | **Bake** (0.5° rasters per hero species + family-level priors) | AquaMaps is 0.5° anyway ✅ (~55 km). Tiny files. |
| Size/depth facts for species | **Bake** at build time from FishBase/SeaLifeBase + curated cetacean/cephalopod table | Needed offline; sizes must be right. |
| Ocean currents (Copernicus) | **Optional live fetch, cached daily**, bake a climatology as fallback | Makes marine snow drift real; app works without it. |
| OBIS live lookup | **Optional, on "Field Guide" screen only** | Nice enrichment; unknown rate limits; never block gameplay. |

**Do not** hit NOAA/Wikidata/OBIS at runtime from the game loop. Do **not** scrape sites with restrictive terms (e.g. wreck-hobbyist sites with no open licence).

### 4.2 Pipeline (offline build)

```
 GEBCO grid ─┬─► tile pyramid (int16, zstd) ───────────────► CDN /tiles/{z}/{x}/{y}.bin
 GEBCO TID ──┴─► surveyed-mask pyramid (1 bit/px) ──────────► CDN /tid/{z}/{x}/{y}.bin
 NOAA/HE/HES/Wikidata/… wrecks ─┐
 Cave lists / blue holes ───────┤
 InterRidge vents ──────────────┼─► normalize → dedupe → features.pack (+ per-tile spatial index)
 Seamount catalogs ─────────────┤
 GEBCO/IHO gazetteer names ─────┤
 Allen / UNEP-WCMC coral ───────┘
 AquaMaps + OBIS + FishBase/SeaLifeBase ─► species.pack (priors + sizes + depth ranges)
 Copernicus (optional) ─► currents-climatology.bin
```

Build tools: Python (rasterio, numpy, zstandard) or Rust. Keep it in a separate `/pipeline` repo folder; CI re-runs it yearly (GEBCO releases annually — **GEBCO_2026 was published 23 April 2026** ✅, so pin the version in config).

### 4.3 Tile design

* Geographic (lat/lon) quadtree, 256×256 int16 samples per tile.
* Level 7 ≈ 1.4° per tile ≈ **~20″ sample pitch ≈ native GEBCO resolution** (32,768 tiles). Bake to L7 (optionally L8 oversampled). Ocean-only tiles ≈ 70% → very roughly **~1 GB compressed** ⚠️ (estimate; measure in the pipeline).
* **Browser gotcha:** canvas image decode is 8-bit, so a 16-bit PNG loses precision. Use **raw int16 + `DecompressionStream`**, or Terrarium-style RGB encoding (`elev = R*256 + G + B/256 − 32768` ✅) if you want PNG tooling compatibility.
* Bundle the coarse levels (≤ L3) in the app; stream the rest.

```pseudo
function tileKey(lat, lon, z): ...       // geodetic quadtree
function loadTile(key) -> Heightfield:
    if memCache.has(key): return it
    if diskCache.has(key): return decode(diskCache.get(key))      // IndexedDB/OPFS or native disk
    bytes = await fetch(CDN + key)       // HTTP cache headers: immutable, 1y (versioned path)
    diskCache.put(key, bytes, lru=true)
    return decode(bytes)                 // in a Worker, never on main thread
```

### 4.4 Cache policy

* Memory LRU (tiles), disk LRU (default 1 GB web / 4 GB Android, user-adjustable), "Download this region for offline" button (pre-fetches a bbox at chosen detail).
* **Velocity-aware prefetch:** request tiles along the camera's predicted path (§9.5).

---

## 5. Terrain

### 5.1 Macro terrain (real data)

* Geodetic quadtree LOD, screen-space-error driven, ~65×65 vertex patches displaced in the vertex shader from the heightfield texture. Skirts hide LOD cracks.
* Normals from height gradients; slope/aspect feed texturing.

### 5.2 The "Honest Map" (innovative)

GEBCO tells you, per cell, the *type* of source data (multibeam, single-beam, satellite-predicted, etc.) via its Type Identifier grid ✅. We use it three ways:

1. **Detail amplitude:** unsurveyed/predicted cells get **more** procedural detail (plausible fill); well-surveyed cells get **less** (trust the data).
2. **Visual language:** a toggle ("Survey view") tints predicted areas with a soft dreamlike haze, so users can *see* where humans have actually mapped.
3. **Sonar pulse** shows crisp lines where surveyed, shimmering/uncertain lines where predicted.

```pseudo
function detailAmplitude(tid: SourceType, slope, depth) -> f32:
    base = lerp(0.2, 1.0, isPredicted(tid))             // trust measured data
    return base * slopeFactor(slope) * depthFactor(depth)

function terrainHeight(lat, lon, camDist) -> f64:
    macro = sampleGEBCO(lat, lon)                        // ~450 m cells
    t     = smoothstep(2000, 150, camDist)               // blend in detail as camera approaches
    amp   = detailAmplitude(sampleTID(lat, lon), slopeAt(lat, lon), macro)
    micro = abyssalHills(lat, lon) + ridged(lat, lon) + ripples(lat, lon)  // WORLD-space noise
    return macro + t * amp * micro
```

**Critical rule:** procedural noise is evaluated in **world space (lat/lon → ECEF)**, never tile space, so tile seams and LOD transitions never pop.

### 5.3 Micro terrain (procedural)

| Feature | Technique | Where |
|---|---|---|
| Abyssal hills (10s–100s m high, km spacing) | low-freq ridged multifractal | deep plains, spreading-rate dependent |
| Sediment ripples/dunes | anisotropic sine + noise, aligned to current | shelves, plains |
| Pillow lava / basalt | cellular (Worley) + fBM | mid-ocean ridges, seamounts, young crust |
| Talus / cliff faces | slope-aware strata noise | trench walls, canyon walls |
| Fracture zones | long linear ridges/scarps | ridge offsets |
| Pockmarks, mud volcanoes, brine-pool edges | stamped SDF decals | seeps |

### 5.4 Substrate classification (feeds texturing *and* life)

```pseudo
function substrate(depth, slope, lat, features) -> {rock, sand, silt, ooze, reef, kelp, ...}:
    if nearVent(features):              return basalt_sulfide
    if slope > 35°:                     return exposed_rock
    if depth < 200 and tropical(lat):   return sand_or_reef(features.coral)
    if depth > 4500:                    return red_clay_or_silt
    return silt_ooze
```

### 5.5 Sea-level time machine (innovative, nearly free)

A slider from **−130 m to +70 m** (Last-Glacial-Maximum-ish to far-future high stand) shifts the "surface" and re-lights everything. Exposed shelves become land (Doggerland-style); blue holes and caves emerge as dry sinkholes — which is genuinely how they formed (caves carved when sea level sat ~100 m lower ✅). Costs nothing but a uniform.

### 5.6 Vertical exaggeration

`terrainVerticalScale` slider 1×–10× (default 1×). HUD shows an "exaggerated" badge when ≠ 1. Objects (wrecks, animals) are **never** scaled by this.

---

## 6. Surface, optics, and atmosphere

### 6.1 Surface (Y = 0)

* Gerstner wave sum (6–8 waves; direction/steepness from a sea-state slider; optional real wave data from Copernicus later).
* Specular sun glint, Fresnel, whitecap foam from Jacobian of the displacement, horizon haze.
* **Breach transition:** a screen-space waterline effect (meniscus, bubbles streaking, brief refraction smear) + audio low-pass sweep + exposure adaptation.

### 6.2 Underwater light (physically motivated)

Water absorbs red first, blue last. Approximate clear-ocean absorption (pure-water order of magnitude) ⚠️:

| Channel | ~Absorption a (m⁻¹) | 1/e distance |
|---|---|---|
| Red (650 nm) | ~0.34 | ~3 m |
| Green (550 nm) | ~0.06 | ~16 m |
| Blue (450 nm) | ~0.01 | ~100 m |

```pseudo
const ABSORB = vec3(0.34, 0.06, 0.012)     // RGB, per metre; scale up for turbid/coastal water
function underwaterColor(srcColor, pathLen, depthOfPoint):
    sunlightAtDepth = sunColor * exp(-ABSORB * max(depthOfPoint, 0) / max(sunCosZenith, 0.2))
    trans = exp(-ABSORB * pathLen)                         // Beer-Lambert along view ray
    scatter = waterBlue * sunlightAtDepth * (1 - trans)    // in-scatter ("fog")
    return srcColor * trans * sunlightAtDepth + scatter
```

Zones (standard oceanography bands) drive ambient light + HUD ribbon:

| Zone | Depth | Light |
|---|---|---|
| Epipelagic | 0–200 m | sunlit |
| Mesopelagic | 200–1,000 m | twilight → faint |
| Bathypelagic | 1,000–4,000 m | none (bioluminescence only) |
| Abyssopelagic | 4,000–6,000 m | none |
| Hadal | 6,000 m+ | trenches; GEBCO's deepest cell is ≈ −10,930 m ✅ |

Extras: animated caustics projected along the sun vector (fade out by ~40 m), light shafts (cheap froxel/raymarch), surge-driven turbidity near coasts (Jerlov-style water-type setting: Clear / Coastal / Murky).

### 6.3 Marine snow & currents

```pseudo
function marineSnowUpdate(particles, cam, dt, currentVec):
    for p in particles:                       // ~5k-20k GPU particles in a camera-centred shell
        p.pos += (currentVec + settleVel + turbulence(p.pos, time)) * dt   // net slow drift + settle
        if outsideShell(p, cam): respawn(p, randomInShell(cam))
    density = depthDensityCurve(cam.depth)    // thicker in productive upper layers
```

`currentVec` = baked climatology (optional live Copernicus daily field). Because marine snow *moves with real currents*, you can feel the Agulhas/Gulf Stream when you hover. **Also lets "Crawl" mode feel alive: you're stationary but the world drifts past.**

---

### 6.4 Darkness, the torch, and seeing in the deep (the "dread" system)

**Principle: darkness is the default and light is a scarce resource.** Below the sunlit zone the world has *no* ambient light. Nothing "auto-brightens". What you can see is only what you pay for with light.

#### 6.4.1 Natural light budget (no cheating)

```pseudo
// Downwelling blue light decays roughly exponentially with depth (Kd ≈ 0.02–0.04 /m in clear water ⚠️)
function ambientLux(depth, sunElev, waterType):
    Kd = KD_BLUE[waterType]                       // clear ≈ 0.03, coastal ≈ 0.1+
    return SUN_LUX(sunElev) * exp(-Kd * depth)

// Display mapping: NO auto-exposure beyond a slow, limited eye adaptation (6.4.2)
// Practical bands (⚠️ tune by eye):
//   0–50 m      bright cyan, colour fading (red gone by ~10-15 m)
//   50–200 m    deepening blue, shapes only
//   200–~500 m  last dim blue "ceiling" - you can look UP and see silhouettes against it
//   ~500–1000 m animals' eyes can still sense it, a human-like viewer sees almost nothing
//   >1000 m     TRUE BLACK. ambient = 0 (only bioluminescence, vents, your own lights)
```

* **Look-up silhouettes (mesopelagic):** between ~200 and ~700 m, the only light is a faint blue glow from above. Animals appear as black cut-outs against it. Looking *down* is pure void. Real animals hide using counter-illumination, so some silhouettes get faint belly-glow.

#### 6.4.2 Eyes that adapt slowly (and can be ruined)

```pseudo
adaptation ∈ [0..1]            // 0 = bright-adapted, 1 = fully dark-adapted
adaptation += dt / T_DARK  when no strong light in view      // T_DARK ≈ 60–180 s of game time (compressed from real ~20–30 min)
adaptation  = max(adaptation - glare * k, 0)                  // torch pointed at close surfaces/snow = glare
sensitivity = lerp(1.0, 20.0, adaptation)                     // modest gain only, never daylight
noise       = lerp(0.02, 0.18, adaptation)                    // darker = more grain, not more clarity
```

* Switching the torch **off** leaves you briefly blind, then slowly shows the faintest glows. Switching it **on** in the dark kills your adaptation again. This creates real tension at no art cost.

#### 6.4.3 The torch

Real physics, deliberately unforgiving:

```pseudo
function torchLightAt(P, torch, waterType):
    d      = distance(P, torch.pos)
    cone   = smoothstep(cos(torch.outer), cos(torch.inner), dot(normalize(P - torch.pos), torch.dir))
    atten  = exp(-ABSORB[waterType] * d)                       // per-channel Beer-Lambert (6.2): RED DIES IN ~3 m
    return torch.color * torch.lumens * cone * atten / max(d*d, 0.25)

// BACKSCATTER: the real reason deep lights feel claustrophobic.
// Particles in the beam light up and fog the view between you and the target.
function beamBackscatter(ray, torch, snowDensity):
    sum = 0
    for s in rayMarch(ray, steps=16..32):                      // cheap froxel / raymarch inside the cone only
        sum += torchLightAt(s, torch) * snowDensity(s) * phaseHG(g=0.6)
    return sum
```

* **Offset the light** a bit from the camera (below/right, ~0.3 m) so surfaces get raking shadows and you get a visible beam. A light exactly at the camera flattens everything and looks like a game flashlight.
* **Colour only exists near the light.** With a white torch, reds/oranges/yellows only appear within roughly arm's reach (a few metres); at 8–10 m everything has gone green-blue and grey. Seeing a wreck's rust-orange snap into colour as you glide close is a signature moment.
* **Effective range:** by default ~15–25 m of *useful* illumination in clear water, much less in murky water or heavy snow. Light always reaches a bit further than detail does.
* **Torch settings:** `T` toggle · `Alt+Scroll` beam focus (narrow search ↔ wide flood) · power steps *Low / Standard / Search / Floodlight* · colour *White / Blue-green / Red*.
  * Blue-green carries furthest in water.
  * **Red** barely travels but doesn't ruin your adaptation, and many deep animals can't see it (real principle: red is largely invisible to deep fauna ⚠️), so creatures ignore you. A stealth option.
* **Optional "Light Budget" (Dread mode):** torch has a battery that drains faster at high power and flickers when low; floodlight heats and eventually dims. Off by default; on for maximum fear.
* **Eyeshine:** large-eyed deep animals throw back your beam as cold glints in the dark. You often see the *eyes* seconds before the body. (This single effect does a lot of the scary work.)

#### 6.4.4 Ways to see that do NOT look like day

All of these show *information*, not "turn the lights on":

| Aid | What it does | Why it stays scary |
|---|---|---|
| **Sonar pulse (`F`)** | Expanding wireframe sweep reveals geometry as thin lines (monochrome green/amber), not textured surfaces | You see *shape*, never *colour or life*; it fades; every ping reveals you (animals may react) |
| **Sonar memory** | Scanned geometry lingers as a dim ghost-trace that decays over ~20–60 s | Like a fading afterimage; you navigate by half-remembered outlines |
| **Passive hydrophone ring** | Edge-of-screen arcs show *direction and rough distance* of sounds (clicks, tail beats, groans) | You hear things before you see them, and can't tell what they are |
| **Bioluminescence as light** | Real emitted light (cold blue-green) faintly illuminates nearby surfaces; flickers, sparse, moves with animals | A dim, moving glow that you don't control |
| **Chemical glow-sticks (`G`)** | Throwable/droppable cold lights (limited count), fade over minutes, colour-coded; they drift with the current | Tiny pools of light in an ocean of black; each one makes the dark around it feel bigger |
| **Strobe beacon** | Marks a point you want to find again; visible from far in clear water | A lonely blink in the void |
| **Vent glow** | Hot vents glow dull orange-red and light their chimneys and fauna | "Campfires" of the deep: safe-feeling islands that may not be safe |
| **Low-light amplifier ("ghost vision")** | Optional toggle: grainy, low-res, desaturated, laggy ghosting, limited range, brightness capped | Looks like noisy surveillance footage, not daytime. Off by default |
| **Silhouette vision** | Mid-depths only: look up for dark shapes against the faint blue | Everything you see is a shadow of something bigger |
| **Instrument HUD** | Dim amber/red gauges (depth, pressure, heading, proximity pings) | Even the HUD is kept dim so it never blinds you |

#### 6.4.5 Keeping it frightening (design rules)

1. **Never restore colour or ambient fill to "help".** The "Easier visibility" setting only raises a dark blue-black noise floor (a few percent), never daylight and never colour.
2. **Show scale by what is *not* lit.** A beam that ends in nothing, a wall you can only see a patch of, a shadow that is too big.
3. **Partial reveals.** Torch edge catches a fin, an eye, a curved flank, then it's gone.
4. **Long shadows & raking light** exaggerate size of anything in the beam.
5. **Sound drives dread** more than visuals: low-frequency drones, hull-like groans, clicks at the edge of hearing.
6. **Silence & stillness** in hover (Crawl 0) are part of the experience; add a subtle heartbeat-free ambient bed so quiet feels heavy.
7. **Settings:** `Darkness fidelity` slider (*Realistic* default → *Eased*), `Dread` toggle (Light Budget + more eyeshine + denser fauna at the beam edge), `Jump-scare-free` safety option for calm exploration.

#### 6.4.6 Controls summary (new keys, touch buttons equivalent)

`T` torch · `Alt+Scroll` focus · `Shift+T` torch power/colour cycle · `F` sonar · `G` drop glow-stick · `B` beacon · `V` ghost-vision toggle

---

## 7. Landmarks: wrecks, caves, reefs, vents, seamounts

### 7.1 Unified feature record

```jsonc
// features.pack entry (one schema for everything)
{
  "id": "wreck:titanic",
  "type": "wreck | cave | blue_hole | reef | cold_coral | vent | seep | seamount | canyon | named_feature",
  "name": "RMS Titanic",
  "lat": 41.73, "lon": -49.95,          // ⚠️ example values
  "depthM": 3800,                        // from data if present, else sampled from bathymetry at lat/lon
  "dims": { "lengthM": 269, "beamM": 28 },
  "confidence": "exact | approx | legendary | procedural",   // Honest Map labelling
  "source": "wikidata:Q... | noaa:awois:... | historic_england:... | curated",
  "license": "CC0 | OGL | public-domain | curated",
  "tags": ["war_grave"],                 // drives respectful handling (§13)
  "generator": { "kind": "hull", "params": { ... } }   // or "glb": "wrecks/titanic.glb"
}
```

**Always snap depth to the bathymetry at placement**, because reported wreck positions can be off by hundreds of metres; NOAA itself warns that exact wreck positions are hard to determine ✅.

### 7.2 Wrecks

**Data sources (breadth for the long tail):**

| Source | Coverage | Access | Licence / note |
|---|---|---|---|
| **NOAA OCS Wrecks & Obstructions** (AWOIS + ENC) | US waters; ~13,000 wrecks + ~6,000 obstructions ✅; AWOIS stopped updating in 2016 ✅ | KML/XLS downloads + ArcGIS REST + WMS ✅ (`wrecks.nauticalcharts.noaa.gov`) | US-gov public data; "not for navigation" ✅ |
| **Wikidata (SPARQL)** | Global *notable* wrecks, some with coords/dimensions | `query.wikidata.org/sparql` ✅ | CC0 ⚠️ |
| **Wikipedia "Lists of shipwrecks"** (by continent/year) ✅ | Curated notable wrecks incl. Africa, Oceania | scrape or via Wikidata | CC BY-SA ⚠️ (use Wikidata where possible) |
| **Historic England — Protected Wreck Sites** (58) ✅ | England | Open Data Hub / planning.data.gov.uk ✅ | Open Government Licence v3 ✅ (attribution required) |
| **Historic Environment Scotland NRHE / trove.scot** | Scotland; >320,000 site+wreck records ✅ | web/download services ✅ | Open Government Licence ✅ |
| **Ireland wrecks (data.gov.ie)** | Irish waters ✅ | open data portal | check dataset licence |
| **Australia National Shipwrecks Database** ⚠️ | Australia | data.gov.au | check |
| **Curated hero list (§7.2.2)** | ~30–50 famous wrecks | you maintain | facts are free; models are not (see below) |

South Africa has no known open consolidated wreck dataset in my research — cover it via Wikidata/Wikipedia lists + a hand-curated list (e.g. HMS Birkenhead off Danger Point ⚠️; the SS Waratah "legendary — never found" entry as a mystery search target, `confidence: "legendary"`).

#### 7.2.1 "Basic 3D mock-ups": parametric hull generator (no model files needed)

Generate recognisable ships from a few numbers (length, beam, type). This gives *thousands* of wrecks for free, at true size.

```pseudo
function generateWreck(spec: {type, lengthM, beamM, draftM, year, state, seed}) -> Mesh:
    rng = Random(hash(spec.seed))
    profile = HULL_TEMPLATES[spec.type]           // liner, cargo, tanker, liberty, destroyer, battleship,
                                                  // submarine, sailing_ship, trawler, flying_boat, bomber, tug...
    hull = loftHull(stations = 24, length = spec.lengthM, beam = spec.beamM, draft = spec.draftM,
                    bow = profile.bowShape, stern = profile.sternShape)
    superstructure = placeBlocks(profile.deckLayout, rng)          // bridge, funnels, masts, hatches, cranes
    mesh = merge(hull, superstructure)

    switch spec.state:
        upright:     settleOnSeabed(mesh, tilt = rng.range(0, 8°))
        listing:     settleOnSeabed(mesh, tilt = rng.range(15°, 60°))
        capsized:    rotate(mesh, roll = 180° ± 20°)
        broken:      mesh = splitAt(mesh, 0.35..0.65) and offset(sections, gap=rng.range(5, 600), yawDelta)
        debris_only: mesh = scatterPlates(mesh, count=200)

    mesh = applyDecay(mesh, age = now - spec.year, depth = spec.depth, rng)   // §7.2.3
    mesh = addDebrisField(mesh, radius = 0.5 * spec.lengthM, rng)
    return mesh
```

Aircraft wrecks (WWII bombers, flying boats) use the same pattern with fuselage/wing/tail lofts. Wikidata/Canmore-sourced datasets include ~400 aircraft wrecks mixed in with ships ✅, so classify by `type` early.

#### 7.2.2 Hero wrecks (hand-tuned, optionally real photogrammetry)

All figures ⚠️ approximate — verify and replace from authoritative sources:

| Wreck | Approx. location | Approx. depth | Length | Note |
|---|---|---|---|---|
| RMS Titanic | ~41.7°N, 49.95°W | ~3,800 m | ~269 m | broke in two; bow/stern ~600 m apart; rusticles; war-grave-style respect |
| Bismarck | ~48.2°N, 16.2°W | ~4,700 m | ~251 m | |
| HMS Hood | ~63.3°N, 31.8°W | ~2,800 m | ~262 m | war grave |
| RMS Lusitania | ~51.4°N, 8.55°W | ~90 m | ~239 m | |
| Andrea Doria | ~40.5°N, 69.85°W | ~70 m | ~212 m | |
| SS Thistlegorm | ~27.8°N, 33.9°E | ~30 m | ~126 m | Red Sea; cargo of vehicles |
| SS Yongala | ~19.3°S, 147.6°E | 15–30 m | ~109 m | |
| SS President Coolidge | ~15.3°S, 167.1°E | 20–70 m | ~200 m | |
| USS Arizona | ~21.37°N, 157.95°W | ~12 m | ~185 m | memorial — see §13 |
| HMS Birkenhead (SA) | ~34.6°S, 19.3°E | shallow ⚠️ | ~64 m ⚠️ | Danger Point |

**Real 3D scans (optional upgrade, check each licence):** NOAA/BOEM "Virtual Archaeology Museum" ROV photogrammetry (e.g. Gulf of Mexico wrecks on Sketchfab/Zenodo) ✅; Indiana University's *City of Washington* model (Florida Keys) ✅; "3D Shipwrecks" Great Lakes models ✅; Open Heritage 3D (CC BY assets) ✅. These are heavy (one NOAA model is ~8.6M triangles ✅) → decimate to LOD0 ≤ 150k tris on mobile, bake normal maps. **Per-model licences vary; never bundle without checking.**

#### 7.2.3 Aging, growth, and sediment (what makes a mock-up look *real*)

```pseudo
function applyDecay(mesh, age, depth, rng):
    // 1. Structural: plates peel, hull collapses with age and depth-related crush
    displaceByNoise(mesh, amp = f(age), mask = hullPlates)
    // 2. Material: rust darkening; "rusticles" (icicle-like iron bacteria) in cold deep water
    if depth > 500 and temp(depth) < 6°C: addRusticles(mesh, density = min(1, age/80))
    // 3. Sediment drape: accumulates on up-facing normals, scaled by local current & age
    sedimentMask = clamp(dot(normal, up)) * (1 - currentStrength) * ageFactor
    // 4. Biology (depth/latitude/light dependent)
    if depth < 60 and tropical: coralAndSpongeGrowth(mesh, mask = sunlitSurfaces)
    elif depth < 200: anemonesAndKelp(mesh)
    else: sparseSponges_andBrittleStars(mesh)
```

#### 7.2.4 Interaction

* Proximity reveal: label + ghost silhouette fades in at ~500 m (sonar can reveal at any range).
* "Size ghost" toggle: overlays a bus/whale/football-pitch silhouette for scale.
* Fauna behaviour: wrecks are fish magnets (artificial reefs) → spawn weights boosted near wrecks (§8.3).

### 7.3 Caves & blue holes

There is **no single global database** of underwater caves. Practical approach: curated list (Wikidata + Wikipedia + published survey sites) with *procedural* interiors driven by real dimensions.

| Feature | Facts to encode | |
|---|---|---|
| **Dragon Hole (Longdong), South China Sea** | deepest known blue hole, ≈ 300.89 m | ✅ |
| **Taam Ja' Blue Hole, Chetumal Bay (Mexico)** | reported as the deepest known; bottom not yet reached | ✅ (depth figure ⚠️) |
| **Dean's Blue Hole, Long Island, Bahamas** | 23.10639°N, 75.00861°W; 202 m deep; entrance 25–35 m, widening to ~100 m at ~20 m depth | ✅ |
| **Great Blue Hole, Belize** | ~125 m deep, up to ~300 m across | ✅ |
| **Sistema Sac Actun / Dos Ojos (Yucatán)** | ~375 km connected system (record); Dos Ojos connected 2018; QRSS maintains survey maps | ✅ (third-party stats) |
| **Dahab Blue Hole (Red Sea)** | | ✅ named |
| Sodwana Bay canyons (SA) | coelacanth habitat | ⚠️ |

**Procedural cave generator:**

```pseudo
function buildCave(spec: {entrance: LatLon, centerline: [Vec3] | null, lengthM, maxDepthM, kind, seed}):
    rng = Random(spec.seed)
    path = spec.centerline ?? randomWalkPath(spec.entrance, spec.lengthM, spec.maxDepthM, rng)  // branching allowed
    radiusAlong = (p) -> baseRadius(spec.kind) * (0.6 + 0.8*noise1D(p.t * 0.05, rng))
    sdf(x) = union( tubes(path, radiusAlong) ) + 0.35 * fBM(x * 0.8) + stalactites(x, rng)   // signed distance field
    // Carve into terrain: terrain is a heightfield, caves need volumes. Use a local VOLUMETRIC INSET:
    chunkSdf = combine(heightfieldAsSdf(terrain), -sdf)       // subtract cave from rock
    mesh = marchingCubes(chunkSdf, cell = 0.5m near camera, 2m far)   // only within ~300 m of the camera
    return mesh

function blueHole(spec):    // vertical shaft + flared chamber
    return carveCylinder(spec.entrance, radius = spec.entranceR, depth = spec.depth,
                         flare = spec.flareAtDepth(20m → R = 100m)) + sideTunnels(rng)
```

Cave atmospherics (cheap, high impact):

* **Light** falls off exponentially from the entrance; torchless exploring is dark → optional "headlamp" toggle for the bodiless entity (a soft cone).
* **Halocline** in Yucatán-style cenotes: a wavering fresh/salt boundary layer (refractive blur shimmer) at a set depth.
* Blue holes: strong green-blue light cone near the entrance, anoxic/murky "hydrogen-sulfide cloud" layers at depth (visual only).

### 7.4 Corals, reefs, kelp, seagrass

| Layer | Source | Notes |
|---|---|---|
| **Shallow tropical reefs** | **Allen Coral Atlas** — benthic + geomorphic maps, 5 m pixels ✅; global shallow reef area est. ≈ 348,361 km² ✅; shallow (<20 m), 30°N–30°S ✅; downloads via Atlas, Google Earth Engine ✅ | Licence: check Atlas terms ⚠️ |
| **Cold-water corals** | **UNEP-WCMC Global Distribution of Cold-water Corals v5.1** (occurrence records, 86 families) ✅ | "UNEP-WCMC General Data Licence"; commercial use needs permission ✅ |
| **Deep-sea coral & sponge records (US)** | **NOAA Deep-Sea Coral Research & Technology Program** — a large dataset inside OBIS (~665k records in one area summary) ✅ | via OBIS |
| Kelp | Global Kelp Timeseries (NCEAS/KEEN) in OBIS ✅ | |
| Seagrass / mangroves ⚠️ | UNEP-WCMC seagrass; Global Mangrove Watch | verify |

```pseudo
function reefInstances(tile, camPos):
    for cell in reefMaskCells(tile):                        // from Allen Coral Atlas rasters (baked to 5-m mask, coarsened)
        zone = benthicClass(cell)                           // coral/algae, rubble, sand, seagrass...
        density = zoneDensity[zone] * lightFactor(depth) * (1 - turbidity)
        for k in poisson(density, seed = hash(cell, "coral")):
            spawn(CoralTemplates.pick(zone, depth, rng), scaleM = rng.logNormal(...))   // meters, real sizes
```

Coral templates (parametric, instanced): branching (staghorn), table, brain, plate, fan (gorgonian), soft tree, sponge vase, kelp frond, seagrass blade. Cold-water: *Lophelia*-style thickets and black coral at depth, placed from UNEP-WCMC points + slope/current heuristics.

### 7.5 Hydrothermal vents, seeps, whale falls, brine pools

| Feature | Source | Notes |
|---|---|---|
| **Hydrothermal vent fields** | **InterRidge Vents Database v3.4**: **721 vent fields**, 666 confirmed/inferred active, 55 inactive ✅; fields include lat, lon, depth, tectonic setting ✅ | **CC BY-NC-SA 4.0** ✅ — non-commercial! Plan for it (§14). |
| Cold seeps, brine pools, mud volcanoes ⚠️ | Literature + curated list (e.g. Gulf of Mexico brine pools) | procedural stamps |
| Whale falls | **Procedural**: skeleton prop + sulfur-mat zones + specialised fauna; placed on abyssal plains near whale migration corridors (low-density) | fun, plausible |

Vent rendering: black-smoker chimney generator (stacked cones + noise), particle plume that rises then flattens at neutral buoyancy, shimmering water, tube-worm clusters (*Riftia* up to ~2 m ⚠️), yeti crabs, mussel beds. Vent lights = few emissive glows (hot fluid).

### 7.6 Seamounts & named features

* **Seamount catalogs:** the SIO catalog combined with Kim & Wessel = tens of thousands of seamounts (24,643 + 19,325 newly identified ✅, Zenodo); a brand-new **SDUST2026SM** catalog lists **67,374** high-confidence seamounts ✅ (an ESSD *preprint* — check licence/status before relying on it). Wessel's older 11,882-seamount database ✅ remains a simple fallback.
* **Names for labels:** **GEBCO Gazetteer of Undersea Feature Names** (~4,500 features ✅, REST API serving points/lines/polygons ✅) and Marine Regions (6,754 undersea features ✅).
* Seamounts get procedural **flat-topped guyots / cone** surface detail, coral gardens on summits, and "seamount aggregation" fauna (sharks, tuna, rays).

---

## 8. Marine life

### 8.1 Data sources

| Source | What it gives | Access | Notes |
|---|---|---|---|
| **OBIS** | Real occurrence records w/ lat, lon, **depth**, year, dataset ✅; free API with **no key** ✅ (`api.obis.org/v3`); bulk **AWS Open Data GeoParquet** ✅; R package `robis` ✅ | API + Parquet | Per-dataset licences vary (CC0/CC-BY/CC-BY-NC) — record the licence per dataset in the pipeline. |
| **AquaMaps** | Predicted ranges for 33,500+ marine species ✅ at 0.5° ✅ using depth, temp, salinity, productivity, oxygen, ice ✅; `aquamapsdata` can download ~2 GB (≈10 GB unpacked) ✅ | SQLite/R | **Non-commercial use with attribution** ✅; computer-generated predictions — "verify occurrences before usage" ✅ |
| **FishBase / SeaLifeBase** | Max length (Lmax), weight, age, depth range, etc. via the POPCHAR/SPECIES tables ✅; SeaLifeBase covers ~200k non-fish aquatic species ✅; `rfishbase` serves Parquet snapshots hosted on HuggingFace ✅ | Parquet / R | Check licence (likely CC-BY-NC) ⚠️ |
| **WoRMS** | Taxonomy backbone (OBIS uses WoRMS AphiaIDs ✅) | API | Use AphiaID as the species key everywhere |
| Cetaceans, cephalopods, big sharks | Curated table (NOAA Fisheries species directory / IUCN / literature) ⚠️ | manual | FishBase won't cover mammals well |
| Bio-ORACLE ⚠️ | Environmental layers (temperature, salinity, etc.) | download | OBIS already adds SST from Bio-ORACLE ✅ |

### 8.2 Species record (baked)

```jsonc
{
  "aphiaId": 105838, "sci": "Carcharodon carcharias", "common": "Great white shark",
  "sizeM": { "min": 1.2, "typ": 4.2, "max": 6.1 },        // ⚠️ build pipeline overwrites from FishBase/curated
  "depthM": { "min": 0, "typ_max": 300, "max": 1200 },
  "habitat": ["coastal","pelagic","seal_colony"],
  "tempC": [8, 24],
  "prior": "priors/105838.bin",                           // 0.5° AquaMaps probability raster
  "behavior": "patrol_cruiser",                           // maps to a motion template (§8.5)
  "template": "shark_fusiform", "palette": "grey_countershaded",
  "rarityBoost": 1.5,                                      // 'fun' multiplier (capped, §8.3)
  "light": null                                            // or bioluminescence spec
}
```

### 8.3 The Plausibility Engine (fun, but never wrong)

```pseudo
function suitability(sp, place) -> [0..1]:              // HARD constraints first
    if place.depth < sp.depthM.min or place.depth > sp.depthM.max: return 0
    if not tempOK(sp, tempAt(place.lat, place.depth)):             return 0
    if sp.hadalOnly and place.depth < 6000:                        return 0
    habitatFit = overlap(sp.habitat, place.habitatTags)            // reef, vent, canyon, wreck, open_water...
    rangePrior = sampleRaster(sp.prior, place.lat, place.lon)      // AquaMaps: 0..1
    obisDensity = sampleOptional(sp.obisDensity, place)            // optional baked heat-map
    return habitatFit * (0.7*rangePrior + 0.3*obisDensity)

function spawnWeight(sp, place):
    base = suitability(sp, place)
    if base == 0:  return 0                                         // NEVER spawn where it's biologically impossible
    fun = clamp(sp.rarityBoost, 1, 3) ^ funBudget                   // funBudget ∈ [0,1], user "Realism ↔ Wonder" slider
    return base * fun * wreckBoost(place) * seamountBoost(place)
```

* **Fun lives in the weights, not the rules.** "Wonder" mode bumps charismatic megafauna frequency; it cannot teleport a tropical reef fish into the Arctic. Optional "cameo" rule: allow ≤ 1-in-N out-of-core-range cameos only in *adjacent* suitable habitat (e.g. a vagrant sea turtle).
* Sizes: **never exceed Lmax**, and sample from a truncated log-normal with the median near typical length. Model scale = real length ÷ template length, uniform in all axes.

### 8.4 Stateless spawning (the trick that makes this scale)

No stored world. Each ~64 m (near) / ~512 m (far) **cell** deterministically generates its inhabitants from a hash:

```pseudo
function inhabitantsOf(cell, timeOfDay):
    rng = Random(hash(cell.id, WORLD_SEED))
    out = []
    for sp in candidateSpecies(cell.place):              // pre-filtered by depth & range from the baked priors
        w = spawnWeight(sp, cell.place)
        n = poissonCount(w * sp.densityPerCell, rng)
        for i in 0..n:
            out.push(Actor{ sp, id: hash(cell.id, sp.id, i), size: sampleSize(sp, rng) })
    return out

function actorPose(actor, tSeconds) -> Pose:             // CLOSED-FORM: no simulation state
    path = Lissajous/CatmullRom loop seeded by actor.id, radius by species roam range
    pos  = path(tSeconds * actor.speed / path.length)
    return Pose{ pos, heading: derivative(path), bodyPhase: tSeconds * tailBeatHz(actor) }
```

Because pose is a pure function of `(actor.id, time)`, two users in the same place see the same animals, scrubbing time works, and there is nothing to keep in memory off-screen. For flocking/schooling, spawn **school anchors** deterministically and let nearby individuals follow with local boids only inside ~60 m of the camera.

### 8.5 Behaviour templates

| Template | Examples | Motion |
|---|---|---|
| `patrol_cruiser` | sharks, tuna, dolphins | long loops, burst chase when prey nearby |
| `drifter` | jellyfish, siphonophores, salps | currents + slow pulsing |
| `bentho_crawler` | crabs, isopods, sea cucumbers | slow ground crawl, hug terrain |
| `ambush` | anglerfish, wobbegong, octopus | stationary, lure flicker, strike on proximity |
| `school` | sardines, anchovies, lanternfish | boids + predator "bait ball" reaction |
| `deep_diver` | sperm whales, beaked whales | surface ↔ deep cycles over minutes (click-train audio) |
| `sessile` | corals, sponges, tube worms | static + sway |

**Diel vertical migration (iconic, real):** each mesopelagic "scattering layer" rises toward the surface at dusk and sinks at dawn. Implement as a per-species `targetDepth(timeOfDay)`; show the layer as a faint band on the sonar HUD. This single system makes the deep feel *alive and clock-driven*.

### 8.6 Bioluminescence

* Many deep animals emit blue-green light; reds are often invisible to deep fauna, which is why deep-sea animals are frequently red/black ⚠️ — use that in palettes (a red animal looks black at depth).
* Disturbance bursts: moving close to some jellies/plankton triggers a luminous wake (cheap point-sprite flashes).
* Lures (anglerfish), photophores (lanternfish, dragonfish), glowing siphonophore strings.

### 8.7 Hero species (true-scale showpieces)

Values ⚠️ approximate — the pipeline overwrites from data:

| Species | Max size (approx.) | Typical depth | Notes |
|---|---|---|---|
| Blue whale | ~30 m | 0–~300 m | largest animal; seasonal feeding grounds |
| Sperm whale | males ~16–18 m | forages to ~1–2 km | deep_diver; squid hunter |
| Whale shark | ~12 m (larger claims unverified) | 0–~700 m | plankton feeder; warm waters |
| Great white shark | ~6 m | 0–~1 km | seal colonies — **False Bay (SA)** |
| Giant squid | ~10–13 m (with tentacles) | ~300–1,000 m | rare, deep |
| Colossal squid | mantle ~2.5 m, total several m | ~1–2 km, Southern Ocean | |
| Oarfish | up to ~8 m | ~200–1,000 m | |
| Greenland shark | ~5–6 m | to ~2 km, cold | |
| Goblin shark | ~3.8 m | ~200–1,300 m | |
| Coelacanth | ~2 m | ~100–700 m | **Sodwana Bay / Comoros** |
| Giant tube worm (*Riftia*) | ~2 m | ~2.5 km vents | |
| Giant isopod | ~0.5 m | ~170–2,500 m | |
| Vampire squid | ~0.3 m | ~600–1,200 m | |
| Dumbo octopus | ~0.2–0.3 m | ~300 m+ | |
| Siphonophore (*Praya*-like) | tens of metres (colony) | mesopelagic | longest animals by length |
| Mariana snailfish | ~0.1–0.3 m | ~6–8 km | hadal; trenches only |
| Hadal amphipods | ~few cm | >6 km | swarm near trench axes |

### 8.8 Field Guide / Atlas (retention + education)

* Auto-fills as you encounter species; each entry shows measured size vs a human silhouette, depth range, the OBIS/AquaMaps range map, and attribution.
* "Photo mode" (freeze time, depth-of-field, hide HUD) that stamps lat/lon/depth in the file metadata.
* Optional live OBIS lookup (online only) for "other sightings near here".

---

## 9. Controls (rewritten for your spec)

### 9.1 Field of view: 80°–120°, adjustable on the fly

```pseudo
const FOV_MIN = 80, FOV_MAX = 120               // degrees, HORIZONTAL (what players expect)
state.hFov = clamp(userFov, FOV_MIN, FOV_MAX)

function applyFov(camera, aspect, dt):
    target = clamp(state.hFov + (speedKickEnabled ? speedFovKick(state.speed) : 0), FOV_MIN, FOV_MAX)  // NEVER exceed bounds
    smooth = lerpExp(smooth, target, 1 - exp(-dt / 0.12))                       // ~0.12s ease, no pop
    camera.fov = toDegrees( 2 * atan( tan(toRadians(smooth)/2) / aspect ) )     // engines want VERTICAL fov
```

* UI: slider with quick presets (80 / 90 / 100 / 110 / 120), pinch-gesture option, keyboard `[` / `]`, mouse-wheel + modifier.
* **Edge distortion fix:** past ~100°, rectilinear projection stretches edges. Provide a **Projection** option: *Rectilinear / Panini / Stereographic* as a post-process.
* Comfort: optional vignette that tightens with speed and rotation (reduces motion sickness).

### 9.2 Touch layout (edges of the screen, thumb-reachable)

```
┌───────────────────────────────────────────────────────────────┐
│ [depth ribbon]            HUD / compass             [menu ☰]  │
│                                                               │
│                      (drag centre = look)                     │
│                                                               │
│  ┌────────┐                                      ┌─┐          │
│  │ MOVE   │  ← left edge: 2-axis stick           │▲│ ← right  │
│  │ stick  │     (fwd/back + strafe)              │ │   edge:  │
│  └────────┘                                      │▼│ vertical │
│  [CRAWL | CRUISE | WARP]   speed slider ═════●══ │ │  lever   │
└───────────────────────────────────────────────────────────────┘
```

* Left stick: thrust relative to look direction (`W A S D` equivalent).
* Right vertical lever: ascend/descend (`Space` / `C` equivalent); spring-return or "latch" (configurable).
* Look: drag anywhere in the centre; optional gyro look.
* Roll is auto-levelled (bodiless entity keeps horizon "up") with an optional free-roll toggle.
* Left-handed layout swap; button sizes scale with screen; all controls fade to 30% opacity after a few seconds idle.
* Desktop: `WASD` + `Space/C` (or `Q/E`), mouse look (pointer lock), `Tab` cycles modes, `1/2/3` select mode, `Scroll` adjusts the *current mode's* slider.

### 9.3 Speed: three modes, each with its own slider

| Mode | Slider range | Scale | Default | Intent |
|---|---|---|---|---|
| **CRAWL** | **0 → 5 m/s** | fine near zero; `0` = hold perfectly still | 0.5 m/s | inspect a 2 cm amphipod, hover beside a vent |
| **CRUISE** | 1 → 500 m/s | log | 25 m/s | normal exploration (a wreck in ~10 s) |
| **WARP** | 0.5 km/s → 5,000 km/s | log | 50 km/s | cross ocean basins; at the top end, Earth's circumference in ~8 s |

```pseudo
struct Mode { name, vmin, vmax, slider01, accelTau, brake }       // each mode keeps its OWN slider value
MODES = [
  Mode("CRAWL",  0.0,      5.0,      0.10, tau=0.15, brake=false),
  Mode("CRUISE", 1.0,      500.0,    0.45, tau=0.40, brake=false),
  Mode("WARP",   500.0,    5_000_000.0, 0.35, tau=1.20, brake=true)     // m/s
]

function sliderToSpeed(mode, t):                         // t ∈ [0,1]
    if mode.name == "CRAWL":  return t == 0 ? 0 : mode.vmax * t*t          // gentle curve, 0 = stop
    return mode.vmin * pow(mode.vmax / mode.vmin, t)                       // log-scale slider

function updateVelocity(cam, input, dt):
    vTarget = sliderToSpeed(mode, mode.slider01) * input.thrust            // input.thrust ∈ unit disk/vector
    if mode.brake: vTarget *= proximityBrake(cam)                          // see below
    alpha = 1 - exp(-dt / mode.accelTau * inertiaSlider)                   // "Inertia": 0 = snappy, 1 = drifty
    cam.vel = lerp(cam.vel, cam.orient * vTarget, alpha)
    moveCamera(cam, cam.vel, dt)

function proximityBrake(cam) -> [0.02..1]:               // optional "terrain-aware ease" (default ON in Warp; collisions stay OFF)
    d = min(distToSeabed(cam), distToNearestFeature(cam))
    return clamp(d / (BRAKE_RANGE * speedFactor), 0.02, 1)                 // ease down as you approach, never blocks flight
```

* **Bodiless means no collision** (as in v1): you can pass through terrain and waves. The proximity brake only *eases speed*; a "Ghost" toggle disables it entirely.
* Persist each mode's slider; double-tap the slider thumb to reset to default.
* HUD shows speed in m/s **and** a human comparison ("≈ blue-whale cruise", "≈ jet airliner", "≈ Earth lap in 8 s").

### 9.4 Warp-mode rendering (so it feels like a starship, not a slideshow)

```pseudo
function warpRenderPolicy(cam):
    speedPerAlt = cam.speed / max(cam.altitudeAboveSeabed, 10)
    if speedPerAlt > 2:     lodBias += 2; disableMicroTerrain(); disableActors(); drawFarFauna=false  // stay at coarse LODs
    drawSpeedStreaks(strength = smoothstep(1e3, 1e5, cam.speed))      // marine snow stretches into lines
    chromaticAberration = small; vignette = comfortScaled
    showPlaceNames = labelsAlongPath(featuresWithin(corridor))         // GEBCO gazetteer labels flash past
```

### 9.5 Streaming under extreme speed

```pseudo
function prefetch(cam, dt):
    horizon = clamp(cam.speed * 8.0, 2_000, 5_000_000)              // look ~8 seconds ahead
    cone = frustumExtruded(cam.pos, cam.vel, horizon, angle=35°)
    for tile in tilesIntersecting(cone, desiredLodFor(cam.speed)):   // at warp speeds ask only for COARSE levels
        request(tile, priority = 1 / (etaSeconds(tile) + screenError(tile)))
    cancelStale(requests, notInCone)
```

Rule of thumb: **speed buys you coarse tiles only**; as you slow down the LOD target tightens, so detail "resolves in" like a camera focusing — which looks intentional.

---

## 9A. UI architecture: an empty screen, everything nested

**Rule: the default screen is almost empty.** Only the ocean, two faint thumb controls, and a tiny depth readout. Everything else is one gesture away and organised into six nested groups. Nothing is permanently on screen unless it's useful *right now*.

### 9A.1 Four layers of disclosure

| Layer | What's visible | How you get there |
|---|---|---|
| **L0 Immersion** (default) | Ocean + move stick (left edge) + vertical lever (right edge) + depth number. Controls fade to ~30% after 4 s idle. | — |
| **L1 Glance bar** | Thin top bar: depth (m/ft), heading, speed + mode, torch state, FOV, lat/lon. Auto-hides after 3 s. | Swipe down from the top edge (desktop: hold `Alt`) |
| **L2 Quick wheel** | Radial menu with 6 spokes (below); each spoke opens a small sub-wheel/slider tray. Closes on release/tap away. | Long-press the ☰ button or two-finger tap (desktop: **hold `Tab`**) |
| **L3 Drawer** | Full settings and tuning, tabs matching the six spokes. | ☰ → "More…" (desktop: `Esc`) |

`H` (desktop) or three-finger tap = **Pure Immersion**: hides everything including thumb controls (they still work invisibly). Tap `Tab` (without holding) cycles speed mode; `M` opens the map.

### 9A.2 The six spokes: where every feature lives

| Spoke | Sub-items (nested) |
|---|---|
| **LIGHT** | Torch on/off · beam focus · power (Low/Std/Search/Flood) · colour (White/Blue-green/Red) · glow-sticks (count) · strobe beacon · ghost vision |
| **SONAR** | Ping · Survey view (Honest Map) · range · passive hydrophone arcs · sonar memory fade |
| **SPEED** | Mode (Crawl/Cruise/Warp) · that mode's slider · inertia · proximity brake / Ghost |
| **VIEW** | FOV 80–120° (+presets) · projection (Rectilinear/Panini/Stereographic) · comfort vignette · time of day · sea level (−130…+70 m) · vertical exaggeration |
| **DISCOVER** | Expedition Board (§9B) · Nearby (auto-list) · Field Guide/Atlas · Dives (tours) · Photo mode · Share link |
| **SYSTEM** | Quality tier · audio · control layout/left-hand · accessibility · Darkness fidelity · Dread · Realism↔Wonder · Credits · Tuning/Debug (§20.3) |

### 9A.3 Contextual elements (appear only when relevant, then leave)

* **Depth-zone ribbon** slides in for ~3 s whenever you cross a zone boundary, then hides.
* **Nearby chip:** a small pulsing dot + name when a notable feature is within ~1 km; tap to expand, ignore to let it fade. Never more than one at a time.
* **Discovery cards:** first sighting of a species/feature slides in from the side for ~4 s and drops into the Field Guide.
* **Sonar/torch widgets:** the sonar cooldown ring only appears while sonar is active; glow-stick count only appears when the torch is off or you're below the lit zone; torch battery bar only in Dread mode.
* **Toasts:** max one at a time, bottom-centre, small, auto-dismiss.
* **Warnings** (war-grave notice, restricted-feature notes) appear once per feature as a brief card.

```pseudo
function updateHudVisibility(state, dt):
    for el in HUD_ELEMENTS:
        want = el.alwaysOn ? true
             : el.contextRule(state)                 // e.g. nearFeature<1000, zoneChanged<3s, sonarActive
        el.alpha = approach(el.alpha, want ? el.maxAlpha : 0, dt / 0.25)
        if el.idleFade and state.idleSeconds > 4: el.alpha = min(el.alpha, 0.3)
    enforce(maxPersistentElements = 5, maxToasts = 1)   // hard cap so the screen can never clutter
```

---

## 9B. Pre-dive "Expedition Board" (launch menu)

Shown on launch and from DISCOVER. Dark, minimal, full-screen: a horizontally swipeable row of cards plus a few filter chips. Each card tells you *what to expect* before you commit.

### 9B.1 Layout

* **Top chips:** `All · Wrecks · Caves & Blue Holes · Reefs · Deep & Dark · Wildlife · Home waters (SA) · Wonders`
* **Primary buttons:** **Start at the surface (100 ft)** · **Continue last spot** · **Surprise me** · **Daily Dive** (deterministic pick from the date).
* **Card tap = expand** to a short sheet; **Dive here** drops you there with the recommended settings applied (you can untick that).

### 9B.2 Card content (consistent so it's scannable)

```jsonc
{
  "id": "dest:deans_blue_hole",
  "title": "Dean's Blue Hole",
  "hook": "A 200 m shaft into the Bahamian limestone.",          // one line
  "expect": "2-3 sentences describing the experience",
  "stats": { "depthM": 202, "lightLevel": 2, "dread": 3, "scale": "25-100 m wide" },  // lightLevel 5=sunlit .. 0=black; dread 1-5
  "bestFor": ["first dive", "caves"],
  "start": { "lat": 23.10639, "lon": -75.00861, "h": 20, "heading": 0 },
  "suggested": { "mode": "CRAWL", "torch": "Std", "timeOfDay": "noon", "fov": 100 },
  "tags": ["blue_hole"], "note": null                              // e.g. "war_grave" shows a respect notice
}
```

`lightLevel` shows as a ☀→⬛ icon strip; `dread` as ●○○○○ dots. The board is generated from `features.pack` + a hand-written `destinations.json` (copy below is the starter).

### 9B.3 Starter destinations (copy is a draft; facts ⚠️ unless marked ✅ — verify before final)

**First timers**
* **Open Ocean Surface Start** — *Start 100 ft above the swells and fall through the waves.* Watch the light change as you sink: red vanishes in the first ~15 m, blue fades to black by a few hundred metres. A good first dive. · ☀ → ⬛ · Dread ●○○○○
* **Great Barrier Reef** — *The brightest place in the app.* Shallow, sunlit, saturated colour, corals and reef fish; mapped from the Allen Coral Atlas ✅. Proof that the ocean isn't always dark. · ☀☀☀☀ · Dread ○○○○○

**Wrecks**
* **RMS Titanic** — *Two halves, ~600 m apart, 3.8 km down.* Total darkness, a debris field, rust "rusticles", marine snow. Bring the torch and move slowly. **War-grave-style respect applies.** · ⬛ · Dread ●●●●○ · note: memorial
* **SS Thistlegorm (Red Sea)** — *A WWII freighter with its cargo still aboard.* About 30 m down, warm and bright; trucks and motorbikes in the holds, glassfish swarming. · ☀☀☀ · Dread ●○○○○
* **Bismarck** — *A battleship in the abyss, ~4.7 km down.* Immense, silent, very dark. The scale is the scare. · ⬛ · Dread ●●●●○ · note: war grave
* **HMS Birkenhead (Danger Point, SA)** — *An 1852 troopship lost off the Cape coast.* Cold, green Cape water and kelp; a gentle, historic wreck. · ☀☀ · Dread ●●○○○ · note: memorial
* **SS Waratah (unsolved)** — *A liner that vanished in 1909 and has never been found.* Search the Wild Coast seabed: it exists only as a mystery marker (`legendary`). · ☀→⬛ · Dread ●●●○○

**Caves & blue holes**
* **Dean's Blue Hole (Bahamas)** ✅ — *A 202 m shaft that opens into a vast chamber.* Entrance 25–35 m wide, flaring to ~100 m at about 20 m depth. Light drains as you sink; the walls fall away into blue-black. · ☀☀ → ⬛ · Dread ●●●○○
* **Great Blue Hole (Belize)** ✅ — *A ~300 m wide, ~125 m deep ring in the reef.* Look for ledges and the fading light halfway down. · ☀☀ → ⬛ · Dread ●●○○○
* **Dragon Hole (South China Sea)** ✅ — *The deepest known blue hole, ~300 m.* Dark, still, and rarely visited. · ⬛ · Dread ●●●●○
* **Yucatán cenotes (Sac Actun / Dos Ojos)** ✅ — *Flooded caves with a shimmering halocline.* Where fresh and salt water meet you'll see a wavering layer; beyond your torch, nothing. · ☀ → ⬛ · Dread ●●●●○

**Deep & Dark**
* **Challenger Deep (Mariana Trench)** ✅ — *The deepest point on Earth, ≈ 10.9 km.* Total black, silt plains, trench walls. Life is tiny and strange (hadal amphipods, snailfish). Plan to hover and listen. · ⬛ · Dread ●●●●●
* **East Pacific Rise vents** — *Black smokers 2.5 km down.* Hot, glowing chimneys and dense tube-worm clusters: islands of light and life in a black desert. · ⬛ (vent glow) · Dread ●●●○○
* **Midnight Zone / Deep Scattering Layer** — *Go at night, then at noon.* A band of animals rises toward the surface at dusk and sinks at dawn; the sonar band moves with the clock. · ☀ → ⬛ · Dread ●●●○○
* **Seamount Garden (random)** — *An underwater mountain draws life.* Coral gardens on the summit, sharks and tuna circling, cold dark flanks below. Picks a seamount from the catalog. · ☀☀ → ⬛ · Dread ●●○○○

**Wildlife & Home waters (South Africa)**
* **False Bay, Seal Island** — *Great white country.* Cold green water, fast silhouettes, and the occasional surface breach. · ☀☀ · Dread ●●●●○
* **Sodwana Bay canyons** — *Warm reef above, coelacanth-depth canyons below.* Tropical shallows with a dim blue drop-off where the coelacanth lives. · ☀☀☀ → ⬛ · Dread ●●○○○
* **Cape Point / Cape Canyon** — *Where two oceans meet.* Cool Atlantic and warm Indian currents, kelp near shore, a deep canyon offshore. · ☀☀ → ⬛ · Dread ●●○○○
* **Sardine Run (winter, Wild Coast)** — *A seasonal bait-ball spectacle.* Dolphins, sharks and gannets herd sardines; chaotic and fast. · ☀☀☀ · Dread ●●●○○ · event

### 9B.4 Board rules

* Every card shows **what you'll see, how dark it is, and how tense it is**: no surprises you didn't opt into.
* A **"Jump-scare-free"** toggle (SYSTEM) softens flagged encounters on the Dread≥4 cards.
* New cards auto-generate for any feature in `features.pack` tagged `showcase: true`.
* Surface Start is always the first card and the default, matching the original blueprint (spawn at +30.48 m).

---

## 10. HUD & tool inventory (placement is defined in §9A)

* **HUD:** latitude/longitude, depth/altitude in metres *and* feet, speed (with mode), FOV, pressure (≈ 1 atm per 10 m + 1), water temperature (model), light level, heading compass, **depth-zone ribbon** with the creatures typical of each zone.
* **Sonar pulse (`F`):** expanding wireframe wave across the seafloor; also pings wrecks, caves and vents as ghost icons; crisp where surveyed, shimmery where predicted (Honest Map, §5.2).
* **Scale ruler & size ghosts** (§7.2.4).
* **Teleports** (searchable, with categories & a "Surprise me" button):
  * Trenches/ridges: Challenger Deep area (Mariana), Mid-Atlantic Ridge, Puerto Rico Trench ⚠️.
  * Wrecks: the hero list (§7.2.2).
  * Blue holes/caves: Dean's, Great Blue Hole, Dragon Hole, Taam Ja', Yucatán cenotes.
  * **Home waters (South Africa)** ⚠️: Cape Point/Cape canyon, False Bay *Seal Island*, Gansbaai/Danger Point (Birkenhead), Aliwal Shoal, Protea Banks, Sodwana Bay (coelacanth canyons), Agulhas Bank, Wild Coast (Waratah mystery). Optional seasonal event: the **Sardine Run** (winter bait balls with dolphins/sharks/gannets) as a scripted `school` event.
  * Vents: pick any InterRidge field from the map.
* **Guided "Dives" (autopilot tours):** 3–5 min scripted camera paths with narration text ("Titanic: stern to bow", "Trench descent: surface to 10,900 m").
* **Deep links:** `#lat,lon,depth,heading,time` so you can share exact spots.
* **Time controls:** time-of-day slider (drives surface light, DSL migration), "day/night auto" option.
* **Comfort & accessibility:** reduced-motion mode, colour-blind-safe HUD, haptics on breach/ping, left-hand layout, subtitle for audio events.

---

## 11. Audio (cheap, atmospheric)

* Above water: wind, wave wash, gulls (distance-dependent). Breach: whoosh + underwater "thump".
* Below: pressure-dependent low-pass (more muffled with depth), distant creaks, bubbles, sonar ping.
* Creature calls: procedurally synthesised whale-like moans/clicks by species template (avoids licensing). Real recordings (e.g. public hydrophone archives) can be added later — **check each licence** ⚠️.
* Wrecks emit metal groans scaled by proximity; caves add convolution reverb.

---

## 12. Performance budgets & quality tiers

| Tier | Target | Terrain verts/frame | Actors in full detail | Marine snow | Effects |
|---|---|---|---|---|---|
| Low (budget phone) | 30 fps | ~150k | ≤ 40 | 3k | no god-rays, simple caustics |
| Medium | 45–60 fps | ~400k | ≤ 150 | 8k | god-rays, caustics |
| High (desktop) | 60+ fps | ~1.5M | ≤ 600 | 20k | full volumetrics, Panini, bloom |

* Adaptive resolution scaler targets frame time; thermal-aware (drop a tier if sustained throttling).
* **Impostors/LOD** for creatures: mesh → simplified mesh → camera-facing impostor → glowing point (deep).
* **Instancing** for corals/rocks/snow; **vertex-shader animation** for swimming (spine sine-wave bend), so thousands of fish cost nearly nothing on CPU.
* All streaming/decoding/mesh-generation (caves!) runs in **Workers / job threads**; main thread only submits draws.

---

## 13. Respect, ethics & legal

* **War graves & memorials.** Titanic, Hood, Arizona, Lusitania and many others are sites of mass loss of life. Policy: no human remains ever, no "destroy/loot" mechanics, a small dignity notice at tagged sites (`tags: ["war_grave"]`), and no cutesy fauna cameos on them. Some are legally protected (e.g. England's protected wreck sites ✅).
* **Don't mislead.** The app labels each feature `exact | approx | legendary | procedural` (Honest Map) — the Waratah and unresolved wrecks are "legendary", fictional dressing is never presented as survey fact.
* **Licences (personal-use project, never monetised, free resources only).** Every source in §14 is free to access. Non-commercial terms (InterRidge CC BY-NC-SA ✅, AquaMaps ✅, UNEP-WCMC General Licence ✅) are fine for private, non-monetised use, so **all layers stay in**. Practical rules: keep attribution in an in-app Credits screen, don't redistribute the baked data packs or third-party 3D scans publicly, and a free Copernicus account is needed only if you add live currents. If the project is ever shared or sold, revisit this section first (a `LICENSES.json` in the pipeline makes that easy).
* GEBCO: public domain / free to use ✅ — still credit it, and show "not for navigation".
* NOAA wreck data carries a "not for navigation" disclaimer ✅ — repeat it in-app.
* Don't hot-link or scrape sites without open licences.

---

## 14. Source catalogue (everything found, with how to use it)

| # | Source | Gives you | URL / access | Licence & caveats | Bake / Stream |
|---|---|---|---|---|---|
| 1 | **GEBCO_2025 / GEBCO_2026 Grid** ✅ | Global 15″ (~450 m) bathymetry+land, 43,200×86,400 ✅; 2026 grid published 23 Apr 2026 ✅ | gebco.net; download app at download.gebco.net ✅ (global file, tiles, user areas, OPeNDAP) | Public domain, free ✅ (credit) | **Bake** → own tiles |
| 2 | **GEBCO TID Grid** ✅ | Per-cell source-type ("how real is this?") | gebco.net (with the grid) | same | **Bake** |
| 3 | **AWS Terrain Tiles (Terrarium)** ✅ | Easy tiles; ocean from ETOPO1 1′ ✅ | AWS Registry of Open Data, anonymous HTTPS ✅ | Attribution required ✅ | Dev/prototype only |
| 4 | **GEBCO Gazetteer of Undersea Feature Names** ✅ | ~4,500 named features (points/lines/polygons), REST API ✅ | NCEI/IHO DCDB ArcGIS FeatureServer ✅ | open ⚠️ | **Bake** |
| 5 | **Marine Regions** ✅ | 6,754 undersea features, IDs/synonyms | marineregions.org | CC BY ⚠️ | Bake (optional) |
| 6 | **SIO / Kim-Wessel seamount catalogs** ✅ | 24k–44k seamounts (Zenodo) ✅; Wessel DB 11,882 ✅ | Zenodo, soest.hawaii.edu/pwessel/smts ✅ | check | **Bake** |
| 7 | **SDUST2026SM** ✅ (preprint) | 67,374 seamounts | ESSD preprint + Zenodo ✅ | verify | Bake (when final) |
| 8 | **NOAA Wrecks & Obstructions** ✅ | ~13k wrecks + 6k obstructions (US) | KML/XLS + REST + WMS at `wrecks.nauticalcharts.noaa.gov` ✅ | public data, not for navigation | **Bake** |
| 9 | **Wikidata SPARQL (shipwrecks, caves, etc.)** ✅ | Global notable features w/ coords | query.wikidata.org/sparql ✅ | CC0 ⚠️ | **Bake** |
| 10 | **Wikipedia Lists of shipwrecks** ✅ | Notable wrecks by region/year | en.wikipedia.org/wiki/Lists_of_shipwrecks ✅ | CC BY-SA ⚠️ | Bake via Wikidata |
| 11 | **Historic England protected wrecks** ✅ | 58 sites (lat/lon in dataset ✅) | planning.data.gov.uk / Open Data Hub ✅ | OGL v3 ✅ | **Bake** |
| 12 | **Historic Environment Scotland NRHE (trove.scot)** ✅ | >320k site+wreck records ✅ | trove.scot / SG spatial portal ✅ | OGL ✅ | Bake (wrecks subset) |
| 13 | **Data.gov.ie wrecks** ✅ | Irish wrecks | data.gov.ie | check | Bake |
| 14 | **NOAA/BOEM Virtual Archaeology Museum; Sketchfab/Zenodo scans; Indiana Univ.; 3D Shipwrecks; Open Heritage 3D** ✅ | Real photogrammetry wrecks | Sketchfab, Zenodo, openheritage3d.org ✅ | **per-model** | Bundle selectively |
| 15 | **Allen Coral Atlas** ✅ | Global shallow reef benthic/geomorphic maps, 5 m ✅ | allencoralatlas.org; Google Earth Engine ✅ | verify terms | **Bake** (mask) |
| 16 | **UNEP-WCMC Cold-water Corals v5.1** ✅ | Occurrence points, 86 families ✅ | UNEP-WCMC (DOI 10.34892/72x9-rt61 ✅) | General Data Licence; commercial → ask ✅ | **Bake** |
| 17 | **InterRidge Vents DB v3.4** ✅ | 721 vent fields ✅, lat/lon/depth | vents-data.interridge.org ✅; PANGAEA DOI 10.1594/PANGAEA.917894 ✅ | **CC BY-NC-SA 4.0** ✅ | **Bake** |
| 18 | **OBIS** ✅ | Occurrence records w/ depth; API (no key) + AWS GeoParquet ✅ | api.obis.org/v3; github.com/iobis/obis-open-data ✅ | per-dataset | **Bake** priors; live = optional |
| 19 | **AquaMaps** ✅ | 33.5k species range predictions @0.5° | aquamaps.org; `aquamapsdata` ✅ | **Non-commercial** ✅ | **Bake** |
| 20 | **FishBase / SeaLifeBase** ✅ | Lmax/weight/depth, 30k fish + ~200k non-fish ✅ | `rfishbase` (Parquet on HuggingFace) ✅ | verify (likely NC) | **Bake** |
| 21 | **WoRMS** ✅ (taxonomy) | AphiaIDs | marinespecies.org | CC BY ⚠️ | Bake IDs |
| 22 | **Copernicus Marine** ✅ | Currents (surface + vertical `wcur`), temp, salinity, waves; free with account ✅; OPeNDAP/ERDDAP/Toolbox ✅ | data.marine.copernicus.eu | free w/ registration ✅ | Bake climatology; **live optional** |
| 23 | **QRSS (Quintana Roo Speleological Survey)** ✅ | Cave survey maps/lengths (Yucatán) | qrss.caves.org ✅ | © QRSS — reference only | Reference; don't redistribute maps |
| 24 | **Bahamas Caves Research Foundation / Blue Holes Foundation** ✅ (named) | Blue hole info | their sites | reference | Reference |

---

## 15. Architecture (modules)

```
/app
  core/        time, state, input, settings, deeplinks
  world/       coords (f64), quadtree, tileStore (mem+disk cache), workers
  terrain/     heightfield decode, patch mesher, detail shaders, TID overlay, substrate
  ocean/       surface (Gerstner), waterline, optics, caustics, godrays, snow, currents
  features/    featureIndex (spatial), wrecks/, caves/ (SDF+marching cubes), reefs/, vents/, seamounts/
  life/        speciesDB, plausibility, cellSpawner, actorPose, schools(boids), diel, bioluminescence
  ui/          hud, sonar, touchControls, speedModes, fovControl, atlas, teleports, photoMode, tours
  audio/       ambience, creature synth, wreck groans
/pipeline      (Python/Rust) gebco→tiles, tid→masks, features builders, species builders, license checker
/data          (CDN) tiles/, tid/, features.pack, species.pack, currents.bin, LICENSES.json
```

Worker plan: `TileWorker` (fetch+decompress+mesh), `CaveWorker` (SDF→mesh), `SpawnWorker` (cells→instances). Main thread = input, camera, draw.

---

## 16. Roadmap (revised, each phase shippable)

| Phase | Goal | Acceptance test |
|---|---|---|
| **1. Core flight + surface** | Three.js scene, sky, Gerstner sea, breach, 80–120° FOV, touch+keyboard controls, 3 speed modes with sliders, floating origin | Start at 30.48 m, dive through waves, FOV changes mid-flight with no jump; Warp doesn't jitter |
| **2. Real bathymetry (prototype)** | Terrarium tiles for quick global terrain, geodetic quadtree | See Mariana Trench relief; no seams |
| **3. Own GEBCO pipeline** | Bake GEBCO → tiles + TID; replace Terrarium; Honest Map overlay | Visible quality jump vs ETOPO1; "Survey view" works |
| **4. Procedural micro-detail** | World-space fBM/ridged/Worley, slope texturing, sonar pulse | No pops at LOD/tile borders; detail strongest on predicted cells |
| **5. Optics, darkness & torch** | Beer-Lambert light, caustics, marine snow w/ currents, depth zones, audio, torch with backscatter, slow dark-adaptation, sonar memory, glow-sticks, eyeshine (§6.4) | Red vanishes by ~15 m; effectively black by ~300-500 m; torch shows colour only within a few metres; switching torch off briefly blinds you |
| **6. Features v1** | features.pack; wrecks (parametric + 5 hero), 5 blue holes, vents, seamount labels | Fly to Titanic, Dean's Blue Hole, a vent field; sizes correct vs ruler |
| **7. Life v1** | species.pack (top ~60), plausibility engine, stateless spawner, DSL migration, field guide | Same cell yields same animals every visit; nothing spawns out of depth range |
| **8. Reefs & caves v2** | Allen Coral Atlas masks, cold-water corals, SDF cave interiors, halocline | Great Barrier Reef looks like reef; cenote halocline shimmers |
| **9. Polish & platforms** | Tours, photo mode, deep links, teleports (incl. SA), quality tiers, Android wrapper | 30 fps on mid-range Android; installable |
| **10. Native evaluation** | Decide Unity/Godot port using §2 triggers | Written go/no-go with measured memory/thermal data |

---

## 17. Risks & open questions

1. **Tile size/CDN cost** — measure real compressed L7 size; consider R2/S3 with zero-egress options ⚠️; offer regional offline packs.
2. **Licence strategy** — resolved: personal, non-monetised use, so NC layers are allowed (see §13). Keep a Credits screen.
3. **Wreck position accuracy** — snap to bathymetry; flag `confidence`; allow users to submit corrections (future).
4. **Mobile browser limits** — WebGPU availability and memory caps; keep a WebGL2 path and the native option open.
5. **Marching-cubes cost** near caves on low-end phones — cap volume size, fall back to textured shaft + darkness.
6. **Data staleness** — GEBCO releases yearly ✅; pipeline pinned + re-run annually.
7. **Sensitive sites** — see §13; add a content-review checklist before adding any new wreck with fatalities.
8. **Scope creep** — Phases 1–7 are the app; everything after is bonus.

---

## 18. Innovation shortlist (the "10×" bits, ranked by wow ÷ effort)

1. **Honest Map** (surveyed vs guessed) — nearly free, unique.
2. **Sea-level time machine** (−130 m…+70 m) — a uniform, huge storytelling payoff (blue holes form before your eyes).
3. **Stateless, deterministic world** — no saves, perfect consistency, shareable deep links.
4. **Diel vertical migration** + sonar band — makes the deep feel alive and time-aware.
5. **Real-current marine snow** — the ocean *moves* even when you don't.
6. **Parametric wreck generator** — thousands of true-scale wrecks from a few numbers.
7. **Plausibility Engine with a Realism↔Wonder slider** — fun without lying.
8. **Warp mode with proximity brake + speed-buys-coarse-LOD** — "starship in the ocean" without breaking streaming.
9. **Projection options (Panini/stereographic) for 120° FOV** — comfort and fidelity.
10. **Dives (guided tours) + Field Guide + photo mode** — gives non-explorers a reason to stay.

---

## 19. Suggested next prompts for your coding assistant

1. "Implement §3 + §9 only: f64 floating-origin camera, 3 speed modes with per-mode sliders, live 80–120° horizontal FOV, touch layout, on a flat blue test scene."
2. "Write the Python pipeline in §4.2 for GEBCO → L0–L7 int16 zstd tiles + TID masks, with a manifest and LICENSES.json."
3. "Implement the `features.pack` builder: NOAA wrecks, Wikidata shipwrecks/blue holes, Historic England wrecks, InterRidge vents → unified schema in §7.1 with dedupe and bathymetry snapping."
4. "Implement §8.3–8.4: plausibility engine + stateless cell spawner using a stub species DB of 20 species."
5. "Implement the parametric hull generator in §7.2.1 for five ship types, with decay/sediment shading."

---

## 20. Handoff pack (read this first, coding assistant)

### 20.1 How to work from this document

1. **Code as much as possible in every response. Do not stop early, do not ask permission to continue, and do not wait for feedback between phases.** Work through the phases in order (§16), module by module, and keep writing code until you run out of tokens for that response. Only then stop (see the Continuation Protocol below).
2. **Always output complete, working code.** Never write "...rest unchanged", "(previous code here)", "TODO: implement later" for something that is in scope, or summarise code instead of writing it. If a file is too long, split it into smaller modules and output each in full.

   **Continuation Protocol (mandatory):**
   * Output files in a fixed, numbered order (`[File 1/N] path/name.js`). Keep a short running list of what is finished.
   * Reserve a few hundred tokens at the end of every response. When you are about to run out, **stop cleanly and end with this exact block**, filled in:
     ```
     ⛔ OUT OF TOKENS FOR THIS RESPONSE
     Finished: <files/modules completed in full>
     Stopped at: <file name + function/section you were inside, or "between files">
     Next up: <next 3 files/modules in order>
     Reply "continue" and I will resume exactly here.
     ```
   * When the user replies **"continue"**, resume *exactly* where you stopped. Begin with `▶ CONTINUING <file> from <function/section>`. If you were mid-file, restart from the last **complete function** (so the user can paste it cleanly) and **do not repeat any code that was already finished**. Never restart a phase or re-summarise earlier work.
   * When a phase is done, print a short `✅ PHASE n COMPLETE` marker with 3-5 lines on how to test it in the app (use §20.4), then **immediately start the next phase** in the same response if tokens remain.
   * If the user's message is anything other than "continue", treat it as an instruction or bug report, fix it, then carry on coding from where you were.
3. If something is ambiguous, **follow this document**; if it is silent, use the defaults in §20.2 and list the assumption in a short note at the top of your reply. Don't stop to ask unless something is truly blocking.
4. Keep modules small and named as in §15. Use ES modules, no global state except one `CONFIG` and one `STATE`.
5. Units are always **metres, seconds, degrees** internally; show feet/km only in UI formatting.

### 20.2 Defaults so you don't need to ask

| Topic | Default |
|---|---|
| Renderer | Three.js (latest stable) with WebGPU if available, else WebGL2 |
| FOV | Horizontal 100° (range 80–120°), converted to vertical for the camera |
| Start | Surface Start: +30.48 m, pitched ~8° down, open ocean, noon |
| Speed modes | Crawl 0–5 m/s (default 0.5) · Cruise 1–500 m/s (25) · Warp 0.5 km/s–5,000 km/s (50 km/s) |
| Units | Metric with a feet toggle |
| Time | Real-time clock off; manual time-of-day slider; day/night auto optional |
| Water type | Clear (switchable Coastal/Murky) |
| Quality tier | Auto-detect, user-overridable |
| Random seed | Fixed `WORLD_SEED` constant; same world every launch |
| Hash | Use a deterministic integer hash (e.g. PCG/xxhash-style) for all world gen; **never `Math.random()`** in world generation |
| Data | Phase 0 uses the **Mini Data Pack** (§20.5) |
| Offline | Everything must degrade gracefully when the network is down |

### 20.3 Built-in test & tuning tools (so the user can test in-app)

The user tests everything by hand in the running app, so build these in from Phase 1 (SYSTEM → Tuning/Debug, hidden by default):

* **Live tuning panel:** sliders for every constant that affects feel (ABSORB per channel, Kd, torch lumens/cone/offset, T_DARK, noise floor, backscatter strength, wave steepness, snow density, detail amplitude, LOD bias, speed ranges). Buttons to **Export / Import CONFIG as JSON** and **Reset**.
* **Teleport console:** enter `lat, lon, depth`, or pick a feature/species; set time-of-day and sea level instantly.
* **Overlays (toggle each):** FPS/frame-time graph · tile loads/cache hits · memory · LOD wireframe · TID (surveyed vs predicted) heat · spawn cells · actor bounding boxes with **real-size labels** · 1 m / 10 m grid cubes for **scale checks** · torch cone · light-level (lux) readout.
* **System toggles:** enable/disable terrain detail, actors, snow, caves, wrecks, sonar, audio independently (to isolate bugs/perf).
* **Seed override** and **species spawn forcing** ("spawn a blue whale 100 m ahead").
* **Screenshot + log export** (state snapshot as JSON: position, depth, settings, version) so issues can be reported with exact conditions.

### 20.4 Test scenarios the user will run (acceptance checklist)

| # | Scenario | Expected result |
|---|---|---|
| 1 | Surface Start, look around, dive straight down | Breach transition; red gone by ~15 m; dark blue by 200 m; black by ~300–500 m |
| 2 | Change FOV 80→120 repeatedly while moving | Smooth change, no camera jump; stays within 80–120 |
| 3 | Switch Crawl/Cruise/Warp; set each slider to min/max | Each mode remembers its slider; 0 in Crawl holds still; Warp crosses basins with no jitter |
| 4 | Torch on at 3,000 m, then off | Cone with visible backscatter; colour only near; going off = brief blindness, then near-black |
| 5 | Fly to Titanic / Dean's Blue Hole / a vent field | Correct location & depth; sizes match the scale grid |
| 6 | Hover 10 min in the same place | Same animals in the same cell; nothing spawns out of its depth range |
| 7 | Time slider day→night near ~400 m | Scattering layer rises toward the surface |
| 8 | Sea level −120 m | Shelves emerge; blue holes become dry sinkholes |
| 9 | Toggle Survey view and sonar | Predicted vs surveyed areas look distinct |
| 10 | Airplane mode after first run | Cached areas still load; no crashes |
| 11 | Open every nested menu | Screen returns to near-empty when closed; max 5 persistent elements |
| 12 | Expedition Board → Dive here | Lands at the card's location with its suggested settings applied |

### 20.5 Mini Data Pack (so Phase 1–7 can be tested before the full pipeline)

* **Terrain:** AWS Terrarium tiles for prototyping (coarse in the ocean; replaced by the GEBCO pipeline in Phase 3).
* **`features.mini.json`:** ~30 hand-entered features (the hero wrecks, 5 blue holes, 5 vent fields, 5 reefs, 5 seamounts) using the §7.1 schema.
* **`species.mini.json`:** ~25 species from §8.7 with size/depth ranges and simple hand-set habitat flags (no raster priors yet).
* **`destinations.json`:** the §9B.3 cards.
* The app must load these through the *same* loader the real packs will use, so swapping in the real data later changes no code.

### 20.6 Known gotchas (please avoid)

* Browser canvas decoding is 8-bit: **don't store depth in 16-bit PNGs**; use raw int16 + `DecompressionStream` or Terrarium RGB encoding.
* **Float precision:** keep camera and world positions as doubles on the CPU; render camera-relative only.
* **World-space noise** for terrain detail (not tile-space), or seams and LOD pops will appear.
* Don't let fauna or wreck generation call `Math.random()`; worlds must be reproducible.
* Don't tie field of view to speed beyond the 80–120° limits.
* Don't add ambient fill light below ~300 m "to help"; darkness is the design (§6.4).
* Run decoding and mesh building off the main thread.
* Never render a species outside its depth range or larger than its max length.

### 20.7 Master prompt to paste into Gemini

> You are the lead engineer for "Deep Ocean Explorer", a personal, non-commercial, free-roam deep-ocean exploration app (web first, Android later). The attached Blueprint v2 is the single source of truth. **Write as much working code as you can in every response, and do not stop or ask for permission until you run out of tokens for that response.** Work through the phases (§16) in order, module by module, with **no pauses between phases**. Always output **complete files**, never placeholders or "rest unchanged". Follow the **Continuation Protocol in §20.1** exactly: when you run out of tokens, end with the "⛔ OUT OF TOKENS FOR THIS RESPONSE" block (finished / stopped at / next up), and when I reply "continue", resume exactly where you stopped without repeating finished code. Follow §15 module layout and §20.2 defaults, and state any assumptions in a short note. Use deterministic hashing (no `Math.random()` in world generation), double-precision world coordinates with camera-relative rendering, and world-space noise. Build the debug/tuning tools in §20.3 as you go. Start with **Phase 1** ("Core flight + surface") plus the empty-screen UI skeleton from §9A (L0 immersion, Glance bar, Quick wheel with the six spokes, stubs for sub-items) and the Expedition Board from §9B using `destinations.json`. At the end of each phase, print a short "✅ PHASE n COMPLETE" note with how I can test it in the app, then immediately continue to the next phase.

### 20.8 Pre-flight checklist for you (the user)

* [ ] Decide the starting default (Surface Start is the default).
* [ ] Pick which hero wrecks/destinations you want first (the §9B.3 list is a draft; edit freely).
* [ ] Keep a notes file of "feels wrong" moments (too bright, too fast, too empty) and use the Tuning panel's JSON export to share exact settings back for the next iteration.
* [ ] Verify the ⚠️ figures in §7.2.2, §8.7 and §9B.3 before treating them as final.
