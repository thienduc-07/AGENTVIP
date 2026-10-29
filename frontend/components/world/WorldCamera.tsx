"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useWorldStore } from "@/store/worldStore";

export default function WorldCamera() {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  const cameraPosition = useWorldStore((s) => s.cameraPosition);
  const cameraTarget = useWorldStore((s) => s.cameraTarget);

  const desiredCamPos = useRef(new THREE.Vector3(...cameraPosition));
  const desiredCamTarget = useRef(new THREE.Vector3(...cameraTarget));
  const isTransitioning = useRef(false);

  // When store target changes (e.g. user clicked bookmark or area)
  useEffect(() => {
    desiredCamPos.current.set(...cameraPosition);
    desiredCamTarget.current.set(...cameraTarget);
    isTransitioning.current = true;
  }, [cameraPosition, cameraTarget]);

  useFrame((_, delta) => {
    if (controlsRef.current) {
      if (isTransitioning.current) {
        // Smooth lerp glide toward destination bookmark
        const t = Math.min(1.0, delta * 3.8);
        camera.position.lerp(desiredCamPos.current, t);
        controlsRef.current.target.lerp(desiredCamTarget.current, t);
        controlsRef.current.update();

        const distCam = camera.position.distanceTo(desiredCamPos.current);
        const distTarget = controlsRef.current.target.distanceTo(desiredCamTarget.current);

        if (distCam < 0.15 && distTarget < 0.15) {
          isTransitioning.current = false;
        }
      }

      // Non-negotiable safety locks:
      // 1. Never let camera dip below ocean surface (y >= 2.5)
      if (camera.position.y < 2.5) {
        camera.position.y = 2.5;
      }
      // 2. Keep target above ground level
      if (controlsRef.current.target.y < 0.5) {
        controlsRef.current.target.y = 0.5;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      minDistance={3.5}
      maxDistance={90}
      maxPolarAngle={Math.PI / 2 - 0.08}
      minPolarAngle={0.1}
      onStart={() => {
        // When user manually drags/rotates with mouse, immediately yield OrbitControls
        isTransitioning.current = false;
      }}
    />
  );
}
