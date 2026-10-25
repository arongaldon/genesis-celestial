import { State } from '../core/state.js';
import { SpatialHash, dist } from '../utils/utils.js';
import { ANOMALY_CONFIG, ASTEROID_CONFIG, BOUNDARY_CONFIG, GLOBAL_LIGHT, PLANET_CONFIG, G_CONST, MAX_Z_DEPTH, WORLD_BOUNDS } from '../core/config.js';
import { initializePlanetAttributes, spawnStation, splitAsteroid } from '../entities/entities.js';
import { createExplosion, createExplosionDebris, createPlanetExplosionFX, createShockwave } from '../graphics/fx.js';
import { addScreenMessage } from '../graphics/render.js';
import { AudioEngine } from '../audio/audio.js';
import { triggerHomePlanetLost } from '../core/game_engine.js';
import { t } from '../utils/i18n.js';

// With 1000+ asteroids, smaller cell sizes spread the load better and prevent giant O(N^2) clusters inside individual cells.
export const spatialGrid = new SpatialHash(1000);
let physicsFrameTick = 0;

export function updatePhysics() {
    physicsFrameTick = (physicsFrameTick + 1) & 3;
    const activePlanets = [];
    spatialGrid.clear();

    // PHASE 1: PHYSICS UPDATE & GRID POPULATION
    for (let i = 0; i < State.roids.length; i++) {
        const r1 = State.roids[i];
        if (!isFinite(r1.x) || !isFinite(r1.y)) {
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
                    r1.z = 0;
                    r1.zSpeed = Math.abs(r1.zSpeed);
                    r1.zWait = Math.floor(1.0 * (2 * MAX_Z_DEPTH / r1.zSpeed));
                }
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

        if (r1.blinkNum > 0) r1.blinkNum--;

        // Collect Active Planets (z < 1.0) for Attraction Logic
        if (r1.isPlanet && Math.abs(r1.z) < 1.0) {
            activePlanets.push(r1);
        }

        // --- 3. Attraction to Planets (Asteroids only) ---
        const isFarAway = Math.abs(r1.x - State.worldOffsetX) > State.width * 2 || Math.abs(r1.y - State.worldOffsetY) > State.height * 2;
        if (!r1.isPlanet && (!isFarAway || r1.r > ASTEROID_CONFIG.MIN_SIZE * 2)) {
            let nearestPlanet = null;
            let minDistSq = Infinity;

            for (let j = 0; j < activePlanets.length; j++) {
                const other = activePlanets[j];
                const dx = other.x - r1.x;
                const dy = other.y - r1.y;
                const dSq = dx * dx + dy * dy;
                if (dSq < minDistSq) {
                    minDistSq = dSq;
                    nearestPlanet = other;
                }
            }

            if (nearestPlanet) {
                const d = Math.sqrt(minDistSq);
                const dx = nearestPlanet.x - r1.x;
                const dy = nearestPlanet.y - r1.y;
                const orbitRadius = nearestPlanet.r * 3.0 + r1.r;
                const gravityRange = nearestPlanet.r * 10.0;

                if (d < gravityRange) {
                    const isOrbitCandidate = r1.r <= ASTEROID_CONFIG.MIN_SIZE * 1.2;
                    if (d > orbitRadius || !isOrbitCandidate) {
                        const forceMagnitude = (G_CONST * nearestPlanet.mass * 8.0) / Math.max(minDistSq, 100);
                        r1.xv += (dx / d) * forceMagnitude;
                        r1.yv += (dy / d) * forceMagnitude;
                    } else {
                        if (!r1.orbitRadiusFactor) r1.orbitRadiusFactor = 2.2 + Math.random() * 2.0;
                        const dynamicOrbitRadius = nearestPlanet.r * r1.orbitRadiusFactor + r1.r;
                        const angleToPlanet = Math.atan2(dy, dx);
                        const tangentAngle = angleToPlanet + Math.PI / 2;
                        const orbitSpeed = Math.sqrt((G_CONST * nearestPlanet.mass * 8.0) / d);
                        const targetXV = Math.cos(tangentAngle) * orbitSpeed;
                        const targetYV = Math.sin(tangentAngle) * orbitSpeed;
                        r1.xv += (targetXV - r1.xv) * 0.1;
                        r1.yv += (targetYV - r1.yv) * 0.1;
                        const distError = d - dynamicOrbitRadius;
                        const correctionForce = distError * 0.005;
                        r1.xv += (dx / d) * correctionForce;
                        r1.yv += (dy / d) * correctionForce;
                    }
                }
            }
        }

        // --- 4. Gravity on Player ---
        if (r1.isPlanet && r1.z < 0.5) {
            const dx = State.worldOffsetX - r1.x;
            const dy = State.worldOffsetY - r1.y;
            const distSq = dx * dx + dy * dy;
            const d = Math.sqrt(distSq);
            if (d < r1.r * 4 && d > State.playerShip.r) {
                const force = (G_CONST * r1.mass) / Math.max(distSq, 100);
                State.velocity.x += (dx / d) * force * 0.8;
                State.velocity.y += (dy / d) * force * 0.8;
            }
        }

        // --- 5. Speed Limit & Boundary ---
        const speed = Math.hypot(r1.xv, r1.yv);
        if (speed > ASTEROID_CONFIG.MAX_SPEED) {
            const ratio = ASTEROID_CONFIG.MAX_SPEED / speed;
            r1.xv *= ratio;
            r1.yv *= ratio;
        }
        const distToCenter = Math.hypot(r1.x, r1.y);
        if (r1.isPlanet && r1.semiMajorAxis) {
            if (distToCenter > WORLD_BOUNDS + 2000) {
                const angle = Math.atan2(r1.y, r1.x);
                r1.orbitCenterX -= Math.cos(angle) * 1.5;
                r1.orbitCenterY -= Math.sin(angle) * 1.5;
            }
        } else if (distToCenter > WORLD_BOUNDS - BOUNDARY_CONFIG.TOLERANCE_ROIDS) {
            const angle = Math.atan2(r1.y, r1.x);
            r1.xv -= Math.cos(angle) * BOUNDARY_CONFIG.CORRECTION_FORCE;
            r1.yv -= Math.sin(angle) * BOUNDARY_CONFIG.CORRECTION_FORCE;
        }

        // --- 6. Insert into Grid ---
        if (r1.z < 0.5) spatialGrid.insert(r1);
    }

    // PHASE 2: COLLISIONS & GRAVITY MESH
    for (let i = 0; i < activePlanets.length; i++) {
        const p = activePlanets[i];
        if (p._destroyed) continue;
        for (let j = i + 1; j < activePlanets.length; j++) {
            const p2 = activePlanets[j];
            if (!p2._destroyed) resolveInteraction(p, p2);
        }
        const potentialColliders = spatialGrid.query(p);
        for (const r2 of potentialColliders) {
            if (!r2._destroyed && !r2.isPlanet) resolveInteraction(p, r2);
        }
    }

    for (let i = 0; i < State.roids.length; i++) {
        const r1 = State.roids[i];
        if (r1.isPlanet || r1.z >= 0.5 || r1._destroyed || r1.blinkNum > 0) continue;

        // Stagger off-screen small asteroid-to-asteroid checks across 4 frames for smooth 60 FPS
        const isOffScreenFar = Math.abs(r1.x - State.worldOffsetX) > 3500 || Math.abs(r1.y - State.worldOffsetY) > 3500;
        if (isOffScreenFar && r1.r < ASTEROID_CONFIG.MAX_SIZE && ((i & 3) !== physicsFrameTick)) continue;

        const neighbors = spatialGrid.query(r1);
        for (const r2 of neighbors) {
            if (r1.id < r2.id && !r2.isPlanet && !r2._destroyed) {
                resolveInteraction(r1, r2);
            }
        }
    }

    // PHASE 3: CLEANUP
    let writeIdx = 0;
    for (let i = 0; i < State.roids.length; i++) {
        const obj = State.roids[i];
        if (!obj._destroyed && isFinite(obj.x) && isFinite(obj.y)) {
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
}

export function resolveInteraction(r1, r2) {
    if (r1.blinkNum > 0 || r2.blinkNum > 0) return;

    // PREVENT HOT DEBRIS MERGING (Asteroid to Asteroid)
    if ((r1.isHot || r2.isHot) && !r1.isPlanet && !r2.isPlanet) {
        return;
    }

    const dx = r2.x - r1.x;
    const dy = r2.y - r1.y;
    const attractionRange = (r1.r + r2.r) * 3;

    // FAST PRE-CHECK (Bounding Box)
    if (Math.abs(dx) > attractionRange || Math.abs(dy) > attractionRange) return;

    const distSq = dx * dx + dy * dy;
    const d = Math.sqrt(distSq);

    if (d < attractionRange && d > r1.r + r2.r) {
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
            const isGiant = r1.r >= ASTEROID_CONFIG.MAX_SIZE || r2.r >= ASTEROID_CONFIG.MAX_SIZE;
            const G_ROIDS = isGiant ? 5.0 : 0.08;
            force = (G_ROIDS * r1.mass * r2.mass) / Math.max(distSq, 400);
        }

        const fx = (dx / d) * force;
        const fy = (dy / d) * force;

        if (!isNaN(fx)) {
            r1.xv += fx / r1.mass;
            r1.yv += fy / r1.mass;
            r2.xv -= fx / r2.mass;
            r2.yv -= fy / r2.mass;

            // If it's a small satellite, destroy it early if it touches the atmosphere
            if (isSmallSatellite && d < planetRef.r + asteroidRef.r + 30) {
                const midVpX = asteroidRef.x - State.worldOffsetX + State.width / 2;
                const midVpY = asteroidRef.y - State.worldOffsetY + State.height / 2;
                createExplosion(midVpX, midVpY, 15, '#ffffff', 3, 'spark');
                asteroidRef._destroyed = true;
            }
        }
        return;
    }

    if (d < r1.r + r2.r) {
        const midX = (r1.x + r2.x) / 2;
        const midY = (r1.y + r2.y) / 2;
        const midVpX = midX - State.worldOffsetX + State.width / 2;
        const midVpY = midY - State.worldOffsetY + State.height / 2;

        if (r1.isPlanet && r2.isPlanet) {
            createPlanetExplosionFX(midX, midY, r1.z);
            if (r1.id === State.homePlanetId || r2.id === State.homePlanetId) {
                triggerHomePlanetLost('collision');
            }
            State.pendingDebris.push({ x: midX, y: midY, count: ASTEROID_CONFIG.PLANET_DEBRIS, isHot: true });
            createShockwave(midX, midY);
            const planetsBefore = State.roids.filter(r => r.isPlanet && !r._destroyed).length;
            if (State.gameRunning) {
                console.log("Count: " + (planetsBefore - 2) + ". Planets " + r1.name + " and " + r2.name + " destroyed.");
            }
            r1.r = 0; r1.vaporized = true; r1._destroyed = true;
            r2.r = 0; r2.vaporized = true; r2._destroyed = true;
            return;
        }

        if (r1.isPlanet !== r2.isPlanet) {
            const planet = r1.isPlanet ? r1 : r2;
            const asteroid = r1.isPlanet ? r2 : r1;

            if (asteroid.r <= ASTEROID_CONFIG.MIN_SIZE * 1.5 || asteroid.isHot) {
                createExplosion(midVpX, midVpY, 10, '#ffffff', 2, 'spark');
                asteroid._destroyed = true;
                return;
            }

            const totalMass = planet.mass + asteroid.mass;
            planet.r = Math.min(Math.sqrt(planet.r * planet.r + asteroid.r * asteroid.r * 1.5), PLANET_CONFIG.SIZE);
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
            const totalMass = r1.mass + r2.mass;
            const newR = Math.hypot(r1.r, r2.r) * 1.05;
            r1.x = (r1.x * r1.mass + r2.x * r2.mass) / totalMass;
            r1.y = (r1.y * r1.mass + r2.y * r2.mass) / totalMass;
            r1.xv = (r1.xv * r1.mass + r2.xv * r2.mass) / totalMass * 0.5;
            r1.yv = (r1.yv * r1.mass + r2.yv * r2.mass) / totalMass * 0.5;

            if (!r1.isPlanet) {
                const currentPlanets = State.roids.filter(r => r.isPlanet && !r._destroyed).length;
                if (currentPlanets < PLANET_CONFIG.LIMIT) {
                    const tooClose = State.roids.some(
                        p => p.isPlanet && !p._destroyed && dist(p.x, p.y, r1.x, r1.y) < PLANET_CONFIG.SIZE * 2.5
                    );
                    if (!tooClose) {
                        r1.r = PLANET_CONFIG.SIZE;
                        initializePlanetAttributes(r1);
                        r1.mass = totalMass * 0.05;
                        r1.blinkNum = 60;
                        createExplosion(midVpX, midVpY, 60, '#00ffff', 10, 'spark');
                        AudioEngine.playPlanetExplosion(midX, midY, r1.z);
                    } else {
                        r1.r = newR;
                    }
                } else {
                    r1.r = newR;
                }
            } else {
                r1.r = Math.min(newR, PLANET_CONFIG.SIZE);
                r1.mass = totalMass * 0.05;
            }
            r2._destroyed = true;
        } else if (isGiant1 || isGiant2) {
            const giant = isGiant1 ? r1 : r2;
            const smaller = isGiant1 ? r2 : r1;
            if (smaller.r <= ASTEROID_CONFIG.MIN_SIZE * 1.2) {
                createExplosion(midVpX, midVpY, 15, '#fff', 2, 'debris');
                AudioEngine.playSoftThud(midX, midY, giant.z);
                smaller._destroyed = true;
            } else {
                if (State.roids.length >= ASTEROID_CONFIG.MAX_ROIDS) {
                    smaller._destroyed = true;
                    giant.r *= 0.95;
                    return;
                }

                splitAsteroid(giant, Math.random() * Math.PI * 2, 60);
                createExplosion(midVpX, midVpY, 40, '#ffaa00', 3, 'spark');
                AudioEngine.playExplosion('small', midX, midY, r1.z);
                r1._destroyed = true;
                r2._destroyed = true;
            }
        } else {
            const totalMass = r1.mass + r2.mass;
            r1.x = (r1.x * r1.mass + r2.x * r2.mass) / totalMass;
            r1.y = (r1.y * r1.mass + r2.y * r2.mass) / totalMass;
            r1.xv = (r1.xv * r1.mass + r2.xv * r2.mass) / totalMass;
            r1.yv = (r1.yv * r1.mass + r2.yv * r2.mass) / totalMass;
            r1.r = Math.hypot(r1.r, r2.r) * 1.05;
            AudioEngine.playSoftThud(midX, midY, r1.z);
            r2._destroyed = true;
        }
    }
}

export function isInPlanetaryShadow(worldX, worldY) {
    for (let i = 0; i < State.roids.length; i++) {
        const r = State.roids[i];
        if (!r.isPlanet || r.z >= 0.5 || r._destroyed) continue;

        const lx = r.x - GLOBAL_LIGHT.X;
        const ly = r.y - GLOBAL_LIGHT.Y;
        const lDist = Math.max(1, Math.hypot(lx, ly));
        const dirX = lx / lDist;
        const dirY = ly / lDist;

        const px = worldX - r.x;
        const py = worldY - r.y;
        const along = px * dirX + py * dirY;
        const perp = Math.abs(px * (-dirY) + py * dirX);

        if (along > 0 && along < r.r * 3.5 && perp < r.r * 0.95) {
            return true;
        }
    }
    return false;
}

export function updateAnomalies() {
    if (!State.gameRunning) return;

    // --- 1. WORMHOLE PORTALS ---
    if (State.playerShip && State.playerShip.teleportCooldown > 0) {
        State.playerShip.teleportCooldown--;
    }

    for (const w of State.wormholes) {
        w.angle += 0.03;
        const partner = w.partner;
        if (!partner) continue;

        // Player interaction with wormhole
        if (State.playerShip && !State.playerShip.dead) {
            const dx = w.x - State.worldOffsetX;
            const dy = w.y - State.worldOffsetY;
            const d = Math.hypot(dx, dy);

            if (d < ANOMALY_CONFIG.WORMHOLE_PULL_RANGE && d > 1) {
                const pull = (1 - d / ANOMALY_CONFIG.WORMHOLE_PULL_RANGE) * 0.35;
                const tangent = Math.atan2(dy, dx) + Math.PI / 3;
                State.velocity.x += Math.cos(tangent) * pull;
                State.velocity.y += Math.sin(tangent) * pull;
            }

            if (d < w.r && (!State.playerShip.teleportCooldown || State.playerShip.teleportCooldown <= 0)) {
                const exitAngle = Math.atan2(State.velocity.y, State.velocity.x);
                State.worldOffsetX = partner.x + Math.cos(exitAngle) * (partner.r * 1.3);
                State.worldOffsetY = partner.y + Math.sin(exitAngle) * (partner.r * 1.3);
                State.playerShip.teleportCooldown = ANOMALY_CONFIG.WORMHOLE_COOLDOWN_FRAMES;
                State.playerShip.blinkNum = Math.max(State.playerShip.blinkNum, 20);

                createExplosion(State.width / 2, State.height / 2, 45, `hsl(${partner.hue}, 100%, 70%)`, 4, 'spark');
                createShockwave(State.worldOffsetX, State.worldOffsetY);
                AudioEngine.playWarp(State.worldOffsetX, State.worldOffsetY);
                addScreenMessage(t("game.wormhole_jump"), `hsl(${partner.hue}, 100%, 75%)`);
            }
        }

        // AI Ships interaction with wormhole
        for (const s of State.ships) {
            if (s === State.playerShip || s.type === 'station' || s.dead) continue;
            if (s.teleportCooldown > 0) s.teleportCooldown--;

            const d = dist(s.x, s.y, w.x, w.y);
            if (d < w.r && (!s.teleportCooldown || s.teleportCooldown <= 0)) {
                const exitAngle = Math.atan2(s.yv, s.xv);
                s.x = partner.x + Math.cos(exitAngle) * (partner.r * 1.3);
                s.y = partner.y + Math.sin(exitAngle) * (partner.r * 1.3);
                s.teleportCooldown = ANOMALY_CONFIG.WORMHOLE_COOLDOWN_FRAMES;
                AudioEngine.playWarp(s.x, s.y);
            }
        }

        // Asteroids interaction with wormhole (via spatialGrid)
        const nearbyRoids = spatialGrid.query(w);
        for (const r of nearbyRoids) {
            if (r.isPlanet || r._destroyed || r.z > 0.5) continue;
            if (r.teleportCooldown > 0) r.teleportCooldown--;

            const dx = w.x - r.x;
            const dy = w.y - r.y;
            const d = Math.hypot(dx, dy);
            if (d < ANOMALY_CONFIG.WORMHOLE_PULL_RANGE && d > 1) {
                const pull = (1 - d / ANOMALY_CONFIG.WORMHOLE_PULL_RANGE) * 0.15;
                r.xv += (dx / d) * pull;
                r.yv += (dy / d) * pull;
            }
            if (d < w.r && (!r.teleportCooldown || r.teleportCooldown <= 0)) {
                const exitAngle = Math.atan2(r.yv, r.xv);
                r.x = partner.x + Math.cos(exitAngle) * (partner.r + r.r + 40);
                r.y = partner.y + Math.sin(exitAngle) * (partner.r + r.r + 40);
                r.teleportCooldown = ANOMALY_CONFIG.WORMHOLE_COOLDOWN_FRAMES;
                r.blinkNum = 30;
            }
        }

        // Bullets teleportation
        const teleportBullets = (list) => {
            for (const b of list) {
                if (b.teleportCooldown > 0) {
                    b.teleportCooldown--;
                    continue;
                }
                if (dist(b.x, b.y, w.x, w.y) < w.r) {
                    const exitAngle = Math.atan2(b.yv, b.xv);
                    b.x = partner.x + Math.cos(exitAngle) * (partner.r + 20);
                    b.y = partner.y + Math.sin(exitAngle) * (partner.r + 20);
                    b.teleportCooldown = 30;
                }
            }
        };
        teleportBullets(State.playerShipBullets);
        teleportBullets(State.enemyShipBullets);
    }

    // --- 2. SOLAR FLARE STORMS ---
    const storm = State.solarStorm;
    if (storm.warningTimer > 0) {
        storm.warningTimer--;
        if (storm.warningTimer === 0) {
            storm.activeTimer = ANOMALY_CONFIG.SOLAR_STORM_DURATION_FRAMES;
            addScreenMessage(t("game.solar_storm_active"), "#ffcc00");
            if (AudioEngine.ctx) {
                AudioEngine.playSolarWind(AudioEngine.ctx.currentTime, 6.0);
            }
        }
    } else if (storm.activeTimer > 0) {
        storm.activeTimer--;

        const windAngle = Math.atan2(-GLOBAL_LIGHT.Y, -GLOBAL_LIGHT.X);
        const windForceX = Math.cos(windAngle) * ANOMALY_CONFIG.SOLAR_STORM_PUSH_FORCE;
        const windForceY = Math.sin(windAngle) * ANOMALY_CONFIG.SOLAR_STORM_PUSH_FORCE;

        if (State.playerShip && !State.playerShip.dead) {
            const wasSheltered = storm.playerSheltered;
            storm.playerSheltered = isInPlanetaryShadow(State.worldOffsetX, State.worldOffsetY);

            if (storm.playerSheltered) {
                State.playerShip.shield = Math.min(State.playerShip.maxShield, State.playerShip.shield + 0.3);
                if (!wasSheltered) {
                    addScreenMessage(t("game.solar_storm_sheltered"), "#00ffaa");
                }
            } else {
                State.velocity.x += windForceX;
                State.velocity.y += windForceY;
            }
        }

        for (const s of State.ships) {
            if (s === State.playerShip || s.type === 'station' || s.dead) continue;
            if (!isInPlanetaryShadow(s.x, s.y)) {
                s.xv += windForceX * 0.6;
                s.yv += windForceY * 0.6;
            }
        }

        if (storm.activeTimer === 0) {
            storm.timer = ANOMALY_CONFIG.SOLAR_STORM_INTERVAL_FRAMES;
            storm.playerSheltered = false;
        }
    } else {
        storm.timer--;
        if (storm.timer <= 0) {
            storm.warningTimer = ANOMALY_CONFIG.SOLAR_STORM_WARNING_FRAMES;
            addScreenMessage(t("game.solar_storm_warning"), "#ffaa00");
            if (AudioEngine.ctx) {
                AudioEngine.playSolarWind(AudioEngine.ctx.currentTime, 3.0);
            }
        }
    }
}
