import { ASTEROID_CONFIG, BOUNDARY_CONFIG, GALAXY_CONFIG, PLANET_CONFIG, PLAYER_CONFIG, SCORE_REWARDS, SHIP_CONFIG, STATION_CONFIG, FPS, FRICTION, G_CONST, MAX_Z_DEPTH, MIN_DURATION_TAP_TO_MOVE, SCALE_IN_MOUSE_MODE, SCALE_IN_TOUCH_MODE, WORLD_BOUNDS, ZOOM_LEVELS, suffixes, syllables, DOM } from '../core/config.js';
import { State } from '../core/state.js';
import { mulberry32, getShapeName } from '../utils/utils.js';
import { addScreenMessage, updateAsteroidCounter, drawLives } from '../graphics/render.js';
import { t } from '../utils/i18n.js';

export function newPlayerShip() {
    const startingHP = SHIP_CONFIG.RESISTANCE;
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
        squadSlots: [
            { x: -150, y: -150, occupant: null }, { x: 150, y: -150, occupant: null },
            { x: -300, y: -300, occupant: null }, { x: 300, y: -300, occupant: null },
            { x: -450, y: -450, occupant: null }, { x: 450, y: -450, occupant: null } // 6 wingman slots
        ],
        structureHP: startingHP,
        thrusting: false,
        tier: 0,
        // Weapon Properties (Default for Player)
        bulletSpeed: 25,
        bulletLife: 50,
        bulletSize: 6,
        type: 'ship',
        transformationTimer: 0
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

    let roid = {
        id: ++State.roidCounter,
        x, y,
        xv: (0.1 + Math.random() * 5 / FPS) * (Math.random() < 0.5 ? 1 : -1) * (isPlanet ? 0.2 : 1),
        yv: (0.1 + Math.random() * 5 / FPS) * (Math.random() < 0.5 ? 1 : -1) * (isPlanet ? 0.2 : 1),
        r, a: Math.random() * Math.PI * 2,
        vert: Math.floor(Math.random() * 8 + 6), offs: [],
        mass: r * r * 0.05,
        isPlanet: isPlanet,
        z: z,
        zSpeed: 0,
        name: forcedName,
        textureData: null,
        rings: null,
        blinkNum: 0,
        color: `hsl(${Math.random() * 360}, ${Math.random() * 10}%, ${15 + Math.random() * 35}%)` // Gray tones with brightness variation
    };
    if (isPlanet) initializePlanetAttributes(roid, null, forcedName);
    for (let i = 0; i < roid.vert; i++) roid.offs.push(Math.random() * 0.3 * 2 + 1 - 0.3);
    return roid;
}

