import { ASTEROID_CONFIG, PLANET_CONFIG, PLAYER_CONFIG, SHIP_CONFIG, STATION_CONFIG, FPS, WORLD_BOUNDS } from '../core/config.js';
import { State } from '../core/state.js';
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

    State.ships.push({
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
        fleetHue: friendly ? SHIP_CONFIG.FRIENDLY_BLUE_HUE : (Math.floor(Math.random() * 260) + 260) % 360, // Avoid blue (160-260)
        blinkNum: 60,
        z: 0,
        hostPlanetId: hostPlanet.id,
        isFriendly: friendly,
        bulletSpeed: 20,
        bulletSize: 6,
        bulletLife: 50,
        effectiveR: stationR,
        formationOffset: { x: 0, y: 0 }
    });
    State.stationSpawnTimer = STATION_CONFIG.SPAWN_TIMER + Math.random() * STATION_CONFIG.SPAWN_TIMER;
}

export function spawnShipsSquad(station) {
    const currentFactionShips = State.ships.filter(
        en => en.type === 'ship' && en.homeStation && en.homeStation.hostPlanetId === station.hostPlanetId
    ).length;
    const spawnCount = SHIP_CONFIG.PLANET_LIMIT - currentFactionShips;

    if (spawnCount <= 0) return;

    for (let i = 0; i < spawnCount; i++) {
        const spawnDist = station.r * 2.0 + Math.random() * 50;
        const spawnAngle = Math.random() * Math.PI * 2;

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
            score: 0,
            shieldHitTimer: 0,
            squadId: null,
            structureHP: SHIP_CONFIG.RESISTANCE,
            thrusting: false,
            tier: 0,
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
    const legendNames = [t("game.home_planet_name"), t("game.planet_name_2"), t("game.planet_name_3")];
    const presentNames = State.roids.filter(r => r.isPlanet && !r._destroyed).map(r => r.name);

    for (const name of legendNames) {
        if (!presentNames.includes(name)) return name;
    }

    return "DEEP SPACE";
}
