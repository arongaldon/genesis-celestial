import { State } from '../core/state.js';
import { SpatialHash } from '../utils/utils.js';
import { ASTEROID_CONFIG, BOUNDARY_CONFIG, PLANET_CONFIG, PLAYER_CONFIG, SCORE_REWARDS, SHIP_CONFIG, STATION_CONFIG, FPS, FRICTION, G_CONST, MAX_Z_DEPTH, MIN_DURATION_TAP_TO_MOVE, SCALE_IN_MOUSE_MODE, SCALE_IN_TOUCH_MODE, WORLD_BOUNDS, ZOOM_LEVELS, suffixes, syllables, DOM } from '../core/config.js';
import { createAsteroid, initializePlanetAttributes, spawnStation } from '../entities/entities.js';
import { createExplosion, createExplosionDebris, createShockwave } from '../graphics/fx.js';
import { AudioEngine } from '../audio/audio.js';
import { addScreenMessage, updateAsteroidCounter } from '../graphics/render.js';
import { triggerHomePlanetLost } from '../core/game_engine.js';

// With 1000+ asteroids, smaller cell sizes spread the load better and prevent giant O(N^2) clusters inside individual cells.
export const spatialGrid = new SpatialHash(1000);

export function updatePhysics() {
    const activePlanets = [];
    spatialGrid.clear();

    // PHASE 1: PHYSICS UPDATE & GRID POPULATION
    for (let i = 0; i < State.roids.length; i++) {
        let r1 = State.roids[i];
        if (isNaN(r1.x) || isNaN(r1.y) || !isFinite(r1.x) || !isFinite(r1.y)) {
            r1._destroyed = true;
            continue;
        }

        // --- 1. Calculate Mass ---
        r1.mass = r1.r * r1.r * 0.05;

        // --- 2. Planet Physics (Z-Depth, Orbit) ---
        if (r1.isPlanet) {
            if (r1.zWait > 0) {
                r1.zWait--;
            } else {
                const wasVulnerable = r1.z < 0.5;
                r1.z += r1.zSpeed;
                const isVulnerable = r1.z < 0.5;

                if (State.gameRunning && wasVulnerable !== isVulnerable && !r1._destroyed) {
                    if (isVulnerable) {
                        console.log("Planet " + r1.name + " returned to default z distance (Vulnerable).");
                    } else {
                        console.log("Planet " + r1.name + " left default z distance (Safe).");
                    }
                }

                if (r1.z < 0.2 && !r1.hasSpawnedStationThisCycle) {
                    const hasStation = State.ships.some(e => e.type === 'station' && e.hostPlanetId === r1.id);
                    if (!hasStation) spawnStation(r1);
                    r1.hasSpawnedStationThisCycle = true;
                }
                if (r1.z > 1.0) r1.hasSpawnedStationThisCycle = false;
                if (r1.z > MAX_Z_DEPTH) r1.zSpeed *= -1;
                if (r1.z < 0) {
                    r1.z = 0; r1.zSpeed = Math.abs(r1.zSpeed);
                    r1.zWait = Math.floor(1.0 * (2 * MAX_Z_DEPTH / r1.zSpeed));
                }
            }
            if (r1.isBubbleDebris) {
                r1.xv *= r1.bubbleFriction; r1.yv *= r1.bubbleFriction;
                if ((r1.xv * r1.xv + r1.yv * r1.yv) < 0.01) r1.isBubbleDebris = false;
            }
            if (r1.semiMajorAxis && r1.orbitSpeed) {
                const zSpeedModifier = 1 / (1 + r1.z);
                const nextAngle = r1.orbitAngle + (r1.orbitSpeed * zSpeedModifier);
                const xEllipse = r1.semiMajorAxis * Math.cos(nextAngle);
                const yEllipse = r1.semiMinorAxis * Math.sin(nextAngle);
                const cosRot = Math.cos(r1.ellipseRotation);
                const sinRot = Math.sin(r1.ellipseRotation);
                const xRotated = xEllipse * cosRot - yEllipse * sinRot;
                const yRotated = xEllipse * sinRot + yEllipse * cosRot;
                r1.xv = (r1.orbitCenterX + xRotated) - r1.x;
                r1.yv = (r1.orbitCenterY + yRotated) - r1.y;
                r1.orbitAngle = nextAngle;
            }
        }

        // Unset destroyed flag for safety
        r1._destroyed = false;

        if (r1.blinkNum > 0) r1.blinkNum--;

        // Collect Active Planets (z < 1.0) for Attraction Logic
        if (r1.isPlanet && Math.abs(r1.z) < 1.0) {
            activePlanets.push(r1);
        }

        // --- 3. Attraction to Planets (Asteroids only) ---
        // OPTIMIZATION: Skip gravity calculations for asteroids that are extremely far from the camera 
        // IF they aren't massive.
        const isFarAway = Math.abs(r1.x - State.worldOffsetX) > State.width * 2 || Math.abs(r1.y - State.worldOffsetY) > State.height * 2;
        if (!r1.isPlanet && (!isFarAway || r1.r > ASTEROID_CONFIG.MIN_SIZE * 2)) {
            let nearestPlanet = null;
            let minDistSq = Infinity;

            for (let j = 0; j < activePlanets.length; j++) {
                const other = activePlanets[j];
                const dx = other.x - r1.x;
                const dy = other.y - r1.y;
                const dSq = dx * dx + dy * dy;
                if (dSq < minDistSq) { minDistSq = dSq; nearestPlanet = other; }
            }

            if (nearestPlanet) {
                const dist = Math.sqrt(minDistSq);
                const dx = nearestPlanet.x - r1.x;
                const dy = nearestPlanet.y - r1.y;
                const orbitRadius = nearestPlanet.r * 3.0 + r1.r; // Increased trigger range
                const gravityRange = nearestPlanet.r * 10.0; // Increased gravity range

                if (dist < gravityRange) {
                    const isOrbitCandidate = (r1.r <= ASTEROID_CONFIG.MIN_SIZE * 1.2);
                    if (dist > orbitRadius || !isOrbitCandidate) {
                        const forceMagnitude = (G_CONST * nearestPlanet.mass * 8.0) / Math.max(minDistSq, 100);
                        r1.xv += (dx / dist) * forceMagnitude;
                        r1.yv += (dy / dist) * forceMagnitude;
                    }
                    if (dist <= orbitRadius && isOrbitCandidate) {
                        if (!r1.orbitRadiusFactor) r1.orbitRadiusFactor = 2.2 + Math.random() * 2.0; // Stay well outside atmosphere (1.1r)
                        const dynamicOrbitRadius = nearestPlanet.r * r1.orbitRadiusFactor + r1.r;
                        const angleToPlanet = Math.atan2(dy, dx);
                        const tangentAngle = angleToPlanet + Math.PI / 2;
                        const orbitSpeed = Math.sqrt((G_CONST * nearestPlanet.mass * 8.0) / dist);
                        const targetXV = Math.cos(tangentAngle) * orbitSpeed;
                        const targetYV = Math.sin(tangentAngle) * orbitSpeed;
                        r1.xv += (targetXV - r1.xv) * 0.1;
                        r1.yv += (targetYV - r1.yv) * 0.1;
                        const distError = dist - dynamicOrbitRadius;
                        const correctionForce = distError * 0.005;
                        r1.xv += (dx / dist) * correctionForce;
                        r1.yv += (dy / dist) * correctionForce;
                    }
                }
            }
        }

        // --- 4. Gravity on Player ---
        if (r1.isPlanet && r1.z < 0.5) {
            let dx = State.worldOffsetX - r1.x;
            let dy = State.worldOffsetY - r1.y;
            let distSq = dx * dx + dy * dy;
            let dist = Math.sqrt(distSq);
            if (dist < r1.r * 4 && dist > State.playerShip.r) {
                let clampedDistSq = Math.max(distSq, 100);
                let force = (G_CONST * r1.mass) / clampedDistSq;
                // Reduced strength (0.8x) and range (4x) for better playability/escape
                State.velocity.x += (dx / dist) * force * 0.8;
                State.velocity.y += (dy / dist) * force * 0.8;
            }
        }

        // --- 5. Speed Limit & Boundary ---
        const speedSq = r1.xv * r1.xv + r1.yv * r1.yv;
        const speed = Math.sqrt(speedSq);
        if (speed > ASTEROID_CONFIG.MAX_SPEED) {
            const ratio = ASTEROID_CONFIG.MAX_SPEED / speed;
            r1.xv *= ratio; r1.yv *= ratio;
        }
        const distToCenter = Math.sqrt(r1.x * r1.x + r1.y * r1.y);
        if (r1.isPlanet && r1.semiMajorAxis) {
            // Let planets drift further but slowly pull their entire orbit center inwards
            if (distToCenter > WORLD_BOUNDS + 2000) {
                const angle = Math.atan2(r1.y, r1.x);
                // Slowly shift the orbit center toward the map origin
                r1.orbitCenterX -= Math.cos(angle) * 1.5;
                r1.orbitCenterY -= Math.sin(angle) * 1.5;
            }
        } else {
            // Harder correction for simple asteroids so they bounce back into bounds
            if (distToCenter > WORLD_BOUNDS - BOUNDARY_CONFIG.TOLERANCE_ROIDS) {
                const angle = Math.atan2(r1.y, r1.x);
                r1.xv -= Math.cos(angle) * BOUNDARY_CONFIG.CORRECTION_FORCE;
                r1.yv -= Math.sin(angle) * BOUNDARY_CONFIG.CORRECTION_FORCE;
            }
        }

        // --- 6. Insert into Grid ---
        if (r1.z < 0.5) spatialGrid.insert(r1);
    }

    // PHASE 2: COLLISIONS & GRAVITY MESH
    for (let i = 0; i < activePlanets.length; i++) {
        let p = activePlanets[i];
        if (p._destroyed) continue;
        for (let j = i + 1; j < activePlanets.length; j++) {
            let p2 = activePlanets[j];
            if (!p2._destroyed) resolveInteraction(p, p2);
        }
        let potentialColliders = spatialGrid.query(p);
        for (let r2 of potentialColliders) {
            if (!r2._destroyed && !r2.isPlanet) resolveInteraction(p, r2);
        }
    }

    for (let i = 0; i < State.roids.length; i++) {
        let r1 = State.roids[i];
        // OPTIMIZATION: Skip collision checks for planets (handled in Phase 2) or ghosted/destroyed asteroids
        if (r1.isPlanet || r1.z >= 0.5 || r1._destroyed || r1.blinkNum > 0) continue;
        let neighbors = spatialGrid.query(r1);
        for (let r2 of neighbors) {
            if (r1.id < r2.id && !r2.isPlanet && !r2._destroyed) {
                resolveInteraction(r1, r2);
            }
        }
    }

    // PHASE 3: CLEANUP
    let writeIdx = 0;
    for (let i = 0; i < State.roids.length; i++) {
        const obj = State.roids[i];
        if (!obj._destroyed && !isNaN(obj.x) && !isNaN(obj.y) && isFinite(obj.x) && isFinite(obj.y)) {
            State.roids[writeIdx++] = obj;
        }
    }
    State.roids.length = writeIdx;

    // Process pending debris spawns (avoiding mid-loop array mutations)
    if (State.pendingDebris && State.pendingDebris.length > 0) {
        for (const spawn of State.pendingDebris) {
            createExplosionDebris(spawn.x, spawn.y, spawn.count, spawn.isHot);
        }
        State.pendingDebris = [];
    }

    updateAsteroidCounter();
}

