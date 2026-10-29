"use client";

import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Sparkles, Html } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { WorldAgentStatus } from "@/types";
import { applyAnimeCelShading } from "@/lib/animeCelShading";
import { useWorldStore } from "@/store/worldStore";

export interface AgentCharacterModelProps {
  agentId?: string;
  appearance: string;
  color: string;
  status?: WorldAgentStatus;
  isMoving?: boolean;
}

export const CHARACTER_SPECS: Record<
  string,
  {
    url: string;
    targetHeight: number;
    auraColor: string;
    rotationX?: number;
    name: string;
  }
> = {
  "luffy-gear5": {
    url: "/models/characters/luffy.glb",
    targetHeight: 2.35,
    auraColor: "#ff1a1a",
    name: "Luffy (Gear 5)",
  },
  captain: {
    url: "/models/characters/luffy.glb",
    targetHeight: 2.35,
    auraColor: "#ff1a1a",
    name: "Luffy (Gear 5)",
  },
  zoro: {
    url: "/models/characters/zoro.glb",
    targetHeight: 2.35,
    auraColor: "#00ffaa",
    name: "Zoro",
  },
  nami: {
    url: "/models/characters/nami.glb",
    targetHeight: 2.10,
    auraColor: "#ffea00",
    name: "Nami",
  },
  usopp: {
    url: "/models/characters/usopp.glb",
    targetHeight: 2.20,
    auraColor: "#ff6600",
    name: "Usopp",
  },
  sanji: {
    url: "/models/characters/sanji.glb",
    targetHeight: 2.35,
    auraColor: "#3399ff",
    name: "Sanji",
  },
  chopper: {
    url: "/models/characters/chopper.glb",
    targetHeight: 1.15,
    auraColor: "#ff80bf",
    name: "Chopper",
  },
  robin: {
    url: "/models/characters/robin.glb",
    targetHeight: 2.40,
    auraColor: "#d966ff",
    name: "Robin",
  },
  franky: {
    url: "/models/characters/franky.glb",
    targetHeight: 3.50,
    auraColor: "#ffcc00",
    rotationX: Math.PI / 2, // Rotates Franky +90 deg around X so he stands 100% upright on his feet
    name: "Franky",
  },
  brook: {
    url: "/models/characters/brook.glb",
    targetHeight: 2.95,
    auraColor: "#33ffff",
    name: "Brook",
  },
  jinbe: {
    url: "/models/characters/jinbe.glb",
    targetHeight: 2.85,
    auraColor: "#0099ff",
    name: "Jinbe",
  },
};

/**
 * Procedural Arm & Posture Relaxation Engine
 * Permanently removes the rigid T-pose / horizontal outstretched arm syndrome for:
 * 1. Rigged SkinnedMeshes (Nami with 250 bones, Sanji with 30 clips)
 * 2. Unskinned Static Humanoid Geometries (Luffy, Zoro, Franky, Chopper, Robin, Brook, Jinbe, Usopp)
 * For Zoro: creates wide martial horse-stance (shiko-dachi) and two-handed katana grip in front of abdomen.
 */
function relaxCharacterLimbs(
  container: THREE.Group,
  targetHeight: number,
  appearance?: string
) {
  container.updateMatrixWorld(true);
  const H = targetHeight;

  // 1. Skinned / Rigged Humanoid Models (Nami)
  let hasBones = false;
  container.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) {
      hasBones = true;
      const boneName = obj.name.toLowerCase();

      // Nami arm posing
      if (boneName.includes("arm_left_shoulder_2") || boneName.includes("arm_left_shoulder_1")) {
        obj.rotation.x = -1.18; // ~68 deg downward
        obj.rotation.z = 0.22;  // slight inward tuck
      } else if (boneName.includes("arm_right_shoulder_2") || boneName.includes("arm_right_shoulder_1")) {
        obj.rotation.x = 1.18;  // ~68 deg downward
        obj.rotation.z = -0.22; // slight inward tuck
      } else if (boneName.includes("arm_left_elbow")) {
        obj.rotation.z = 0.35;  // natural forward bend
      } else if (boneName.includes("arm_right_elbow")) {
        obj.rotation.z = -0.35;
      }
    }
  });

  if (hasBones) {
    container.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        (child as THREE.SkinnedMesh).skeleton.update();
      }
    });
  }

  const invMatrix = new THREE.Matrix4();
  const vLocal = new THREE.Vector3();
  const vCanon = new THREE.Vector3();

  // 2. Unskinned Static Mesh Procedural Vertex Relaxation for Humanoid Characters
  let Xs = 0.165 * H;
  let Ys = 0.72 * H;
  let downAngle = 1.18; // ~68 degrees downward

  if (appearance === "franky") {
    Xs = 0.23 * H;
    Ys = 0.74 * H;
    downAngle = 1.12; // ~64 degrees for massive cyborg arms
  } else if (appearance === "jinbe") {
    Xs = 0.24 * H;
    Ys = 0.73 * H;
    downAngle = 1.15;
  } else if (appearance === "chopper") {
    Xs = 0.18 * H;
    Ys = 0.62 * H;
    downAngle = 1.10;
  } else if (appearance === "zoro") {
    Xs = 0.17 * H;
    Ys = 0.72 * H;
    downAngle = 1.05; // natural martial stance with arms angled downwards towards hips/swords
  }

  const elbowDist = 0.17 * H;

  container.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || !mesh.geometry) return;

    const mName = (mesh.name || "").toLowerCase();
    if (mName.includes("aura") || mName.includes("cloud") || mName.includes("eyes")) return;

    const geo = mesh.geometry.clone();
    mesh.geometry = geo;
    const pos = geo.attributes.position;
    if (!pos || pos.count === 0) return;

    mesh.updateMatrixWorld(true);
    invMatrix.copy(mesh.matrixWorld).invert();

    let modified = false;

    for (let i = 0; i < pos.count; i++) {
      vLocal.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      vCanon.copy(vLocal).applyMatrix4(mesh.matrixWorld);

      const x = vCanon.x;
      const y = vCanon.y;
      const z = vCanon.z;

      const side = x >= 0 ? 1 : -1;
      const distX = Math.abs(x) - Xs;

      const isArmHeight = y > 0.38 * H && y < 0.84 * H;
      const isOutsideShoulder = distX > 0.005 * H;
      const isClearOfHips = y >= 0.48 * H || distX > 0.05 * H;

      if (isArmHeight && isOutsideShoulder && isClearOfHips) {
        const dy = y - Ys;
        const armDist = Math.sqrt(distX * distX + dy * dy);

        const blendDist = 0.08 * H;
        const t = Math.min(Math.max(distX / blendDist, 0), 1);
        const wShoulder = t * t * (3 - 2 * t);
        const curDownAngle = downAngle * wShoulder;

        const dx = distX;
        let dxNew = dx * Math.cos(curDownAngle) + dy * Math.sin(curDownAngle);
        let dyNew = -dx * Math.sin(curDownAngle) + dy * Math.cos(curDownAngle);

        let dzNew = 0;
        if (armDist > elbowDist) {
          const elbowT = Math.min(Math.max((armDist - elbowDist) / (0.12 * H), 0), 1);
          const wElbow = elbowT * elbowT * (3 - 2 * elbowT);
          dzNew = 0.065 * H * wElbow;
          dxNew *= (1.0 - 0.12 * wElbow);
          dyNew -= 0.02 * H * wElbow;
        }

        const newCanonX = side * (Xs + dxNew);
        const newCanonY = Ys + dyNew;
        const newCanonZ = z + dzNew;

        vCanon.set(newCanonX, newCanonY, newCanonZ);
        vCanon.applyMatrix4(invMatrix);

        pos.setXYZ(i, vCanon.x, vCanon.y, vCanon.z);
        modified = true;
      }
    }

    if (modified) {
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
    }
  });
}