export function initializePlanetAttributes(roid, forcedHue = null, forcedName = null) {
    if (roid.isPlanet && roid.textureData) return;
    const r = roid.r;
    const seed = Math.floor(Math.random() * 100000);
    const rng = mulberry32(seed);
    const hue = forcedHue !== null ? forcedHue : rng() * 360;
    roid.isPlanet = true;
    roid.name = forcedName || generatePlanetName();

    const countInState = State.roids.filter(r => r.isPlanet && !r._destroyed).length;
    const isNewToState = !State.roids.find(r => r.id === roid.id);
    const totalPlanetsCount = countInState + (isNewToState ? 1 : 0);

    if (State.gameRunning) console.log("Count: " + totalPlanetsCount + ". New planet " + roid.name + ".");

    // ELLIPTICAL ORBITAL INITIALIZATION
    // Each planet has its own unique center of gravity (not all orbiting 0,0)
    // Generate a random offset for this planet's orbital center
    const maxCenterOffset = WORLD_BOUNDS * 0.3; // Centers can be up to 30% of world bounds from origin
    const centerDist = rng() * maxCenterOffset;
    const centerAng = rng() * Math.PI * 2;
    roid.orbitCenterX = Math.cos(centerAng) * centerDist;
    roid.orbitCenterY = Math.sin(centerAng) * centerDist;

    // Calculate distance from this planet's orbital center
    const dx = roid.x - roid.orbitCenterX;
    const dy = roid.y - roid.orbitCenterY;
    const distFromCenter = Math.hypot(dx, dy);

    // Semi-major axis (a) - the longest radius of the ellipse
    roid.semiMajorAxis = Math.max(1000, distFromCenter * (0.8 + rng() * 0.4));

    // Eccentricity determines how "elliptical" the orbit is (0 = circle, close to 1 = very elongated)
    // Range from 0.1 to 0.7 for variety
    roid.eccentricity = 0.1 + rng() * 0.6;

    // Semi-minor axis (b) calculated from eccentricity: b = a * sqrt(1 - e^2)
    roid.semiMinorAxis = roid.semiMajorAxis * Math.sqrt(1 - roid.eccentricity * roid.eccentricity);

    // Initial angle (eccentric anomaly) based on current position
    roid.orbitAngle = Math.atan2(dy, dx);

    // Random rotation of the ellipse itself (orientation in space)
    roid.ellipseRotation = rng() * Math.PI * 2;

    // Orbital Speed - angular State.velocity (radians per frame)
    // Slower for larger orbits (Kepler's third law approximation)
    const baseOrbitSpeed = 0.5; // Majestic, slow, elegant orbits
    roid.orbitSpeed = (baseOrbitSpeed / roid.semiMajorAxis) * (rng() < 0.5 ? 1 : -1);

    roid.zSpeed = (rng() * 0.001) + 0.0005;

    // Softer, more realistic base colors
    const isDesolate = rng() < 0.2; // 20% chance of being a dead/moon-like world

    let wSat = isDesolate ? 10 + rng() * 20 : 40 + rng() * 30;
    let wLight = isDesolate ? 20 + rng() * 20 : 25 + rng() * 20;

    let lSat = isDesolate ? 5 + rng() * 15 : 30 + rng() * 35;
    let lLight = isDesolate ? 30 + rng() * 20 : 35 + rng() * 20;

    // Atmosphere is generally slightly brighter than water but very transparent
    let aHue = hue + (rng() * 40 - 20); // slight atmosphere shift

    let textureData = {
        waterColor: `hsl(${hue}, ${wSat}%, ${wLight}%)`,
        landColor: `hsl(${hue + (rng() * 60 - 30)}, ${lSat}%, ${lLight}%)`, // Slightly shifted hue for land
        craterColor: `rgba(0, 0, 0, 0.25)`,
        landmasses: [],
        craters: []
    };
    for (let i = 0; i < 5 + Math.floor(rng() * 3); i++) {
        const startAngle = rng() * Math.PI * 2;
        const radiusFactor = (0.4 + rng() * 0.5);
        const vertices = 15 + Math.floor(rng() * 15); // More vertices for smoother landmasses
        const vertexOffsets = [];
        for (let j = 0; j < vertices; j++) vertexOffsets.push(0.7 + rng() * 0.3);
        textureData.landmasses.push({ startAngle, radiusFactor, vertices, vertexOffsets });
    }
    for (let i = 0; i < 10; i++) {
        textureData.craters.push({
            xFactor: (rng() - 0.5) * 1.5,
            yFactor: (rng() - 0.5) * 1.5,
            rFactor: (0.05 + rng() * 0.1)
        });
    }
    roid.zWait = 0;
    roid.textureData = textureData;
    if (Math.random() < 0.25 || r > ASTEROID_CONFIG.MAX_SIZE + 100) {
        roid.rings = {
            tilt: (rng() * 0.4 - 0.2) + (Math.PI / 2),
            bands: [
                { rRatio: 1.2, wRatio: 0.1, alpha: 0.6, color: `hsl(${hue + 60}, 40%, 70%)` },
                { rRatio: 1.5, wRatio: 0.15, alpha: 0.5, color: `hsl(${hue - 60}, 50%, 50%)` }
            ]
        };
    } else {
        roid.rings = null;
    }
}



export function createAsteroidBelt(cx, cy, innerRadius, outerRadius, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = innerRadius + Math.random() * (outerRadius - innerRadius);
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;
        const r = (Math.random() < 0.5 ? 0.5 : 0.25) * ASTEROID_CONFIG.MAX_SIZE;
        const roid = createAsteroid(x, y, r);

        // Small tangential State.velocity to give a sense of belt movement
        const orbitalSpeed = 0.2 + Math.random() * 0.3;
        const tangentAngle = angle + Math.PI / 2;
        roid.xv += Math.cos(tangentAngle) * orbitalSpeed * (Math.random() < 0.5 ? 1 : -1);
        roid.yv += Math.sin(tangentAngle) * orbitalSpeed * (Math.random() < 0.5 ? 1 : -1);

        State.roids.push(roid);
    }
}

