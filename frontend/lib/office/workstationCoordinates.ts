import * as THREE from "three";

export interface WorkstationCoordinateProfile {
  deskPos: [number, number, number];
  deskRotationY: number;
  chairPos: [number, number, number];
  chairRotationY: number;
  sittingAnchor: [number, number, number];
  standingAnchor: [number, number, number];
  keyboardAnchor: [number, number, number];
  monitorAnchor: [number, number, number];
}

/**
 * Computes world-space anchors for a workstation given its root position and yaw rotation.
 * Ensures employees sit strictly ON the ergonomic chair cushion (height 0.44m, offset +0.55m)
 * and never on top of the desk slab.
 */
export function computeWorkstationCoordinates(
  rootX: number,
  rootY: number,
  rootZ: number,
  rotationY: number = 0
): WorkstationCoordinateProfile {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);

  // Transform local offset [lx, lz] by rotationY
  const transform = (lx: number, lz: number): [number, number] => {
    return [rootX + lx * cos + lz * sin, rootZ - lx * sin + lz * cos];
  };

  // Chair cushion is at local offset [0, 0.55] relative to desk center
  const [chairX, chairZ] = transform(0, 0.55);
  // Standing anchor is behind the chair at [0, 0.95]
  const [standX, standZ] = transform(0, 0.95);
  // Keyboard is in front of employee on desk at [0, 0.15]
  const [kbX, kbZ] = transform(0, 0.15);
  // Monitor is at [0, -0.25]
  const [monX, monZ] = transform(0, -0.25);

  return {
    deskPos: [rootX, rootY, rootZ],
    deskRotationY: rotationY,
    chairPos: [chairX, rootY, chairZ],
    chairRotationY: rotationY + Math.PI, // Chair faces desk
    sittingAnchor: [chairX, rootY + 0.44, chairZ], // Pelvis placed directly on chair seat
    standingAnchor: [standX, rootY, standZ],
    keyboardAnchor: [kbX, rootY + 0.75, kbZ],
    monitorAnchor: [monX, rootY + 1.08, monZ],
  };
}

