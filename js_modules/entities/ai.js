import { SHIP_CONFIG } from '../core/config.js';
import { State } from '../core/state.js';
import { fireEntityWeapon } from '../systems/combat.js';
import { spatialGrid } from '../systems/physics.js';

export function enemyShoot(e, tx, ty) {
    // e.x, e.y, tx, ty are ABSOLUTE WORLD COORDINATES

    if (tx === undefined) tx = State.worldOffsetX;
    if (ty === undefined) ty = State.worldOffsetY;

    const isPlayer = e === State.playerShip;
    const tier = isPlayer ? e.tier : Math.floor((e.score || 0) / SHIP_CONFIG.EVOLUTION_SCORE_STEP);

    // AI Godships should be extremely careful with their Ring of Power
    if (!isPlayer && tier >= 12) {
        let alliesNear = false;
        const SAFETY_RADIUS = 2500;

        // Check for friendly planets nearby
        for (let r of State.roids) {
            if (r.isPlanet) {
                let isFriendlyPlanet = false;
                if (e.isFriendly && r.id === State.homePlanetId) isFriendlyPlanet = true;
                if (!e.isFriendly && r.textureData && r.textureData.fleetHue === e.fleetHue) isFriendlyPlanet = true;

                if (isFriendlyPlanet && Math.sqrt((r.x - e.x) * (r.x - e.x) + (r.y - e.y) * (r.y - e.y)) < SAFETY_RADIUS) {
                    alliesNear = true;
                    break;
                }
            }
        }

        // Check for fellow allied ships nearby
        if (!alliesNear) {
            for (let other of State.ships) {
                if (other === e) continue;
                let isAlly = false;
                if (e.isFriendly && other.isFriendly) isAlly = true;
                if (!e.isFriendly && !other.isFriendly && e.fleetHue === other.fleetHue) isAlly = true;

                if (isAlly && Math.sqrt((other.x - e.x) * (other.x - e.x) + (other.y - e.y) * (other.y - e.y)) < SAFETY_RADIUS) {
                    alliesNear = true;
                    break;
                }
            }
        }

        // If allies or own planet are within blast range, suppress the God Weapon
        if (alliesNear) return;
    }

    let trajectoryAngle = Math.atan2(ty - e.y, tx - e.x); // Correct angle in world space

    let angleDiff = trajectoryAngle - e.a;

    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;

    const FIRE_CONE = Math.PI / 6; // 30 degrees
    if (Math.abs(angleDiff) > FIRE_CONE) return;

    if (!isTrajectoryClear(e, tx, ty)) return;

    let clearShot = true;

    for (let other of State.ships) {
        if (other === e) continue;
        let distToOther = Math.sqrt((other.x - e.x) * (other.x - e.x) + (other.y - e.y) * (other.y - e.y)); // World distance
        let distToTarget = Math.sqrt((tx - e.x) * (tx - e.x) + (ty - e.y) * (ty - e.y)); // World distance

        // If the friend is closer than the target (potential block)
        if (distToOther < distToTarget) {
            let angleToOther = Math.atan2(other.y - e.y, other.x - e.x);
            let checkAngleDiff = Math.abs(trajectoryAngle - angleToOther);
            if (checkAngleDiff > Math.PI) checkAngleDiff = 2 * Math.PI - checkAngleDiff;

            // If friend is within a 20-degree cone (approx 0.35 rad) of the firing line
            if (checkAngleDiff < 0.35) {
                clearShot = false;
                break;
            }
        }
    }

    if (clearShot) {
        fireEntityWeapon(e, State.enemyShipBullets, true);
        e.reloadTime = 30 + Math.random() * 20; // Set cooldown after successful shot
    }
}

export function isTrajectoryClear(e, targetX, targetY) {
    const trajectoryAngle = Math.atan2(targetY - e.y, targetX - e.x);
    const distToTarget = Math.sqrt((targetX - e.x) * (targetX - e.x) + (targetY - e.y) * (targetY - e.y));

    // Check against player
    if (!State.playerShip.dead) {
        if (e.isFriendly) {
            // Friendlies check if player is in way
            const distToPlayer = Math.sqrt((State.worldOffsetX - e.x) * (State.worldOffsetX - e.x) + (State.worldOffsetY - e.y) * (State.worldOffsetY - e.y));
            if (distToPlayer < distToTarget) {
                const angleToPlayer = Math.atan2(State.worldOffsetY - e.y, State.worldOffsetX - e.x);
                let diff = Math.abs(trajectoryAngle - angleToPlayer);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                if (diff < 0.2) return false; // Player is in way
            }
        } else {
            // State.ships check if other State.ships are in way
            // (Standard enemy behavior handled in enemyShoot, but let's be thorough)
        }
    }

    // Check against all other State.ships/stations
    for (let other of State.ships) {
        if (other === e) continue;

        let shouldRespect = false;
        if (e.isFriendly && other.isFriendly) shouldRespect = true;
        if (!e.isFriendly && !other.isFriendly && e.fleetHue === other.fleetHue) shouldRespect = true;

        if (shouldRespect) {
            const distToOther = Math.sqrt((other.x - e.x) * (other.x - e.x) + (other.y - e.y) * (other.y - e.y));
            if (distToOther < distToTarget) {
                const angleToOther = Math.atan2(other.y - e.y, other.x - e.x);
                let diff = Math.abs(trajectoryAngle - angleToOther);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                if (diff < 0.25) return false; // Friend is in way
            }
        }
    }
    return true;
}

