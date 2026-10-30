import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

export class IslandWorld3D {
  constructor(canvas, labelsLayer, content, callbacks) {
    this.canvas = canvas;
    this.labelsLayer = labelsLayer;
    this.content = content;
    this.cb = callbacks || {};

    this.isMobile = window.innerWidth <= 768;
    this.lowQuality = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.timeMode = 'auto'; // 'day' | 'dusk' | 'night' | 'auto' | 'realtime'
    this.dayTime = 9.5; // 0..24 hours (9.5 = 09:30 AM)
    this.themeName = 'morning';

    this.islandsMap = new Map();
    this.clickableMeshes = [];
    this.npcs = [];
    this.animals = [];
    this.shells = [];
    this.clouds = [];
    this.birdFlocks = [];
    this.boats = [];
    this.windmills = [];
    this.ferrisWheels = [];
    this.nightWindows = [];
    this.nightPointLights = [];
    this.glowSprites = [];
    this.labelItems = [];
    this.foamRings = [];

    this.selectedActor = null;
    this.cameraAnim = null;
    this.isCinemaPlaying = false;

    this.fpsFrames = 0;
    this.fpsLastCheck = performance.now();
    this.lowFpsStreak = 0;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointerDownPos = { x: 0, y: 0 };

    this.webglSupported = this.initEngine();
  }