/**
 * Universal Master Normalizer
 */
export function prepareAndNormalizeCharacter(
  rawScene: THREE.Object3D,
  targetHeight: number,
  rotationX = 0,
  appearance?: string
): THREE.Group {
  const clone = SkeletonUtils.clone(rawScene);
  applyAnimeCelShading(clone);

  clone.rotation.x = rotationX;

  const wrapper = new THREE.Group();
  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(wrapper);
  let size = new THREE.Vector3();
  box.getSize(size);

  if (!isFinite(size.y) || size.y < 0.05) {
    box.makeEmpty();
    wrapper.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
        (child as THREE.Mesh).geometry.computeBoundingBox();
        const geoBox = (child as THREE.Mesh).geometry.boundingBox;
        if (geoBox) {
          box.union(geoBox.clone().applyMatrix4(child.matrixWorld));
        }
      }
    });
    box.getSize(size);
  }

  const safeHeight = Math.max(size.y, 0.001);
  const uniformScale = targetHeight / safeHeight;
  wrapper.scale.setScalar(uniformScale);
  wrapper.updateMatrixWorld(true);

  // Align feet to ground surface (min.y = 0) and center at (0, 0)
  const centerBox = new THREE.Box3().setFromObject(wrapper);
  const center = new THREE.Vector3();
  centerBox.getCenter(center);
  wrapper.position.set(-center.x, -centerBox.min.y, -center.z);

  const container = new THREE.Group();
  container.add(wrapper);
  container.updateMatrixWorld(true);

  // Relax limbs from T-pose to natural anime posture
  relaxCharacterLimbs(container, targetHeight, appearance);

  // Ground alignment after limb deformation
  container.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(container);
  if (finalBox.min.y < -0.01) {
    wrapper.position.y += Math.abs(finalBox.min.y);
    container.updateMatrixWorld(true);
  }

  return container;
}

// ============================================================================
// 3D INTERACTIVE PROPS & AURA VISUAL EFFECTS
// ============================================================================

/**
 * Procedural Curved Flame Wave Ribbon Geometry for Zoro's Dragon Wings
 * Perfectly matches the user's reference image with twin billowing emerald/cyan energy wings
 */
function createCurvedBladeWaveGeometry(isLeft = false) {
  const points: THREE.Vector3[] = [];
  const sign = isLeft ? -1 : 1;
  // Starting at sword center, sweeping down-outward then curving up-outward
  points.push(new THREE.Vector3(sign * 0.05, 1.12, 0.35));
  points.push(new THREE.Vector3(sign * 0.40, 1.04, 0.42));
  points.push(new THREE.Vector3(sign * 0.85, 1.25, 0.32));
  points.push(new THREE.Vector3(sign * 1.25, 1.58, 0.20));
  points.push(new THREE.Vector3(sign * 1.60, 2.02, 0.08));

  const curve = new THREE.CatmullRomCurve3(points);
  const numSegments = 32;
  const spinePoints = curve.getPoints(numSegments);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= numSegments; i++) {
    const p = spinePoints[i];
    const t = i / numSegments;
    const width = Math.sin(t * Math.PI) * 0.40 + 0.06;
    const nx = sign * Math.cos(t * Math.PI * 0.5) * 0.15;
    const ny = 0.88;
    const nz = -0.3;
    const len = Math.hypot(nx, ny, nz) || 1;

    // Top vertex (feathering outward flame edge)
    positions.push(p.x + (nx / len) * width, p.y + (ny / len) * width, p.z + (nz / len) * width);
    uvs.push(t, 1);

    // Bottom vertex (core blade trail)
    positions.push(p.x - (nx / len) * (width * 0.25), p.y - (ny / len) * (width * 0.25), p.z - (nz / len) * (width * 0.25));
    uvs.push(t, 0);

    if (i < numSegments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, curve };
}