export function proactiveCombatScanner(e) {
    if (e.reloadTime > 0) return;

    // 1. SCAN FOR RIVALS
    for (let target of State.ships) {
        if (target === e || target.type === 'station') continue;

        let isRival = false;
        if (e.isFriendly && !target.isFriendly) isRival = true;
        if (!e.isFriendly && (target.isFriendly || target.fleetHue !== e.fleetHue)) isRival = true;

        if (isRival) {
            const dist = Math.sqrt((target.x - e.x) * (target.x - e.x) + (target.y - e.y) * (target.y - e.y));
            if (dist < 2000) {
                // Since we mirror rotation, we only shoot if lined up
                enemyShoot(e, target.x, target.y);
                if (e.reloadTime > 0) return; // Shot fired
            }
        }
    }

    // 2. SCAN FOR PLANETS
    if (e.isFriendly) {
        // FRIENDLY: Scan for Enemy Planets (Friendly Wingmen)
        for (let r of State.roids) {
            if (r.isPlanet && r.z < 0.5 && r.id !== State.homePlanetId && !r._destroyed) {
                const dist = Math.sqrt((r.x - e.x) * (r.x - e.x) + (r.y - e.y) * (r.y - e.y));
                if (dist < 2000) {
                    enemyShoot(e, r.x, r.y);
                    if (e.reloadTime > 0) return;
                }
            }
        }
    } else {
        // ENEMY: Scan for Home Planet (High Priority)
        if (State.homePlanetId) {
            const home = State.roids.find(r => r.id === State.homePlanetId);
            if (home && home.z < 0.5 && !home._destroyed) {
                const dist = Math.sqrt((home.x - e.x) * (home.x - e.x) + (home.y - e.y) * (home.y - e.y));
                if (dist < 2500) { // Slightly longer sight range for massive planet
                    enemyShoot(e, home.x, home.y);
                    if (e.reloadTime > 0) return;
                }
            }
        }
    }

    // 3. SCAN FOR ASTEROID_CONFIG.COUNT (Defend Home Station)
    // Priority: Asteroids near the home station
    if (e.homeStation) {
        for (let r of State.roids) {
            if (r.z > 0.5 || r.isPlanet) continue;
            const distToStation = Math.sqrt((r.x - e.homeStation.x) * (r.x - e.homeStation.x) + (r.y - e.homeStation.y) * (r.y - e.homeStation.y));
            const dangerRange = e.homeStation.r * 8.0;

            if (distToStation < dangerRange) {
                const distToShip = Math.sqrt((r.x - e.x) * (r.x - e.x) + (r.y - e.y) * (r.y - e.y));
                if (distToShip < 2000) { // Within firing range
                    enemyShoot(e, r.x, r.y);
                    if (e.reloadTime > 0) return;
                }
            }
        }
    }

    // Generic asteroid clearing
    for (let r of State.roids) {
        if (r.z > 0.5 || r.isPlanet) continue;
        const dist = Math.sqrt((r.x - e.x) * (r.x - e.x) + (r.y - e.y) * (r.y - e.y));
        if (dist < 1500) {
            enemyShoot(e, r.x, r.y);
            if (e.reloadTime > 0) return;
        }
    }

    // 3. SCAN FOR PLAYER (if enemy)
    if (!e.isFriendly && !State.playerShip.dead) {
        const dist = Math.sqrt((State.worldOffsetX - e.x) * (State.worldOffsetX - e.x) + (State.worldOffsetY - e.y) * (State.worldOffsetY - e.y));
        if (dist < 2000) {
            enemyShoot(e, State.worldOffsetX, State.worldOffsetY);
        }
    }
}