  initEngine() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('nowebgl') === '1') {
        throw new Error('Forced WebGL fallback via query param');
      }

      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: !this.isMobile,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 2));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (err) {
      console.warn('WebGL unavailable, switching to accessible list view:', err);
      return false;
    }

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xeae2d3, 0.0042);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.5,
      500
    );
    this.overviewPos = new THREE.Vector3(0, 52, 86);
    this.overviewTarget = new THREE.Vector3(0, 2, 0);
    this.camera.position.copy(this.overviewPos);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(this.overviewTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = 0.25;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 145;
    this.controls.update();

    this.glowTexture = this.createGlowTexture();

    this.setupLights();
    this.buildSkyAndHorizon();
    this.buildSea();
    this.buildArchipelago();
    this.buildLivingWorld();
    this.buildSkyAndSeaLife();
    this.bindEvents();

    this.updateEnvironment(0, true);
    this.animate();
    return true;
  }

  createGlowTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255, 235, 160, 1)');
    g.addColorStop(0.4, 'rgba(255, 200, 90, 0.55)');
    g.addColorStop(1, 'rgba(255, 180, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  setupLights() {
    this.hemiLight = new THREE.HemisphereLight(0xfff8e7, 0x496b5e, 0.85);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff1d0, 1.55);
    this.dirLight.position.set(45, 68, 38);
    this.dirLight.castShadow = true;
    const mapSize = this.isMobile ? 1024 : 2048;
    this.dirLight.shadow.mapSize.set(mapSize, mapSize);
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 180;
    const d = 68;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    // 中央廣場與重點島嶼夜燈（最多 4 盞 PointLight 避免手機卡頓）
    const lightCoords = [
      [0, 6.5, 0],
      [-26, 5.5, -18],
      [26, 5.5, -18],
      [0, 5.5, 30]
    ];
    lightCoords.forEach(([x, y, z]) => {
      const pl = new THREE.PointLight(0xffb84d, 0, 24, 1.6);
      pl.position.set(x, y, z);
      this.scene.add(pl);
      this.nightPointLights.push(pl);
    });
  }

  buildSkyAndHorizon() {
    // 天空穹頂漸層 Shader
    const skyGeo = new THREE.SphereGeometry(230, 32, 20);
    this.skyUniforms = {
      topColor: { value: new THREE.Color(0x7ec8e3) },
      horizonColor: { value: new THREE.Color(0xf6f0e4) },
      bottomColor: { value: new THREE.Color(0xd5e6e0) }
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 col = mix(horizonColor, topColor, max(pow(max(h, 0.0), 0.65), 0.0));
          col = mix(col, bottomColor, max(pow(max(-h, 0.0), 0.5), 0.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);

    // 太陽與月亮＋光暈
    this.celestialGroup = new THREE.Group();
    const sunGeo = new THREE.SphereGeometry(5.2, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe484 });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    const sunHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffd56b,
        transparent: true,
        blending: THREE.AdditiveBlending
      })
    );
    sunHalo.scale.set(26, 26, 1);
    this.sunMesh.add(sunHalo);
    this.celestialGroup.add(this.sunMesh);

    const moonGeo = new THREE.SphereGeometry(4.0, 16, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xe2f1ff });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    const moonHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0x93c5fd,
        transparent: true,
        blending: THREE.AdditiveBlending
      })
    );
    moonHalo.scale.set(20, 20, 1);
    this.moonMesh.add(moonHalo);
    this.celestialGroup.add(this.moonMesh);
    this.scene.add(this.celestialGroup);

    // 夜晚星空
    const starCount = 420;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.44 + 0.05;
      const r = 195;
      starPos[i * 3] = r * Math.cos(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.sin(phi);
      starPos[i * 3 + 2] = r * Math.cos(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      transparent: true,
      opacity: 0
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.stars);

    // 遠景外海山林剪影（讓畫面有框）
    const horizonGroup = new THREE.Group();
    const peakCount = 32;
    const peakMat = new THREE.MeshLambertMaterial({ color: 0x5c8374, flatShading: true });
    this.horizonMat = peakMat;
    for (let i = 0; i < peakCount; i++) {
      const ang = (i / peakCount) * Math.PI * 2;
      const dist = 152 + (i % 3) * 8;
      const h = 12 + (i % 5) * 4.5;
      const r = 16 + (i % 4) * 4;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), peakMat);
      cone.position.set(Math.cos(ang) * dist, h * 0.42 - 1, Math.sin(ang) * dist);
      cone.rotation.y = i * 0.7;
      horizonGroup.add(cone);
    }
    this.scene.add(horizonGroup);
  }

  buildSea() {
    const segs = this.isMobile ? 40 : 68;
    const seaGeo = new THREE.PlaneGeometry(340, 340, segs, segs);
    seaGeo.rotateX(-Math.PI / 2);

    const pos = seaGeo.attributes.position;
    this.seaBaseY = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      this.seaBaseY[i] = pos.getY(i);
    }

    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x3b969b,
      roughness: 0.35,
      metalness: 0.08,
      flatShading: true
    });
    this.seaMesh = new THREE.Mesh(seaGeo, this.seaMat);
    this.seaMesh.receiveShadow = true;
    this.scene.add(this.seaMesh);
  }

  // 建立不規則海岸線圓柱（沙灘／岩壁／草地三層＋3層以上色階）
  createIrregularCylinder(radiusTop, radiusBottom, height, radialSegments, seed) {
    const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ang = Math.atan2(z, x);
      const noise =
        1 +
        0.11 * Math.sin(ang * 3 + seed) +
        0.07 * Math.cos(ang * 5 - seed * 1.7) +
        0.04 * Math.sin(ang * 7 + seed * 0.5);
      pos.setX(i, x * noise);
      pos.setZ(i, z * noise);
    }
    geo.computeVertexNormals();
    return geo;
  }

  buildArchipelago() {
    // 規劃中央島與 9 座學科島嶼座標（依分類海域排成環狀群島）
    this.islandSpecs = [
      {
        id: 'center-island',
        order: 0,
        name: this.content.centerIsland.name,
        group: '總複習島',
        pos: new THREE.Vector3(0, 0, 0),
        radius: 13.5,
        seed: 1.1,
        landmarkType: 'centerCampus',
        isCenter: true
      }
    ];

    // 9 座島環繞中央島（半徑約 32~38）
    const total = this.content.islands.length;
    this.content.islands.forEach((isl, idx) => {
      const angle = (idx / total) * Math.PI * 2 - Math.PI * 0.5;
      const dist = idx % 2 === 0 ? 33 : 38;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      this.islandSpecs.push({
        id: isl.id,
        order: isl.order,
        name: isl.name,
        group: isl.group,
        pos: new THREE.Vector3(x, 0, z),
        radius: 7.4,
        seed: (idx + 2) * 1.9,
        landmarkType: isl.landmark?.type || 'scrollPavilion',
        isCenter: false,
        data: isl
      });
    });

    this.islandSpecs.forEach((spec, index) => {
      const group = this.buildSingleIsland(spec, index);
      this.scene.add(group);
      this.islandsMap.set(spec.id, { spec, group });

      if (!spec.isCenter) {
        this.buildWoodenBridge(new THREE.Vector3(0, 0, 0), spec.pos, 13.0, spec.radius - 0.3);
      }
    });
  }

  buildSingleIsland(spec, index) {
    const root = new THREE.Group();
    root.position.copy(spec.pos);
    const r = spec.radius;

    // 0. 海岸白色浪花圈
    const foamGeo = this.createIrregularCylinder(r * 1.15, r * 1.17, 0.12, 28, spec.seed);
    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65
    });
    const foam = new THREE.Mesh(foamGeo, foamMat);
    foam.position.y = 0.04;
    root.add(foam);
    this.foamRings.push({ mesh: foam, baseScale: 1, phase: index * 0.8 });

    // 1. 第一層：沙灘層（暖沙色）
    const sandGeo = this.createIrregularCylinder(r * 1.03, r * 1.1, 0.85, 24, spec.seed);
    const sandMat = new THREE.MeshLambertMaterial({ color: 0xeed6a7, flatShading: true });
    const sandMesh = new THREE.Mesh(sandGeo, sandMat);
    sandMesh.position.y = 0.35;
    sandMesh.receiveShadow = true;
    root.add(sandMesh);

    // 2. 第二層：岩壁層（深淺雙色階土石層，底部稍暗假環境光遮蔽）
    const rockDarkGeo = this.createIrregularCylinder(r * 0.96, r * 1.0, 0.9, 24, spec.seed + 0.3);
    const rockDarkMat = new THREE.MeshLambertMaterial({ color: 0x8c7a6b, flatShading: true });
    const rockDark = new THREE.Mesh(rockDarkGeo, rockDarkMat);
    rockDark.position.y = 0.95;
    rockDark.castShadow = true;
    rockDark.receiveShadow = true;
    root.add(rockDark);

    const rockLightGeo = this.createIrregularCylinder(r * 0.93, r * 0.96, 0.85, 24, spec.seed + 0.6);
    const rockLightMat = new THREE.MeshLambertMaterial({ color: 0xa6927f, flatShading: true });
    const rockLight = new THREE.Mesh(rockLightGeo, rockLightMat);
    rockLight.position.y = 1.55;
    rockLight.castShadow = true;
    rockLight.receiveShadow = true;
    root.add(rockLight);

    // 3. 第三層：草地層（分深淺兩層色階草坪）
    const grassColors = [0x5da66b, 0x67b274, 0x559c68, 0x6eb569];
    const grassBaseGeo = this.createIrregularCylinder(r * 0.91, r * 0.93, 0.55, 24, spec.seed + 1.0);
    const grassBaseMat = new THREE.MeshLambertMaterial({
      color: grassColors[index % grassColors.length],
      flatShading: true
    });
    const grassBase = new THREE.Mesh(grassBaseGeo, grassBaseMat);
    grassBase.position.y = 2.1;
    grassBase.receiveShadow = true;
    grassBase.userData = { islandId: spec.id };
    root.add(grassBase);
    this.clickableMeshes.push(grassBase);

    const grassTopGeo = this.createIrregularCylinder(r * 0.82, r * 0.86, 0.24, 20, spec.seed + 1.5);
    const grassTopMat = new THREE.MeshLambertMaterial({
      color: 0x7bc27d,
      flatShading: true
    });
    const grassTop = new THREE.Mesh(grassTopGeo, grassTopMat);
    grassTop.position.y = 2.4;
    grassTop.receiveShadow = true;
    grassTop.userData = { islandId: spec.id };
    root.add(grassTop);
    this.clickableMeshes.push(grassTop);

    const surfaceY = 2.52;

    // 4. 獨特地標建築（每座島完全不同，點了會飛近開面板）
    const landmarkGroup = this.buildLandmark(spec.landmarkType, spec.id);
    landmarkGroup.position.set(0, surfaceY, 0);
    landmarkGroup.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData = { islandId: spec.id };
        this.clickableMeshes.push(child);
      }
    });
    root.add(landmarkGroup);

    // 5. 「精緻」等級細節：石板小路、小房子（窗戶夜晚亮起）、兩種樹形、圍籬或花圃、長椅/木箱/告示牌/水井、邊緣草叢與岩石、碼頭與小船
    this.populateIslandDetails(root, spec, surfaceY, index);

    // 6. 沙灘可撿取的貝殼 🐚（每座島 1 顆，撿了 +1，20 秒重生）
    this.buildBeachShell(root, spec, index);

    // 7. 建立 HTML 浮動標籤
    this.createIslandLabel(spec, surfaceY + (spec.isCenter ? 8.2 : 6.2));

    return root;
  }

  buildLandmark(type, islandId) {
    const g = new THREE.Group();
    const primaryMat = new THREE.MeshLambertMaterial({ color: 0x2f7a6b, flatShading: true });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0xd9792f, flatShading: true });
    const creamMat = new THREE.MeshLambertMaterial({ color: 0xfff7e8, flatShading: true });
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b, flatShading: true });
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b, flatShading: true });

    if (type === 'centerCampus') {
      // 中央大島：1) 好孩子校本鐘樓主館
      const base = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.8, 3.8), creamMat);
      base.position.set(-2.2, 1.4, -1.2);
      g.add(base);

      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.0, 2.0, 4), primaryMat);
      roof.position.set(-2.2, 3.8, -1.2);
      roof.rotation.y = Math.PI * 0.25;
      g.add(roof);

      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.8, 5.4, 1.8), creamMat);
      tower.position.set(-2.2, 2.7, -1.2);
      g.add(tower);

      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.2, 6), accentMat);
      spire.position.set(-2.2, 6.5, -1.2);
      g.add(spire);

      // 2) 使用者額外指定：中央島【男子漢品牌圖書館】（書本拱頂＋彩繪發光窗＋柱廊）
      const libGroup = new THREE.Group();
      libGroup.position.set(3.2, 0, -1.0);
      const libBody = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 3.4), creamMat);
      libBody.position.y = 1.3;
      libGroup.add(libBody);

      // 屋頂上展開的巨型立體書本造型
      const pageLeft = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 3.6), goldMat);
      pageLeft.position.set(-1.0, 2.85, 0);
      pageLeft.rotation.z = 0.25;
      libGroup.add(pageLeft);

      const pageRight = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 3.6), goldMat);
      pageRight.position.set(1.0, 2.85, 0);
      pageRight.rotation.z = -0.25;
      libGroup.add(pageRight);

      // 圖書館四根門柱與夜晚發光彩繪窗
      [-1.5, -0.5, 0.5, 1.5].forEach((px) => {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.4, 8), primaryMat);
        col.position.set(px, 1.2, 1.75);
        libGroup.add(col);
      });

      const winMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
      const libWin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 0.12), winMat);
      libWin.position.set(0, 1.5, 1.72);
      libGroup.add(libWin);
      this.nightWindows.push(winMat);
      g.add(libGroup);

      // 3) 中央市集攤位（3 座彩色遮陽棚攤位）
      [-3.2, 0, 3.2].forEach((mx, idx) => {
        const stall = new THREE.Group();
        stall.position.set(mx, 0, 3.6);
        const counter = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.1), woodMat);
        counter.position.y = 0.45;
        stall.add(counter);
        const awningMat = new THREE.MeshLambertMaterial({
          color: idx === 1 ? 0xd9792f : 0x2f7a6b,
          flatShading: true
        });
        const awning = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.8, 4), awningMat);
        awning.position.y = 1.65;
        awning.rotation.y = Math.PI * 0.25;
        stall.add(awning);
        g.add(stall);
      });

      // 4) 點綴：🎡 彩色摩天輪（慢慢轉動，夜晚發光）
      const ferris = this.buildFerrisWheel(3.2);
      ferris.position.set(-5.8, 0, 2.2);
      ferris.rotation.y = 0.4;
      g.add(ferris);
    } else if (type === 'scrollPavilion') {
      // 1. 國語島：竹簡書卷閣樓＋硃砂毛筆塔
      const scrollBase = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 2.4), creamMat);
      scrollBase.position.y = 1.1;
      g.add(scrollBase);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.6, 4), accentMat);
      roof.position.y = 2.9;
      roof.rotation.y = Math.PI * 0.25;
      g.add(roof);
      const brushShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 3.6, 10), woodMat);
      brushShaft.position.set(1.9, 1.8, 0.6);
      g.add(brushShaft);
      const brushTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 1.2, 10),
        new THREE.MeshLambertMaterial({ color: 0xdc2626, flatShading: true })
      );
      brushTip.position.set(1.9, 4.1, 0.6);
      g.add(brushTip);
    } else if (type === 'clockTowerABC') {
      // 2. 英語島：ABC 雙層鐘塔與地球儀
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.1, 4.2, 2.1), creamMat);
      tower.position.y = 2.1;
      g.add(tower);
      const spire = new THREE.Mesh(
        new THREE.ConeGeometry(1.7, 1.9, 4),
        new THREE.MeshLambertMaterial({ color: 0x0284c7, flatShading: true })
      );
      spire.position.y = 5.1;
      spire.rotation.y = Math.PI * 0.25;
      g.add(spire);
      const globe = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.05, 1),
        new THREE.MeshLambertMaterial({ color: 0x38bdf8, flatShading: true })
      );
      globe.position.set(2.1, 1.6, 0.8);
      g.add(globe);
    } else if (type === 'mathPyramid') {
      // 3. 數學島：幾何金字塔與巨大算盤拱門
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.6, 4), goldMat);
      pyr.position.y = 1.8;
      pyr.rotation.y = Math.PI * 0.25;
      g.add(pyr);
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.4, 1.4),
        new THREE.MeshLambertMaterial({ color: 0x3b82f6, flatShading: true })
      );
      cube.position.set(2.0, 0.9, 1.0);
      cube.rotation.set(0.3, 0.5, 0.2);
      g.add(cube);
    } else if (type === 'ecoDome') {
      // 4. 自然島：透明生態溫室穹頂＋觀星台＋風車
      const dome = new THREE.Mesh(
        new THREE.IcosahedronGeometry(2.4, 1),
        new THREE.MeshLambertMaterial({
          color: 0x86efac,
          transparent: true,
          opacity: 0.82,
          flatShading: true
        })
      );
      dome.position.y = 1.4;
      g.add(dome);
      const wm = this.buildWindmill();
      wm.position.set(2.5, 0, -1.2);
      g.add(wm);
    } else if (type === 'robotTower') {
      // 5. 科技島：積木機器人基地塔＋轉動風車
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.4, 1.8),
        new THREE.MeshLambertMaterial({ color: 0x0891b2, flatShading: true })
      );
      body.position.y = 1.2;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 1.4, 1.5),
        new THREE.MeshLambertMaterial({ color: 0x38bdf8, flatShading: true })
      );
      head.position.y = 3.2;
      g.add(head);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8), goldMat);
      antenna.position.y = 4.3;
      g.add(antenna);
      const wm = this.buildWindmill();
      wm.position.set(-2.3, 0, -1.0);
      g.add(wm);
    } else if (type === 'stadiumTorch') {
      // 6. 體育島：運動場拱門与聖火台
      const pillarL = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 3.2, 10), accentMat);
      pillarL.position.set(-1.5, 1.6, 0);
      const pillarR = pillarL.clone();
      pillarR.position.set(1.5, 1.6, 0);
      const arch = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.65, 0.8), goldMat);
      arch.position.set(0, 3.3, 0);
      g.add(pillarL, pillarR, arch);

      const torchStand = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 1.8, 10), creamMat);
      torchStand.position.set(0, 0.9, 1.5);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 1.3, 8),
        new THREE.MeshBasicMaterial({ color: 0xf97316 })
      );
      flame.position.set(0, 2.3, 1.5);
      g.add(torchStand, flame);
    } else if (type === 'heritageArch') {
      // 7. 社會島：傳統紅磚古蹟牌樓
      const redBrick = new THREE.MeshLambertMaterial({ color: 0xb91c1c, flatShading: true });
      [-1.7, 0, 1.7].forEach((x) => {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 3.2, 10), redBrick);
        col.position.set(x, 1.6, 0);
        g.add(col);
      });
      const roofTop = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.55, 1.4), goldMat);
      roofTop.position.set(0, 3.4, 0);
      g.add(roofTop);
    } else if (type === 'harpStage') {
      // 8. 音樂島：黃金豎琴舞台＋迷你摩天輪
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.6, 16), creamMat);
      stage.position.y = 0.3;
      g.add(stage);
      const harpFrame = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.22, 8, 18, Math.PI * 1.3), goldMat);
      harpFrame.position.set(0, 2.2, 0);
      g.add(harpFrame);
    } else {
      // 9. 美術島：巨型調色盤畫架工坊與彩虹拱門
      const palette = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, 0.3, 16),
        new THREE.MeshLambertMaterial({ color: 0xfde68a, flatShading: true })
      );
      palette.position.set(0, 1.8, 0);
      palette.rotation.x = 0.45;
      g.add(palette);
      const rainbow = new THREE.Mesh(
        new THREE.TorusGeometry(2.4, 0.28, 8, 20, Math.PI),
        new THREE.MeshLambertMaterial({ color: 0xec4899, flatShading: true })
      );
      rainbow.position.set(0, 1.2, -0.8);
      g.add(rainbow);
    }

    return g;
  }

  buildWindmill() {
    const wm = new THREE.Group();
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.95, 3.2, 8),
      new THREE.MeshLambertMaterial({ color: 0xfff7e8, flatShading: true })
    );
    tower.position.y = 1.6;
    wm.add(tower);

    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(0.75, 0.9, 8),
      new THREE.MeshLambertMaterial({ color: 0xd9792f, flatShading: true })
    );
    cap.position.y = 3.55;
    wm.add(cap);

    const rotor = new THREE.Group();
    rotor.position.set(0, 2.7, 0.65);
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0xfef08a, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.4, 0.08), bladeMat);
      b.rotation.z = (i * Math.PI) / 2;
      rotor.add(b);
    }
    wm.add(rotor);
    this.windmills.push(rotor);
    return wm;
  }

  buildFerrisWheel(radius = 3.0) {
    const fw = new THREE.Group();
    const legMat = new THREE.MeshLambertMaterial({ color: 0x2f7a6b, flatShading: true });
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, radius * 1.35, 8), legMat);
    legL.position.set(-0.6, radius * 0.62, 0.4);
    legL.rotation.z = -0.18;
    const legR = legL.clone();
    legR.position.set(0.6, radius * 0.62, 0.4);
    legR.rotation.z = 0.18;
    fw.add(legL, legR);

    const wheel = new THREE.Group();
    wheel.position.set(0, radius * 1.18, 0);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.14, 8, 20),
      new THREE.MeshLambertMaterial({ color: 0xf59e0b, flatShading: true })
    );
    wheel.add(rim);

    const cabinColors = [0xef4444, 0x3b82f6, 0x10b981, 0xa855f7, 0xf97316, 0xec4899];
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const cab = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 8, 8),
        new THREE.MeshLambertMaterial({ color: cabinColors[i], flatShading: true })
      );
      cab.position.set(Math.cos(ang) * radius, Math.sin(ang) * radius, 0);
      wheel.add(cab);
    }
    fw.add(wheel);
    this.ferrisWheels.push(wheel);
    return fw;
  }

  populateIslandDetails(root, spec, surfaceY, index) {
    const r = spec.radius;

    // 1. 石板小路（精緻等級必備）
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xcbd5e1, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.08, 7), stoneMat);
      stone.position.set((i - 2.5) * 0.85, surfaceY + 0.03, r * 0.42);
      root.add(stone);
    }

    // 2. 小房子（每島 1~3 棟，窗戶晚上會亮）
    const houseCount = spec.isCenter ? 3 : 2;
    for (let h = 0; h < houseCount; h++) {
      const ang = (h / houseCount) * Math.PI * 1.2 + 0.5;
      const dist = r * 0.56;
      const house = this.createCozyHouse(index + h);
      house.position.set(Math.cos(ang) * dist, surfaceY, Math.sin(ang) * dist);
      house.rotation.y = -ang + Math.PI * 0.5;
      root.add(house);
    }

    // 3. 至少 3 棵以上兩種樹形（球疊黏土樹 & 圓錐松樹）
    const treeCount = spec.isCenter ? 6 : 4;
    for (let t = 0; t < treeCount; t++) {
      const ang = (t / treeCount) * Math.PI * 2 + 0.25;
      const dist = r * 0.68;
      const tree = t % 2 === 0 ? this.createRoundClayTree() : this.createPineTree();
      tree.position.set(Math.cos(ang) * dist, surfaceY, Math.sin(ang) * dist);
      root.add(tree);
    }

    // 4. 🌷 彩色花田／花圃與木圍籬（精緻等級＋地景點綴）
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x92400e, flatShading: true });
    for (let f = 0; f < 4; f++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), fenceMat);
      post.position.set(-r * 0.45 + f * 0.55, surfaceY + 0.25, -r * 0.48);
      root.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.08), fenceMat);
    rail.position.set(-r * 0.45 + 0.82, surfaceY + 0.36, -r * 0.48);
    root.add(rail);

    const flowerColors = [0xf43f5e, 0xfacc15, 0xa855f7, 0xfb923c, 0x38bdf8];
    const flowerCount = spec.id === 'island-04' || spec.id === 'island-09' || spec.isCenter ? 16 : 8;
    for (let fl = 0; fl < flowerCount; fl++) {
      const fa = (fl / flowerCount) * Math.PI * 2;
      const fd = r * (0.36 + (fl % 3) * 0.12);
      const bloom = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 6, 6),
        new THREE.MeshLambertMaterial({ color: flowerColors[fl % flowerColors.length] })
      );
      bloom.position.set(Math.cos(fa) * fd, surfaceY + 0.14, Math.sin(fa) * fd);
      root.add(bloom);
    }

    // 5. 2 個以上精緻小道具：木長椅、告示牌、木箱、路燈（夜晚亮起）
    const propWood = new THREE.MeshLambertMaterial({ color: 0x78350f, flatShading: true });
    // 長椅
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 0.42), propWood);
    bench.position.set(r * 0.35, surfaceY + 0.14, r * 0.32);
    root.add(bench);
    // 告示牌
    const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), propWood);
    signPost.position.set(-r * 0.32, surfaceY + 0.35, r * 0.42);
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.4, 0.1), propWood);
    signBoard.position.set(-r * 0.32, surfaceY + 0.65, r * 0.42);
    root.add(signPost, signBoard);

    // 路燈（夜晚亮起暖黃光暈）
    const lampPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 1.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x334155 })
    );
    lampPole.position.set(r * 0.48, surfaceY + 0.75, 0);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), bulbMat);
    bulb.position.set(r * 0.48, surfaceY + 1.55, 0);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffcf6b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending
      })
    );
    glow.scale.set(2.2, 2.2, 1);
    bulb.add(glow);
    root.add(lampPole, bulb);
    this.nightWindows.push(bulbMat);
    this.glowSprites.push(glow);

    // 6. 邊緣草叢與小石頭
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8, flatShading: true });
    for (let rk = 0; rk < 5; rk++) {
      const ra = rk * 1.25;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), rockMat);
      rock.position.set(Math.cos(ra) * r * 0.76, surfaceY + 0.1, Math.sin(ra) * r * 0.76);
      root.add(rock);
    }

    // 7. 碼頭與停泊小船
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 2.4), propWood);
    pier.position.set(0, 0.55, r * 1.05);
    root.add(pier);
    const mooredBoat = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.3, 1.35),
      new THREE.MeshLambertMaterial({ color: 0xd9792f, flatShading: true })
    );
    mooredBoat.position.set(0.95, 0.2, r * 1.16);
    root.add(mooredBoat);
  }

  createCozyHouse(seed) {
    const h = new THREE.Group();
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xfffbeb, flatShading: true });
    const roofColors = [0xd9792f, 0x2f7a6b, 0xe11d48, 0x2563eb];
    const roofMat = new THREE.MeshLambertMaterial({
      color: roofColors[seed % roofColors.length],
      flatShading: true
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.1, 1.25), wallMat);
    body.position.y = 0.55;
    body.castShadow = true;
    body.receiveShadow = true;
    h.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.18, 0.85, 4), roofMat);
    roof.position.y = 1.5;
    roof.rotation.y = Math.PI * 0.25;
    roof.castShadow = true;
    h.add(roof);

    // 窗戶（夜晚變暖黃色）
    const winMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.08), winMat);
    win.position.set(0, 0.62, 0.63);
    h.add(win);
    this.nightWindows.push(winMat);
    return h;
  }

  createRoundClayTree() {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 0.9, 6),
      new THREE.MeshLambertMaterial({ color: 0x78350f, flatShading: true })
    );
    trunk.position.y = 0.45;
    trunk.castShadow = true;
    t.add(trunk);

    const crownMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57, flatShading: true });
    const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), crownMat);
    c1.position.set(0, 1.15, 0);
    c1.castShadow = true;
    const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), crownMat);
    c2.position.set(0.32, 1.38, 0.18);
    t.add(c1, c2);
    return t;
  }

  createPineTree() {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.15, 0.8, 6),
      new THREE.MeshLambertMaterial({ color: 0x78350f, flatShading: true })
    );
    trunk.position.y = 0.4;
    t.add(trunk);

    const leafMat = new THREE.MeshLambertMaterial({ color: 0x1f6f50, flatShading: true });
    const l1 = new THREE.Mesh(new THREE.ConeGeometry(0.68, 1.1, 7), leafMat);
    l1.position.y = 1.05;
    l1.castShadow = true;
    const l2 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.95, 7), leafMat);
    l2.position.y = 1.6;
    l2.castShadow = true;
    t.add(l1, l2);
    return t;
  }

  buildWoodenBridge(p1, p2, startOffset, endOffset) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const totalLen = dir.length();
    dir.normalize();
    const start = p1.clone().addScaledVector(dir, startOffset);
    const end = p2.clone().addScaledVector(dir, -endOffset);
    const bridgeLen = start.distanceTo(end);
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

    const bridgeGroup = new THREE.Group();
    bridgeGroup.position.set(mid.x, 1.65, mid.z);
    bridgeGroup.lookAt(end.x, 1.65, end.z);

    const woodMat = new THREE.MeshLambertMaterial({ color: 0x9a6334, flatShading: true });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.14, bridgeLen), woodMat);
    deck.receiveShadow = true;
    bridgeGroup.add(deck);
    this.scene.add(bridgeGroup);
  }

  buildBeachShell(root, spec, index) {
    const ang = index * 0.9 + 0.8;
    const r = spec.radius * 0.98;
    const shellGeo = new THREE.OctahedronGeometry(0.42, 1);
    const shellMat = new THREE.MeshLambertMaterial({ color: 0xf472b6, flatShading: true });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.set(Math.cos(ang) * r, 0.92, Math.sin(ang) * r);
    shell.userData = {
      type: 'shell',
      islandId: spec.id,
      active: true
    };
    root.add(shell);
    this.clickableMeshes.push(shell);
    this.shells.push({ mesh: shell, respawnAt: 0 });
  }

  // 建立 26 位原創 Q 版居民（島民、送貨員、商人）＋ 9 隻動物（松鼠、小狗、貓咪）
  buildLivingWorld() {
    const clothPalette = [0x2563eb, 0xd9792f, 0x16a34a, 0x9333ea, 0xe11d48, 0x0891b2];
    const hatPalette = [0xfacc15, 0xf97316, 0x14b8a6, 0xec4899, 0x6366f1];

    this.content.residents.forEach((res, idx) => {
      const islEntry = this.islandsMap.get(res.islandId) || this.islandsMap.get('center-island');
      const spec = islEntry.spec;
      const charGroup = this.createHumanoidMesh(
        clothPalette[idx % clothPalette.length],
        hatPalette[idx % hatPalette.length],
        res.type === 'courier'
      );

      const angle = (idx * 1.7) % (Math.PI * 2);
      const walkRadius = spec.isCenter ? 6.2 : 3.6;
      const basePos = spec.pos.clone();
      charGroup.position.set(
        basePos.x + Math.cos(angle) * walkRadius,
        2.52,
        basePos.z + Math.sin(angle) * walkRadius
      );

      charGroup.traverse((c) => {
        if (c.isMesh) {
          c.userData = { type: 'npc', actorId: res.id };
          this.clickableMeshes.push(c);
        }
      });

      this.scene.add(charGroup);

      // 送貨員目標島嶼設定
      const targetSpecs = this.islandSpecs.filter((s) => !s.isCenter);
      const targetSpec = targetSpecs[idx % targetSpecs.length];

      this.npcs.push({
        id: res.id,
        data: res,
        group: charGroup,
        roleType: res.type,
        homeCenter: basePos,
        walkRadius,
        angle,
        speed: 0.55 + (idx % 3) * 0.12,
        state: 'walk',
        pauseTimer: 0,
        lineIndex: 0,
        courierProgress: (idx * 0.22) % 1,
        courierDir: 1,
        courierTarget: targetSpec ? targetSpec.pos.clone() : new THREE.Vector3(28, 0, 0)
      });
    });

    // 建立松鼠、小狗、貓咪
    this.content.animals.forEach((ani, idx) => {
      const islEntry = this.islandsMap.get(ani.islandId) || this.islandsMap.get('center-island');
      const spec = islEntry.spec;
      const meshGroup = this.createAnimalMesh(ani.species);
      const ang = idx * 1.3 + 2.1;
      const rad = spec.isCenter ? 5.2 : 3.1;
      meshGroup.position.set(
        spec.pos.x + Math.cos(ang) * rad,
        2.52,
        spec.pos.z + Math.sin(ang) * rad
      );
      meshGroup.traverse((c) => {
        if (c.isMesh) {
          c.userData = { type: 'animal', actorId: ani.id };
          this.clickableMeshes.push(c);
        }
      });
      this.scene.add(meshGroup);
      this.animals.push({
        id: ani.id,
        data: ani,
        group: meshGroup,
        homeCenter: spec.pos.clone(),
        walkRadius: rad,
        angle: ang,
        speed: 0.7,
        lineIndex: 0,
        jumpOffset: 0
      });
    });
  }

  createHumanoidMesh(clothColor, hatColor, hasCargoBox) {
    const g = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xf6c69d, flatShading: true });
    const bodyMat = new THREE.MeshLambertMaterial({ color: clothColor, flatShading: true });
    const hatMat = new THREE.MeshLambertMaterial({ color: hatColor, flatShading: true });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1e293b, flatShading: true });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.62, 8), bodyMat);
    body.position.y = 0.56;
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), skinMat);
    head.position.y = 1.08;
    head.castShadow = true;
    g.add(head);

    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.28, 8), hatMat);
    hat.position.y = 1.34;
    g.add(hat);

    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.12), darkMat);
    legL.position.set(-0.1, 0.16, 0);
    const legR = legL.clone();
    legR.position.set(0.1, 0.16, 0);
    g.add(legL, legR);

    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.1), bodyMat);
    armL.position.set(-0.32, 0.6, 0);
    const armR = armL.clone();
    armR.position.set(0.32, 0.6, 0);
    g.add(armL, armR);

    let cargoBox = null;
    if (hasCargoBox) {
      cargoBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.32, 0.36),
        new THREE.MeshLambertMaterial({ color: 0xd97706, flatShading: true })
      );
      cargoBox.position.set(0, 0.68, 0.34);
      g.add(cargoBox);
    }

    g.userData.limbs = { legL, legR, armL, armR, cargoBox };
    return g;
  }

  createAnimalMesh(species) {
    const g = new THREE.Group();
    const colorMap = {
      squirrel: 0xc26a2d,
      dog: 0xeab308,
      cat: 0xf97316
    };
    const mat = new THREE.MeshLambertMaterial({
      color: colorMap[species] || 0xc26a2d,
      flatShading: true
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.48), mat);
    body.position.y = 0.22;
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), mat);
    head.position.set(0, 0.38, 0.24);
    g.add(head);

    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 5), mat);
    earL.position.set(-0.1, 0.54, 0.24);
    const earR = earL.clone();
    earR.position.set(0.1, 0.54, 0.24);
    g.add(earL, earR);

    const tail = new THREE.Mesh(
      new THREE.SphereGeometry(species === 'squirrel' ? 0.22 : 0.11, 7, 7),
      mat
    );
    tail.position.set(0, 0.32, -0.28);
    g.add(tail);
    return g;
  }

  buildSkyAndSeaLife() {
    // 1. 10 朵低多邊形球雲（繞外圈飄，絕不擋住鏡頭）
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.cloudMat = cloudMat;
    for (let i = 0; i < 10; i++) {
      const cg = new THREE.Group();
      for (let b = 0; b < 4; b++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 - b * 0.25, 1), cloudMat);
        puff.position.set((b - 1.5) * 1.9, (b % 2) * 0.5, 0);
        cg.add(puff);
      }
      const ang = (i / 10) * Math.PI * 2;
      const dist = 96 + (i % 3) * 12;
      const y = 30 + (i % 4) * 3;
      cg.position.set(Math.cos(ang) * dist, y, Math.sin(ang) * dist);
      this.scene.add(cg);
      this.clouds.push({ group: cg, angle: ang, dist, y, speed: 0.018 + (i % 3) * 0.004 });
    }

    // 2. 3 群 V 字隊形飛鳥（白天飛行，夜晚隱藏）
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x334155, side: THREE.DoubleSide });
    for (let f = 0; f < 3; f++) {
      const flock = new THREE.Group();
      for (let b = 0; b < 5; b++) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 3), birdMat);
        wing.rotation.x = Math.PI * 0.5;
        const row = Math.ceil(b / 2);
        const side = b % 2 === 1 ? 1 : -1;
        wing.position.set(b === 0 ? 0 : side * row * 0.95, 0, row * 0.95);
        flock.add(wing);
      }
      const ang = f * 2.1;
      flock.position.set(Math.cos(ang) * 48, 22 + f * 3, Math.sin(ang) * 48);
      this.scene.add(flock);
      this.birdFlocks.push({ group: flock, angle: ang, radius: 46 + f * 8, y: 21 + f * 3 });
    }

    // 3. 2 艘外海航行帆船
    for (let s = 0; s < 2; s++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.65, 3.2),
        new THREE.MeshLambertMaterial({ color: 0x9a3412, flatShading: true })
      );
      hull.position.y = 0.3;
      boat.add(hull);
      const sail = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 2.8, 3),
        new THREE.MeshLambertMaterial({ color: 0xfffbeb, flatShading: true })
      );
      sail.position.y = 2.0;
       boat.add(sail);
      const ang = s * Math.PI;
      boat.position.set(Math.cos(ang) * 58, 0.1, Math.sin(ang) * 58);
      this.scene.add(boat);
      this.boats.push({ group: boat, angle: ang, radius: 58 + s * 6 });
    }

    // 4. 夜晚螢火蟲粒子（夜晚浮現在各島草地上）
    const ffCount = 60;
    const ffPos = new Float32Array(ffCount * 3);
    for (let i = 0; i < ffCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 44;
      ffPos[i * 3] = Math.cos(a) * d;
      ffPos[i * 3 + 1] = 3.2 + Math.random() * 3.5;
      ffPos[i * 3 + 2] = Math.sin(a) * d;
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      color: 0xbef264,
      size: 0.75,
      transparent: true,
      opacity: 0
    });
    this.fireflies = new THREE.Points(ffGeo, this.fireflyMat);
    this.scene.add(this.fireflies);
  }

  createIslandLabel(spec, offsetY) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `island-label${spec.isCenter ? ' center-label' : ''}`;
    btn.dataset.islandId = spec.id;
    const badgeText = spec.isCenter ? '★ 中央島' : `#${spec.order}`;
    btn.innerHTML = `<span class="order-pill">${badgeText}</span><span class="label-title">${spec.name}</span><span class="done-dot" hidden>✓</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.focusIsland(spec.id, true);
    });
    this.labelsLayer.appendChild(btn);
    this.labelItems.push({
      id: spec.id,
      el: btn,
      worldPos: new THREE.Vector3(spec.pos.x, offsetY, spec.pos.z)
    });
  }

  markVisitedLabels(visitedSet) {
    this.labelItems.forEach((item) => {
      const dot = item.el.querySelector('.done-dot');
      if (dot) {
        dot.hidden = !visitedSet.has(item.id);
      }
    });
  }

  // 電影史詩開場運鏡（4.5秒，手機縮短 30%，隨時可點畫面或按 Esc 跳過）
  playEpicCinemaIntro(onFinish) {
    if (!this.webglSupported || this.reducedMotion) {
      this.resetToOverview(true);
      if (onFinish) onFinish();
      return;
    }
    this.isCinemaPlaying = true;
    this.controls.enabled = false;
    const duration = this.isMobile ? 3.1 : 4.5;
    this.cameraAnim = {
      type: 'epicIntro',
      elapsed: 0,
      duration,
      onFinish: () => {
        this.isCinemaPlaying = false;
        this.controls.enabled = true;
        this.camera.position.copy(this.overviewPos);
        this.controls.target.copy(this.overviewTarget);
        this.controls.update();
        if (onFinish) onFinish();
      }
    };
  }

  skipCinemaIntro() {
    if (this.cameraAnim && this.cameraAnim.type === 'epicIntro') {
      const cb = this.cameraAnim.onFinish;
      this.cameraAnim = null;
      if (cb) cb();
    }
  }

  // 點島運鏡：先拉高、沿弧線繞到島的正面再推近（1.8秒，手機縮短 30%）
  focusIsland(islandId, openPanelAfter = true) {
    const entry = this.islandsMap.get(islandId);
    if (!entry) return;

    this.closeActorBubble();

    const targetIslandPos = entry.spec.pos.clone();
    const offsetDist = entry.spec.isCenter ? 24 : 16.5;
    const offsetHeight = entry.spec.isCenter ? 14 : 9.8;
    const outDir = targetIslandPos.length() > 1
      ? targetIslandPos.clone().normalize()
      : new THREE.Vector3(0, 0, 1);

    const endCamPos = targetIslandPos
      .clone()
      .addScaledVector(outDir, offsetDist)
      .add(new THREE.Vector3(0, offsetHeight, 0));
    const endTarget = targetIslandPos.clone().add(new THREE.Vector3(0, 2.5, 0));

    if (!this.webglSupported || this.reducedMotion) {
      if (this.webglSupported) {
        this.camera.position.copy(endCamPos);
        this.controls.target.copy(endTarget);
        this.controls.update();
      }
      if (openPanelAfter && this.cb.onSelectIsland) {
        this.cb.onSelectIsland(islandId);
      }
      return;
    }

    const startCamPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    // 中途拉高弧線控制點
    const midCamPos = startCamPos
      .clone()
      .lerp(endCamPos, 0.5)
      .add(new THREE.Vector3(8, 14, 0));

    this.controls.enabled = false;
    const duration = this.isMobile ? 1.25 : 1.75;
    this.cameraAnim = {
      type: 'flyToIsland',
      elapsed: 0,
      duration,
      startCamPos,
      midCamPos,
      endCamPos,
      startTarget,
      endTarget,
      onFinish: () => {
        this.controls.enabled = true;
        this.controls.target.copy(endTarget);
        this.controls.update();
        if (openPanelAfter && this.cb.onSelectIsland) {
          this.cb.onSelectIsland(islandId);
        }
      }
    };
  }

  resetToOverview(immediate = false) {
    this.closeActorBubble();
    if (!this.webglSupported) return;
    if (immediate || this.reducedMotion) {
      this.cameraAnim = null;
      this.controls.enabled = true;
      this.camera.position.copy(this.overviewPos);
      this.controls.target.copy(this.overviewTarget);
      this.controls.update();
      return;
    }
    const startCamPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const midCamPos = startCamPos.clone().lerp(this.overviewPos, 0.5).add(new THREE.Vector3(0, 10, 0));
    this.controls.enabled = false;
    this.cameraAnim = {
      type: 'flyToIsland',
      elapsed: 0,
      duration: 1.1,
      startCamPos,
      midCamPos,
      endCamPos: this.overviewPos.clone(),
      startTarget,
      endTarget: this.overviewTarget.clone(),
      onFinish: () => {
        this.controls.enabled = true;
        this.controls.target.copy(this.overviewTarget);
        this.controls.update();
      }
    };
  }

  setQuality(low) {
    this.lowQuality = low;
    if (!this.webglSupported) return;
    this.renderer.shadowMap.enabled = !low;
    this.dirLight.castShadow = !low;
    // 低畫質時居民與動物減半顯示
    this.npcs.forEach((npc, idx) => {
      npc.group.visible = low ? idx % 2 === 0 : true;
    });
    this.animals.forEach((ani, idx) => {
      ani.group.visible = low ? idx % 3 === 0 : true;
    });
    if (this.cb.onQualityChange) this.cb.onQualityChange(low);
  }

  setReducedMotion(val) {
    this.reducedMotion = val;
    if (val) {
      this.skipCinemaIntro();
    }
  }

  setTimeMode(mode) {
    this.timeMode = mode;
    if (mode === 'day') this.dayTime = 10.0;
    else if (mode === 'dusk') this.dayTime = 17.5;
    else if (mode === 'night') this.dayTime = 22.0;
    else if (mode === 'realtime') {
      const now = new Date();
      this.dayTime = now.getHours() + now.getMinutes() / 60;
    }
    this.updateEnvironment(0, true);
  }

  setThemeVisual(themeName) {
    this.themeName = themeName;
    this.updateEnvironment(0, true);
  }

  getPeriodFromHour(h) {
    if (h >= 6 && h < 16.5) return 'day';
    if ((h >= 16.5 && h < 19.2) || (h >= 5 && h < 6)) return 'dusk';
    return 'night';
  }

  updateEnvironment(dt, force = false) {
    if (!this.webglSupported) return;
    if (this.timeMode === 'auto' && !this.reducedMotion) {
      // 約 150 秒走完 24 小時
      this.dayTime = (this.dayTime + dt * (24 / 150)) % 24;
    } else if (this.timeMode === 'realtime') {
      const now = new Date();
      this.dayTime = now.getHours() + now.getMinutes() / 60;
    }

    const period = this.getPeriodFromHour(this.dayTime);
    const isNight = period === 'night';

    // 計算太陽與月亮仰角
    const sunAngle = ((this.dayTime - 6) / 12) * Math.PI;
    const sunX = Math.cos(sunAngle) * 145;
    const sunY = Math.sin(sunAngle) * 125;
    this.sunMesh.position.set(sunX, sunY, -75);
    this.sunMesh.visible = sunY > -12;

    this.moonMesh.position.set(-sunX, -sunY, -75);
    this.moonMesh.visible = -sunY > -12;

    this.dirLight.position.set(
      Math.cos(sunAngle) * 58,
      Math.max(18, Math.abs(Math.sin(sunAngle)) * 68),
      36
    );

    // 根據時段與主題平滑過渡天色、海色、霧色
    const targetSkyTop = new THREE.Color();
    const targetHorizon = new THREE.Color();
    const targetSea = new THREE.Color();
    const targetLight = new THREE.Color();

    if (period === 'day') {
      targetSkyTop.setHex(this.themeName === 'mist' ? 0x6db3c4 : 0x62b6cb);
      targetHorizon.setHex(this.themeName === 'mist' ? 0xdcebee : 0xf6f0e4);
      targetSea.setHex(0x32939c);
      targetLight.setHex(0xfff4d6);
      this.dirLight.intensity = 1.55;
      this.hemiLight.intensity = 0.88;
    } else if (period === 'dusk') {
      targetSkyTop.setHex(0x4a5d80);
      targetHorizon.setHex(0xf2a679);
      targetSea.setHex(0x2d6e7e);
      targetLight.setHex(0xff9e5e);
      this.dirLight.intensity = 1.15;
      this.hemiLight.intensity = 0.65;
    } else {
      targetSkyTop.setHex(0x0b1522);
      targetHorizon.setHex(0x16222e);
      targetSea.setHex(0x14384a);
      targetLight.setHex(0x7aa2f7);
      this.dirLight.intensity = 0.52;
      this.hemiLight.intensity = 0.42;
    }

    const lerpRate = force || this.reducedMotion ? 1.0 : Math.min(1, dt * 2.2);
    this.skyUniforms.topColor.value.lerp(targetSkyTop, lerpRate);
    this.skyUniforms.horizonColor.value.lerp(targetHorizon, lerpRate);
    this.seaMat.color.lerp(targetSea, lerpRate);
    this.dirLight.color.lerp(targetLight, lerpRate);
    this.scene.fog.color.lerp(targetHorizon, lerpRate);

    // 夜晚路燈、窗戶、星星、螢火蟲與飛鳥切換
    this.starMat.opacity = isNight ? 0.92 : 0.0;
    this.fireflyMat.opacity = isNight ? 0.9 : 0.0;
    this.birdFlocks.forEach((f) => {
      f.group.visible = !isNight;
    });

    const winHex = isNight ? 0xffd166 : 0x475569;
    this.nightWindows.forEach((m) => m.color.setHex(winHex));
    this.glowSprites.forEach((s) => {
      s.material.opacity = isNight ? 0.85 : 0.0;
    });
    this.nightPointLights.forEach((pl) => {
      pl.intensity = isNight ? 2.2 : 0.0;
    });

    if (this.cb.onTimeUpdate) {
      const hh = Math.floor(this.dayTime) % 24;
      const mm = Math.floor((this.dayTime % 1) * 60);
      const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      this.cb.onTimeUpdate(period, timeStr);
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.isMobile = window.innerWidth <= 768;
      if (!this.webglSupported) return;
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener('pointerup', (e) => {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > 8) return;
      this.handleCanvasTap(e.clientX, e.clientY);
    });
  }

  handleCanvasTap(clientX, clientY) {
    if (!this.webglSupported) return;
    if (this.isCinemaPlaying) {
      this.skipCinemaIntro();
      return;
    }

    // 1. 先用螢幕投影距離找最近的居民或動物（讓手機與桌機點擊判定範圍超好點！）
    const tapRadius = this.isMobile ? 46 : 34;
    let closestActor = null;
    let minDist = tapRadius;

    const allActors = [
      ...this.npcs.map((n) => ({ kind: 'npc', obj: n })),
      ...this.animals.map((a) => ({ kind: 'animal', obj: a }))
    ];

    allActors.forEach(({ kind, obj }) => {
      if (!obj.group.visible) return;
      const p = obj.group.position.clone().add(new THREE.Vector3(0, 0.9, 0));
      p.project(this.camera);
      if (p.z > 1) return;
      const sx = (p.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-p.y * 0.5 + 0.5) * window.innerHeight;
      const d = Math.hypot(clientX - sx, clientY - sy);
      if (d < minDist) {
        minDist = d;
        closestActor = { kind, obj };
      }
    });

    if (closestActor) {
      this.openActorBubble(closestActor.kind, closestActor.obj);
      return;
    }

    // 2. Raycaster 檢測貝殼或島嶼
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickableMeshes, false);

    if (hits.length > 0) {
      const hitObj = hits[0].object;
      if (hitObj.userData.type === 'shell' && hitObj.userData.active) {
        hitObj.userData.active = false;
        hitObj.visible = false;
        const sh = this.shells.find((s) => s.mesh === hitObj);
        if (sh) sh.respawnAt = performance.now() + 20000;
        if (this.cb.onPickupShell) this.cb.onPickupShell();
        return;
      }
      if (hitObj.userData.type === 'npc') {
        const npc = this.npcs.find((n) => n.id === hitObj.userData.actorId);
        if (npc) {
          this.openActorBubble('npc', npc);
          return;
        }
      }
      if (hitObj.userData.type === 'animal') {
        const ani = this.animals.find((a) => a.id === hitObj.userData.actorId);
        if (ani) {
          this.openActorBubble('animal', ani);
          return;
        }
      }
      if (hitObj.userData.islandId) {
        this.focusIsland(hitObj.userData.islandId, true);
        return;
      }
    }

    // 點空白處關閉對話泡泡
    this.closeActorBubble();
  }

  openActorBubble(kind, actor) {
    this.selectedActor = { kind, actor };
    actor.group.lookAt(this.camera.position.x, actor.group.position.y, this.camera.position.z);
    if (kind === 'animal') {
      actor.jumpOffset = 0.45;
    }
    document.body.classList.add('bubble-open');
    if (this.cb.onOpenBubble) {
      this.cb.onOpenBubble(kind, actor);
    }
  }

  closeActorBubble() {
    this.selectedActor = null;
    document.body.classList.remove('bubble-open');
    if (this.cb.onCloseBubble) {
      this.cb.onCloseBubble();
    }
  }

  // 在測試或外部呼叫時直接開啟指定居民對話泡泡
  triggerNpcTalkById(npcId) {
    const npc = this.npcs.find((n) => n.id === npcId) || this.npcs[0];
    if (npc) {
      this.openActorBubble('npc', npc);
    }
  }

  triggerAnimalTalkById(animalId) {
    const ani = this.animals.find((a) => a.id === animalId) || this.animals[0];
    if (ani) {
      this.openActorBubble('animal', ani);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (document.hidden || !this.webglSupported) return;

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    // 自動偵測 FPS（連續低於 24 自動降級）
    this.fpsFrames++;
    const now = performance.now();
    if (now - this.fpsLastCheck >= 1000) {
      const fps = (this.fpsFrames * 1000) / (now - this.fpsLastCheck);
      this.fpsFrames = 0;
      this.fpsLastCheck = now;
      if (fps < 24 && !this.lowQuality) {
        this.lowFpsStreak++;
        if (this.lowFpsStreak >= 3) {
          this.setQuality(true);
        }
      } else {
        this.lowFpsStreak = 0;
      }
    }

    // 貝殼 20 秒重生檢查
    this.shells.forEach((sh) => {
      if (!sh.mesh.visible && sh.respawnAt > 0 && now >= sh.respawnAt) {
        sh.mesh.visible = true;
        sh.mesh.userData.active = true;
        sh.respawnAt = 0;
      }
    });

    // 更新環境與日夜
    this.updateEnvironment(dt, false);

    // 更新運鏡動畫
    if (this.cameraAnim) {
      this.cameraAnim.elapsed += dt;
      const rawT = Math.min(1, this.cameraAnim.elapsed / this.cameraAnim.duration);
      const t = rawT * rawT * (3 - 2 * rawT); // smoothstep

      if (this.cameraAnim.type === 'epicIntro') {
        const ang = (1 - t) * Math.PI * 1.15;
        const radius = 128 - Math.sin(t * Math.PI) * 44 - t * 42;
        const height = 88 - t * 36;
        this.camera.position.set(Math.cos(ang) * radius, height, Math.sin(ang) * radius);
        this.controls.target.set(0, 4 * (1 - t) + 2, 0);
        this.camera.lookAt(this.controls.target);
      } else if (this.cameraAnim.type === 'flyToIsland') {
        // 二階貝茲弧線平滑推近
        const u = 1 - t;
        const p0 = this.cameraAnim.startCamPos;
        const p1 = this.cameraAnim.midCamPos;
        const p2 = this.cameraAnim.endCamPos;
        this.camera.position.set(
          u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
          u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
          u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z
        );
        this.controls.target.lerpVectors(this.cameraAnim.startTarget, this.cameraAnim.endTarget, t);
        this.camera.lookAt(this.controls.target);
      }

      if (rawT >= 1) {
        const done = this.cameraAnim.onFinish;
        this.cameraAnim = null;
        if (done) done();
      }
    } else {
      this.controls.update();
    }

    // 動態更新（減少動態開啟時全部暫停）
    if (!this.reducedMotion) {
      this.updateDynamicWorld(dt, elapsed);
    }

    // 更新 HTML 標籤與對話泡泡座標（含防重疊演算法）
    this.updateHtmlOverlays();

    this.renderer.render(this.scene, this.camera);
  }

  updateDynamicWorld(dt, elapsed) {
    // 1. 起伏海面與海岸浪花圈
    const pos = this.seaMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const wave =
        Math.sin(x * 0.09 + elapsed * 1.6) * 0.24 +
        Math.cos(z * 0.08 + elapsed * 1.3) * 0.22;
      pos.setY(i, this.seaBaseY[i] + wave);
    }
    pos.needsUpdate = true;

    this.foamRings.forEach((f) => {
      const s = 1 + Math.sin(elapsed * 2.2 + f.phase) * 0.025;
      f.mesh.scale.set(s, 1, s);
    });

    // 2. 風車與摩天輪轉動
    this.windmills.forEach((r) => {
      r.rotation.z -= dt * 1.4;
    });
    this.ferrisWheels.forEach((w) => {
      w.rotation.z += dt * 0.35;
    });

    // 3. 雲、飛鳥、帆船動態
    this.clouds.forEach((c) => {
      c.angle += dt * c.speed;
      c.group.position.x = Math.cos(c.angle) * c.dist;
      c.group.position.z = Math.sin(c.angle) * c.dist;
      c.group.lookAt(0, c.y, 0);
    });

    this.birdFlocks.forEach((f, idx) => {
      f.angle += dt * 0.24;
      f.group.position.x = Math.cos(f.angle) * f.radius;
      f.group.position.z = Math.sin(f.angle) * f.radius;
      f.group.position.y = f.y + Math.sin(elapsed * 2.5 + idx) * 0.8;
      f.group.rotation.y = -f.angle;
      f.group.children.forEach((wing, bIdx) => {
        wing.scale.x = 0.75 + Math.abs(Math.sin(elapsed * 7 + bIdx)) * 0.45;
      });
    });

    this.boats.forEach((b, idx) => {
      b.angle += dt * 0.09;
      b.group.position.x = Math.cos(b.angle) * b.radius;
      b.group.position.z = Math.sin(b.angle) * b.radius;
      b.group.rotation.y = -b.angle + Math.PI * 0.5;
      b.group.rotation.z = Math.sin(elapsed * 2 + idx) * 0.08;
    });

    const isNight = this.getPeriodFromHour(this.dayTime) === 'night';

    // 4. 居民散步、揮手與送貨員往返
    this.npcs.forEach((npc, idx) => {
      if (this.selectedActor && this.selectedActor.actor === npc) {
        // 被點選對話中：停下並揮右手
        const limbs = npc.group.userData.limbs;
        if (limbs) {
          limbs.armR.rotation.z = Math.PI * 0.75 + Math.sin(elapsed * 8) * 0.25;
          limbs.legL.rotation.x = 0;
          limbs.legR.rotation.x = 0;
        }
        return;
      }

      if (npc.roleType === 'merchant') {
        npc.group.rotation.y = Math.sin(elapsed * 1.2) * 0.45;
        return;
      }

      if (npc.roleType === 'courier') {
        npc.courierProgress += dt * 0.14 * npc.courierDir;
        if (npc.courierProgress >= 1) {
          npc.courierProgress = 1;
          npc.courierDir = -1;
        } else if (npc.courierProgress <= 0) {
          npc.courierProgress = 0;
          npc.courierDir = 1;
        }
        const p = new THREE.Vector3().lerpVectors(
          new THREE.Vector3(0, 2.52, 0),
          new THREE.Vector3(npc.courierTarget.x * 0.82, 2.52, npc.courierTarget.z * 0.82),
          npc.courierProgress
        );
        npc.group.position.copy(p);
        const lookDest = npc.courierDir > 0 ? npc.courierTarget : new THREE.Vector3(0, 2.52, 0);
        npc.group.lookAt(lookDest.x, 2.52, lookDest.z);
        const limbs = npc.group.userData.limbs;
        if (limbs) {
          if (limbs.cargoBox) limbs.cargoBox.visible = npc.courierDir > 0;
          limbs.legL.rotation.x = Math.sin(elapsed * 6 + idx) * 0.45;
          limbs.legR.rotation.x = -Math.sin(elapsed * 6 + idx) * 0.45;
        }
        return;
      }

      // 夜晚休息一半居民
      if (isNight && idx % 2 === 1) return;

      npc.angle += dt * npc.speed * 0.28;
      const nx = npc.homeCenter.x + Math.cos(npc.angle) * npc.walkRadius;
      const nz = npc.homeCenter.z + Math.sin(npc.angle) * npc.walkRadius;
      npc.group.lookAt(nx, 2.52, nz);
      npc.group.position.set(nx, 2.52, nz);

      const limbs = npc.group.userData.limbs;
      if (limbs) {
        limbs.legL.rotation.x = Math.sin(elapsed * 5 + idx) * 0.4;
        limbs.legR.rotation.x = -Math.sin(elapsed * 5 + idx) * 0.4;
        limbs.armL.rotation.x = -Math.sin(elapsed * 5 + idx) * 0.35;
        limbs.armR.rotation.x = Math.sin(elapsed * 5 + idx) * 0.35;
        limbs.armR.rotation.z = 0;
      }
    });

    // 5. 動物散步（夜晚休息）
    this.animals.forEach((ani, idx) => {
      if (ani.jumpOffset > 0) {
        ani.jumpOffset = Math.max(0, ani.jumpOffset - dt * 1.4);
      }
      if (this.selectedActor && this.selectedActor.actor === ani) {
        ani.group.position.y = 2.52 + Math.sin(ani.jumpOffset * Math.PI) * 0.5;
        return;
      }
      if (isNight) {
        ani.group.position.y = 2.52;
        return;
      }
      ani.angle += dt * ani.speed * 0.25;
      const ax = ani.homeCenter.x + Math.cos(ani.angle) * ani.walkRadius;
      const az = ani.homeCenter.z + Math.sin(ani.angle) * ani.walkRadius;
      ani.group.lookAt(ax, 2.52, az);
      ani.group.position.set(
        ax,
        2.52 + Math.abs(Math.sin(elapsed * 6 + idx)) * 0.12,
        az
      );
    });
  }

  updateHtmlOverlays() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const coords = [];

    this.labelItems.forEach((item) => {
      const p = item.worldPos.clone().project(this.camera);
      if (p.z > 1) {
        item.el.style.display = 'none';
        return;
      }
      item.el.style.display = 'inline-flex';
      const sx = (p.x * 0.5 + 0.5) * w;
      const sy = (-p.y * 0.5 + 0.5) * h;
      coords.push({ item, x: sx, y: sy });
    });

    // 防重疊推擠演算法：確保任何視角與螢幕尺寸下島嶼標籤都不互相重疊
    const minW = this.isMobile ? 105 : 132;
    const minH = 42;
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < coords.length; i++) {
        for (let j = i + 1; j < coords.length; j++) {
          const a = coords[i];
          const b = coords[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          if (Math.abs(dx) < minW && Math.abs(dy) < minH) {
            const pushY = (minH - Math.abs(dy)) * 0.55 * (dy >= 0 ? 1 : -1);
            const pushX = (minW - Math.abs(dx)) * 0.25 * (dx >= 0 ? 1 : -1);
            a.y -= pushY;
            b.y += pushY;
            a.x -= pushX;
            b.x += pushX;
          }
        }
      }
    }

    coords.forEach(({ item, x, y }) => {
      const cx = Math.max(62, Math.min(w - 62, x));
      const cy = Math.max(82, Math.min(h - 72, y));
      item.el.style.left = `${cx.toFixed(1)}px`;
      item.el.style.top = `${cy.toFixed(1)}px`;
    });

    // 居民／動物頭頂泡泡跟隨定位（保留頂部與底部工具列安全距離）
    if (this.selectedActor && this.cb.onUpdateBubblePos) {
      const pos = this.selectedActor.actor.group.position.clone().add(new THREE.Vector3(0, 1.8, 0));
      pos.project(this.camera);
      if (pos.z <= 1) {
        const bx = Math.max(200, Math.min(w - 200, (pos.x * 0.5 + 0.5) * w));
        const by = Math.max(320, Math.min(h - 140, (-pos.y * 0.5 + 0.5) * h));
        this.cb.onUpdateBubblePos(bx, by);
      }
    }
  }
}