/**
 * Zoro's Twin Emerald/Cyan Billowing Dragon Blade Waves (Image Reference)
 */
export function ZoroTwinDragonBladeWaves() {
  const leftGeo = useMemo(() => createCurvedBladeWaveGeometry(true), []);
  const rightGeo = useMemo(() => createCurvedBladeWaveGeometry(false), []);
  const waveGroupRef = useRef<THREE.Group>(null);
  const leftSpineGeo = useMemo(() => new THREE.TubeGeometry(leftGeo.curve, 24, 0.024, 8, false), [leftGeo.curve]);
  const rightSpineGeo = useMemo(() => new THREE.TubeGeometry(rightGeo.curve, 24, 0.024, 8, false), [rightGeo.curve]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (waveGroupRef.current) {
      const flicker = 1.0 + Math.sin(t * 2.5) * 0.02;
      waveGroupRef.current.scale.set(flicker, flicker, 1.0);
      waveGroupRef.current.position.y = Math.sin(t * 3.0) * 0.01;
    }
  });

  return (
    <group ref={waveGroupRef}>
      {/* Left Wing Flame Ribbon */}
      <mesh geometry={leftGeo.geo}>
        <meshBasicMaterial color="#00ffaa" transparent opacity={0.88} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh geometry={leftSpineGeo}>
        <meshBasicMaterial color="#e0f2fe" />
      </mesh>

      {/* Right Wing Flame Ribbon */}
      <mesh geometry={rightGeo.geo}>
        <meshBasicMaterial color="#00ffaa" transparent opacity={0.88} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh geometry={rightSpineGeo}>
        <meshBasicMaterial color="#e0f2fe" />
      </mesh>

      {/* Secondary Cyan Outer Flare for both wings */}
      <group scale={[1.08, 1.08, 1.08]}>
        <mesh geometry={leftGeo.geo}>
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh geometry={rightGeo.geo}>
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>

      {/* Blazing Emerald Green Fire Sparkles & Gentle Steady Point Light */}
      <Sparkles count={35} scale={3.2} size={4.2} speed={1.2} color="#00ffaa" opacity={0.85} />
      <pointLight position={[0, 1.25, 0.35]} color="#00ffaa" intensity={2.2} distance={5} />
    </group>
  );
}

/**
 * Zoro's Drawn Katana held firmly by both hands in front
 */
export function ZoroDrawnKatana() {
  return (
    <group position={[0, 1.12, 0.35]} rotation={[0.15, 0.12, -0.25]}>
      {/* Polished Steel Blade */}
      <mesh position={[0.42, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <boxGeometry args={[0.012, 0.95, 0.038]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.95} roughness={0.1} />
      </mesh>
      {/* Emerald Hamon Blade Edge */}
      <mesh position={[0.42, 0, 0.02]} rotation={[0, 0, -Math.PI / 2]}>
        <boxGeometry args={[0.006, 0.95, 0.008]} />
        <meshBasicMaterial color="#00ffaa" />
      </mesh>
      {/* Golden Tsuba Handguard */}
      <mesh position={[0, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.065, 0.065, 0.015, 12]} />
        <meshStandardMaterial color="#facc15" metalness={0.85} roughness={0.2} />
      </mesh>
      {/* Ray Skin Tsuka Hilt held by both hands */}
      <mesh position={[-0.14, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.022, 0.024, 0.28, 8]} />
        <meshStandardMaterial color="#7e22ce" roughness={0.4} />
      </mesh>
      {/* Golden Pommel */}
      <mesh position={[-0.28, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <sphereGeometry args={[0.024, 8, 8]} />
        <meshStandardMaterial color="#facc15" metalness={0.85} roughness={0.2} />
      </mesh>
    </group>
  );
}

/**
 * Luffy's Authentic Anime Conqueror's Haki Lightning (Haoshoku Haki Infusion - Matching Image 2)
 * Sharp, crackling crimson-red electric lightning streak plunging from Luffy's hand to the basalt rock
 * with glowing red embers and expanding shockwaves (NO thick black pipe, NO flat white disc!).
 */
export function ConquerorsHakiSpear() {
  const shockwaveRef = useRef<THREE.Mesh>(null);
  const shockwaveRef2 = useRef<THREE.Mesh>(null);
  const lightningRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  // Sharp, jagged anime lightning path plunging from hand to ground
  const { mainBoltGeo, coreBoltGeo, branchGeo } = useMemo(() => {
    const mainCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.22, 1.45, 0.18),
      new THREE.Vector3(0.38, 1.15, 0.32),
      new THREE.Vector3(0.19, 0.85, 0.48),
      new THREE.Vector3(0.44, 0.52, 0.68),
      new THREE.Vector3(0.28, 0.22, 0.88),
      new THREE.Vector3(0.42, 0.02, 1.05),
    ]);

    const branchCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.38, 1.15, 0.32),
      new THREE.Vector3(0.62, 0.95, 0.22),
      new THREE.Vector3(0.85, 0.82, 0.15),
    ]);

    const mainGeo = new THREE.TubeGeometry(mainCurve, 28, 0.02, 6, false);
    const coreGeo = new THREE.TubeGeometry(mainCurve, 28, 0.009, 6, false);
    const bGeo = new THREE.TubeGeometry(branchCurve, 16, 0.012, 6, false);

    return { mainBoltGeo: mainGeo, coreBoltGeo: coreGeo, branchGeo: bGeo };
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (shockwaveRef.current) {
      const waveT = (t * 1.6) % 1.0;
      shockwaveRef.current.scale.setScalar(0.3 + waveT * 2.2);
      (shockwaveRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1.0 - waveT));
    }
    if (shockwaveRef2.current) {
      const waveT2 = (t * 1.6 + 0.5) % 1.0;
      shockwaveRef2.current.scale.setScalar(0.3 + waveT2 * 2.2);
      (shockwaveRef2.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.65 * (1.0 - waveT2));
    }
    if (lightningRef.current) {
      // Crackling high-energy jitter
      const jx = Math.sin(t * 22.0) * 0.02;
      const jz = Math.cos(t * 24.0) * 0.02;
      lightningRef.current.position.set(jx, 0, jz);
    }
    if (lightRef.current) {
      lightRef.current.intensity = 3.2 + Math.sin(t * 8.0) * 0.8;
    }
  });

  return (
    <group>
      {/* Crackling Crimson Anime Conqueror's Haki Lightning (Sharp & Thin) */}
      <group ref={lightningRef}>
        {/* Outer Crimson Electric Arc */}
        <mesh geometry={mainBoltGeo}>
          <meshBasicMaterial color="#ef4444" transparent opacity={0.95} />
        </mesh>
        {/* Inner Hot Coral Energy Core */}
        <mesh geometry={coreBoltGeo}>
          <meshBasicMaterial color="#fee2e2" />
        </mesh>
        {/* Branching Lightning Tendril */}
        <mesh geometry={branchGeo}>
          <meshBasicMaterial color="#f87171" transparent opacity={0.85} />
        </mesh>
      </group>

      {/* Expanding Concentric Red Shockwave Rings on Basalt Ground (NO flat white disc) */}
      <mesh ref={shockwaveRef} position={[0.42, 0.05, 1.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.15, 0.65, 28]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={shockwaveRef2} position={[0.42, 0.07, 1.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.25, 0.85, 28]} />
        <meshBasicMaterial color="#b91c1c" transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Scorched Molten Basalt Impact Decal */}
      <mesh position={[0.42, 0.035, 1.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.28, 20]} />
        <meshBasicMaterial color="#7f1d1d" transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Glowing Volcanic Embers (Image 2) */}
      <Sparkles count={24} scale={2.0} size={3.5} speed={1.2} color="#ef4444" opacity={0.85} />
      <pointLight ref={lightRef} position={[0.42, 0.7, 1.05]} color="#ef4444" intensity={3.5} distance={6} />
    </group>
  );
}

