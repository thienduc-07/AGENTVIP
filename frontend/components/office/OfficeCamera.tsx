"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

interface OfficeCameraProps {
  targetPosition?: [number, number, number];
  targetLookAt?: [number, number, number];
  isTransitioning?: boolean;
}

export default function OfficeCamera({
  targetPosition = [0, 26, 32],
  targetLookAt = [0, 0, 4],
  isTransitioning = false,
}: OfficeCameraProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  const desiredPos = useRef(new THREE.Vector3(...targetPosition));
  const desiredLook = useRef(new THREE.Vector3(...targetLookAt));

  useEffect(() => {
    desiredPos.current.set(...targetPosition);
    desiredLook.current.set(...targetLookAt);
  }, [targetPosition, targetLookAt]);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;

    // Smoothly lerp towards target position and target lookAt
    const lerpSpeed = isTransitioning ? Math.min(1, delta * 3.5) : Math.min(1, delta * 2.5);

    camera.position.lerp(desiredPos.current, lerpSpeed);
    controlsRef.current.target.lerp(desiredLook.current, lerpSpeed);
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={3.5}
      maxDistance={75}
      maxPolarAngle={Math.PI / 2 - 0.06} // Disallow looking from below floor
      minPolarAngle={0.15}
    />
  );
}

