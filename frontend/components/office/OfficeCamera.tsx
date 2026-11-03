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
  targetPosition = [0, 24, 46],
  targetLookAt = [0, 16, 0],
  isTransitioning = false,
}: OfficeCameraProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  // Track currently requested coordinates to prevent re-triggering transitions on React re-renders
  const lastRequestedPos = useRef<[number, number, number]>([...targetPosition]);
  const lastRequestedLook = useRef<[number, number, number]>([...targetLookAt]);

  const desiredPos = useRef(new THREE.Vector3(...targetPosition));
  const desiredLook = useRef(new THREE.Vector3(...targetLookAt));

  // State flags for transitions vs user interaction
  const isTransitionActiveRef = useRef<boolean>(false);
  const isUserDraggingRef = useRef<boolean>(false);

  const isInitialMount = useRef<boolean>(true);

  // Detect genuine target coordinate changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (controlsRef.current) {
        controlsRef.current.target.set(...targetLookAt);
        camera.position.set(...targetPosition);
        controlsRef.current.update();
      }
      lastRequestedPos.current = [...targetPosition];
      lastRequestedLook.current = [...targetLookAt];
      return;
    }

    const posChanged =
      Math.abs(targetPosition[0] - lastRequestedPos.current[0]) > 0.01 ||
      Math.abs(targetPosition[1] - lastRequestedPos.current[1]) > 0.01 ||
      Math.abs(targetPosition[2] - lastRequestedPos.current[2]) > 0.01;

    const lookChanged =
      Math.abs(targetLookAt[0] - lastRequestedLook.current[0]) > 0.01 ||
      Math.abs(targetLookAt[1] - lastRequestedLook.current[1]) > 0.01 ||
      Math.abs(targetLookAt[2] - lastRequestedLook.current[2]) > 0.01;

    if (posChanged || lookChanged) {
      lastRequestedPos.current = [...targetPosition];
      lastRequestedLook.current = [...targetLookAt];
      desiredPos.current.set(...targetPosition);
      desiredLook.current.set(...targetLookAt);
      isTransitionActiveRef.current = true;
    }
  }, [targetPosition, targetLookAt, camera]);

  // Set up OrbitControls event listeners on mount
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    controls.target.set(targetLookAt[0], targetLookAt[1], targetLookAt[2]);
    camera.position.set(targetPosition[0], targetPosition[1], targetPosition[2]);
    controls.update();

    const handleStart = () => {
      // User began interacting (mouse drag, trackpad pan/zoom, touch)
      isUserDraggingRef.current = true;
      // Immediately cancel any in-flight programmatic transition so user has exclusive control
      isTransitionActiveRef.current = false;
    };

    const handleEnd = () => {
      // User released mouse/trackpad - camera stays EXACTLY where user placed it
      isUserDraggingRef.current = false;
      isTransitionActiveRef.current = false;
    };

    controls.addEventListener("start", handleStart);
    controls.addEventListener("end", handleEnd);

    return () => {
      controls.removeEventListener("start", handleStart);
      controls.removeEventListener("end", handleEnd);
    };
  }, []);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;

    // If user is actively dragging or no programmatic transition is active, DO NOT LERP.
    // OrbitControls has full, unhindered authority over camera position and rotation.
    if (isTransitionActiveRef.current && !isUserDraggingRef.current) {
      const lerpSpeed = Math.min(1, delta * 3.5);

      camera.position.lerp(desiredPos.current, lerpSpeed);
      controlsRef.current.target.lerp(desiredLook.current, lerpSpeed);

      // Check arrival threshold: once within 0.06 units, snap and finish transition
      const distToPos = camera.position.distanceTo(desiredPos.current);
      const distToLook = controlsRef.current.target.distanceTo(desiredLook.current);

      if (distToPos < 0.06 && distToLook < 0.06) {
        camera.position.copy(desiredPos.current);
        controlsRef.current.target.copy(desiredLook.current);
        isTransitionActiveRef.current = false; // FINISHED! Never lerp again until next explicit button click!
      }
    }

    // Always update damping for smooth deceleration when user releases drag
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      minDistance={3.5}
      maxDistance={160}
      maxPolarAngle={Math.PI / 2 - 0.04} // Disallow looking from below floor
      minPolarAngle={0.15}
    />
  );
}
