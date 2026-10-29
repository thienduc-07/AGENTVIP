// src/config/islandManifest.ts
export interface CharacterPlacement {
  id: string;
  name: string;
  roleTitle: string;
  skillName: string;
  skillVfxColor: string;
  secondaryVfxColor: string;
  modelPath: string;
  position: [number, number]; // [x, z] trên mặt đảo
  rotationY: number;
  targetHeight: number;       // Chiều cao chuẩn hóa (m)
  exclusionRadius: number;    // Bán kính cấm mọc cây/cỏ che khuất
  accentColor: string;
}

export const STRAW_HAT_MANIFEST: CharacterPlacement[] = [
  {
    id: 'luffy',
    name: '1. Monkey D. Luffy (Gear 5)',
    roleTitle: 'Master Orchestrator & Router',
    skillName: 'Gomu Gomu no Bajrang Lightning',
    skillVfxColor: '#ff1a1a',
    secondaryVfxColor: '#111111',
    modelPath: '/models/characters/luffy.glb',
    position: [2, 2],
    rotationY: -0.2,
    targetHeight: 2.35,
    exclusionRadius: 4.5,
    accentColor: '#ffffff'
  },
  {
    id: 'zoro',
    name: '2. Roronoa Zoro',
    roleTitle: 'Systems & Backend Architect',
    skillName: 'Kyutoryu: 103 Mercies Dragon Damnation',
    skillVfxColor: '#00ffaa',
    secondaryVfxColor: '#9933ff',
    modelPath: '/models/characters/zoro.glb',
    position: [6, 11],
    rotationY: -0.35,
    targetHeight: 2.40,
    exclusionRadius: 3.8,
    accentColor: '#00ffaa'
  },
  {
    id: 'nami',
    name: '3. Nami',
    roleTitle: 'Data Science & Strategy',
    skillName: 'Raitei: Zeus Breeze Tempo',
    skillVfxColor: '#ffea00',
    secondaryVfxColor: '#00ccff',
    modelPath: '/models/characters/nami.glb',
    position: [9, 1],
    rotationY: -0.4,
    targetHeight: 2.15,
    exclusionRadius: 3.5,
    accentColor: '#ffd700'
  },
  {
    id: 'usopp',
    name: '4. Usopp',
    roleTitle: 'QA Automation & Security',
    skillName: 'Hissatsu: Firebird Star',
    skillVfxColor: '#ff6600',
    secondaryVfxColor: '#ffcc00',
    modelPath: '/models/characters/usopp.glb',
    position: [5, -10],
    rotationY: 0.1,
    targetHeight: 2.25,
    exclusionRadius: 3.5,
    accentColor: '#ff9900'
  },
  {
    id: 'sanji',
    name: '5. Vinsmoke Sanji',
    roleTitle: 'Frontend & UI/UX Architect',
    skillName: 'Ifrit Jambe: Boeuf Burst',
    skillVfxColor: '#3399ff',
    secondaryVfxColor: '#ffaa00',
    modelPath: '/models/characters/sanji.glb',
    position: [-10, 2],
    rotationY: 0.45,
    targetHeight: 2.35,
    exclusionRadius: 3.8,
    accentColor: '#ffaa00'
  },
  {
    id: 'chopper',
    name: '6. Tony Tony Chopper',
    roleTitle: 'Code Doctor & Debugger',
    skillName: 'Kokutei Cross: Sakura Blizzard',
    skillVfxColor: '#ff80bf',
    secondaryVfxColor: '#ffffff',
    modelPath: '/models/characters/chopper.glb',
    position: [-12.5, -1.0],
    rotationY: 0.5,
    targetHeight: 1.15,
    exclusionRadius: 3.2,
    accentColor: '#ff66b2'
  },
  {
    id: 'robin',
    name: '7. Nico Robin',
    roleTitle: 'Deep Research, RAG & Docs',
    skillName: 'Mil Fleur: Gigantesco Mano',
    skillVfxColor: '#d966ff',
    secondaryVfxColor: '#ff99cc',
    modelPath: '/models/characters/robin.glb',
    position: [19, 0],
    rotationY: -0.6,
    targetHeight: 2.45,
    exclusionRadius: 4.5,
    accentColor: '#d966ff'
  },
  {
    id: 'franky',
    name: '8. Franky',
    roleTitle: 'Full-Stack Builder & DevOps',
    skillName: 'Franky Radical Beam',
    skillVfxColor: '#ffcc00',
    secondaryVfxColor: '#ff3300',
    modelPath: '/models/characters/franky.glb',
    position: [13, -7],
    rotationY: -0.4,
    targetHeight: 3.85,
    exclusionRadius: 5.0,
    accentColor: '#ff3333'
  },
  {
    id: 'brook',
    name: '9. Brook',
    roleTitle: 'Video, Audio & Motion Producer',
    skillName: 'Yahazu Giri: Soul Solid Ice',
    skillVfxColor: '#33ffff',
    secondaryVfxColor: '#99ffff',
    modelPath: '/models/characters/brook.glb',
    position: [-3, 10],
    rotationY: 0.25,
    targetHeight: 3.10,
    exclusionRadius: 3.8,
    accentColor: '#33ffff'
  },
  {
    id: 'jinbe',
    name: '10. Jinbe',
    roleTitle: 'API Gateway & Data Streaming',
    skillName: 'Fish-Man Karate: Kairyu Ipponzeoi',
    skillVfxColor: '#0099ff',
    secondaryVfxColor: '#e6f9ff',
    modelPath: '/models/characters/jinbe.glb',
    position: [-8, 8],
    rotationY: 0.35,
    targetHeight: 3.00,
    exclusionRadius: 4.0,
    accentColor: '#0099ff'
  }
];

export const THOUSAND_SUNNY_CONFIG = {
  modelPath: '/models/ships/thousand-sunny.glb',
  position: [-25.5, 0.0, 22.0] as [number, number, number],
  rotation: [0, Math.PI * 0.28, 0] as [number, number, number],
  targetLength: 16.0
};