export function applyEvasionForces(ship) {
    if (ship.dead) return;

    let evadeX = 0;
    let evadeY = 0;
    let maxDangerScore = 0;

    // 1. EVADE ASTEROIDS AND PLANETS
    const DANGER_SCAN_RANGE = 500;
    let nearbyDanger = spatialGrid.query(ship);

    for (let r of nearbyDanger) {
        if (r.z > 0.5 || r._destroyed || r.vaporized) continue;

        // Treat planets as huge threats
        const isPlanet = r.isPlanet;
        const scanRange = isPlanet ? r.r * 1.5 + 500 : DANGER_SCAN_RANGE;

        const distToObstacle = Math.sqrt((r.x - ship.x) * (r.x - ship.x) + (r.y - ship.y) * (r.y - ship.y));
        if (distToObstacle > scanRange) continue;

        // Vector to obstacle
        const dirX = r.x - ship.x;
        const dirY = r.y - ship.y;

        // Check if we are heading towards it
        const dotProduct = ship.xv * dirX + ship.yv * dirY;

        // If we are relatively still, just push away if too close
        const speed = Math.sqrt((ship.xv) * (ship.xv) + (ship.yv) * (ship.yv));

        let dangerScore = 0;
        let forceMag = 0;
        let forceX = 0;
        let forceY = 0;

        const safeDist = ship.r + r.r + 50;

        if (distToObstacle < safeDist) {
            // Panic push - we are already too close (or inside atmosphere)
            dangerScore = 1000 / Math.max(1, distToObstacle);
            forceMag = 5.0; // Strong push
            // Push directly away
            forceX = -(dirX / distToObstacle) * forceMag;
            forceY = -(dirY / distToObstacle) * forceMag;
        } else if (speed > 0.5 && dotProduct > 0) {
            // We are moving towards it. Calculate time to collision.
            const relVelX = ship.xv - (r.xv || 0);
            const relVelY = ship.yv - (r.yv || 0);
            const relSpeed = Math.sqrt((relVelX) * (relVelX) + (relVelY) * (relVelY));

            if (relSpeed > 0.1) {
                const timeToClosest = (dirX * relVelX + dirY * relVelY) / (relSpeed * relSpeed);

                if (timeToClosest > 0 && timeToClosest < 60) {
                    // Project future positions
                    const closestDist = Math.sqrt((-dirX + relVelX * timeToClosest) * (-dirX + relVelX * timeToClosest) + (-dirY + relVelY * timeToClosest) * (-dirY + relVelY * timeToClosest));

                    if (closestDist < safeDist + 100) {
                        // Collision predicted!
                        dangerScore = 100 / Math.max(1, timeToClosest);
                        // Steer perpendicularly
                        const lookAheadX = -dirX + relVelX * timeToClosest;
                        const lookAheadY = -dirY + relVelY * timeToClosest;

                        // Push away from the closest approach point
                        const approachDist = Math.max(1, closestDist);
                        forceMag = 3.0 * (1 - timeToClosest / 60);

                        forceX = (lookAheadX / approachDist) * forceMag;
                        forceY = (lookAheadY / approachDist) * forceMag;
                    }
                }
            }
        }

        if (dangerScore > maxDangerScore) {
            maxDangerScore = dangerScore;
        }
        evadeX += forceX;
        evadeY += forceY;
    }

    // 2. EVADE BULLETS
    const bulletsToEvade = ship.isFriendly ? State.enemyShipBullets : State.playerShipBullets;
    const BULLET_EVADE_RANGE = 400;

    for (let b of bulletsToEvade) {
        if (!b.active) continue;
        const distToBullet = Math.sqrt((b.x - ship.x) * (b.x - ship.x) + (b.y - ship.y) * (b.y - ship.y));

        if (distToBullet < BULLET_EVADE_RANGE) {
            // Relative velocity
            const relVelX = b.xv - ship.xv;
            const relVelY = b.yv - ship.yv;
            const relSpeedSq = relVelX * relVelX + relVelY * relVelY;

            if (relSpeedSq > 0.1) {
                const vecToShipX = ship.x - b.x;
                const vecToShipY = ship.y - b.y;

                // Dot product to see if bullet is moving towards ship
                const t = (vecToShipX * relVelX + vecToShipY * relVelY) / relSpeedSq;

                if (t > 0 && t < 30) { // Will hit in next 30 frames
                    const closestX = relVelX * t - vecToShipX;
                    const closestY = relVelY * t - vecToShipY;
                    const closestDist = Math.sqrt((closestX) * (closestX) + (closestY) * (closestY));

                    if (closestDist < ship.r + 30) {
                        // Perpendicular evasion
                        const evadeForce = 2.0 * (1 - t / 30);
                        const cDist = Math.max(1, closestDist);
                        evadeX += (closestX / cDist) * evadeForce;
                        evadeY += (closestY / cDist) * evadeForce;
                    }
                }
            }
        }
    }

    // Apply accumulated forces
    if (evadeX !== 0 || evadeY !== 0) {
        ship.xv += evadeX;
        ship.yv += evadeY;
    }
}
