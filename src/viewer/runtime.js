    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    const documentUrl = new URL(document.baseURI);
    const isViewerCopy = /\/viewer(?:\/index\.html)?\/?$/.test(documentUrl.pathname);
    const appBaseUrl = new URL(isViewerCopy ? '../' : './', documentUrl);
    const bootstrapContext = window.__ATLEE_BOOTSTRAP_CONTEXT__ || {};
    const diagnostics = bootstrapContext.diagnostics || null;
    const { loadPropertyConfig } = await import(new URL('src/property-config.js', appBaseUrl));
    const {
      calculateDaylightStats: calculateConfiguredDaylightStats,
      calculateSolarPosition: calculateConfiguredSolarPosition,
      dateFromDayOfYear,
      dayOfYearFromDate,
      getTimeZoneOffsetHours
    } = await import(new URL('src/solar.js', appBaseUrl));
    const { createViewerExposureController } = await import(
      new URL('src/viewer/exposure-controller.js', appBaseUrl)
    );
    const { sunMarkerPosition } = await import(new URL('src/viewer/sun-markers.js', appBaseUrl));
    const { aggregateZoneExposure, zoneExposurePresentation } = await import(new URL('src/viewer/zone-analysis.js', appBaseUrl));
    const { cameraPreset, publicPropertyLabel, resolveModelUrl, fitPropertyCamera } = await import(
      new URL('src/viewer/property-scene.js', appBaseUrl)
    );

    const { DEFAULT_PROPERTY_CONFIG } = await import(new URL('src/property-config.js', appBaseUrl));
    const FALLBACK_PROPERTY = {
      ...DEFAULT_PROPERTY_CONFIG,
      model: { ...DEFAULT_PROPERTY_CONFIG.model, url: './properties/demo/model.glb' },
    };

    let loadedProperty;
    try {
      loadedProperty = bootstrapContext.localProperty || await loadPropertyConfig({
        search: bootstrapContext.configSearch || window.location.search,
        baseUrl: appBaseUrl
      });
      if (loadedProperty.warnings?.length) {
        console.warn('Property configuration warnings:', ...loadedProperty.warnings);
      }
    } catch (error) {
      console.warn('Could not load property configuration; using the built-in demo defaults.', error);
      diagnostics?.recordError?.(error, {
        category: 'config',
        stage: 'config',
        component: 'property-config',
      });
      loadedProperty = { config: FALLBACK_PROPERTY, url: appBaseUrl.href, warnings: [`${error.message} Using the built-in demo configuration.`] };
    }

    const suppliedProperty = loadedProperty.runtimeConfig || loadedProperty.config || {};
    const USING_BUILT_IN_FALLBACK = loadedProperty.warnings?.some(warning => warning.includes('built-in demo')) || false;
    const PROPERTY = {
      ...FALLBACK_PROPERTY,
      ...suppliedProperty,
      location: { ...FALLBACK_PROPERTY.location, ...(suppliedProperty.location || {}) },
      model: { ...FALLBACK_PROPERTY.model, ...(suppliedProperty.model || {}) },
      scene: { ...FALLBACK_PROPERTY.scene, ...(suppliedProperty.scene || {}) },
      zones: Array.isArray(suppliedProperty.zones) ? suppliedProperty.zones : FALLBACK_PROPERTY.zones,
      solar: { ...FALLBACK_PROPERTY.solar, ...(suppliedProperty.solar || {}) }
    };

    const PUBLIC_PROPERTY_LABEL = publicPropertyLabel(PROPERTY);
    document.title = `${PROPERTY.location.showExactLocation ? PROPERTY.title : PUBLIC_PROPERTY_LABEL} — 3D Solar & Shade Tracker`;

    // -------------------------------------------------------------
    // 2. Configured Property, Calendar & Sun Math
    // -------------------------------------------------------------
    const LATITUDE = PROPERTY.location.latitude;
    const LONGITUDE = PROPERTY.location.longitude;
    const TIME_ZONE = PROPERTY.location.timeZone;
    const currentYear = new Date().getFullYear();

    function todayInTimeZone() {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: TIME_ZONE,
          year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date());
        const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
        return `${values.year}-${values.month}-${values.day}`;
      } catch (error) {
        console.warn(`Invalid time zone "${TIME_ZONE}"; using the browser calendar.`, error);
        return new Date().toISOString().slice(0, 10);
      }
    }

    function normalizedDateValue(value) {
      if (typeof value === 'string') return value.slice(0, 10);
      if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
      return todayInTimeZone();
    }

    let currentDate = /^\d{4}-\d{2}-\d{2}$/.test(bootstrapContext.shareState?.date || '')
      ? bootstrapContext.shareState.date
      : /^\d{4}-\d{2}-\d{2}$/.test(PROPERTY.solar.defaultDate || '')
      ? PROPERTY.solar.defaultDate
      : todayInTimeZone();
    let currentDayOfYear = dayOfYearFromDate(currentDate);
    let currentTimeMinutes = Number.isInteger(bootstrapContext.shareState?.localTimeMinutes)
      ? bootstrapContext.shareState.localTimeMinutes
      : 870;
    let isPlaying = false;
    let playSpeed = Number(bootstrapContext.shareState?.playbackSpeed) || 2;
    let autoRotate = false;
    let showSunArc = bootstrapContext.shareState?.markers !== 'off';
    let showHeatmap = bootstrapContext.shareState?.map !== 'off';
    let showCompass = bootstrapContext.shareState?.compass !== 'off';
    let activeView = bootstrapContext.shareState?.view || 'street';
    let selectedZone = bootstrapContext.shareState?.selectedZone || null;
    let reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;

    function announceStateChange(source = 'viewer') {
      window.dispatchEvent(new CustomEvent('atlee:statechange', { detail: { source } }));
    }

    // Piecewise-linear terrain profile supplied by the property configuration.
    function getTerrainElevation(x, z) {
      const profile = PROPERTY.scene.terrainProfile;
      if (!Array.isArray(profile) || profile.length === 0) return 0;
      const points = profile
        .filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
        .map(point => [Number(point[0]), Number(point[1])])
        .sort((a, b) => a[0] - b[0]);
      if (!points.length) return 0;
      if (z <= points[0][0]) return points[0][1];
      for (let i = 1; i < points.length; i++) {
        if (z <= points[i][0]) {
          const [z0, y0] = points[i - 1];
          const [z1, y1] = points[i];
          const t = z1 === z0 ? 0 : (z - z0) / (z1 - z0);
          return y0 + (y1 - y0) * t;
        }
      }
      return points[points.length - 1][1];
    }

    function calculateSolarPosition(dayOfYear, timeMinutes) {
      const year = Number(currentDate.slice(0, 4)) || currentYear;
      const date = normalizedDateValue(dateFromDayOfYear(dayOfYear, year));
      return calculateConfiguredSolarPosition({
        date,
        timeMinutes,
        latitude: LATITUDE,
        longitude: LONGITUDE,
        timeZone: TIME_ZONE
      });
    }

    function getCardinalDirection(az) {
      const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      const idx = Math.round(az / 22.5) % 16;
      return cardinals[idx];
    }

    function formatTime12h(totalMinutes) {
      const m = Math.floor(totalMinutes % 60);
      let h = Math.floor(totalMinutes / 60) % 24;
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    }

    function updateLocationDisplay() {
      let timeZoneName = TIME_ZONE;
      try {
        timeZoneName = new Intl.DateTimeFormat('en-US', {
          timeZone: TIME_ZONE,
          timeZoneName: 'short'
        }).formatToParts(new Date(`${currentDate}T12:00:00Z`)).find(part => part.type === 'timeZoneName')?.value || TIME_ZONE;
      } catch (error) {
        console.warn('Could not format configured time zone.', error);
      }
      const offset = getTimeZoneOffsetHours(currentDate, TIME_ZONE);
      const sign = offset >= 0 ? '+' : '−';
      const absOffset = Math.abs(offset);
      const offsetText = Number.isInteger(absOffset)
        ? `${absOffset}`
        : `${Math.floor(absOffset)}:${String(Math.round((absOffset % 1) * 60)).padStart(2, '0')}`;
      document.getElementById('location-display').innerText = `${timeZoneName} (UTC${sign}${offsetText}) • ${PUBLIC_PROPERTY_LABEL}`;
    }

    function calculateDaylightStats(dayOfYear) {
      const year = Number(currentDate.slice(0, 4)) || currentYear;
      const date = normalizedDateValue(dateFromDayOfYear(dayOfYear, year));
      return calculateConfiguredDaylightStats({
        date,
        latitude: LATITUDE,
        longitude: LONGITUDE,
        timeZone: TIME_ZONE
      });
    }

    // -------------------------------------------------------------
    // 3. Three.js Scene, Camera, Shadows & Renderer
    // -------------------------------------------------------------
    const container = document.getElementById('canvas-container');
    const scene = new THREE.Scene();

    // A soft vertical sky wash keeps the model readable while preserving the
    // solar-state color changes below (day, golden hour, twilight, and night).
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2;
    skyCanvas.height = 512;
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    scene.background = skyTexture;

    function setSkyGradient(top, middle, horizon) {
      const ctx = skyCanvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, skyCanvas.height);
      gradient.addColorStop(0, top);
      gradient.addColorStop(0.62, middle);
      gradient.addColorStop(1, horizon);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
      skyTexture.needsUpdate = true;
    }

    setSkyGradient('#4d9fe8', '#9ed8f4', '#e8f7ff');

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.2, 1500);
    camera.position.set(0, 7.5, -28);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 1.0, 5.0);
    controls.maxPolarAngle = Math.PI / 2 - 0.01;
    controls.minDistance = 3;
    controls.maxDistance = 450;
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    // -------------------------------------------------------------
    // 4. Dynamic Sun, Sky & Night Lighting
    // -------------------------------------------------------------
    const sunLight = new THREE.DirectionalLight(0xfffaed, 2.6);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = Math.max(320, (PROPERTY.scene.groundBounds.maxX - PROPERTY.scene.groundBounds.minX + PROPERTY.scene.groundBounds.maxZ - PROPERTY.scene.groundBounds.minZ) * 3);
    sunLight.shadow.camera.left = -Math.max(55, Math.max(Math.abs(PROPERTY.scene.groundBounds.minX), Math.abs(PROPERTY.scene.groundBounds.maxX), Math.abs(PROPERTY.scene.groundBounds.minZ), Math.abs(PROPERTY.scene.groundBounds.maxZ)) * 1.5);
    sunLight.shadow.camera.right = Math.max(55, Math.max(Math.abs(PROPERTY.scene.groundBounds.minX), Math.abs(PROPERTY.scene.groundBounds.maxX), Math.abs(PROPERTY.scene.groundBounds.minZ), Math.abs(PROPERTY.scene.groundBounds.maxZ)) * 1.5);
    sunLight.shadow.camera.top = Math.max(55, Math.max(Math.abs(PROPERTY.scene.groundBounds.minX), Math.abs(PROPERTY.scene.groundBounds.maxX), Math.abs(PROPERTY.scene.groundBounds.minZ), Math.abs(PROPERTY.scene.groundBounds.maxZ)) * 1.5);
    sunLight.shadow.camera.bottom = -Math.max(55, Math.max(Math.abs(PROPERTY.scene.groundBounds.minX), Math.abs(PROPERTY.scene.groundBounds.maxX), Math.abs(PROPERTY.scene.groundBounds.minZ), Math.abs(PROPERTY.scene.groundBounds.maxZ)) * 1.5);
    sunLight.shadow.bias = -0.0003;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0xdceeff, 0x3d4432, 0.85);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const porchLight = new THREE.PointLight(0xffb74d, 0, 10, 1.8);
    porchLight.position.set(0.1, 2.6, -4.8);
    scene.add(porchLight);

    const bayWindowGlow = new THREE.PointLight(0xffcc66, 0, 12, 1.8);
    bayWindowGlow.position.set(3.4, 1.8, -4.8);
    scene.add(bayWindowGlow);

    const carportGlow = new THREE.PointLight(0xffe082, 0, 10, 1.8);
    carportGlow.position.set(-8.5, 2.2, -1.0);
    scene.add(carportGlow);

    // -------------------------------------------------------------
    // 5. CLOSE 3D SUN PATH ARC, RED BEAM & COMPASS
    // -------------------------------------------------------------
    const SUN_PATH_RADIUS = 26.0;
    const SUN_PATH_BASE_HEIGHT = 2.5;
    const SUN_PATH_ALTITUDE_SCALE = 0.5;
    const sunArcGroup = new THREE.Group();
    scene.add(sunArcGroup);

    // Scaled Sun Orb for intimate close-up view
    const sunSphereGeo = new THREE.SphereGeometry(1.0, 32, 32);
    const sunSphereMat = new THREE.MeshBasicMaterial({ color: 0xffea75 });
    const sunSphere = new THREE.Mesh(sunSphereGeo, sunSphereMat);

    const coronaGeo = new THREE.SphereGeometry(1.65, 24, 24);
    const coronaMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.35, side: THREE.BackSide });
    const sunCorona = new THREE.Mesh(coronaGeo, coronaMat);
    sunSphere.add(sunCorona);
    scene.add(sunSphere);

    // The viewer intentionally renders suns only. Retain an empty group so
    // older scene code can address it without drawing the former thick beam.
    const redBeamGroup = new THREE.Group();
    redBeamGroup.visible = false;
    scene.add(redBeamGroup);

    // Compass Rose (renderOrder 99999)
    const compassGroup = new THREE.Group();
    compassGroup.position.set(0, 0.15, 0);
    compassGroup.renderOrder = 99999;

    const ringGeo = new THREE.RingGeometry(18.1, 18.7, 96);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const compassRing = new THREE.Mesh(ringGeo, ringMat);
    compassRing.rotation.x = -Math.PI / 2;
    compassRing.renderOrder = 99999;
    compassGroup.add(compassRing);

    const innerRingGeo = new THREE.RingGeometry(17.7, 17.9, 96);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.renderOrder = 99999;
    compassGroup.add(innerRing);

    const crossLinesMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      depthTest: false,
      depthWrite: false
    });
    const nsGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, -18.5), new THREE.Vector3(0, 0.01, 18.5)]);
    const nsLine = new THREE.Line(nsGeo, crossLinesMat);
    nsLine.renderOrder = 99999;
    compassGroup.add(nsLine);

    const ewGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-18.5, 0.01, 0), new THREE.Vector3(18.5, 0.01, 0)]);
    const ewLine = new THREE.Line(ewGeo, crossLinesMat);
    ewLine.renderOrder = 99999;
    compassGroup.add(ewLine);

    function createWhiteGroundBadge(letter) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.arc(128, 128, 114, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 14;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 136px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, 128, 136);

      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      });
      const geo = new THREE.PlaneGeometry(3.8, 3.8);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
      mesh.renderOrder = 99999;
      return mesh;
    }

    const badgeN = createWhiteGroundBadge('N');
    badgeN.position.set(0, 0.02, 18.5);
    compassGroup.add(badgeN);

    const badgeS = createWhiteGroundBadge('S');
    badgeS.position.set(0, 0.02, -18.5);
    compassGroup.add(badgeS);

    const badgeE = createWhiteGroundBadge('E');
    badgeE.position.set(-18.5, 0.02, 0);
    compassGroup.add(badgeE);

    const badgeW = createWhiteGroundBadge('W');
    badgeW.position.set(18.5, 0.02, 0);
    compassGroup.add(badgeW);

    compassGroup.traverse((child) => {
      child.renderOrder = 99999;
      if (child.material) {
        child.material.depthTest = false;
        child.material.depthWrite = false;
        child.material.transparent = true;
      }
    });

    scene.add(compassGroup);

    // -------------------------------------------------------------
    // 6. DYNAMIC SEASONAL SOLAR HEATMAP & 3D CLICK PICKING (DOUBLED BACKYARD)
    // -------------------------------------------------------------
    const heatmapGroup = new THREE.Group();
    heatmapGroup.visible = false;
    scene.add(heatmapGroup);
    const exposureStatus = document.getElementById('exposure-status');
    let activeExposureMethod = 'estimated';
    let exposureAbortController = null;
    let loadedModelRoot = null;
    const viewerExposure = createViewerExposureController();
    let exposureTier = bootstrapContext.shareState?.exposureTier || 'standard';
    let lastExposureResult = null;

    // 3D Click Beacon Marker
    const beaconGroup = new THREE.Group();
    beaconGroup.visible = false;
    const beaconRingGeo = new THREE.RingGeometry(0.8, 1.2, 32);
    const beaconRingMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false });
    const beaconRing = new THREE.Mesh(beaconRingGeo, beaconRingMat);
    beaconRing.rotation.x = -Math.PI / 2;
    beaconRing.renderOrder = 99999;
    beaconGroup.add(beaconRing);

    const beaconPoleGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.5, 12);
    beaconPoleGeo.translate(0, 1.25, 0);
    const beaconPoleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
    const beaconPole = new THREE.Mesh(beaconPoleGeo, beaconPoleMat);
    beaconPole.renderOrder = 99999;
    beaconGroup.add(beaconPole);

    scene.add(beaconGroup);

    // Neutral until a completed calculation exists. No illustrative house data.
    function generateSolarHeatmapTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#94a3b8'; ctx.fillRect(0, 0, 1, 1);
      return new THREE.CanvasTexture(canvas);
    }

    let heatmapMesh = null;
    function buildHeatmapOverlayMesh() {
      const nx = 40, nz = 90;
      const { minX, maxX, minZ, maxZ } = PROPERTY.scene.groundBounds;
      const xs = []; const zs = [];
      for (let j = 0; j < nx; j++) xs.push(minX + (maxX - minX) * (j / (nx - 1)));
      for (let i = 0; i < nz; i++) zs.push(minZ + (maxZ - minZ) * (i / (nz - 1)));

      const positions = [];
      const uvs = [];
      const indices = [];

      for (let i = 0; i < nz; i++) {
        const z = zs[i];
        const v = (z - minZ) / (maxZ - minZ);
        for (let j = 0; j < nx; j++) {
          const x = xs[j];
          const u = (x - minX) / (maxX - minX);
          const y = getTerrainElevation(x, z) + 0.08;
          positions.push(x, y, z);
          uvs.push(u, v);
        }
      }

      for (let i = 0; i < nz - 1; i++) {
        for (let j = 0; j < nx - 1; j++) {
          const idx0 = i * nx + j;
          const idx1 = i * nx + (j + 1);
          const idx2 = (i + 1) * nx + j;
          const idx3 = (i + 1) * nx + (j + 1);
          indices.push(idx0, idx2, idx1);
          indices.push(idx1, idx2, idx3);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mat = new THREE.MeshBasicMaterial({
        map: generateSolarHeatmapTexture(currentDayOfYear),
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -2.0,
        polygonOffsetUnits: -4.0
      });

      heatmapMesh = new THREE.Mesh(geo, mat);
      heatmapMesh.renderOrder = 50;
      heatmapGroup.add(heatmapMesh);
    }

    buildHeatmapOverlayMesh();

    let interactiveBadges = [];
    const badgeConfigs = PROPERTY.zones.map((zone) => ({
      id: zone.id, pos: zone.position, title: zone.title,
    }));

    function createGardenZoneBadge(title, hoursText, colorHex, zoneKey) {
      const canvas = document.createElement('canvas');
      canvas.width = 340; canvas.height = 110;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 324, 94, 20);
      ctx.fill();

      ctx.fillStyle = colorHex;
      ctx.beginPath();
      ctx.roundRect(8, 8, 14, 94, [20, 0, 0, 20]);
      ctx.fill();

      ctx.lineWidth = 4;
      ctx.strokeStyle = colorHex;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(title, 34, 44);

      ctx.fillStyle = colorHex;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(hoursText, 34, 82);

      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(7.6, 2.5, 1);
      sprite.renderOrder = 99999;
      sprite.userData = { title, hoursText, colorHex, zoneKey };
      return sprite;
    }

    function rebuildZoneBadges() {
      interactiveBadges.forEach(badge => {
        heatmapGroup.remove(badge);
        badge.material.map?.dispose(); badge.material.dispose();
      });
      interactiveBadges = [];
      const summaries = getZoneAnalysis()?.zones || {};
      PROPERTY.zones.forEach(zone => {
        const display = zoneExposurePresentation(zone, summaries[zone.id]);
        const badge = createGardenZoneBadge(zone.title, display.hoursText, display.color, display.key);
        badge.userData.zoneId = zone.id;
        badge.position.fromArray(zone.position);
        heatmapGroup.add(badge); interactiveBadges.push(badge);
      });
    }

    rebuildZoneBadges();

    function setExposureStatus(message, state = 'estimated') {
      exposureStatus.innerText = message;
      exposureStatus.dataset.state = state;
      const toggle = document.getElementById('toggle-heatmap');
      if (activeExposureMethod === 'calculated') {
        toggle.innerText = '🌻 Calculated Map';
        toggle.title = 'Model-derived direct-sun exposure for the selected date';
      } else {
        toggle.innerText = '🌻 Ground Sun Map';
        toggle.title = 'No ground exposure calculated yet';
      }
    }

    function replaceHeatmapTexture(texture) {
      if (!heatmapMesh) return;
      heatmapMesh.material.map?.dispose();
      heatmapMesh.material.map = texture;
      heatmapMesh.material.map.needsUpdate = true;
    }

    function cancelExposureCalculation() {
      if (exposureAbortController) {
        exposureAbortController.abort();
        exposureAbortController = null;
      }
      viewerExposure.cancel();
    }

    function applyEstimatedExposureMap(message = 'Not calculated. Run Model Exposure to study ground sunlight.', state = 'estimated') {
      lastExposureResult = null;
      activeExposureMethod = 'estimated';
      replaceHeatmapTexture(generateSolarHeatmapTexture(currentDayOfYear));
      rebuildZoneBadges();
      setExposureStatus(message, state);
    }

    function exposureColor(sunHours) {
      const stops = [
        [0, new THREE.Color('#2563eb')],
        [3, new THREE.Color('#10b981')],
        [6, new THREE.Color('#eab308')],
        [9, new THREE.Color('#f97316')],
        [12, new THREE.Color('#ef4444')]
      ];
      for (let index = 1; index < stops.length; index++) {
        if (sunHours <= stops[index][0]) {
          const [lowHours, lowColor] = stops[index - 1];
          const [highHours, highColor] = stops[index];
          const t = (sunHours - lowHours) / (highHours - lowHours);
          return lowColor.clone().lerp(highColor, Math.max(0, Math.min(1, t)));
        }
      }
      return stops[stops.length - 1][1].clone();
    }

    function calculatedExposureTexture(exposures, columns, rows) {
      const canvas = document.createElement('canvas');
      canvas.width = columns;
      canvas.height = rows;
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(columns, rows);
      exposures.forEach((exposure, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const canvasRow = rows - row - 1;
        const offset = (canvasRow * columns + column) * 4;
        const color = exposureColor(exposure.sunHours);
        pixels.data[offset] = Math.round(color.r * 255);
        pixels.data[offset + 1] = Math.round(color.g * 255);
        pixels.data[offset + 2] = Math.round(color.b * 255);
        pixels.data[offset + 3] = 255;
      });
      context.putImageData(pixels, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    }

    async function updateExposureMap() {
      if (!loadedModelRoot) {
        activeExposureMethod = 'estimated';
        setExposureStatus('Model exposure is unavailable until a model loads. No hours have been calculated.', 'error');
        return;
      }

      cancelExposureCalculation();
      const controller = new AbortController();
      exposureAbortController = controller;
      const exposureTiming = diagnostics?.startTiming?.('exposure', {
        tier: exposureTier,
        mode: viewerExposure.mode,
      });
      applyEstimatedExposureMap();
      setExposureStatus(`Calculating ${exposureTier} model-derived direct sun for ${currentDate}… 0%`, 'calculating');

      try {
        const result = await viewerExposure.run({
          property: PROPERTY,
          modelRoot: loadedModelRoot,
          date: currentDate,
          tier: exposureTier,
          elevationAt: getTerrainElevation,
          signal: controller.signal,
          onProgress(update) {
            const percent = Math.round((update.progress || 0) * 100);
            setExposureStatus(`Calculating ${exposureTier} model-derived direct sun for ${currentDate}… ${percent}%`, 'calculating');
            window.dispatchEvent(new CustomEvent('atlee:exposureprogress', { detail: update }));
          }
        });
        if (controller.signal.aborted) return;
        lastExposureResult = result;
        activeExposureMethod = 'calculated';
        replaceHeatmapTexture(calculatedExposureTexture(result.exposures, result.grid.columns, result.grid.rows));
        rebuildZoneBadges();
        if (selectedZone) showZoneDetails(selectedZone);
        announceStateChange('exposure');
        const maxHours = Math.max(...result.exposures.map(exposure => exposure.sunHours));
        setExposureStatus(`${exposureTier} model-derived direct sun (${result.samplingMinutes}-minute samples; maximum ${maxHours.toFixed(1)} hours; ${result.source}).`, 'calculated');
        diagnostics?.endTiming?.(exposureTiming, {
          status: 'complete',
          tier: exposureTier,
          sampleCount: result.sampleCount,
          gridPointCount: result.grid?.pointCount,
        });
        window.dispatchEvent(new CustomEvent('atlee:exposurecomplete', { detail: result }));
      } catch (error) {
        if (error.name === 'AbortError') {
          diagnostics?.endTiming?.(exposureTiming, { status: 'canceled', tier: exposureTier });
          return;
        }
        console.error('Model-derived exposure calculation failed.', error);
        diagnostics?.endTiming?.(exposureTiming, { status: 'failed', tier: exposureTier });
        diagnostics?.recordError?.(error, {
          category: 'exposure',
          stage: 'exposure',
          component: 'model-exposure',
        });
        applyEstimatedExposureMap('Model exposure failed. No sunlight hours are available; try Quick or reload the model.', 'error');
        window.dispatchEvent(new CustomEvent('atlee:exposureerror', {
          detail: { message: 'Model exposure calculation failed; no sunlight hours are available.' }
        }));
      } finally {
        if (exposureAbortController === controller) exposureAbortController = null;
      }
    }

    setExposureStatus('Not calculated. Run Model Exposure to study ground sunlight.', 'estimated');

    // -------------------------------------------------------------
    // 7. OPEN PLANT RECOMMENDATION MODAL ON CLICK (HEATMAP ONLY)
    // -------------------------------------------------------------
    const plantModal = document.getElementById('plant-modal');
    const modalZoneTitle = document.getElementById('modal-zone-title');
    const modalZoneBadge = document.getElementById('modal-zone-badge');
    const modalZoneDesc = document.getElementById('modal-zone-desc');
    const modalCategoriesContainer = document.getElementById('modal-categories-container');
    const modalGardenerTip = document.getElementById('modal-gardener-tip');
    const btnCloseModal = document.getElementById('btn-close-modal');

    btnCloseModal.addEventListener('click', () => {
      plantModal.style.display = 'none';
      plantModal.setAttribute('aria-hidden', 'true');
      beaconGroup.visible = false;
      selectedZone = null;
      announceStateChange('zone');
      window.dispatchEvent(new CustomEvent('atlee:zoneclose'));
    });

    function showGroundDetails(display, areaTitle, beaconPos) {
      if (!showHeatmap) return;
      modalZoneTitle.innerText = areaTitle;
      modalZoneBadge.innerText = display.hoursText;
      modalZoneBadge.style.background = 'rgba(15,23,42,.6)';
      modalZoneBadge.style.color = display.color;
      modalZoneBadge.style.borderColor = display.color;
      modalZoneDesc.innerText = display.qualification;
      modalCategoriesContainer.replaceChildren();
      modalGardenerTip.textContent = 'Compare dates during the growing season and check this place on site. Match your plant’s sunlight needs to the modeled hours. Missing trees and buildings cannot cast modeled shade.';

      plantModal.style.display = 'flex';
      plantModal.setAttribute('aria-hidden', 'false');
      announceStateChange('zone');
      window.dispatchEvent(new CustomEvent('atlee:zoneopen', {
        detail: { zoneId: selectedZone, title: areaTitle }
      }));

      if (beaconPos) {
        beaconGroup.position.copy(beaconPos);
        beaconRingMat.color.set(display.color);
        beaconGroup.visible = true;
      }
    }

    // Raycast Interaction on 3D Canvas
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    window.addEventListener('pointerdown', (e) => {
      if (!showHeatmap) return;

      if (e.target.closest('#fab-menu-card') || e.target.closest('#fab-toggle') || e.target.closest('.plant-modal')) {
        return;
      }

      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      const badgeHits = raycaster.intersectObjects(interactiveBadges);
      if (badgeHits.length > 0) {
        const hit = badgeHits[0];
        const udata = hit.object.userData;
        const groundY = getTerrainElevation(hit.object.position.x, hit.object.position.z);
        const beaconP = new THREE.Vector3(hit.object.position.x, groundY + 0.1, hit.object.position.z);
        selectedZone = udata.zoneId || null;
        showZoneDetails(selectedZone, beaconP);
        return;
      }

      const hits = raycaster.intersectObjects(scene.children, true);
      for (let h of hits) {
        const bounds = PROPERTY.scene.groundBounds;
        if (h.point && h.point.x >= bounds.minX && h.point.x <= bounds.maxX && h.point.z >= bounds.minZ && h.point.z <= bounds.maxZ) {
          const px = h.point.x;
          const pz = h.point.z;
          const py = h.point.y;

          if (badgeConfigs.length) {
            const nearest = badgeConfigs.reduce((best, zone) =>
              Math.hypot(px - zone.pos[0], pz - zone.pos[2]) < Math.hypot(px - best.pos[0], pz - best.pos[2]) ? zone : best);
            selectZone(nearest.id);
          } else {
            const samples = lastExposureResult?.exposures || [];
            const nearest = samples.length ? samples.reduce((best, sample) =>
              Math.hypot(px - sample.point.x, pz - sample.point.z) < Math.hypot(px - best.point.x, pz - best.point.z) ? sample : best) : null;
            const display = zoneExposurePresentation({}, nearest ? {sunMinutes: nearest.sunMinutes,
              qualification: 'Nearest modeled ground grid point to the clicked position.'} : null);
            selectedZone = null;
            showGroundDetails(display, 'Ground point', new THREE.Vector3(px, py + 0.08, pz));
          }
          break;
        }
      }
    });

    // Floating Sky Time Badge Generator (Refined scale for R = 48m)
    function createFloatingTimeSprite(text) {
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 90;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 224, 74, 37);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#fbbf24';
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 120, 46);

      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.renderOrder = 31;
      sprite.scale.set(2.4, 0.9, 1);
      return sprite;
    }

    // Rebuild the actual daily celestial path at a readable distance from the model.
    function rebuildSunPathArc(dayOfYear) {
      while (sunArcGroup.children.length > 0) {
        const obj = sunArcGroup.children[0];
        sunArcGroup.remove(obj);
      }

      const R = SUN_PATH_RADIUS;
      const arcPoints = [];

      for (let m = 0; m < 1440; m += 8) {
        const pos = calculateSolarPosition(dayOfYear, m);
        if (pos.altitude >= -2.0) {
          const point = sunMarkerPosition({
            altitude: Math.max(0, pos.altitude), azimuth: pos.azimuth, radius: R,
            baseHeight: SUN_PATH_BASE_HEIGHT,
            altitudeScale: SUN_PATH_ALTITUDE_SCALE
          });
          arcPoints.push(new THREE.Vector3(point.x, point.y, point.z));
        }
      }

      if (arcPoints.length >= 2) {
        const keyHours = Array.from({ length: 24 }, (_, h) => ({
          h,
          label: formatTime12h(h * 60).replace(':00', '')
        }));

        keyHours.forEach(({ h, label }) => {
          const m = h * 60;
          const pos = calculateSolarPosition(dayOfYear, m);
          if (pos.altitude >= 1.0) {
            const marker = sunMarkerPosition({
              altitude: pos.altitude, azimuth: pos.azimuth, radius: R,
              baseHeight: SUN_PATH_BASE_HEIGHT,
              altitudeScale: SUN_PATH_ALTITUDE_SCALE
            });
            const { x: nx, y: ny, z: nz } = marker;

            const nodeGeo = new THREE.SphereGeometry(0.35, 16, 16);
            const nodeMat = new THREE.MeshBasicMaterial({ color: 0xfff4c2, depthTest: false, toneMapped: false });
            const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
            nodeMesh.position.set(nx, ny, nz);
            nodeMesh.renderOrder = 31;
            sunArcGroup.add(nodeMesh);

            const timeTag = createFloatingTimeSprite(label);
            timeTag.position.set(nx, ny + 1.0, nz);
            sunArcGroup.add(timeTag);
          }
        });
      }

      const stats = calculateDaylightStats(dayOfYear);
      document.getElementById('hud-sun-times').innerText = stats.sunrise && stats.sunset
        ? `${stats.sunrise} — ${stats.sunset}`
        : 'No sunrise / sunset';
      document.getElementById('hud-daylight').innerText = `${stats.daylightText} daylight`;
    }

    // -------------------------------------------------------------
    // 8. Update Sun Position, Lighting & Close Red Solar Beam
    // -------------------------------------------------------------
    function updateSunSystem(dayOfYear, timeMinutes) {
      const { altitude, azimuth } = calculateSolarPosition(dayOfYear, timeMinutes);
      document.getElementById('hud-solar-pos').innerText = `Alt: ${altitude.toFixed(1)}° • Az: ${Math.round(azimuth)}° (${getCardinalDirection(azimuth)})`;

      const R = SUN_PATH_RADIUS;
      const marker = sunMarkerPosition({
        altitude, azimuth, radius: R,
        baseHeight: SUN_PATH_BASE_HEIGHT,
        altitudeScale: SUN_PATH_ALTITUDE_SCALE
      });
      const { x: sunX, y: sunY, z: sunZ } = marker;

      sunLight.position.set(sunX, sunY, sunZ);
      sunLight.target.position.set(0, 1.2, 0.0);
      sunLight.target.updateMatrixWorld();

      sunSphere.position.set(sunX, sunY, sunZ);
      sunSphere.visible = showSunArc && (altitude > -3.0);

      redBeamGroup.visible = false;

      sunArcGroup.visible = showSunArc;
      compassGroup.visible = showCompass;

      const modeBadge = document.getElementById('mode-badge');

      if (altitude > 15.0) {
        modeBadge.innerText = 'Daylight (Full Sun)';
        modeBadge.style.background = 'rgba(56, 189, 248, 0.25)';
        modeBadge.style.color = '#38bdf8';

        setSkyGradient('#4d9fe8', '#9ed8f4', '#e8f7ff');
        sunLight.intensity = 2.6;
        sunLight.color.setHex(0xfffaed);
        hemiLight.intensity = 0.85;
        hemiLight.color.setHex(0xdceeff);
        ambientLight.intensity = 0.45;

        porchLight.intensity = 0;
        bayWindowGlow.intensity = 0;
        carportGlow.intensity = 0;

      } else if (altitude > 0.0) {
        modeBadge.innerText = 'Golden Hour (Low Sun)';
        modeBadge.style.background = 'rgba(245, 158, 11, 0.3)';
        modeBadge.style.color = '#f59e0b';

        const t = altitude / 15.0;
        setSkyGradient(
          new THREE.Color(0x87ceeb).lerp(new THREE.Color(0xff8c42), 1.0 - t).getStyle(),
          new THREE.Color(0x9ed8f4).lerp(new THREE.Color(0xffc078), 1.0 - t).getStyle(),
          new THREE.Color(0xe8f7ff).lerp(new THREE.Color(0xffe0a8), 1.0 - t).getStyle()
        );
        sunLight.intensity = 1.6 + t * 1.0;
        sunLight.color.setHex(0xffaa44);
        hemiLight.intensity = 0.55;
        hemiLight.color.setHex(0xffbe88);
        ambientLight.intensity = 0.35;

        porchLight.intensity = (1.0 - t) * 1.2;
        bayWindowGlow.intensity = (1.0 - t) * 1.5;
        carportGlow.intensity = (1.0 - t) * 1.0;

      } else if (altitude > -6.0) {
        modeBadge.innerText = 'Twilight (Shaded)';
        modeBadge.style.background = 'rgba(168, 85, 247, 0.25)';
        modeBadge.style.color = '#c084fc';

        setSkyGradient('#222b4a', '#3c4c72', '#69728d');
        sunLight.intensity = 0.15;
        sunLight.color.setHex(0x556688);
        hemiLight.intensity = 0.35;
        hemiLight.color.setHex(0x334466);
        ambientLight.intensity = 0.25;

        porchLight.intensity = 2.2;
        bayWindowGlow.intensity = 2.5;
        carportGlow.intensity = 1.8;

      } else {
        modeBadge.innerText = 'Night Mode';
        modeBadge.style.background = 'rgba(99, 102, 241, 0.25)';
        modeBadge.style.color = '#818cf8';

        setSkyGradient('#080b16', '#11182a', '#1e293b');
        sunLight.intensity = 0.08;
        sunLight.color.setHex(0x99aacc);
        hemiLight.intensity = 0.18;
        hemiLight.color.setHex(0x162036);
        ambientLight.intensity = 0.15;

        porchLight.intensity = 3.0;
        bayWindowGlow.intensity = 3.2;
        carportGlow.intensity = 2.4;
      }
    }

    // -------------------------------------------------------------
    // 9. Load 3D Model with Opaque DoubleSide Materials
    // -------------------------------------------------------------
    const loader = new GLTFLoader();
    const modelReference = USING_BUILT_IN_FALLBACK ? FALLBACK_PROPERTY.model.url : PROPERTY.model.url;
    const modelBaseUrl = USING_BUILT_IN_FALLBACK ? appBaseUrl : (loadedProperty.url || appBaseUrl);
    const modelUrl = resolveModelUrl({ model: { url: modelReference } }, {
      configUrl: modelBaseUrl,
      appBaseUrl,
      fallbackUrl: FALLBACK_PROPERTY.model.url
    });

    function configureModelRoot(root) {
      const scale = PROPERTY.model.scale;
      if (Array.isArray(scale)) root.scale.set(Number(scale[0]) || 1, Number(scale[1]) || 1, Number(scale[2]) || 1);
      else root.scale.setScalar(Number(scale) || 1);

      const position = PROPERTY.model.position;
      if (Array.isArray(position)) root.position.set(Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0);
      else if (position && typeof position === 'object') root.position.set(Number(position.x) || 0, Number(position.y) || 0, Number(position.z) || 0);
      root.rotation.y = THREE.MathUtils.degToRad(Number(PROPERTY.model.northOffsetDegrees) || 0);

      root.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach(material => {
          material.side = THREE.DoubleSide;
          material.shadowSide = THREE.DoubleSide;
          material.transparent = false;
          material.opacity = 1.0;
          material.depthWrite = true;
          material.depthTest = true;
          if ('roughness' in material) material.roughness = 0.8;
          if ('metalness' in material) material.metalness = 0.05;
        });
      });
    }

    const modelTiming = diagnostics?.startTiming?.('model', { source: 'configured-model-asset' });
    loader.load(
      modelUrl,
      (gltf) => {
        const root = gltf.scene;
        cancelExposureCalculation();
        viewerExposure.clearCache();
        configureModelRoot(root);
        loadedModelRoot = root;
        scene.add(root);
        diagnostics?.endTiming?.(modelTiming, { status: 'loaded' });

        const loaderElem = document.getElementById('loader');
        loaderElem.setAttribute('aria-busy', 'false');
        loaderElem.style.opacity = '0';
        setTimeout(() => loaderElem.style.display = 'none', 500);
        window.dispatchEvent(new CustomEvent('atlee:modelloaded', {
          detail: { message: 'The 3D property model is ready.' }
        }));

        rebuildSunPathArc(currentDayOfYear);
        updateSunSystem(currentDayOfYear, currentTimeMinutes);
        if (showHeatmap) void updateExposureMap();
      },
      undefined,
      (err) => {
        cancelExposureCalculation();
        loadedModelRoot = null;
        diagnostics?.endTiming?.(modelTiming, { status: 'failed' });
        diagnostics?.recordError?.(err, {
          category: 'model',
          stage: 'model',
          component: 'gltf-loader',
        });
        console.error(`Could not load configured model: ${modelUrl}`, err);
        const loaderElem = document.getElementById('loader');
        loaderElem.setAttribute('aria-busy', 'false');
        const modelErrorMessage = 'The configured 3D model could not be loaded. Solar geometry and study summaries remain available.';
        loaderElem.style.display = 'none';
        setExposureStatus(modelErrorMessage, 'error');
        window.dispatchEvent(new CustomEvent('atlee:modelerror', {
          detail: { message: modelErrorMessage }
        }));
        rebuildSunPathArc(currentDayOfYear);
        updateSunSystem(currentDayOfYear, currentTimeMinutes);
        applyEstimatedExposureMap('The model could not be loaded. Ground exposure is unavailable.', 'error');
      }
    );

    // -------------------------------------------------------------
    // 10. FLOATING ACTION BUTTON & TAB MENU LOGIC
    // -------------------------------------------------------------
    const fabToggle = document.getElementById('fab-toggle');
    const fabText = document.getElementById('fab-text');
    const fabMenuCard = document.getElementById('fab-menu-card');
    const btnCloseMenu = document.getElementById('btn-close-menu');

    const tabBtnSolar = document.getElementById('tab-btn-solar');
    const tabBtnCamera = document.getElementById('tab-btn-camera');
    const tabContentSolar = document.getElementById('tab-content-solar');
    const tabContentCamera = document.getElementById('tab-content-camera');

    let isMenuOpen = false;

    function toggleFabMenu(openState) {
      isMenuOpen = typeof openState === 'boolean' ? openState : !isMenuOpen;
      fabMenuCard.classList.toggle('active', isMenuOpen);
      fabToggle.classList.toggle('open', isMenuOpen);
      fabText.innerText = isMenuOpen ? 'Close' : 'Controls';
      fabToggle.setAttribute('aria-expanded', String(isMenuOpen));
      fabMenuCard.setAttribute('aria-hidden', String(!isMenuOpen));
      if (isMenuOpen) {
        fabMenuCard.removeAttribute('inert');
      } else {
        fabMenuCard.setAttribute('inert', '');
        if (fabMenuCard.contains(document.activeElement)) fabToggle.focus();
      }
    }

    fabToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFabMenu();
    });

    btnCloseMenu.addEventListener('click', () => {
      toggleFabMenu(false);
    });

    tabBtnSolar.addEventListener('click', () => {
      tabBtnSolar.classList.add('active');
      tabBtnCamera.classList.remove('active-cam');
      tabContentSolar.classList.add('active');
      tabContentCamera.classList.remove('active');
    });

    tabBtnCamera.addEventListener('click', () => {
      tabBtnCamera.classList.add('active-cam');
      tabBtnSolar.classList.remove('active');
      tabContentCamera.classList.add('active');
      tabContentSolar.classList.remove('active');
    });

    // Close menu when clicking outside on desktop/mobile
    window.addEventListener('pointerdown', (e) => {
      if (isMenuOpen && !e.target.closest('#fab-menu-card') && !e.target.closest('#fab-toggle') && !e.target.closest('#plant-modal')) {
        toggleFabMenu(false);
      }
    });

    // -------------------------------------------------------------
    // 11. Interactive UI Controls (Solar & Camera Tabs)
    // -------------------------------------------------------------
    const timeSlider = document.getElementById('time-slider');
    const clockDisplay = document.getElementById('clock-display');
    const dateInput = document.getElementById('date-input');
    function syncTimeControl() {
      const label = formatTime12h(currentTimeMinutes);
      timeSlider.value = currentTimeMinutes;
      timeSlider.setAttribute('aria-valuetext', label);
      clockDisplay.innerText = label;
    }
    dateInput.value = currentDate;
    syncTimeControl();
    updateLocationDisplay();

    timeSlider.addEventListener('input', (e) => {
      currentTimeMinutes = parseInt(e.target.value);
      syncTimeControl();
      updateSunSystem(currentDayOfYear, currentTimeMinutes);
      announceStateChange('time');
    });

    const presetSummer = document.getElementById('preset-summer');
    const presetToday = document.getElementById('preset-today');
    const presetWinter = document.getElementById('preset-winter');

    function setActiveDate(date, btn = null) {
      cancelExposureCalculation();
      [presetSummer, presetToday, presetWinter].forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      currentDate = normalizedDateValue(date);
      currentDayOfYear = dayOfYearFromDate(currentDate);
      dateInput.value = currentDate;
      updateLocationDisplay();

      applyEstimatedExposureMap(showHeatmap ? 'Date changed; recalculating ground sunlight…' : 'Not calculated. Run Model Exposure to study ground sunlight.');
      if (selectedZone) showZoneDetails(selectedZone);
      rebuildSunPathArc(currentDayOfYear);
      updateSunSystem(currentDayOfYear, currentTimeMinutes);
      if (showHeatmap) void updateExposureMap();
      announceStateChange('date');
    }

    dateInput.addEventListener('change', () => {
      if (dateInput.value) setActiveDate(dateInput.value);
    });
    presetSummer.addEventListener('click', () => {
      const year = Number(currentDate.slice(0, 4)) || currentYear;
      setActiveDate(`${year}-06-21`, presetSummer);
    });
    presetToday.addEventListener('click', () => setActiveDate(todayInTimeZone(), presetToday));
    presetWinter.addEventListener('click', () => {
      const year = Number(currentDate.slice(0, 4)) || currentYear;
      setActiveDate(`${year}-12-21`, presetWinter);
    });

    const toggleArc = document.getElementById('toggle-arc');
    const toggleHeatmap = document.getElementById('toggle-heatmap');
    const toggleCompass = document.getElementById('toggle-compass');
    toggleArc.classList.toggle('active', showSunArc);
    toggleHeatmap.classList.toggle('active-heatmap', showHeatmap);
    toggleCompass.classList.toggle('active', showCompass);
    heatmapGroup.visible = showHeatmap;
    compassGroup.visible = showCompass;

    toggleArc.addEventListener('click', () => {
      showSunArc = !showSunArc;
      toggleArc.classList.toggle('active', showSunArc);
      sunArcGroup.visible = showSunArc;
      sunSphere.visible = showSunArc;
      redBeamGroup.visible = false;
      announceStateChange('markers');
    });

    toggleHeatmap.addEventListener('click', () => {
      showHeatmap = !showHeatmap;
      toggleHeatmap.classList.toggle('active-heatmap', showHeatmap);
      heatmapGroup.visible = showHeatmap;

      if (showHeatmap) {
        container.style.cursor = 'crosshair';
        void updateExposureMap();
      } else {
        cancelExposureCalculation();
        if (activeExposureMethod !== 'calculated') {
          setExposureStatus('Exposure calculation paused; reopen Sun Map to calculate.', 'estimated');
        }
        container.style.cursor = 'default';
        plantModal.style.display = 'none';
        beaconGroup.visible = false;
      }
      announceStateChange('map');
    });

    toggleCompass.addEventListener('click', () => {
      showCompass = !showCompass;
      toggleCompass.classList.toggle('active', showCompass);
      compassGroup.visible = showCompass;
      announceStateChange('compass');
    });

    const btnPlay = document.getElementById('btn-play-loop');
    const btnSpeed = document.getElementById('btn-speed');

    btnPlay.addEventListener('click', () => {
      if (reduceMotion) return;
      isPlaying = !isPlaying;
      btnPlay.innerText = isPlaying ? '⏸ Pause Timelapse' : '▶ Play 24h Timelapse';
      btnPlay.style.background = isPlaying ? 'linear-gradient(135deg, #ef4444, #b91c1c)' : 'linear-gradient(135deg, #f59e0b, #d97706)';
      announceStateChange('playback');
    });

    btnSpeed.addEventListener('click', () => {
      playSpeed = playSpeed === 1 ? 2 : playSpeed === 2 ? 4 : 1;
      btnSpeed.innerText = `${playSpeed}x`;
      announceStateChange('speed');
    });

    const btnStreet = document.getElementById('btn-street');
    const btnTop = document.getElementById('btn-top');
    const btnRear = document.getElementById('btn-rear');
    const btnSky = document.getElementById('btn-sky');
    const btnIso = document.getElementById('btn-iso');
    const btnSpin = document.getElementById('btn-spin');
    const btnDemoReel = document.getElementById('btn-demo-reel');
    const cameraButtons = { street: btnStreet, top: btnTop, rear: btnRear, sky: btnSky, iso: btnIso };
    const fallbackCameraPresets = {
      street: { position: [0, 5.5, -24], target: [0, 2.2, -1] },
      top: { position: [0, 95, 15], target: [0, -3, 15] },
      rear: { position: [-18, 2.5, 36], target: [0, -3, 12] },
      sky: { position: [-58, 42, -68], target: [0, 3, 5] },
      iso: { position: [-28, 18, -16], target: [0, 0, 5] }
    };

    function configuredCameraPreset(id) {
      return cameraPreset(PROPERTY, id, fallbackCameraPresets[id]);
    }

    function applyCameraPreset(id) {
      const preset = configuredCameraPreset(id);
      if (!preset?.position || !preset?.target) return;
      camera.position.fromArray(preset.position);
      controls.target.fromArray(preset.target);
      activeView = id;
      for (const [viewId, button] of Object.entries(cameraButtons)) button.setAttribute('aria-pressed', String(viewId === id));
      announceStateChange('view');
    }

    const configuredPresets = PROPERTY.scene.cameraPresets || {};
    for (const [id, button] of Object.entries(cameraButtons)) {
      if (!configuredPresets[id]) { button.hidden = true; delete cameraButtons[id]; }
    }
    const authoredPresets = Object.keys(configuredPresets).length ? configuredPresets
      : { overview: fitPropertyCamera(PROPERTY.scene.groundBounds) };
    for (const [id, preset] of Object.entries(authoredPresets)) {
      if (!cameraButtons[id]) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn-cam-action';
        document.querySelector('.camera-grid').insertBefore(button, btnSpin);
        cameraButtons[id] = button;
        fallbackCameraPresets[id] = preset;
      }
      const button = cameraButtons[id];
      button.innerText = preset.label || id;
      button.title = preset.label || id;
      button.addEventListener('click', () => {
        clearActiveCamera(); button.classList.add('active'); applyCameraPreset(id);
      });
    }
    btnDemoReel.hidden = !['street', 'top', 'rear', 'sky', 'iso'].every(id => configuredPresets[id]);
    function clearActiveCamera() {
      [...Object.values(cameraButtons), btnDemoReel].forEach(button => button.classList.remove('active'));
    }
    clearActiveCamera();
    const initialView = cameraButtons[activeView] ? activeView : Object.keys(authoredPresets)[0];
    cameraButtons[initialView].classList.add('active');
    applyCameraPreset(initialView);

    btnSpin.addEventListener('click', () => {
      if (reduceMotion) return;
      autoRotate = !autoRotate;
      btnSpin.classList.toggle('active', autoRotate);
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 1.2;
    });

    // 🎬 Choreographed 20s Demo Sequence
    let isDemoRunning = false;
    btnDemoReel.addEventListener('click', () => {
      if (isDemoRunning || reduceMotion) return;
      isDemoRunning = true;
      clearActiveCamera();
      btnDemoReel.classList.add('active');
      btnDemoReel.innerText = '🎬 Playing Demo...';

      // Step 1: Street View Orbit (0s - 4s)
      applyCameraPreset('street');
      autoRotate = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 2.0;

      // Step 2: 24h Solar Timelapse (4s)
      setTimeout(() => {
        if (!isDemoRunning || reduceMotion) return;
        autoRotate = false;
        controls.autoRotate = false;
        applyCameraPreset('iso');
        isPlaying = true;
        playSpeed = 4;
      }, 4000);

      // Step 3: Garden Top & Heatmap Mode (9s)
      setTimeout(() => {
        if (!isDemoRunning || reduceMotion) return;
        isPlaying = false;
        applyCameraPreset('top');
        showHeatmap = true;
        toggleHeatmap.classList.add('active-heatmap');
        heatmapGroup.visible = true;
        void updateExposureMap();
      }, 9000);

      // Step 4: Zoom into Walkout Patio & Show Plant Recommendations (14s)
      setTimeout(() => {
        if (!isDemoRunning || reduceMotion) return;
        applyCameraPreset('rear');
        const patio = badgeConfigs.find(zone => zone.id === 'patio') || { title: 'Garden', pos: [0, 0, 0] };
        if (patio.id) showZoneDetails(patio.id, new THREE.Vector3(...patio.pos));
      }, 14000);

      // Step 5: Reset to Standard Orbit View (19s)
      setTimeout(() => {
        if (!isDemoRunning || reduceMotion) return;
        plantModal.style.display = 'none';
        beaconGroup.visible = false;
        showHeatmap = false;
        cancelExposureCalculation();
        toggleHeatmap.classList.remove('active-heatmap');
        heatmapGroup.visible = false;
        btnDemoReel.innerText = '🎬 Play 20s Demo Reel';
        btnDemoReel.classList.remove('active');
        btnIso.classList.add('active');
        applyCameraPreset('iso');
        isDemoRunning = false;
      }, 19500);
    });

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function getViewerState() {
      return {
        property: bootstrapContext.registrySelection?.entry?.slug || PROPERTY.package?.id || PROPERTY.slug || 'demo',
        revision: bootstrapContext.registrySelection?.entry?.revision || PROPERTY.package?.revision || null,
        date: currentDate,
        localTimeMinutes: Math.round(currentTimeMinutes),
        view: activeView,
        selectedZone,
        markers: showSunArc ? 'on' : 'off',
        compass: showCompass ? 'on' : 'off',
        map: showHeatmap ? (activeExposureMethod === 'calculated' ? 'calculated' : 'estimated') : 'off',
        exposureTier,
        playbackSpeed: playSpeed,
        playing: isPlaying,
        autoRotate,
        compareDates: [...(bootstrapContext.shareState?.compareDates || [])],
      };
    }

    function showZoneDetails(zoneId, beaconPosition) {
      const zone = PROPERTY.zones.find(candidate => candidate.id === zoneId);
      if (!zone) return;
      const display = zoneExposurePresentation(zone, getZoneAnalysis()?.zones?.[zoneId]);
      const pos = zone.position;
      selectedZone = zone.id;
      showGroundDetails(display, `${zone.title} Area`,
        beaconPosition || new THREE.Vector3(pos[0], getTerrainElevation(pos[0], pos[2]) + 0.1, pos[2]));
    }

    function selectZone(zoneId) {
      if (!zoneId) {
        btnCloseModal.click();
        return false;
      }
      const zone = badgeConfigs.find((candidate) => candidate.id === zoneId);
      if (!zone) return false;
      showHeatmap = true;
      heatmapGroup.visible = true;
      toggleHeatmap.classList.add('active-heatmap');
      selectedZone = zone.id;
      showZoneDetails(zone.id);
      announceStateChange('zone');
      return true;
    }

    function getPvPlanningShadeFactor() {
      if (!lastExposureResult?.exposures?.length) {
        return {
          sunFraction: null,
          source: 'clear-sky-unshaded',
          label: 'Clear-sky solar geometry; no model-derived shade factor is available.',
          limitations: 'Run Model Exposure for the selected date to optionally apply a coarse model-derived shade factor.',
        };
      }
      const exposures = lastExposureResult.exposures;
      let sunHours;
      let scopeLabel = 'whole-property average';
      if (selectedZone) {
        const zone = PROPERTY.zones.find(candidate => candidate.id === selectedZone);
        const summary = getZoneAnalysis()?.zones?.[selectedZone];
        if (!Number.isFinite(summary?.sunMinutes)) return {
          sunFraction: null, source: 'clear-sky-unshaded',
          label: 'No surface-specific shade result is available for this zone.',
          limitations: 'The model study samples ground, not roofs, windows, or elevated surfaces.',
        };
        sunHours = summary.sunMinutes / 60;
        scopeLabel = `selected ground zone ${zone.title}`;
      }
      if (!Number.isFinite(sunHours)) {
        sunHours = exposures.reduce((sum, exposure) => sum + exposure.sunHours, 0) / exposures.length;
      }
      const exposureDay = dayOfYearFromDate(lastExposureResult.date || currentDate);
      const daylightHours = calculateDaylightStats(exposureDay).daylightMinutes / 60;
      const sunFraction = daylightHours > 0
        ? Math.max(0, Math.min(1, sunHours / daylightHours))
        : 0;
      return {
        sunFraction,
        source: 'model-derived-selected-day-extrapolation',
        label: `${scopeLabel} model-derived direct-sun fraction from ${lastExposureResult.date || currentDate}, extrapolated across annual clear-sky geometry.`,
        limitations: 'This applies one modeled day as a coarse annual factor. Seasonal obstructions, weather, equipment temperature, clipping, snow, soiling, degradation, and electrical design are not modeled.',
      };
    }

    function getZoneAnalysis() {
      if (!lastExposureResult) return null;
      const exposureDay = dayOfYearFromDate(lastExposureResult.date || currentDate);
      return aggregateZoneExposure({
        zones: PROPERTY.zones,
        exposure: lastExposureResult,
        daylightMinutes: calculateDaylightStats(exposureDay).daylightMinutes,
      });
    }

    function applyViewerState(next = {}, { notify = true } = {}) {
      if (next.exposureTier && next.exposureTier !== exposureTier && ['quick', 'standard', 'high'].includes(next.exposureTier)) {
        cancelExposureCalculation(); exposureTier = next.exposureTier; applyEstimatedExposureMap('Quality changed. Run Model Exposure to calculate again.');
      }
      if (next.date && next.date !== currentDate) setActiveDate(next.date);
      if (Number.isInteger(next.localTimeMinutes)) {
        currentTimeMinutes = Math.max(0, Math.min(1439, next.localTimeMinutes));
        syncTimeControl();
        updateSunSystem(currentDayOfYear, currentTimeMinutes);
      }
      if (next.view && cameraButtons[next.view]) {
        clearActiveCamera();
        cameraButtons[next.view].classList.add('active');
        applyCameraPreset(next.view);
      }
      if (next.markers === 'on' || next.markers === 'off') {
        showSunArc = next.markers === 'on';
        toggleArc.classList.toggle('active', showSunArc);
        sunArcGroup.visible = showSunArc;
        sunSphere.visible = showSunArc;
      }
      if (next.compass === 'on' || next.compass === 'off') {
        showCompass = next.compass === 'on';
        toggleCompass.classList.toggle('active', showCompass);
        compassGroup.visible = showCompass;
      }
      if (next.map && ['off', 'estimated', 'calculated'].includes(next.map)) {
        showHeatmap = next.map !== 'off';
        heatmapGroup.visible = showHeatmap;
        toggleHeatmap.classList.toggle('active-heatmap', showHeatmap);
        if (showHeatmap) void updateExposureMap();
        else cancelExposureCalculation();
      }
      if (Number.isFinite(next.playbackSpeed)) {
        playSpeed = Math.max(0.25, Math.min(16, Number(next.playbackSpeed)));
        btnSpeed.innerText = `${playSpeed}x`;
      }
      if (typeof next.selectedZone === 'string' || next.selectedZone === null) selectedZone = next.selectedZone;
      bootstrapContext.shareState = { ...bootstrapContext.shareState, ...next };
      if (notify) announceStateChange('history');
    }

    const viewerRuntime = {
      property: PROPERTY,
      usedFallback: USING_BUILT_IN_FALLBACK,
      get state() { return getViewerState(); },
      get exposure() { return lastExposureResult; },
      get exposureMode() { return viewerExposure.mode; },
      get exposureTier() { return exposureTier; },
      applyState: applyViewerState,
      setExposureTier(tier) {
        if (!['quick', 'standard', 'high'].includes(tier)) return false;
        if (tier !== exposureTier) {
          cancelExposureCalculation();
          exposureTier = tier;
          applyEstimatedExposureMap('Quality changed. Run Model Exposure to calculate again.');
          if (selectedZone) showZoneDetails(selectedZone);
          announceStateChange('exposure-tier');
        }
        return true;
      },
      runExposure() {
        showHeatmap = true;
        heatmapGroup.visible = true;
        toggleHeatmap.classList.add('active-heatmap');
        return updateExposureMap();
      },
      cancelExposure() {
        cancelExposureCalculation();
        applyEstimatedExposureMap('Exposure calculation canceled. No new sunlight hours are available.');
        if (selectedZone) showZoneDetails(selectedZone);
        window.dispatchEvent(new CustomEvent('atlee:exposureerror', {
          detail: { message: 'Exposure calculation canceled.' }
        }));
      },
      setReducedMotion(reduced) {
        reduceMotion = Boolean(reduced);
        if (reduceMotion) {
          isPlaying = false;
          autoRotate = false;
          isDemoRunning = false;
          controls.autoRotate = false;
          btnPlay.innerText = '▶ Play 24h Timelapse';
          btnSpin.classList.remove('active');
          btnDemoReel.classList.remove('active');
          btnDemoReel.innerText = '🎬 Play 20s Demo Reel';
        }
      },
      setActiveDate,
      applyCameraPreset,
      selectZone,
      getPvPlanningShadeFactor,
      getZoneAnalysis,
      announceStateChange,
    };
    window.AtleeViewer = viewerRuntime;
    window.dispatchEvent(new CustomEvent('atlee:ready', { detail: viewerRuntime }));

    // -------------------------------------------------------------
    // 12. Animation Render Loop
    // -------------------------------------------------------------
    let clock = new THREE.Clock();
    const firstRenderTiming = diagnostics?.startTiming?.('first-render', { renderer: 'webgl' });
    let firstRenderRecorded = false;

    function animate() {
      requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();
      if (beaconGroup.visible && !reduceMotion) {
        const s = 1.0 + 0.15 * Math.sin(elapsedTime * 4.0);
        beaconRing.scale.set(s, s, s);
      }

      if (isPlaying) {
        currentTimeMinutes = (currentTimeMinutes + playSpeed) % 1440;
        syncTimeControl();
        updateSunSystem(currentDayOfYear, currentTimeMinutes);
      }

      controls.update();
      renderer.render(scene, camera);
      if (!firstRenderRecorded) {
        firstRenderRecorded = true;
        diagnostics?.endTiming?.(firstRenderTiming, { status: 'rendered' });
      }
    }

    animate();

    export { viewerRuntime };
