import { ANOMALY_CONFIG, ASTEROID_CONFIG, NEMESIS_CONFIG, PLANET_CONFIG, PLAYER_CONFIG, SHIP_CONFIG, STATION_CONFIG, FPS, WORLD_BOUNDS } from '../core/config.js';
import { State } from '../core/state.js';
import { AudioEngine } from '../audio/audio.js';
import { addScreenMessage } from '../graphics/render.js';
import { mulberry32, dist } from '../utils/utils.js';
import { t } from '../utils/i18n.js';

export function createSquadSlots() {
    return SHIP_CONFIG.SQUAD_SLOTS.map(slot => ({ x: slot.x, y: slot.y, occupant: null }));
}

export function newPlayerShip() {
    return {
        a: 90 / 180 * Math.PI,
        blinkNum: 30,
        dead: false,
        effectiveR: SHIP_CONFIG.SIZE / 2,
        isFriendly: true,
        leaderRef: null,
        lives: PLAYER_CONFIG.INITIAL_LIVES,
        loneWolf: false,
        maxShield: SHIP_CONFIG.BASE_MAX_SHIELD,
        r: SHIP_CONFIG.SIZE / 2,
        role: 'leader',
        score: 0,
        shield: SHIP_CONFIG.BASE_MAX_SHIELD,
        squadId: null,
        squadSlots: createSquadSlots(),
        structureHP: SHIP_CONFIG.RESISTANCE,
        thrusting: false,
        tier: 0,
        // Weapon Properties (Default for Player)
        bulletSpeed: 25,
        bulletLife: 50,
        type: 'ship',
        transformationTimer: 0,
        formationOffset: { x: 0, y: 0 }
    };
}

export function createAsteroid(x, y, r, z = 0, forcedName = null) {
    let isPlanet = false;

    // Determine if this asteroid should become a planet based on size request
    if (r > ASTEROID_CONFIG.MAX_SIZE) {
        const currentPlanets = State.roids.filter(ro => ro.isPlanet && !ro._destroyed).length;
        if (currentPlanets < PLANET_CONFIG.LIMIT && !State.victoryState && !(State.playerShip && State.playerShip.dead && State.playerShip.lives <= 0)) {
            isPlanet = true;
            r = Math.min(r, PLANET_CONFIG.SIZE); // Cap at planet max
        } else {
            // Cannot spawn a planet, cap it at asteroid max
            r = Math.min(r, ASTEROID_CONFIG.MAX_SIZE);
        }
    } else {
        r = Math.min(r, ASTEROID_CONFIG.MAX_SIZE); // Standard asteroid cap
    }

    const roid = {
        id: ++State.roidCounter,
        x, y,
        xv: (0.1 + Math.random() * 5 / FPS) * (Math.random() < 0.5 ? 1 : -1) * (isPlanet ? 0.2 : 1),
        yv: (0.1 + Math.random() * 5 / FPS) * (Math.random() < 0.5 ? 1 : -1) * (isPlanet ? 0.2 : 1),
        r,
        a: Math.random() * Math.PI * 2,
        vert: Math.floor(Math.random() * 8 + 6),
        offs: [],
        mass: r * r * 0.05,
        isPlanet,
        z,
        zSpeed: 0,
        name: forcedName,
        textureData: null,
        blinkNum: 0,
        color: `hsl(${Math.random() * 360}, ${Math.random() * 10}%, ${15 + Math.random() * 35}%)` // Gray tones with brightness variation
    };

    if (isPlanet) initializePlanetAttributes(roid, null, forcedName);
    for (let i = 0; i < roid.vert; i++) {
        roid.offs.push(Math.random() * 0.3 * 2 + 1 - 0.3);
    }
    return roid;
}