export function resolveInteraction(r1, r2) {
    if (r1.blinkNum > 0 || r2.blinkNum > 0) return;

    // PREVENT HOT DEBRIS MERGING (Asteroid to Asteroid)
    if ((r1.isHot || r2.isHot) && !r1.isPlanet && !r2.isPlanet) {
        // Hot debris simply passes through other asteroids to prevent jitter clusters
        return;
    }

    let dx = r2.x - r1.x; let dy = r2.y - r1.y;
    const attractionRange = (r1.r + r2.r) * 3;

    // FAST PRE-CHECK (Bounding Box)
    if (Math.abs(dx) > attractionRange || Math.abs(dy) > attractionRange) return;

    let distSq = dx * dx + dy * dy; let dist = Math.sqrt(distSq);

    if (dist < attractionRange && dist > r1.r + r2.r) {
        let force = 0;
        let isSmallSatellite = false;
        let planetRef = null;
        let asteroidRef = null;

        if (r1.isPlanet && r2.isPlanet) {
            force = (G_CONST * r1.mass * r2.mass * 15.0) / Math.max(distSq, 2000);
        } else if (r1.isPlanet || r2.isPlanet) {
            force = (G_CONST * r1.mass * r2.mass) / Math.max(distSq, 500);

            planetRef = r1.isPlanet ? r1 : r2;
            asteroidRef = r1.isPlanet ? r2 : r1;
            if (asteroidRef.r <= ASTEROID_CONFIG.MIN_SIZE * 1.5 || asteroidRef.isHot) {
                isSmallSatellite = true;
            }
        } else {
            const isGiant = (r1.r >= ASTEROID_CONFIG.MAX_SIZE || r2.r >= ASTEROID_CONFIG.MAX_SIZE);
            const G_ROIDS = isGiant ? 5.0 : 0.08;
            force = (G_ROIDS * r1.mass * r2.mass) / Math.max(distSq, 400);
        }

        // Apply forces
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;

        if (!isNaN(fx)) {
            // Normal gravity pull for everything
            r1.xv += fx / r1.mass; r1.yv += fy / r1.mass;
            r2.xv -= fx / r2.mass; r2.yv -= fy / r2.mass;

            // If it's a small satellite, destroy it early if it touches the atmosphere
            if (isSmallSatellite) {
                const atmosphereRadius = planetRef.r + asteroidRef.r + 30; // 30 units of atmosphere
                if (dist < atmosphereRadius) {
                    const midX = asteroidRef.x; const midY = asteroidRef.y;
                    const midVpX = midX - State.worldOffsetX + State.width / 2;
                    const midVpY = midY - State.worldOffsetY + State.height / 2;
                    createExplosion(midVpX, midVpY, 15, '#ffffff', 3, 'spark');
                    asteroidRef._destroyed = true;
                }
            }
        }
        return;
    }

    if (dist < r1.r + r2.r) {
        const midX = (r1.x + r2.x) / 2; const midY = (r1.y + r2.y) / 2;
        const midVpX = midX - State.worldOffsetX + State.width / 2;
        const midVpY = midY - State.worldOffsetY + State.height / 2;

        if (r1.isPlanet && r2.isPlanet) {
            createExplosion(midVpX, midVpY, 150, '#ffaa00', 8, 'flame');
            createExplosion(midVpX, midVpY, 100, '#ff4400', 12, 'flame');
            createExplosion(midVpX, midVpY, 80, '#550000', 15, 'smoke');
            createExplosion(midVpX, midVpY, 50, '#ffff00', 4, 'spark');
            AudioEngine.playPlanetExplosion(midX, midY, r1.z);
            if (r1.id === State.homePlanetId || r2.id === State.homePlanetId) triggerHomePlanetLost('collision');
            State.pendingDebris.push({ x: midX, y: midY, count: ASTEROID_CONFIG.PLANET_DEBRIS, isHot: true });
            createShockwave(midX, midY, true);
            createShockwave(midX, midY);
            const planetsBefore = State.roids.filter(r => r.isPlanet && !r._destroyed).length;
            if (State.gameRunning) {
                console.log("Count: " + (planetsBefore - 2) + ". Planets " + r1.name + " and " + r2.name + " destroyed.");
            }
            PLANET_CONFIG.LIMIT = Math.max(0, PLANET_CONFIG.LIMIT - 2);
            r1.r = 0; r1.vaporized = true; r1._destroyed = true;
            r2.r = 0; r2.vaporized = true; r2._destroyed = true;
            const idx1 = State.roids.indexOf(r1); if (idx1 !== -1) State.roids.splice(idx1, 1);
            const idx2 = State.roids.indexOf(r2); if (idx2 !== -1) State.roids.splice(idx2, 1);
            return;
        }

        if (r1.isPlanet !== r2.isPlanet) {
            let planet = r1.isPlanet ? r1 : r2;
            let asteroid = r1.isPlanet ? r2 : r1;

            // Any asteroid smaller than MIN_SIZE * 1.5, OR any hot debris is destroyed upon touching the planet surface
            if (asteroid.r <= ASTEROID_CONFIG.MIN_SIZE * 1.5 || asteroid.isHot) {
                createExplosion(midVpX, midVpY, 10, '#ffffff', 2, 'spark');
                asteroid._destroyed = true;
                return;
            }

            let totalMass = planet.mass + asteroid.mass;
            // Calculate new radius and instantly clamp it
            planet.r = Math.min(Math.sqrt((Math.PI * planet.r * planet.r + Math.PI * asteroid.r * asteroid.r * 1.5) / Math.PI), PLANET_CONFIG.SIZE);
            planet.mass = totalMass;

            if (planet.id === State.homePlanetId && asteroid.r > ASTEROID_CONFIG.MIN_SIZE * 2) {
                createExplosion(midVpX, midVpY, 20, '#00ffaa', 3, 'spark');
            }

            asteroid._destroyed = true;
            return;
        }

        const isGiant1 = r1.r >= ASTEROID_CONFIG.MAX_SIZE;
        const isGiant2 = r2.r >= ASTEROID_CONFIG.MAX_SIZE;

        if (isGiant1 && isGiant2) {
            let totalMass = r1.mass + r2.mass;
            let newR = Math.sqrt(r1.r * r1.r + r2.r * r2.r) * 1.05;
            r1.x = (r1.x * r1.mass + r2.x * r2.mass) / totalMass;
            r1.y = (r1.y * r1.mass + r2.y * r2.mass) / totalMass;
            r1.xv = (r1.xv * r1.mass + r2.xv * r2.mass) / totalMass * 0.5;
            r1.yv = (r1.yv * r1.mass + r2.yv * r2.mass) / totalMass * 0.5;
            if (!r1.isPlanet) {
                const currentPlanets = State.roids.filter(r => r.isPlanet && !r._destroyed).length;
                if (currentPlanets < PLANET_CONFIG.LIMIT) {
                    r1.r = PLANET_CONFIG.SIZE;
                    initializePlanetAttributes(r1);
                    r1.mass = totalMass * 0.05;
                    createExplosion(midVpX, midVpY, 60, '#00ffff', 10, 'spark');
                    AudioEngine.playPlanetExplosion(midX, midY, r1.z);
                } else { r1.r = newR; }
            } else { r1.r = Math.min(newR, PLANET_CONFIG.SIZE); r1.mass = totalMass * 0.05; }
            r2._destroyed = true;
        } else if (isGiant1 || isGiant2) {
            const giant = isGiant1 ? r1 : r2;
            const smaller = isGiant1 ? r2 : r1;
            if (smaller.r <= ASTEROID_CONFIG.MIN_SIZE * 1.2) {
                createExplosion(midVpX, midVpY, 15, '#fff', 2, 'debris');
                AudioEngine.playSoftThud(midX, midY, giant.z);
                smaller._destroyed = true;
            } else {
                [r1, r2].forEach((r) => {
                    const newSize = r.r * 0.5;
                    if (newSize >= ASTEROID_CONFIG.MIN_SIZE) {
                        const off = r.r * (ASTEROID_CONFIG.SPLIT_OFFSET / ASTEROID_CONFIG.MAX_SIZE);
                        const ang = Math.random() * Math.PI * 2;
                        let f1 = createAsteroid(r.x + Math.cos(ang) * off, r.y + Math.sin(ang) * off, newSize);
                        f1.xv = r.xv + Math.cos(ang) * ASTEROID_CONFIG.MAX_SPEED; f1.yv = r.yv + Math.sin(ang) * ASTEROID_CONFIG.MAX_SPEED; f1.blinkNum = 30;
                        State.roids.push(f1);
                        let f2 = createAsteroid(r.x - Math.cos(ang) * off, r.y - Math.sin(ang) * off, newSize);
                        f2.xv = r.xv - Math.cos(ang) * ASTEROID_CONFIG.MAX_SPEED; f2.yv = r.yv - Math.sin(ang) * ASTEROID_CONFIG.MAX_SPEED; f2.blinkNum = 30;
                        State.roids.push(f2);
                    }
                });
                createExplosion(midVpX, midVpY, 40, '#ffaa00', 3, 'spark');
                AudioEngine.playExplosion('small', midX, midY, r1.z);
                r1._destroyed = true; r2._destroyed = true;
            }
        } else {
            let totalMass = r1.mass + r2.mass;
            r1.x = (r1.x * r1.mass + r2.x * r2.mass) / totalMass;
            r1.y = (r1.y * r1.mass + r2.y * r2.mass) / totalMass;
            r1.xv = (r1.xv * r1.mass + r2.xv * r2.mass) / totalMass;
            r1.yv = (r1.yv * r1.mass + r2.yv * r2.mass) / totalMass;
            r1.r = Math.sqrt(r1.r * r1.r + r2.r * r2.r) * 1.05;
            AudioEngine.playSoftThud(midX, midY, r1.z);
            r2._destroyed = true;
        }
    }
}



