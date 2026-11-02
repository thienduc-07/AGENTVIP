# PROVIPAGENT — Phase 4.1: 3D Scene Report
## Three.js / React Three Fiber Spatial Implementation & PBR Rendering

**Version:** 1.0.0  
**Date:** 2026-11-02  
**Baseline Git Checkpoint:** `2209f67faa875ed0bfe2fd91009a81f17e3652e2`  
**Graphics Pipeline:** Three.js 0.174.0, React Three Fiber 9.0.4, Drei 10.0.4  

---

### 1. Scene Construction & Architectural Geometry

The 3D office environment is designed as an executive high-rise office floor situated atop a futuristic metropolis. Rather than relying on heavy uncompressed GLTF assets that slow load times, the architectural environment is built procedurally with high-fidelity PBR (Physically-Based Rendering) materials, optimized geometries, and instanced mesh structures.

#### 1.1 Architectural Floor (`OfficeFloor.tsx`)
- **Main Office Slab**: Sized at $60\text{m} \times 54\text{m} \times 0.5\text{m}$. Terrazzo composite material with roughness $0.22$, metalness $0.15$, and deep charcoal color `#0b1120`.
- **Perimeter Trims & Baseboards**: Dark anodized aluminum extrusions (`#020617`) defining the boundary of the floorplate.
- **Corridor Pathways & LED Strips**: Recessed central primary axis ($3.2\text{m}$ width) with twin glowing teal floor runner strips (`#06b6d4`, emissive intensity $0.65$) connecting the Executive Suite to the southern engineering and finance wings.
- **Central Corporate Atrium**: Concentric circular inlays at the world origin with brushed brass and copper accents (`#d97706`).

#### 1.2 Glass Curtain Walls & Skyline Backdrop (`OfficeEnvironment.tsx`)
- **Curtain Walls**: Floor-to-ceiling glass enclosure along the east, west, north, and south perimeter ($4.2\text{m}$ height). Material configured with `transmission: 0.92`, `roughness: 0.05`, `metalness: 0.1`, `transparent: true`, `opacity: 0.35`, and a subtle cyan refraction tint (`#0ea5e9`).
- **Structural Mullions**: Vertical and horizontal structural aluminum fins spaced every $3.0\text{m}$ to give depth and realistic architectural proportion.
- **Procedural Metropolis Skyline**: 42 procedural skyscraper towers arranged outside the perimeter windows at distances ranging from $35\text{m}$ to $120\text{m}$. Towers feature varied heights ($15\text{m}$ to $65\text{m}$), dark glass facades, and random illuminated window matrices (emissive amber `#f59e0b` and cool blue `#38bdf8`).

#### 1.3 PBR Lighting Architecture (`OfficeLighting.tsx`)
The lighting rig achieves balanced, photorealistic illumination while strictly bounding real-time shadow computation:
1. **Key Sunlight (`DirectionalLight`)**: Positioned at `(25, 35, 20)` with warm white daylight (`#ffffff`, intensity $1.65$). Configured with `PCFSoftShadowMap`, shadow map size $2048 \times 2048$, shadow camera frustum $[-35, 35, -35, 35]$, and shadow bias $-0.00015$ to eliminate shadow acne.
2. **Sky & Ground Fill (`HemisphereLight`)**: Soft sky blue (`#e0f2fe`) from above and warm floor reflection (`#0f172a`) from below (intensity $0.55$), eliminating harsh pitch-black ambient crevices.
3. **Executive Suite Downlight (`PointLight`)**: Located above the CEO desk at `(0, 4.0, -12)` with warm amber tone (`#fef3c7`, intensity $0.8$, radius $10\text{m}$) for high-prestige executive ambiance.

---

### 2. Department Workstation System (`Workstation.tsx`)

Each workstation represents an authoritative desk allocation directly tied to backend `WorkstationAllocation` and `workstation_id`:

- **Desk Frame & Surface**: Powder-coated steel cantilever legs with natural Scandinavian ash wood desktop ($1.8\text{m} \times 0.9\text{m} \times 0.74\text{m}$).
- **Dual/Triple Display Rig**: Articulated monitor arms supporting dual ultrawide curved screens ($0.75\text{m} \times 0.42\text{m}$ each) tilted $12^\circ$ inward toward the user. Screen materials feature dynamic emissive glow corresponding to the occupant's current behavioral state (e.g. blue for `IN_PROGRESS`, amber for `QUEUED`, emerald for `COMPLETED`).
- **Ergonomic Mesh Chair**: High-back office chair with five-star caster base, pneumatic cylinder, contoured armrests, and mesh backrest.
- **Status Beacon Post**: Compact corner LED post indicating real-time desk occupancy and health.
- **Raycasting Interaction**: Interactive hover state lifts emissive rim highlighting; clicking dispatches `onSelectWorkstation(workstationId)`.

---

### 3. Reusable 3D Humanoid Avatar (`AgentAvatar.tsx`)

The avatar represents an active autonomous agent with realistic humanoid proportions ($1.8\text{m}$ height) and articulated segments:

- **Torso & Limbs**: Proportional chest, hips, articulated arms (biceps, forearms, hands), and legs (thighs, shins, feet) with matte corporate attire materials.
- **Floating Billboard HUD**: Uses Drei's `<Billboard>` to always face the camera regardless of orientation. Renders agent name, department badge, and dynamic state chip in crisp, high-contrast typography.
- **State Beacon Ring**: An oscillating emissive ring hovered above the agent's head ($y = 2.2\text{m}$) with color matching `CANONICAL_STATE_CONFIGS[state].beaconColor`.
- **Dynamic Animation Rig**:
  - `working` / `IN_PROGRESS`: Seated or standing typing posture with alternating rhythmic forearm oscillation ($12\text{Hz}$) and subtle head concentration tilt.
  - `walking` / `ASSIGNED`: Natural walk cycle with reciprocating leg swings and arm counterbalances.
  - `reviewing` / `REVIEW`: Folded arms posture with contemplative slow head nodding.
  - `celebrating` / `COMPLETED`: Victory posture with upward arm motion and pulsed green radiance.
  - `error` / `FAILED`: Distressed posture with pulsing red sparks VFX.
  - `idle` / `IDLE`: Relaxed breathing cycle ($0.4\text{Hz}$ chest dilation).

---

### 4. Interactive Camera Control & Presets (`OfficeCamera.tsx`)

Camera navigation balances intuitive free-form Orbit exploration with instant tactical jumping:

```
Overview Bookmark: [0, 26, 32] -> Target: [0, 0, 4]  (65° High Altitude Tactical)
CEO Suite Bookmark: [0, 7.5, -4] -> Target: [0, 1.2, -12] (Executive Close-up)
Agent Focus: [agent.x + 4.5, agent.y + 2.8, agent.z + 5.5] -> Target: [agent.x, agent.y + 1.0, agent.z]
```

- **Smooth Interpolation**: All transitions use exponential damping (`lerp(current, target, delta * 4.5)`) ensuring silky 60 FPS camera motion without jarring cuts.
- **Boundary Clamping**: Strict polar angle clamping (`maxPolarAngle = π/2 - 0.05`) prevents the camera from ever clipping underneath the floor. Minimum distance is set to $4.0\text{m}$ and maximum to $75.0\text{m}$.