export function splitAsteroid(roid, baseAngle = 0, blinkNum = 30) {
    const newSize = roid.r * 0.5;
    if (newSize < ASTEROID_CONFIG.MIN_SIZE) return;

    const dynamicOffset = roid.r * (ASTEROID_CONFIG.SPLIT_OFFSET / ASTEROID_CONFIG.MAX_SIZE);
    const cos = Math.cos(baseAngle);
    const sin = Math.sin(baseAngle);

    const frag1 = createAsteroid(roid.x + cos * dynamicOffset, roid.y + sin * dynamicOffset, newSize);
    frag1.xv = roid.xv + cos * ASTEROID_CONFIG.MAX_SPEED;
    frag1.yv = roid.yv + sin * ASTEROID_CONFIG.MAX_SPEED;
    frag1.blinkNum = blinkNum;
    State.roids.push(frag1);

    const frag2 = createAsteroid(roid.x - cos * dynamicOffset, roid.y - sin * dynamicOffset, newSize);
    frag2.xv = roid.xv - cos * ASTEROID_CONFIG.MAX_SPEED;
    frag2.yv = roid.yv - sin * ASTEROID_CONFIG.MAX_SPEED;
    frag2.blinkNum = blinkNum;
    State.roids.push(frag2);
}

export function initializePlanetAttributes(roid, forcedHue = null, forcedName = null) {
    if (roid.isPlanet && roid.textureData) return;
    const seed = Math.floor(Math.random() * 100000);
    const rng = mulberry32(seed);
    const hue = forcedHue !== null ? forcedHue : rng() * 360;
    const existingPlanetsCount = State.roids.filter(r => r.isPlanet && !r._destroyed && r.id !== roid.id).length;

    // Final safety check: if we're already at the limit, cancel promotion (unless it's the home planet)
    if (existingPlanetsCount >= PLANET_CONFIG.LIMIT && forcedName !== t("game.home_planet_name")) {
        return;
    }

    roid.isPlanet = true;
    roid.name = forcedName || generatePlanetName();

    if (State.gameRunning) {
        console.log("Count: " + (existingPlanetsCount + 1) + ". New planet " + roid.name + ".");
    }

    // ELLIPTICAL ORBITAL INITIALIZATION
    // Each planet has its own unique center of gravity (not all orbiting 0,0)
    const maxCenterOffset = WORLD_BOUNDS * 0.3; // Centers can be up to 30% of world bounds from origin
    const centerDist = rng() * maxCenterOffset;
    const centerAng = rng() * Math.PI * 2;
    roid.orbitCenterX = Math.cos(centerAng) * centerDist;
    roid.orbitCenterY = Math.sin(centerAng) * centerDist;

    const dx = roid.x - roid.orbitCenterX;
    const dy = roid.y - roid.orbitCenterY;
    const distFromCenter = dist(0, 0, dx, dy);

    // Semi-major axis (a) - the longest radius of the ellipse
    roid.semiMajorAxis = Math.max(1000, distFromCenter * (0.8 + rng() * 0.4));

    // Eccentricity determines how "elliptical" the orbit is (0 = circle, close to 1 = very elongated)
    roid.eccentricity = 0.1 + rng() * 0.6;

    // Semi-minor axis (b) calculated from eccentricity: b = a * sqrt(1 - e^2)
    roid.semiMinorAxis = roid.semiMajorAxis * Math.sqrt(1 - roid.eccentricity * roid.eccentricity);

    // Initial angle (eccentric anomaly) based on current position
    roid.orbitAngle = Math.atan2(dy, dx);

    // Random rotation of the ellipse itself (orientation in space)
    roid.ellipseRotation = rng() * Math.PI * 2;

    // Orbital Speed - angular velocity (radians per frame), slower for larger orbits
    const baseOrbitSpeed = 0.5;
    roid.orbitSpeed = (baseOrbitSpeed / roid.semiMajorAxis) * (rng() < 0.5 ? 1 : -1);

    roid.zSpeed = (rng() * 0.001) + 0.0005;

    // Softer, more realistic base colors
    const isDesolate = rng() < 0.2; // 20% chance of being a dead/moon-like world
    const wSat = isDesolate ? 10 + rng() * 20 : 40 + rng() * 30;
    const wLight = isDesolate ? 20 + rng() * 20 : 25 + rng() * 20;
    const lSat = isDesolate ? 5 + rng() * 15 : 30 + rng() * 35;
    const lLight = isDesolate ? 30 + rng() * 20 : 35 + rng() * 20;

    const textureData = {
        waterColor: `hsl(${hue}, ${wSat}%, ${wLight}%)`,
        landColor: `hsl(${hue + (rng() * 60 - 30)}, ${lSat}%, ${lLight}%)`,
        craterColor: `rgba(0, 0, 0, 0.25)`,
        landmasses: [],
        craters: []
    };

    for (let i = 0; i < 5 + Math.floor(rng() * 3); i++) {
        const startAngle = rng() * Math.PI * 2;
        const radiusFactor = 0.3 + rng() * 0.45;
        const vertices = 15 + Math.floor(rng() * 15);
        const vertexOffsets = [];
        for (let j = 0; j < vertices; j++) vertexOffsets.push(0.7 + rng() * 0.3);
        textureData.landmasses.push({ startAngle, radiusFactor, vertices, vertexOffsets });
    }

    for (let i = 0; i < 10; i++) {
        textureData.craters.push({
            xFactor: (rng() - 0.5) * 1.5,
            yFactor: (rng() - 0.5) * 1.5,
            rFactor: 0.05 + rng() * 0.1
        });
    }

    roid.zWait = 0;
    roid.textureData = textureData;
}