/**
 * Authentic Zoro Katanas Bundle from Sketchfab (58a5e0f98e0a4b589fd7747027f6a653)
 * Wado Ichimonji, Sandai Kitetsu, Enma
 */
export function ZoroSketchfabKatanas() {
  const { scene } = useGLTF("/models/weapons/zoro-katanas.glb");
  const katanasGroup = useMemo(() => {
    const clone = scene.clone(true);
    applyAnimeCelShading(clone);
    clone.scale.setScalar(0.48);
    return clone;
  }, [scene]);

  return (
    <group position={[-0.26, 0.95, -0.05]} rotation={[0.42, -0.32, -0.58]}>
      <primitive object={katanasGroup} />
    </group>
  );
}

/**
 * Giant Manga Meat on the Bone Prop for Luffy
 */
export function MangaMeatProp() {
  return (
    <group position={[0.15, 1.35, 0.38]} rotation={[0.3, 0.4, 0.5]}>
      {/* Bone Shaft */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.55, 8]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </mesh>
      {/* Bone Knobs */}
      {[-0.27, 0.27].flatMap((bx) =>
        [-0.035, 0.035].map((bz, bi) => (
          <mesh key={`bone-knob-${bx}-${bz}-${bi}`} position={[bx, 0, bz]}>
            <sphereGeometry args={[0.038, 8, 8]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
        ))
      )}
      {/* Juicy Roast Meat */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 0.32, 16]} />
        <meshStandardMaterial color="#854d0e" roughness={0.65} />
      </mesh>
      {/* Roast Crust */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.142, 0.142, 0.15, 16]} />
        <meshStandardMaterial color="#713f12" roughness={0.7} />
      </mesh>
      <Sparkles count={15} scale={0.8} size={2.5} speed={0.9} color="#fbbf24" opacity={0.8} />
    </group>
  );
}

/**
 * Giant Barbell Training Prop for Zoro
 */
export function GiantBarbellProp() {
  return (
    <group position={[0, 1.15, 0.38]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 1.6, 12]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
      </mesh>
      {[-0.7, 0.7].flatMap((px) =>
        [0, 0.08].map((offset, di) => (
          <mesh key={`weight-${px}-${di}`} position={[px + (px > 0 ? offset : -offset), 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.26 - di * 0.03, 0.26 - di * 0.03, 0.06, 16]} />
            <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.35} />
          </mesh>
        ))
      )}
    </group>
  );
}

/**
 * Franky Shipwright Sledgehammer & Welding Sparks
 */
export function FrankyRepairProp() {
  const sparksRef = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (sparksRef.current) {
      sparksRef.current.intensity = 1.8 + Math.sin(t * 3.0) * 0.4;
    }
  });

  return (
    <group position={[0.5, 1.2, 0.5]} rotation={[0.4, 0.2, -0.6]}>
      <mesh position={[0, -0.3, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.035, 0.85, 8]} />
        <meshStandardMaterial color="#78350f" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.12, 0]} castShadow>
        <boxGeometry args={[0.18, 0.18, 0.36]} />
        <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} />
      </mesh>
      <Sparkles count={30} scale={1.8} size={4.2} speed={2.5} color="#38bdf8" opacity={0.9} />
      <pointLight ref={sparksRef} color="#38bdf8" intensity={3.5} distance={5} />
    </group>
  );
}

/**
 * Chopper Stone Mortar & Pestle Grinding Sakura Medicine
 */
