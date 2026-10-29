// src/utils/terrainPhysics.ts
import { STRAW_HAT_MANIFEST } from '../config/islandManifest';

export function getGroundHeight(x: number, z: number): number {
  const distFromCenter = Math.hypot(x * 0.85, z * 0.95);
  if (distFromCenter > 26) return -1.5;

  let height = Math.max(0, (1 - Math.pow(distFromCenter / 26, 2.2)) * 3.2);

  // 1. Quảng trường Lộ thiên Thần Mặt Trời ở trung tâm (Luffy Gear 5 đứng lộ thiên rộng rãi)
  const distCentral = Math.hypot(x - 2, z - 2);
  if (distCentral < 5.5) {
    height = Math.max(height, 2.2 * Math.exp(-Math.pow(distCentral / 5.0, 2)));
  }

  // 2. Mỏm đá rừng trúc của Zoro
  const distZoro = Math.hypot(x - 6, z - 11);
  if (distZoro < 4.8) {
    height = Math.max(height, 3.6 * Math.exp(-Math.pow(distZoro / 4.0, 2.5)));
  }

  // 3. Đồi Hoa Anh Đào của Chopper (Lush rolling Sakura hill)
  const distChopper = Math.hypot(x + 13, z + 5);
  if (distChopper < 9.5) {
    height += 3.2 * Math.exp(-Math.pow(distChopper / 7.2, 2));
  }

  // 4. Dãy núi đá vôi hùng vĩ phía Bắc (Smooth Karst Peaks with Waterfall Chute - Image 2)
  if (z < -6) {
    const northDepth = Math.min(1, Math.abs(z + 6) / 16);
    // Western mountain peak (behind Chopper):
    const peakWest = 12.5 * Math.exp(-((x + 7.5) ** 2 + (z + 15.5) ** 2) / 48);
    // Eastern mountain peak (behind Franky/Usopp):
    const peakEast = 13.8 * Math.exp(-((x - 8.5) ** 2 + (z + 16.0) ** 2) / 52);
    // Far Northern backbone ridge:
    const peakBack = 11.5 * Math.exp(-((x * 0.55) ** 2 + (z + 21.0) ** 2) / 65);
    // Rolling base mountain gradient:
    const mountainBase = northDepth * 4.6 + Math.cos(x * 0.18) * 1.3 * northDepth;

    // Waterfall notch gorge in the middle (x ~ 0): keeps waterfall plunge clear
    const gorgeFactor = Math.exp(-(x ** 2) / 9.5);
    const mountainTotal = (mountainBase + peakWest + peakEast + peakBack) * (1.0 - gorgeFactor * 0.42);

    height += mountainTotal;
  }

  // 5. Hồ trung tâm dưới chân thác và kênh nước ra biển
  const isCentralLake = Math.hypot(x + 3, z + 3) < 4.8;
  const isWaterChannel = x < -4 && x > -14 && z > 2 && z < 13 && Math.abs(x + z) < 7;
  if (isCentralLake || isWaterChannel) return 0.15;

  return height;
}

export function isInsideCharacterExclusionZone(x: number, z: number, extraMargin = 0): boolean {
  for (const char of STRAW_HAT_MANIFEST) {
    const [cx, cz] = char.position;
    if (Math.hypot(x - cx, z - cz) < char.exclusionRadius + extraMargin) return true;

    // Giữ thông thoáng đường nhìn từ Camera mặc định [0, 28, 44] tới nhân vật
    const camX = 0, camZ = 44;
    const toCamLen = Math.hypot(camX - cx, camZ - cz);
    const t = ((x - cx) * (camX - cx) + (z - cz) * (camZ - cz)) / (toCamLen * toCamLen);
    if (t > 0 && t < 0.35) {
      const projX = cx + t * (camX - cx);
      const projZ = cz + t * (camZ - cz);
      if (Math.hypot(x - projX, z - projZ) < char.exclusionRadius * 0.75) return true;
    }
  }
  return false;
}