export function createAsteroidBelt(cx, cy, innerRadius, outerRadius, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = innerRadius + Math.random() * (outerRadius - innerRadius);
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;
        const r = (Math.random() < 0.5 ? 0.5 : 0.25) * ASTEROID_CONFIG.MAX_SIZE;
        const roid = createAsteroid(x, y, r);

        // Small tangential velocity to give a sense of belt movement
        const orbitalSpeed = 0.2 + Math.random() * 0.3;
        const tangentAngle = angle + Math.PI / 2;
        const dir = Math.random() < 0.5 ? 1 : -1;
        roid.xv += Math.cos(tangentAngle) * orbitalSpeed * dir;
        roid.yv += Math.sin(tangentAngle) * orbitalSpeed * dir;

        State.roids.push(roid);
    }
}

export function spawnStation(hostPlanet = null) {
    if (!hostPlanet) {
        const nearbyPlanets = State.roids.filter(r => r.isPlanet);
        if (nearbyPlanets.length === 0) {
            State.stationSpawnTimer = STATION_CONFIG.SPAWN_TIMER;
            return;
        }
        hostPlanet = nearbyPlanets[Math.floor(Math.random() * nearbyPlanets.length)];
    }

    const stationR = STATION_CONFIG.RADIUS;
    const orbitDistance = hostPlanet.r + (hostPlanet.r * STATION_CONFIG.ORBIT_FACTOR) + stationR;
    const orbitAngle = Math.random() * Math.PI * 2;

    const startX = hostPlanet.x + Math.cos(orbitAngle) * orbitDistance;
    const startY = hostPlanet.y + Math.sin(orbitAngle) * orbitDistance;

    const friendly = State.playerShip.loneWolf === false && State.homePlanetId !== null && hostPlanet.id === State.homePlanetId;
    const planetHue = hostPlanet.textureData && hostPlanet.textureData.fleetHue !== undefined
        ? hostPlanet.textureData.fleetHue
        : (Math.floor(Math.random() * 260) + 260) % 360;

    const station = {
        type: 'station',
        x: startX,
        y: startY,
        xv: hostPlanet.xv,
        yv: hostPlanet.yv,
        r: stationR,
        a: Math.random() * Math.PI * 2,
        rotSpeed: STATION_CONFIG.ROT_SPEED,
        structureHP: STATION_CONFIG.RESISTANCE,
        shieldHitTimer: 0,
        spawnTimer: 180,
        reloadTime: 120,
        hostPlanet,
        orbitDistance,
        orbitAngle,
        orbitSpeed: (Math.random() > 0.5 ? 1 : -1) * STATION_CONFIG.ORBIT_SPEED,
        fleetHue: friendly ? SHIP_CONFIG.FRIENDLY_BLUE_HUE : planetHue,
        blinkNum: 60,
        z: 0,
        hostPlanetId: hostPlanet.id,
        isFriendly: friendly,
        bulletSpeed: 20,
        bulletSize: 6,
        bulletLife: 50,
        effectiveR: stationR,
        formationOffset: { x: 0, y: 0 }
    };
    State.ships.push(station);
    State.stationSpawnTimer = STATION_CONFIG.SPAWN_TIMER + Math.random() * STATION_CONFIG.SPAWN_TIMER;
    return station;
}