export function ChopperApothecaryProp() {
  return (
    <group position={[0, 0.45, 0.35]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.18, 0.12, 0.16, 16]} />
        <meshStandardMaterial color="#64748b" roughness={0.8} />
      </mesh>
      <mesh position={[0.04, 0.12, 0]} rotation={[0.3, 0, 0.2]} castShadow>
        <cylinderGeometry args={[0.035, 0.04, 0.26, 8]} />
        <meshStandardMaterial color="#92400e" roughness={0.7} />
      </mesh>
      <Sparkles count={25} scale={1.2} size={3.5} speed={1.2} color="#ec4899" opacity={0.9} />
      <pointLight color="#f472b6" intensity={2.0} distance={4} />
    </group>
  );
}

/**
 * Sanji Baratie Frying Pan with Sizzling Meat & Culinary Flames
 */
export function SanjiCookingProp() {
  return (
    <group position={[0.3, 1.1, 0.38]} rotation={[0.2, -0.3, 0.1]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.22, 0.18, 0.06, 16]} />
        <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[-0.26, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.26, 8]} />
        <meshStandardMaterial color="#78350f" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.14, 12]} />
        <meshStandardMaterial color="#b45309" roughness={0.6} />
      </mesh>
      <Sparkles count={20} scale={1.0} size={3.2} speed={1.5} color="#f97316" opacity={0.85} />
      <pointLight color="#f97316" intensity={2.2} distance={4} />
    </group>
  );
}

/**
 * Nami Grand Line Sea Chart & Log Pose Compass
 */
export function NamiCartographyProp() {
  return (
    <group position={[0, 1.1, 0.36]} rotation={[0.4, 0, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.55, 0.38, 0.015]} />
        <meshStandardMaterial color="#fef3c7" roughness={0.7} />
      </mesh>
      <mesh position={[0.16, 0.08, 0.03]} castShadow>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#f59e0b" metalness={0.85} roughness={0.25} />
      </mesh>
    </group>
  );
}

/**
 * Brook Classical Violin with Floating Musical Melodies
 */
export function BrookViolinProp() {
  return (
    <group position={[0.2, 1.45, 0.32]} rotation={[0.4, 0.2, -0.3]}>
      <mesh castShadow>
        <boxGeometry args={[0.16, 0.34, 0.06]} />
        <meshStandardMaterial color="#92400e" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.02, 0.26, 8]} />
        <meshStandardMaterial color="#1e1b4b" roughness={0.3} />
      </mesh>
      <mesh position={[0.1, 0.05, 0.08]} rotation={[0, 0, 0.8]} castShadow>
        <cylinderGeometry args={[0.008, 0.008, 0.55, 6]} />
        <meshStandardMaterial color="#fde047" metalness={0.8} roughness={0.3} />
      </mesh>
      <Sparkles count={25} scale={2.2} size={3.8} speed={1.4} color="#67e8f9" opacity={0.9} />
    </group>
  );
}

/**
 * Jinbe Fishman Karate Water Sphere
 */
export function JinbeKarateProp() {
  const waterRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (waterRef.current) {
      waterRef.current.rotation.y = t * 3.0;
      waterRef.current.scale.setScalar(1.0 + Math.sin(t * 4.0) * 0.15);
    }
  });
  return (
    <group position={[0, 1.35, 0.55]}>
      <mesh ref={waterRef}>
        <sphereGeometry args={[0.26, 16, 16]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.1} transparent opacity={0.85} emissive="#0284c7" emissiveIntensity={0.6} />
      </mesh>
      <Sparkles count={30} scale={2.5} size={4.2} speed={1.8} color="#0099ff" opacity={0.9} />
      <pointLight color="#0284c7" intensity={3.5} distance={6} />
    </group>
  );
}

/**
 * Usopp Kuro Kabuto Slingshot Prop
 */
export function UsoppKabutoProp() {
  return (
    <group position={[0.2, 1.25, 0.4]} rotation={[0.2, 0.3, 0]}>
      <mesh position={[0, -0.2, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.025, 0.65, 8]} />
        <meshStandardMaterial color="#1e293b" roughness={0.4} />
      </mesh>
      {[-0.08, 0.08].map((fx, i) => (
        <mesh key={`fork-${i}`} position={[fx, 0.22, 0]} rotation={[0, 0, fx > 0 ? 0.3 : -0.3]}>
          <cylinderGeometry args={[0.015, 0.015, 0.25, 8]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      ))}
      <Sparkles count={15} scale={1.2} size={3.0} speed={1.2} color="#f97316" opacity={0.8} />
    </group>
  );
}

/**
 * Robin Ancient Poneglyph Study Tome
 */
export function RobinBookProp() {
  return (
    <group position={[0, 1.25, 0.35]} rotation={[0.4, 0, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.32, 0.42, 0.06]} />
        <meshStandardMaterial color="#581c87" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <boxGeometry args={[0.3, 0.4, 0.05]} />
        <meshStandardMaterial color="#fef3c7" roughness={0.8} />
      </mesh>
      <Sparkles count={25} scale={1.5} size={3.2} speed={1.1} color="#d946ef" opacity={0.9} />
    </group>
  );
}

// ============================================================================
// 1. LUFFY (GEAR 5 - SUN GOD NIKA) ANIMATED COMPONENT
// Floating Torus Cloud Ring Deleted per user command; Remade Conqueror's Haki Spear & Eating Routine
// ============================================================================
function LuffyAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity,
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "luffy-gear5");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving || activity === "strolling") {
      // High-speed Gear 5 running bounce
      const runStep = t * 11.0;
      modelRef.current.position.y = Math.abs(Math.sin(runStep)) * 0.12;
      modelRef.current.rotation.x = 0.12; // Forward lean
      modelRef.current.rotation.y = Math.sin(runStep * 0.5) * 0.08;
      modelRef.current.scale.set(1.0, 1.0 + Math.sin(runStep) * 0.05, 1.0);
    } else if (activity === "eating") {
      // Joyful chowing down on giant meat on the bone
      modelRef.current.position.y = Math.abs(Math.sin(t * 8.0)) * 0.05;
      modelRef.current.rotation.x = -0.06 + Math.sin(t * 10.0) * 0.03;
      modelRef.current.rotation.y = Math.sin(t * 4.0) * 0.06;
    } else {
      // Nika Drums of Liberation rhythmic bouncing heartbeat (Squash & Stretch)
      const nikaPulse = Math.sin(t * 5.2);
      const isLaughing = t % 8.0 > 5.2;

      if (isLaughing) {
        modelRef.current.rotation.x = -0.18 + Math.sin(t * 12.0) * 0.04;
        modelRef.current.position.y = 0.08 + Math.abs(Math.sin(t * 8.0)) * 0.08;
        modelRef.current.scale.set(1.05, 0.95, 1.05);
      } else {
        modelRef.current.position.y = Math.abs(nikaPulse) * 0.06;
        modelRef.current.rotation.x = 0;
        modelRef.current.scale.set(
          1 - Math.abs(nikaPulse) * 0.03,
          1 + Math.abs(nikaPulse) * 0.05,
          1 - Math.abs(nikaPulse) * 0.03
        );
      }
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />

      {/* Daily Routine Props */}
      {activity === "eating" ? (
        <MangaMeatProp />
      ) : (
        /* Remade Conqueror's Haki Lightning Spear (No floating torus circle ring) */
        <ConquerorsHakiSpear />
      )}
    </group>
  );
}

