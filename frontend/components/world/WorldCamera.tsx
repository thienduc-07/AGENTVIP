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

  // When store target changes (e.g. user clicked bookmark or department)
  useEffect(() => {
    desiredCamPos.current.set(...cameraPosition);
    desiredCamTarget.current.set(...cameraTarget);
    isTransitioning.current = true;
  }, [cameraPosition, cameraTarget]);

  useFrame((_, delta) => {
    if (controlsRef.current) {
      if (isTransitioning.current) {
        // Smooth lerp glide toward destination department
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

      // Keep camera above office floor level
      if (camera.position.y < 0.8) {
        camera.position.y = 0.8;
      }
      if (controlsRef.current.target.y < 0.2) {
        controlsRef.current.target.y = 0.2;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.8}
      zoomSpeed={1.0}
      panSpeed={0.8}
      minDistance={4}
      maxDistance={50}
      maxPolarAngle={Math.PI / 2 - 0.05}
    />
  );
}