export function spawnShipsSquad(station, minTier = 0) {
    const currentFactionShips = State.ships.filter(
        en => en.type === 'ship' && en.homeStation && en.homeStation.hostPlanetId === station.hostPlanetId
    ).length;
    const spawnCount = SHIP_CONFIG.PLANET_LIMIT - currentFactionShips;

    if (spawnCount <= 0) return;

    const baseTier = Math.max(minTier, (station.hostPlanet && station.hostPlanet.initialEnemyTier) || 0);

    for (let i = 0; i < spawnCount; i++) {
        const spawnDist = station.r * 2.0 + Math.random() * 50;
        const spawnAngle = Math.random() * Math.PI * 2;
        const shipTier = baseTier > 0 ? Math.max(0, baseTier - (i % 2)) : 0;

        State.ships.push({
            a: spawnAngle + Math.PI,
            aiState: 'FORMATION',
            blinkNum: 30,
            fleetHue: station.fleetHue,
            formationOffset: { x: 0, y: 0 },
            isFriendly: station.isFriendly,
            leaderRef: null,
            r: SHIP_CONFIG.SIZE / 2,
            reloadTime: 100 + Math.random() * 100,
            role: 'wingman', // Spawns as independent stray
            score: shipTier * SHIP_CONFIG.EVOLUTION_SCORE_STEP,
            shieldHitTimer: 0,
            squadId: null,
            structureHP: SHIP_CONFIG.RESISTANCE,
            thrusting: false,
            tier: shipTier,
            type: 'ship',
            x: station.x + Math.cos(spawnAngle) * spawnDist,
            xv: station.xv + (Math.random() - 0.5),
            y: station.y + Math.sin(spawnAngle) * spawnDist,
            yv: station.yv + (Math.random() - 0.5),
            z: 0,
            homeStation: station,
            bulletSpeed: 15 + Math.random() * 10,
            bulletSize: 4 + Math.random() * 3,
            bulletLife: 45 + Math.random() * 15
        });
    }
}

export function generatePlanetName() {
    const legendNames = [t("game.home_planet_name"), ...PLANET_CONFIG.NAMES];
    const presentNames = State.roids.filter(r => r.isPlanet && !r._destroyed).map(r => r.name);

    for (const name of legendNames) {
        if (!presentNames.includes(name)) return name;
    }

    return `SECTOR-${State.roidCounter}`;
}

export function spawnDistantPlanet(announce = true) {
    if (PLANET_CONFIG.LIMIT <= 0) return null;
    const currentPlanets = State.roids.filter(r => r.isPlanet && !r._destroyed).length;
    if (currentPlanets >= PLANET_CONFIG.LIMIT) return null;

    const minDist = WORLD_BOUNDS * PLANET_CONFIG.DISTANT_MIN_DIST_FACTOR;
    const maxDist = WORLD_BOUNDS * PLANET_CONFIG.DISTANT_MAX_DIST_FACTOR;

    let spawnX = 0;
    let spawnY = 0;
    let foundSpot = false;

    for (let attempt = 0; attempt < 25; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = minDist + Math.random() * (maxDist - minDist);
        const cx = Math.cos(angle) * distance;
        const cy = Math.sin(angle) * distance;

        const tooCloseToPlanet = State.roids.some(
            r => r.isPlanet && !r._destroyed && dist(cx, cy, r.x, r.y) < PLANET_CONFIG.SIZE * 4.5
        );
        const tooCloseToPlayer = dist(cx, cy, State.worldOffsetX, State.worldOffsetY) < PLANET_CONFIG.SIZE * 3.0;

        if (!tooCloseToPlanet && !tooCloseToPlayer) {
            spawnX = cx;
            spawnY = cy;
            foundSpot = true;
            break;
        }
    }

    if (!foundSpot) return null;

    const planetRadius = PLANET_CONFIG.SIZE * (0.8 + Math.random() * 0.25);
    const planet = createAsteroid(spawnX, spawnY, planetRadius, 0);
    if (!planet.isPlanet) {
        initializePlanetAttributes(planet);
    }

    const fleetHue = (Math.floor(Math.random() * 260) + 260) % 360;
    if (planet.textureData) {
        planet.textureData.fleetHue = fleetHue;
    }

    const distRatio = Math.min(1, Math.max(0, (Math.hypot(spawnX, spawnY) - minDist) / Math.max(1, maxDist - minDist)));
    const tierRange = PLANET_CONFIG.DISTANT_ENEMY_MAX_TIER - PLANET_CONFIG.DISTANT_ENEMY_MIN_TIER;
    planet.initialEnemyTier = PLANET_CONFIG.DISTANT_ENEMY_MIN_TIER + Math.round(distRatio * tierRange);
    planet.blinkNum = 90;

    State.roids.unshift(planet);

    const stationCount = Math.floor(Math.random() * STATION_CONFIG.PER_PLANET) + 1;
    for (let i = 0; i < stationCount; i++) {
        const station = spawnStation(planet);
        if (station && i === 0) {
            spawnShipsSquad(station, planet.initialEnemyTier);
        }
    }

    if (announce && State.gameRunning) {
        addScreenMessage(t("game.distant_planet_detected", { name: planet.name }), "#ff8800");
    }

    return planet;
}