// ============================================================================
// 2. RORONOA ZORO (KING OF HELL) ANIMATED COMPONENT
// Wide combat stance, 3 Katanas, Drawn Katana, Twin Billowing Emerald Dragon Blade Waves
// ============================================================================
export function ZoroThreeSwords() {
  return (
    <group position={[-0.32, 1.08, -0.06]} rotation={[0.42, -0.32, -0.58]}>
      {/* 3 Scabbards side-by-side along left hip sash */}
      {[
        { name: "Wado", hiltColor: "#ffffff", sayaColor: "#f8fafc", tsubaColor: "#fbbf24", offsetZ: -0.07, rotY: 0.0 },
        { name: "Kitetsu", hiltColor: "#dc2626", sayaColor: "#1e1b4b", tsubaColor: "#d97706", offsetZ: 0.0, rotY: 0.04 },
        { name: "Enma", hiltColor: "#9333ea", sayaColor: "#581c87", tsubaColor: "#facc15", offsetZ: 0.07, rotY: -0.04 },
      ].map((sword, idx) => (
        <group key={`katana-${idx}`} position={[0, 0, sword.offsetZ]} rotation={[0, sword.rotY, 0]}>
          <mesh position={[0, -0.48, 0]} castShadow>
            <cylinderGeometry args={[0.022, 0.018, 0.98, 8]} />
            <meshStandardMaterial color={sword.sayaColor} roughness={0.35} />
          </mesh>
          <mesh position={[0, -0.98, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.014, 0.06, 8]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.01, 0]}>
            <cylinderGeometry args={[0.026, 0.024, 0.035, 8]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 0.014, 12]} />
            <meshStandardMaterial color={sword.tsubaColor} metalness={0.85} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.18, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.022, 0.28, 8]} />
            <meshStandardMaterial color={sword.hiltColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.33, 0]}>
            <sphereGeometry args={[0.024, 8, 8]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.8} roughness={0.25} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function ZoroAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "sword_kata",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "zoro");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const step = t * 9.0;
      modelRef.current.position.y = Math.abs(Math.sin(step)) * 0.04;
      modelRef.current.rotation.x = 0.08;
      modelRef.current.rotation.z = Math.sin(step) * 0.03;
    } else if (activity === "heavy_weights") {
      // Rythmic barbell lifts
      const lift = Math.sin(t * 3.5);
      modelRef.current.position.y = Math.abs(lift) * 0.03;
      modelRef.current.rotation.x = 0.04 + lift * 0.02;
    } else if (activity === "meditation") {
      // Deep zen breathing
      modelRef.current.position.y = Math.sin(t * 1.5) * 0.01;
      modelRef.current.rotation.x = 0.02;
      modelRef.current.rotation.y = 0;
    } else {
      // King of Hell combat stance: firm low stance with subtle energy pulse
      modelRef.current.position.y = Math.sin(t * 2.2) * 0.012;
      modelRef.current.rotation.x = 0.03;
      modelRef.current.rotation.y = Math.sin(t * 0.8) * 0.03;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />

      {/* Authentic Sketchfab Zoro's 3 Katanas (Wado Ichimonji, Kitetsu, Enma) at hip */}
      <ZoroSketchfabKatanas />

      {/* Routine Specific Props */}
      {activity === "heavy_weights" ? (
        <GiantBarbellProp />
      ) : activity === "meditation" ? null : (
        <>
          {/* Drawn Katana held firmly by both hands in front */}
          <ZoroDrawnKatana />

          {/* Twin Billowing Emerald Dragon Blade Waves (Image Reference) */}
          <ZoroTwinDragonBladeWaves />
        </>
      )}
    </group>
  );
}