export function spawnStation(hostPlanet = null) {
    if (!hostPlanet) {
        const nearbyPlanets = State.roids.filter(r => r.isPlanet);
        if (nearbyPlanets.length === 0) {
            State.stationSpawnTimer = 300;
            return;
        }

        // Select a random planet to host the station
        hostPlanet = nearbyPlanets[Math.floor(Math.random() * nearbyPlanets.length)];
    }

    const SAFE_ORBIT_FACTOR = 0.3; // Much closer
    const STATION_R = 70;
    const orbitDistance = hostPlanet.r + (hostPlanet.r * SAFE_ORBIT_FACTOR) + STATION_R;

    const orbitAngle = Math.random() * Math.PI * 2;

    // Calculate initial ABSOLUTE WORLD position relative to the planet center
    const startX = hostPlanet.x + Math.cos(orbitAngle) * orbitDistance;
    const startY = hostPlanet.y + Math.sin(orbitAngle) * orbitDistance;

    const friendly = State.playerShip.loneWolf === false && State.homePlanetId !== null && hostPlanet.id === State.homePlanetId;

    State.ships.push({
        type: 'station',
        x: startX, // World Coordinate X
        y: startY, // World Coordinate Y
        xv: hostPlanet.xv, // Inherit planet State.velocity
        yv: hostPlanet.yv,
        r: STATION_R, a: Math.random() * Math.PI * 2, rotSpeed: 0.005,
        structureHP: STATION_CONFIG.RESISTANCE,
        shieldHitTimer: 0,
        spawnTimer: 180, reloadTime: 120,
        hostPlanet: hostPlanet, // Reference to the planet object
        orbitDistance: orbitDistance,
        orbitAngle: orbitAngle,
        orbitSpeed: (Math.random() > 0.5 ? 1 : -1) * 0.002, // Slow orbital rotation
        fleetHue: friendly ? SHIP_CONFIG.FRIENDLY_BLUE_HUE : (Math.floor(Math.random() * 260) + 260) % 360, // Avoid blue (160-260)
        blinkNum: 60,
        z: 0, // Always at default Z-depth for radar visibility
        hostPlanetId: hostPlanet.id, // Store ID instead of reference
        isFriendly: friendly,
        // Weapon Props
        bulletSpeed: 20,
        bulletSize: 6,
        bulletLife: 50,
        effectiveR: STATION_R // Use station radius for bullet spawn offset
    });
    State.stationSpawnTimer = STATION_CONFIG.SPAWN_TIMER + Math.random() * STATION_CONFIG.SPAWN_TIMER;
}

export function spawnShipsSquad(station) {
    const currentFactionShips = State.ships.filter(en => en.type === 'ship' && en.homeStation && en.homeStation.hostPlanetId === station.hostPlanetId).length;
    const spawnCount = SHIP_CONFIG.PLANET_LIMIT - currentFactionShips;

    if (spawnCount <= 0) return;

    for (let i = 0; i < spawnCount; i++) {
        const spawnDist = station.r * 2.0 + Math.random() * 50;
        const spawnAngle = Math.random() * Math.PI * 2;

        const squadX = station.x + Math.cos(spawnAngle) * spawnDist;
        const squadY = station.y + Math.sin(spawnAngle) * spawnDist;

        let e = {
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
            x: squadX,
            xv: station.xv + (Math.random() - 0.5),
            y: squadY,
            yv: station.yv + (Math.random() - 0.5),
            z: 0,
            homeStation: station,
            bulletSpeed: 15 + Math.random() * 10,
            bulletSize: 4 + Math.random() * 3,
            bulletLife: 45 + Math.random() * 15
        };

        State.ships.push(e);
    }
}


export function generatePlanetName() {
    const s1 = syllables[Math.floor(Math.random() * syllables.length)];
    const s2 = syllables[Math.floor(Math.random() * syllables.length)];
    const suf = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${s1}${s2.toLowerCase()} ${suf}`;
}