export function createWormholes() {
    State.wormholes = [];
    const minDistFromCenter = PLANET_CONFIG.HOME_SPAWN_RANGE * 1.4;
    const maxDistFromCenter = WORLD_BOUNDS * 0.72;
    const pairHues = [280, 175, 45];

    const pickSafePortalCoords = (baseAngle) => {
        for (let attempt = 0; attempt < 20; attempt++) {
            const angle = baseAngle + (Math.random() - 0.5) * 0.5;
            const distance = minDistFromCenter + Math.random() * (maxDistFromCenter - minDistFromCenter);
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;

            const tooCloseToPlanet = State.roids.some(
                r => r.isPlanet && dist(x, y, r.x, r.y) < r.r + ANOMALY_CONFIG.WORMHOLE_PULL_RANGE * 1.5
            );
            const tooCloseToWormhole = State.wormholes.some(
                w => dist(x, y, w.x, w.y) < ANOMALY_CONFIG.WORMHOLE_PULL_RANGE * 2
            );

            if (!tooCloseToPlanet && !tooCloseToWormhole) {
                return { x, y };
            }
        }
        return {
            x: Math.cos(baseAngle) * ((minDistFromCenter + maxDistFromCenter) * 0.5),
            y: Math.sin(baseAngle) * ((minDistFromCenter + maxDistFromCenter) * 0.5)
        };
    };

    for (let p = 0; p < ANOMALY_CONFIG.WORMHOLE_PAIRS; p++) {
        const angleA = (p * Math.PI / ANOMALY_CONFIG.WORMHOLE_PAIRS) + Math.random() * 0.6;
        const angleB = angleA + Math.PI + (Math.random() - 0.5) * 0.4;
        const posA = pickSafePortalCoords(angleA);
        const posB = pickSafePortalCoords(angleB);
        const hue = pairHues[p % pairHues.length];
        const idA = p * 2 + 1;
        const idB = p * 2 + 2;

        const portalA = {
            id: idA,
            partnerId: idB,
            pairIndex: p,
            x: posA.x,
            y: posA.y,
            r: ANOMALY_CONFIG.WORMHOLE_RADIUS,
            hue,
            angle: 0
        };
        const portalB = {
            id: idB,
            partnerId: idA,
            pairIndex: p,
            x: posB.x,
            y: posB.y,
            r: ANOMALY_CONFIG.WORMHOLE_RADIUS,
            hue,
            angle: Math.PI
        };
        portalA.partner = portalB;
        portalB.partner = portalA;
        State.wormholes.push(portalA, portalB);
    }
}

export function promoteToNemesis(ship) {
    if (!ship || ship.isNemesis || ship.isFriendly) return;
    const names = NEMESIS_CONFIG.NAMES;
    const name = names[Math.floor(Math.random() * names.length)];

    ship.isNemesis = true;
    ship.nemesisName = name;
    ship.score = Math.max(ship.score || 0, NEMESIS_CONFIG.MIN_TIER * SHIP_CONFIG.EVOLUTION_SCORE_STEP);
    ship.tier = Math.max(ship.tier || 0, NEMESIS_CONFIG.MIN_TIER);
    ship.maxStructureHP = SHIP_CONFIG.RESISTANCE * NEMESIS_CONFIG.HP_MULTIPLIER;
    ship.structureHP = ship.maxStructureHP;
    ship.r = SHIP_CONFIG.SIZE * 0.75;
    ship.fleetHue = NEMESIS_CONFIG.HUE;
    ship.role = 'leader';
    if (!ship.squadSlots) {
        ship.squadSlots = createSquadSlots();
    }

    State.activeNemesis = ship;
    addScreenMessage(t("game.nemesis_arrived", { name }), "#ff0055");
    AudioEngine.playNemesisAlert();
}