// ============================================================================
// 3. FRANKY (IRON PIRATE CYBORG BF-38) ANIMATED COMPONENT
// ============================================================================
function FrankyAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "ship_repair",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);
  const starGlowRef = useRef<THREE.Mesh>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, Math.PI / 2, "franky");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const step = t * 7.5;
      modelRef.current.position.y = Math.abs(Math.sin(step)) * 0.05;
      modelRef.current.rotation.x = 0.05;
    } else if (activity === "super_pose") {
      modelRef.current.position.y = 0.06;
      modelRef.current.rotation.x = -0.08;
      if (starGlowRef.current) {
        starGlowRef.current.visible = true;
        starGlowRef.current.scale.setScalar(1.0 + Math.sin(t * 18.0) * 0.25);
      }
    } else {
      // Shipwright hammer tapping rhythm
      modelRef.current.position.y = Math.sin(t * 3.0) * 0.02;
      modelRef.current.rotation.x = 0.04;
      if (starGlowRef.current) starGlowRef.current.visible = false;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />

      {activity === "ship_repair" && <FrankyRepairProp />}

      {/* Franky "SUUUUPER!!" Forearm Star Energy Blast */}
      <group ref={starGlowRef} position={[0, 3.65, 0.4]} visible={false}>
        <mesh>
          <sphereGeometry args={[0.35, 16, 16]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
        <pointLight color="#38bdf8" intensity={4.5} distance={8} />
        <Html position={[0, 0.6, 0]} center transform distanceFactor={14}>
          <div className="font-extrabold text-2xl text-cyan-300 drop-shadow-[0_0_12px_#38bdf8] select-none pointer-events-none">
            ⭐ SUUUUPER!! ⭐
          </div>
        </Html>
      </group>

      <Sparkles count={25} scale={3.5} size={4.0} speed={1.2} color="#ffcc00" opacity={0.8} />
    </group>
  );
}

// ============================================================================
// 4. SANJI (BLACK LEG) ANIMATED COMPONENT
// ============================================================================
function SanjiAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "cooking",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene, animations } = (useGLTF as any)(spec.url);
  const groupRef = useRef<THREE.Group>(null);

  const { normalizedGroup, mixer, actions } = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    applyAnimeCelShading(clone);

    const wrapper = new THREE.Group();
    wrapper.add(clone);
    wrapper.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(wrapper);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = spec.targetHeight / Math.max(size.y, 0.01);
    wrapper.scale.setScalar(scale);
    wrapper.updateMatrixWorld(true);

    const finalBox = new THREE.Box3().setFromObject(wrapper);
    const center = new THREE.Vector3();
    finalBox.getCenter(center);
    wrapper.position.set(-center.x, -finalBox.min.y, -center.z);

    const mx = new THREE.AnimationMixer(clone);
    const acts: Record<string, THREE.AnimationAction> = {};
    if (animations && animations.length > 0) {
      animations.forEach((clip: THREE.AnimationClip) => {
        acts[clip.name] = mx.clipAction(clip);
      });
    }

    return { normalizedGroup: wrapper, mixer: mx, actions: acts };
  }, [scene, animations, spec]);

  useEffect(() => {
    const isWorking = status === "working";
    const currentActionName = isMoving || isWorking ? "pl_sanji_atta01_run" : "pl_sanji_atta01_idle_a";
    const active = actions[currentActionName] || actions["pl_sanji_atta01_idle_a"];

    if (active) {
      active.reset().fadeIn(0.35).play();
    }

    return () => {
      active?.fadeOut(0.25);
    };
  }, [actions, status, isMoving]);

  useFrame((_, delta) => {
    mixer.update(delta);
  });

  return (
    <group ref={groupRef}>
      <primitive object={normalizedGroup} />

      {/* Daily Routine: Baratie Cooking Frying Pan */}
      {activity === "cooking" ? (
        <SanjiCookingProp />
      ) : (
        /* Ifrit Jambe Blue Plasma Fire on Right Leg */
        <group position={[0.22, 0.28, 0]}>
          <mesh>
            <coneGeometry args={[0.22, 0.7, 8]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          <pointLight color="#38bdf8" intensity={3.5} distance={4} />
        </group>
      )}
    </group>
  );
}

// ============================================================================
// 5. CHOPPER (REINDEER DOCTOR) ANIMATED COMPONENT
// ============================================================================
function ChopperAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "apothecary",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "chopper");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const hop = Math.abs(Math.sin(t * 12.0));
      modelRef.current.position.y = hop * 0.12;
      modelRef.current.rotation.x = 0.1;
      modelRef.current.rotation.z = Math.sin(t * 12.0) * 0.08;
    } else {
      modelRef.current.position.y = Math.sin(t * 2.2) * 0.02;
      modelRef.current.rotation.y = Math.sin(t * 1.0) * 0.08;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />
      {activity === "apothecary" && <ChopperApothecaryProp />}
      <Sparkles count={25} scale={1.8} size={3.5} speed={0.9} color="#f472b6" opacity={0.9} />
    </group>
  );
}

// ============================================================================
// 6. NAMI (WEATHER QUEEN) ANIMATED COMPONENT
// ============================================================================
function NamiAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "cartography",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);
  const zeusCloudRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "nami");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const step = t * 8.5;
      modelRef.current.position.y = Math.abs(Math.sin(step)) * 0.03;
      modelRef.current.rotation.x = 0.06;
    } else {
      modelRef.current.position.y = Math.sin(t * 2.0) * 0.015;
      modelRef.current.rotation.y = Math.sin(t * 0.7) * 0.06;
    }

    if (zeusCloudRef.current) {
      zeusCloudRef.current.position.y = 2.45 + Math.sin(t * 3.0) * 0.12;
      zeusCloudRef.current.rotation.y = t * 0.6;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />

      {activity === "cartography" ? (
        <NamiCartographyProp />
      ) : (
        <group ref={zeusCloudRef} position={[0.4, 2.45, 0.2]}>
          <mesh>
            <sphereGeometry args={[0.24, 12, 12]} />
            <meshStandardMaterial color="#334155" roughness={0.9} />
          </mesh>
          <Sparkles count={25} scale={1.5} size={3.8} speed={1.8} color="#facc15" opacity={0.95} />
          <pointLight color="#facc15" intensity={2.8} distance={5} />
        </group>
      )}
    </group>
  );
}

// ============================================================================
// 7. BROOK (SOUL KING) ANIMATED COMPONENT
// ============================================================================
function BrookAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "violin_concert",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "brook");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const step = t * 8.0;
      modelRef.current.position.y = Math.abs(Math.sin(step)) * 0.05;
    } else {
      modelRef.current.rotation.z = Math.sin(t * 3.2) * 0.05;
      modelRef.current.position.y = Math.abs(Math.sin(t * 3.2)) * 0.03;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />
      <BrookViolinProp />
    </group>
  );
}

// ============================================================================
// 8. NICO ROBIN (DEVIL CHILD) ANIMATED COMPONENT
// ============================================================================
function RobinAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "cien_fleurs",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);
  const petalsRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "robin");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const step = t * 8.5;
      modelRef.current.position.y = Math.abs(Math.sin(step)) * 0.035;
    } else {
      modelRef.current.position.y = Math.sin(t * 1.8) * 0.015;
    }

    if (petalsRef.current) {
      petalsRef.current.rotation.y = t * 0.8;
      petalsRef.current.position.y = 1.3 + Math.sin(t * 2.5) * 0.08;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />

      {activity === "poneglyph_study" ? (
        <RobinBookProp />
      ) : (
        <group ref={petalsRef}>
          {[0, 1, 2, 3, 4, 5].map((idx) => {
            const angle = (idx / 6) * Math.PI * 2;
            return (
              <mesh key={`robin-petal-${idx}`} position={[Math.cos(angle) * 0.7, 0, Math.sin(angle) * 0.7]} rotation={[0.4, angle, 0.2]}>
                <boxGeometry args={[0.08, 0.02, 0.16]} />
                <meshStandardMaterial color="#ec4899" emissive="#d946ef" emissiveIntensity={0.6} />
              </mesh>
            );
          })}
        </group>
      )}

      <Sparkles count={25} scale={2.4} size={3.2} speed={1.1} color="#d946ef" opacity={0.85} />
    </group>
  );
}

// ============================================================================
// 9. JINBE (KNIGHT OF THE SEA) ANIMATED COMPONENT
// ============================================================================
function JinbeAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "karate_kata",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "jinbe");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const step = t * 7.5;
      modelRef.current.position.y = Math.abs(Math.sin(step)) * 0.045;
    } else {
      modelRef.current.position.y = Math.sin(t * 1.5) * 0.018;
      modelRef.current.rotation.y = Math.sin(t * 0.7) * 0.04;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />
      <JinbeKarateProp />
    </group>
  );
}

// ============================================================================
// 10. GOD USOPP (SNIPER KING) ANIMATED COMPONENT
// ============================================================================
function UsoppAnimatedCharacter({
  spec,
  status,
  isMoving,
  activity = "sniper_scout",
}: {
  spec: any;
  status?: WorldAgentStatus;
  isMoving?: boolean;
  activity?: string;
}) {
  const { scene } = (useGLTF as any)(spec.url);
  const modelRef = useRef<THREE.Group>(null);

  const normalizedGroup = useMemo(() => {
    return prepareAndNormalizeCharacter(scene, spec.targetHeight, spec.rotationX || 0, "usopp");
  }, [scene, spec]);

  useFrame((state) => {
    if (!modelRef.current) return;
    const t = state.clock.getElapsedTime();

    if (isMoving) {
      const step = t * 9.5;
      modelRef.current.position.y = Math.abs(Math.sin(step)) * 0.05;
    } else {
      modelRef.current.position.y = Math.sin(t * 2.0) * 0.015;
      modelRef.current.rotation.y = Math.sin(t * 0.8) * 0.18;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={normalizedGroup} />
      <UsoppKabutoProp />
    </group>
  );
}

// ============================================================================
// MAIN AGENT CHARACTER MODEL ROUTER
// Routes each Straw Hat member to their dedicated animated component with live daily activities
// ============================================================================
export default function AgentCharacterModel({
  agentId,
  appearance,
  color,
  status = "idle",
  isMoving = false,
}: AgentCharacterModelProps) {
  const spec = CHARACTER_SPECS[appearance] || CHARACTER_SPECS["luffy-gear5"];
  const activity = useWorldStore((s) => (agentId ? s.agentActivities[agentId] : undefined));

  if (appearance === "luffy-gear5" || appearance === "captain") {
    return <LuffyAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "zoro") {
    return <ZoroAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "franky") {
    return <FrankyAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "sanji") {
    return <SanjiAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "chopper") {
    return <ChopperAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "nami") {
    return <NamiAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "brook") {
    return <BrookAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "robin") {
    return <RobinAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "jinbe") {
    return <JinbeAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }
  if (appearance === "usopp") {
    return <UsoppAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
  }

  return <LuffyAnimatedCharacter spec={spec} status={status} isMoving={isMoving} activity={activity} />;
}

// Preload all 10 Straw Hat character models
useGLTF.preload("/models/characters/luffy.glb");
useGLTF.preload("/models/characters/zoro.glb");
useGLTF.preload("/models/characters/nami.glb");
useGLTF.preload("/models/characters/usopp.glb");
useGLTF.preload("/models/characters/sanji.glb");
useGLTF.preload("/models/characters/chopper.glb");
useGLTF.preload("/models/characters/robin.glb");
useGLTF.preload("/models/characters/franky.glb");
useGLTF.preload("/models/characters/brook.glb");
useGLTF.preload("/models/characters/jinbe.glb");
useGLTF.preload("/models/weapons/zoro-katanas.glb");
