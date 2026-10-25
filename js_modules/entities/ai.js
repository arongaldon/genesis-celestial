import { ASTEROID_CONFIG, BOUNDARY_CONFIG, NEMESIS_CONFIG, SCORE_REWARDS, SHIP_CONFIG, STATION_CONFIG, WORLD_BOUNDS } from '../core/config.js';
import { State } from '../core/state.js';
import { AudioEngine } from '../audio/audio.js';
import { createSquadSlots, promoteToNemesis, spawnShipsSquad, splitAsteroid } from './entities.js';
import { createExplosion } from '../graphics/fx.js';
import { addScreenMessage } from '../graphics/render.js';
import { destroyShipEntity, fireEntityWeapon } from '../systems/combat.js';
import { spatialGrid } from '../systems/physics.js';
import { getShipTier, increaseShipScore, onShipDestroyed, onStationDestroyed } from '../systems/scoring.js';
import { dist, normalizeAngle, rotateTowards } from '../utils/utils.js';
import { t } from '../utils/i18n.js';

let homeAttackWarningTimer = 0;
let stationAttackWarningTimer = 0;

export function resetAIWarningTimers() {
    homeAttackWarningTimer = 0;
    stationAttackWarningTimer = 0;
}

export function tickAIWarningTimers() {
    if (homeAttackWarningTimer > 0) homeAttackWarningTimer--;
    if (stationAttackWarningTimer > 0) stationAttackWarningTimer--;

    if (State.activeNemesis && (State.activeNemesis.dead || !State.ships.includes(State.activeNemesis) || State.activeNemesis.isFriendly)) {
        State.activeNemesis = null;
    }

    if (!State.activeNemesis && State.gameRunning && !State.victoryState) {
        State.nemesisSpawnTimer--;
        if (State.nemesisSpawnTimer <= 0) {
            let bestCandidate = null;
            let highestScore = -1;
            for (const s of State.ships) {
                if (s.type === 'ship' && !s.isFriendly && !s.dead && (s.score || 0) > highestScore) {
                    highestScore = s.score || 0;
                    bestCandidate = s;
                }
            }
            if (bestCandidate) {
                promoteToNemesis(bestCandidate);
            }
            State.nemesisSpawnTimer = NEMESIS_CONFIG.FALLBACK_SPAWN_FRAMES;
        }
    }
}

export function enemyShoot(e, tx = State.worldOffsetX, ty = State.worldOffsetY) {
    const isPlayer = e === State.playerShip;
    const tier = isPlayer ? e.tier : getShipTier(e);

    // AI Godships should be extremely careful with their Ring of Power
    if (!isPlayer && tier >= SHIP_CONFIG.GODSHIP_TIER) {
        const SAFETY_RADIUS = 2500;
        let alliesNear = State.roids.some(r => {
            if (!r.isPlanet) return false;
            const isFriendlyPlanet = (e.isFriendly && r.id === State.homePlanetId) ||
                (!e.isFriendly && r.textureData && r.textureData.fleetHue === e.fleetHue);
            return isFriendlyPlanet && dist(e.x, e.y, r.x, r.y) < SAFETY_RADIUS;
        });

        if (!alliesNear) {
            alliesNear = State.ships.some(other => {
                if (other === e) return false;
                const isAlly = (e.isFriendly && other.isFriendly) || (!e.isFriendly && !other.isFriendly && e.fleetHue === other.fleetHue);
                return isAlly && dist(e.x, e.y, other.x, other.y) < SAFETY_RADIUS;
            });
        }

        if (alliesNear) return;
    }

    const trajectoryAngle = Math.atan2(ty - e.y, tx - e.x);
    const angleDiff = normalizeAngle(trajectoryAngle - e.a);

    const FIRE_CONE = Math.PI / 6; // 30 degrees
    if (Math.abs(angleDiff) > FIRE_CONE) return;

    if (!isTrajectoryClear(e, tx, ty)) return;

    fireEntityWeapon(e, State.enemyShipBullets, true);
    e.reloadTime = 30 + Math.random() * 20;
}

export function isTrajectoryClear(e, targetX, targetY) {
    const trajectoryAngle = Math.atan2(targetY - e.y, targetX - e.x);
    const distToTarget = dist(e.x, e.y, targetX, targetY);

    // Check against player if friendly
    if (!State.playerShip.dead && e.isFriendly) {
        const distToPlayer = dist(e.x, e.y, State.worldOffsetX, State.worldOffsetY);
        if (distToPlayer < distToTarget) {
            const angleToPlayer = Math.atan2(State.worldOffsetY - e.y, State.worldOffsetX - e.x);
            if (Math.abs(normalizeAngle(trajectoryAngle - angleToPlayer)) < 0.2) return false;
        }
    }

    // Check against other ships/stations in the line of fire
    for (const other of State.ships) {
        if (other === e) continue;
        const distToOther = dist(e.x, e.y, other.x, other.y);
        if (distToOther < distToTarget) {
            const angleToOther = Math.atan2(other.y - e.y, other.x - e.x);
            if (Math.abs(normalizeAngle(trajectoryAngle - angleToOther)) < 0.35) {
                return false;
            }
        }
    }
    return true;
}

export function proactiveCombatScanner(e) {
    if (e.reloadTime > 0) return;

    // 1. SCAN FOR RIVALS
    for (const target of State.ships) {
        if (target === e || target.type === 'station') continue;
        const isRival = (e.isFriendly && !target.isFriendly) ||
            (!e.isFriendly && (target.isFriendly || target.fleetHue !== e.fleetHue));

        if (isRival && dist(e.x, e.y, target.x, target.y) < 2000) {
            enemyShoot(e, target.x, target.y);
            if (e.reloadTime > 0) return;
        }
    }

    // 2. SCAN FOR PLANETS
    if (e.isFriendly) {
        for (const r of State.roids) {
            if (r.isPlanet && r.z < 0.5 && r.id !== State.homePlanetId && !r._destroyed) {
                if (dist(e.x, e.y, r.x, r.y) < 2000) {
                    enemyShoot(e, r.x, r.y);
                    if (e.reloadTime > 0) return;
                }
            }
        }
    } else if (State.homePlanetId) {
        const home = State.roids.find(r => r.id === State.homePlanetId);
        if (home && home.z < 0.5 && !home._destroyed && dist(e.x, e.y, home.x, home.y) < 2500) {
            enemyShoot(e, home.x, home.y);
            if (e.reloadTime > 0) return;
        }
    }

    // 3. DEFEND HOME STATION FROM ASTEROIDS
    if (e.homeStation) {
        const dangerRange = e.homeStation.r * 8.0;
        for (const r of State.roids) {
            if (r.z > 0.5 || r.isPlanet) continue;
            if (dist(e.homeStation.x, e.homeStation.y, r.x, r.y) < dangerRange && dist(e.x, e.y, r.x, r.y) < 2000) {
                enemyShoot(e, r.x, r.y);
                if (e.reloadTime > 0) return;
            }
        }
    }

    // 4. GENERIC ASTEROID CLEARING
    for (const r of State.roids) {
        if (r.z > 0.5 || r.isPlanet) continue;
        if (dist(e.x, e.y, r.x, r.y) < 1500) {
            enemyShoot(e, r.x, r.y);
            if (e.reloadTime > 0) return;
        }
    }

    // 5. SCAN FOR PLAYER (if enemy)
    if (!e.isFriendly && !State.playerShip.dead && dist(e.x, e.y, State.worldOffsetX, State.worldOffsetY) < 2000) {
        enemyShoot(e, State.worldOffsetX, State.worldOffsetY);
    }
}

export function applyEvasionForces(ship) {
    if (ship.dead) return;

    let evadeX = 0;
    let evadeY = 0;

    // 1. EVADE ASTEROIDS AND PLANETS
    const DANGER_SCAN_RANGE = 500;
    const nearbyDanger = spatialGrid.query(ship);

    for (const r of nearbyDanger) {
        if (r.z > 0.5 || r._destroyed || r.vaporized) continue;

        const scanRange = r.isPlanet ? r.r * 1.5 + 500 : DANGER_SCAN_RANGE;
        const distToObstacle = dist(ship.x, ship.y, r.x, r.y);
        if (distToObstacle > scanRange) continue;

        const dirX = r.x - ship.x;
        const dirY = r.y - ship.y;
        const dotProduct = ship.xv * dirX + ship.yv * dirY;
        const speed = Math.hypot(ship.xv, ship.yv);
        const safeDist = ship.r + r.r + 50;

        if (distToObstacle < safeDist) {
            const forceMag = 5.0;
            const d = Math.max(1, distToObstacle);
            evadeX -= (dirX / d) * forceMag;
            evadeY -= (dirY / d) * forceMag;
        } else if (speed > 0.5 && dotProduct > 0) {
            const relVelX = ship.xv - (r.xv || 0);
            const relVelY = ship.yv - (r.yv || 0);
            const relSpeed = Math.hypot(relVelX, relVelY);

            if (relSpeed > 0.1) {
                const timeToClosest = (dirX * relVelX + dirY * relVelY) / (relSpeed * relSpeed);
                if (timeToClosest > 0 && timeToClosest < 60) {
                    const lookAheadX = -dirX + relVelX * timeToClosest;
                    const lookAheadY = -dirY + relVelY * timeToClosest;
                    const closestDist = Math.hypot(lookAheadX, lookAheadY);

                    if (closestDist < safeDist + 100) {
                        const approachDist = Math.max(1, closestDist);
                        const forceMag = 3.0 * (1 - timeToClosest / 60);
                        evadeX += (lookAheadX / approachDist) * forceMag;
                        evadeY += (lookAheadY / approachDist) * forceMag;
                    }
                }
            }
        }
    }

    // 2. EVADE BULLETS
    const bulletsToEvade = ship.isFriendly ? State.enemyShipBullets : State.playerShipBullets;
    const BULLET_EVADE_RANGE = 400;

    for (const b of bulletsToEvade) {
        if (b.life <= 0) continue;
        const distToBullet = dist(ship.x, ship.y, b.x, b.y);

        if (distToBullet < BULLET_EVADE_RANGE) {
            const relVelX = b.xv - ship.xv;
            const relVelY = b.yv - ship.yv;
            const relSpeedSq = relVelX * relVelX + relVelY * relVelY;

            if (relSpeedSq > 0.1) {
                const vecToShipX = ship.x - b.x;
                const vecToShipY = ship.y - b.y;
                const timeToHit = (vecToShipX * relVelX + vecToShipY * relVelY) / relSpeedSq;

                if (timeToHit > 0 && timeToHit < 30) {
                    const closestX = relVelX * timeToHit - vecToShipX;
                    const closestY = relVelY * timeToHit - vecToShipY;
                    const closestDist = Math.hypot(closestX, closestY);

                    if (closestDist < ship.r + 30) {
                        const evadeForce = 2.0 * (1 - timeToHit / 30);
                        const cDist = Math.max(1, closestDist);
                        evadeX += (closestX / cDist) * evadeForce;
                        evadeY += (closestY / cDist) * evadeForce;
                    }
                }
            }
        }
    }

    if (evadeX !== 0 || evadeY !== 0) {
        ship.xv += evadeX;
        ship.yv += evadeY;
    }
}

function updateStationOrbit(station) {
    if (!station.hostPlanetId) return;
    const host = State.roids.find(r => r.id === station.hostPlanetId);
    if (!host) {
        station.hostPlanetId = null;
        station.xv = (Math.random() - 0.5) * 0.5;
        station.yv = (Math.random() - 0.5) * 0.5;
        return;
    }

    station.orbitAngle += station.orbitSpeed;
    const effectiveOrbitDist = host.r * (1 + STATION_CONFIG.ORBIT_FACTOR) + station.r;
    const targetX = host.x + Math.cos(station.orbitAngle) * effectiveOrbitDist;
    const targetY = host.y + Math.sin(station.orbitAngle) * effectiveOrbitDist;

    station.xv = (station.xv + (targetX - station.x) * 0.1) * 0.8;
    station.yv = (station.yv + (targetY - station.y) * 0.1) * 0.8;

    const stationNeighbors = spatialGrid.query(station);
    for (const r of stationNeighbors) {
        if (r === host || r.z > 0.5 || r.isPlanet) continue;
        const dx = station.x - r.x;
        const dy = station.y - r.y;
        const d = Math.hypot(dx, dy);
        const minDist = station.r + r.r + 100;
        if (d < minDist && d > 0) {
            const force = (minDist - d) * 0.05;
            station.xv += (dx / d) * force;
            station.yv += (dy / d) * force;
        }
    }

    if (station.z >= 0.5) {
        station.structureHP = STATION_CONFIG.RESISTANCE;
    }
}

function updateStationBehavior(station) {
    station.a += station.rotSpeed;
    station.spawnTimer--;
    if (station.spawnTimer <= 0) {
        const currentFactionShips = State.ships.filter(
            en => en.type === 'ship' && en.homeStation && en.homeStation.hostPlanetId === station.hostPlanetId
        ).length;
        if (currentFactionShips < SHIP_CONFIG.PLANET_LIMIT) {
            spawnShipsSquad(station);
        }
        station.spawnTimer = SHIP_CONFIG.SPAWN_TIME + Math.random() * SHIP_CONFIG.SPAWN_TIME;
    }

    if (station.reloadTime <= 0) {
        const targets = spatialGrid.query(station);
        for (const r of targets) {
            if (r.z > 0.5 || r.isPlanet) continue;
            if (dist(station.x, station.y, r.x, r.y) < 1500) {
                enemyShoot(station, r.x, r.y);
                if (station.reloadTime > 0) break;
            }
        }
    } else {
        station.reloadTime--;
    }
}

function checkAttackWarnings(ship, tier) {
    if (ship.isFriendly || State.victoryState) return;

    let isThreat = tier >= SHIP_CONFIG.GODSHIP_TIER;
    if (!isThreat && ship.role === 'leader' && ship.squadSlots) {
        const validSubordinates = ship.squadSlots.filter(
            s => s.occupant && !s.occupant.dead && State.ships.includes(s.occupant)
        ).length;
        if (validSubordinates > 0) isThreat = true;
    }

    if (!isThreat) return;

    let warnedHome = false;
    if (State.homePlanetId && homeAttackWarningTimer === 0) {
        const home = State.roids.find(r => r.id === State.homePlanetId);
        if (home && home.z < 0.5 && dist(ship.x, ship.y, home.x, home.y) < 3000) {
            addScreenMessage(t("game.warn_home_attack"), "#ff0000");
            homeAttackWarningTimer = 600;
            warnedHome = true;
        }
    }

    if (!warnedHome && stationAttackWarningTimer === 0) {
        for (const other of State.ships) {
            if (other.isFriendly && other.type === 'station' && dist(ship.x, ship.y, other.x, other.y) < 3000) {
                addScreenMessage(t("game.warn_station_attack"), "#ff8800");
                stationAttackWarningTimer = 600;
                break;
            }
        }
    }
}

function updateSafeZoneHunter(ship) {
    proactiveCombatScanner(ship);

    if (!ship.safeZoneTarget || dist(ship.x, ship.y, ship.safeZoneTarget.x, ship.safeZoneTarget.y) < 500) {
        const angle = Math.random() * Math.PI * 2;
        const r = WORLD_BOUNDS * 0.8 + Math.random() * (WORLD_BOUNDS * 0.1);
        ship.safeZoneTarget = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }

    let huntTarget = null;
    let minThreatDist = Infinity;

    if (!ship.isFriendly && State.homePlanetId) {
        const home = State.roids.find(r => r.id === State.homePlanetId);
        if (home && home.z < 0.5 && !home._destroyed) {
            const d = dist(ship.x, ship.y, home.x, home.y);
            if (d < 5000) {
                huntTarget = home;
                minThreatDist = d;
            }
        }
    }

    if (!huntTarget) {
        const gridThreats = spatialGrid.query(ship);
        for (const r of gridThreats) {
            if (r.z > 0.5 || r.isPlanet) continue;
            const d = dist(ship.x, ship.y, r.x, r.y);
            if (d < 1500 && d < minThreatDist) {
                huntTarget = r;
                minThreatDist = d;
            }
        }
    }

    if (!huntTarget) {
        for (const other of State.ships) {
            if (other === ship || other.type === 'station') continue;
            const isRival = ship.fleetHue !== other.fleetHue ||
                ((other === State.playerShip || ship === State.playerShip) && State.playerShip.loneWolf);
            if (isRival) {
                const d = dist(ship.x, ship.y, other.x, other.y);
                if (d < 2000 && d < minThreatDist) {
                    huntTarget = other;
                    minThreatDist = d;
                }
            }
        }
        if (!ship.isFriendly && !State.playerShip.dead) {
            const d = dist(ship.x, ship.y, State.worldOffsetX, State.worldOffsetY);
            if (d < 2000 && d < minThreatDist) {
                huntTarget = { x: State.worldOffsetX, y: State.worldOffsetY };
                minThreatDist = d;
            }
        }
    }

    if (ship.isFriendly && State.playerShip.tier >= SHIP_CONFIG.GODSHIP_TIER && State.homePlanetId) {
        const home = State.roids.find(r => r.id === State.homePlanetId);
        if (home) {
            for (const other of State.ships) {
                if (!other.isFriendly && other.type !== 'station' && dist(other.x, other.y, home.x, home.y) < 3000) {
                    const distToRival = dist(ship.x, ship.y, other.x, other.y);
                    if (distToRival < minThreatDist) {
                        huntTarget = other;
                        minThreatDist = distToRival;
                    }
                }
            }
        }
    }

    const moveTarget = huntTarget || ship.safeZoneTarget;
    const moveAngle = Math.atan2(moveTarget.y - ship.y, moveTarget.x - ship.x);
    ship.xv = (ship.xv + Math.cos(moveAngle) * 0.4) * 0.95;
    ship.yv = (ship.yv + Math.sin(moveAngle) * 0.4) * 0.95;
    ship.a = rotateTowards(ship.a, moveAngle, 0.05);
}

function updateWingmanRetreat(ship) {
    if (!ship.isFriendly || State.playerShip.tier < SHIP_CONFIG.GODSHIP_TIER || !State.homePlanetId) return false;
    const home = State.roids.find(r => r.id === State.homePlanetId);
    if (!home) return false;

    const dx = home.x - ship.x;
    const dy = home.y - ship.y;
    const d = Math.hypot(dx, dy);
    const orbitRadius = home.r * 1.5 + ship.r;

    if (d > orbitRadius + 100) {
        ship.xv += (dx / d) * 1.5;
        ship.yv += (dy / d) * 1.5;
        ship.a = rotateTowards(ship.a, Math.atan2(ship.yv, ship.xv), 0.1);
    } else if (d < orbitRadius - 100) {
        ship.xv -= (dx / d) * 1.5;
        ship.yv -= (dy / d) * 1.5;
        ship.a = rotateTowards(ship.a, Math.atan2(ship.yv, ship.xv), 0.1);
    } else {
        if (!ship.orbitDir) ship.orbitDir = Math.random() > 0.5 ? 1 : -1;
        const orbitAngle = Math.atan2(dy, dx) + (Math.PI / 2) * ship.orbitDir;
        ship.xv += Math.cos(orbitAngle) * 1.0;
        ship.yv += Math.sin(orbitAngle) * 1.0;

        let targetAngle = Math.atan2(ship.yv, ship.xv);
        let nearestThreat = null;
        let minThreatDist = Infinity;

        for (const r of State.roids) {
            if (r.z > 0.5 || r.isPlanet) continue;
            if (dist(home.x, home.y, r.x, r.y) < home.r * 8.0) {
                const distToShip = dist(ship.x, ship.y, r.x, r.y);
                if (distToShip < minThreatDist && distToShip < 2000) {
                    nearestThreat = r;
                    minThreatDist = distToShip;
                }
            }
        }
        for (const target of State.ships) {
            if (target === ship || target.type === 'station' || target.isFriendly) continue;
            if (dist(home.x, home.y, target.x, target.y) < home.r * 8.0) {
                const distToShip = dist(ship.x, ship.y, target.x, target.y);
                if (distToShip < minThreatDist && distToShip < 2000) {
                    nearestThreat = target;
                    minThreatDist = distToShip;
                }
            }
        }

        if (nearestThreat) {
            targetAngle = Math.atan2(nearestThreat.y - ship.y, nearestThreat.x - ship.x);
        }
        ship.a = rotateTowards(ship.a, targetAngle, 0.15);
    }
    ship.xv *= 0.95;
    ship.yv *= 0.95;
    return true;
}

function updateSquadLeader(ship) {
    if (ship.squadSlots) {
        const validOccupants = [];
        ship.squadSlots.forEach(slot => {
            if (slot.occupant && !slot.occupant.dead && (State.ships.includes(slot.occupant) || slot.occupant === State.playerShip)) {
                validOccupants.push(slot.occupant);
            }
            slot.occupant = null;
        });

        for (let i = 0; i < Math.min(validOccupants.length, ship.squadSlots.length); i++) {
            const member = validOccupants[i];
            const slot = ship.squadSlots[i];
            slot.occupant = member;
            member.formationOffset = { x: slot.x, y: slot.y };
        }
        ship._lastSquadCount = validOccupants.length;
    }

    let targetX, targetY;
    let targetFound = false;

    if (ship.homeStation && !ship.homeStation.dead) {
        let threateningAst = null;
        let minAstDist = Infinity;

        const stationHazards = spatialGrid.query(ship.homeStation);
        for (const r of stationHazards) {
            if (r.z > 0.5 || r.isPlanet) continue;
            const distToHome = dist(ship.homeStation.x, ship.homeStation.y, r.x, r.y);
            if (distToHome < 2500 && distToHome < minAstDist) {
                minAstDist = distToHome;
                threateningAst = r;
            }
        }

        if (threateningAst) {
            targetX = threateningAst.x;
            targetY = threateningAst.y;
            targetFound = true;
        }
    }

    if (!targetFound) {
        if (!ship.patrolTarget) {
            ship.patrolTarget = { x: ship.x, y: ship.y };
        }

        if (dist(ship.x, ship.y, ship.patrolTarget.x, ship.patrolTarget.y) < 500) {
            if (Math.random() < 0.5) {
                const ang = Math.random() * Math.PI * 2;
                const r = Math.random() * WORLD_BOUNDS * 0.9;
                ship.patrolTarget.x = Math.cos(ang) * r;
                ship.patrolTarget.y = Math.sin(ang) * r;
            } else {
                const rival = State.ships.find(s => s.type === 'station' && !s.isFriendly && s.fleetHue !== ship.fleetHue && !s.dead);
                if (rival) {
                    ship.patrolTarget.x = rival.x;
                    ship.patrolTarget.y = rival.y;
                } else {
                    ship.patrolTarget.x = (Math.random() - 0.5) * 1.8 * WORLD_BOUNDS;
                    ship.patrolTarget.y = (Math.random() - 0.5) * 1.8 * WORLD_BOUNDS;
                }
            }
        }
        targetX = ship.patrolTarget.x;
        targetY = ship.patrolTarget.y;
    }

    const targetAngle = Math.atan2(targetY - ship.y, targetX - ship.x);
    ship.a = rotateTowards(ship.a, targetAngle, 0.05);

    const CRUISE_SPEED = 12;
    ship.xv += Math.cos(ship.a) * 0.5;
    ship.yv += Math.sin(ship.a) * 0.5;

    const speed = Math.hypot(ship.xv, ship.yv);
    if (speed > CRUISE_SPEED) {
        ship.xv = (ship.xv / speed) * CRUISE_SPEED;
        ship.yv = (ship.yv / speed) * CRUISE_SPEED;
    }
}

function updateFormationFollower(ship) {
    const followingPlayer = ship.leaderRef === State.playerShip;
    const lx = followingPlayer ? State.worldOffsetX : ship.leaderRef.x;
    const ly = followingPlayer ? State.worldOffsetY : ship.leaderRef.y;
    const la = ship.leaderRef.a;

    const fwdX = Math.cos(la);
    const fwdY = Math.sin(la);
    const rightX = -fwdY;
    const rightY = fwdX;

    const targetX = lx + (rightX * ship.formationOffset.x) + (fwdX * ship.formationOffset.y);
    const targetY = ly + (rightY * ship.formationOffset.x) + (fwdY * ship.formationOffset.y);

    const dx = targetX - ship.x;
    const dy = targetY - ship.y;
    const distToTarget = Math.hypot(dx, dy);
    const isInVisualSlot = distToTarget < (followingPlayer ? 40 : 50);

    if (followingPlayer) {
        const isPlayerActive = Math.abs(State.velocity.x) > 0.5 || Math.abs(State.velocity.y) > 0.5 ||
            State.keys.KeyA || State.keys.KeyD || State.keys.ArrowLeft || State.keys.ArrowRight ||
            State.keys.ArrowUp || State.keys.Space;

        let obstacle = null;
        const safetyDist = 50;
        const nearbyObs = spatialGrid.query(ship);
        for (const r of nearbyObs) {
            if (r.z > 0.5 || r.isPlanet) continue;
            if (dist(ship.x, ship.y, r.x, r.y) < r.r + ship.r + safetyDist) {
                obstacle = r;
                break;
            }
        }
        if (!obstacle) {
            for (const other of State.ships) {
                if (other === ship || (other.isFriendly && other.type !== 'station')) continue;
                if (dist(ship.x, ship.y, other.x, other.y) < other.r + ship.r + safetyDist) {
                    obstacle = other;
                    break;
                }
            }
        }

        if (obstacle && isPlayerActive) ship.isAvoiding = true;
        else if (!isPlayerActive) ship.isAvoiding = false;

        let formationForce = 0.15;
        ship.arrivalDamping = 0.85;

        if (ship.isAvoiding) {
            if (obstacle) {
                const avoidAng = Math.atan2(ship.y - obstacle.y, ship.x - obstacle.x);
                ship.xv += Math.cos(avoidAng) * 2.5;
                ship.yv += Math.sin(avoidAng) * 2.5;
                ship.arrivalDamping = 0.92;
            } else {
                ship.arrivalDamping = 0.98;
            }
        } else {
            ship.xv += (State.velocity.x - ship.xv) * 0.1;
            ship.yv += (State.velocity.y - ship.yv) * 0.1;

            if (distToTarget < 200) {
                const arrivalFactor = distToTarget / 200;
                formationForce *= arrivalFactor;
                ship.arrivalDamping = 0.85 + (1 - arrivalFactor) * 0.1;
            }
            ship.xv += dx * formationForce;
            ship.yv += dy * formationForce;
        }

        if (isInVisualSlot && !ship.isAvoiding) {
            const angleDiff = normalizeAngle(la - ship.a);
            ship.a = Math.abs(angleDiff) < 0.05 ? la : normalizeAngle(ship.a + angleDiff * 0.4);
        } else {
            ship.a = rotateTowards(ship.a, Math.atan2(ship.yv, ship.xv), 0.1);
        }

        const speed = Math.hypot(ship.xv, ship.yv);
        const maxFormationSpeed = 25;
        if (speed > maxFormationSpeed) {
            ship.xv = (ship.xv / speed) * maxFormationSpeed;
            ship.yv = (ship.yv / speed) * maxFormationSpeed;
        }
        ship.xv *= ship.arrivalDamping || 0.85;
        ship.yv *= ship.arrivalDamping || 0.85;
        return;
    }

    // NPC Leader Follower
    let force = 0.25;
    let damping = 0.90;
    const lvx = ship.leaderRef.xv || 0;
    const lvy = ship.leaderRef.yv || 0;

    ship.xv += (lvx - ship.xv) * 0.25;
    ship.yv += (lvy - ship.yv) * 0.25;

    if (distToTarget < 200) {
        const factor = distToTarget / 200;
        force *= factor;
        damping = 0.90 + (1 - factor) * 0.05;
    } else if (distToTarget > 500) {
        force *= 1.5;
    }

    ship.xv += dx * force;
    ship.yv += dy * force;

    const distToLeader = dist(ship.x, ship.y, lx, ly);
    const minSafeDist = ship.r + (ship.leaderRef.r || 30) + 10;
    if (distToLeader < minSafeDist) {
        const ang = Math.atan2(ship.y - ly, ship.x - lx);
        ship.xv += Math.cos(ang) * 1.5;
        ship.yv += Math.sin(ang) * 1.5;
    }

    for (const other of State.ships) {
        if (other === ship || other.type !== 'ship') continue;
        const isTeammate = (ship.isFriendly && other.isFriendly) || (ship.fleetHue === other.fleetHue);
        if (isTeammate) {
            const sdx = ship.x - other.x;
            const sdy = ship.y - other.y;
            const requiredDist = SHIP_CONFIG.SEPARATION_DISTANCE + (ship.r + other.r) * 0.5;
            if (Math.abs(sdx) < requiredDist && Math.abs(sdy) < requiredDist) {
                const distToOther = Math.hypot(sdx, sdy);
                if (distToOther < requiredDist) {
                    const ang = Math.atan2(sdy, sdx);
                    const sepForce = (requiredDist - distToOther) * 0.08;
                    ship.xv += Math.cos(ang) * sepForce;
                    ship.yv += Math.sin(ang) * sepForce;
                }
            }
        }
    }

    if (isInVisualSlot) {
        const angleDiff = normalizeAngle(la - ship.a);
        ship.a = Math.abs(angleDiff) < 0.05 ? la : normalizeAngle(ship.a + angleDiff * 0.4);
    } else {
        ship.a = rotateTowards(ship.a, Math.atan2(ship.yv, ship.xv), 0.1);
    }

    ship.xv *= damping;
    ship.yv *= damping;
}

function tryJoinOrOrbitSquad(ship) {
    let foundLeader = null;
    let foundSlot = null;
    const NPC_JOIN_RANGE = 300;

    if (ship.isFriendly && !State.playerShip.dead && !State.playerShip.loneWolf && State.playerShip.squadSlots) {
        const openSlot = State.playerShip.squadSlots.find(s => !s.occupant || s.occupant.dead || !State.ships.includes(s.occupant));
        if (openSlot) {
            foundLeader = State.playerShip;
            foundSlot = openSlot;
        }
    }

    if (!foundLeader && !ship.isFriendly) {
        for (const other of State.ships) {
            if (other.dead || other === ship || other.type !== 'ship') continue;
            if (other.fleetHue === ship.fleetHue && !other.isFriendly && dist(ship.x, ship.y, other.x, other.y) < NPC_JOIN_RANGE) {
                if (other.role === 'leader' && other.squadSlots) {
                    const openSlot = other.squadSlots.find(s => !s.occupant || s.occupant.dead || !State.ships.includes(s.occupant));
                    if (openSlot) {
                        foundLeader = other;
                        foundSlot = openSlot;
                        break;
                    }
                } else if (!other.leaderRef && other.role !== 'leader' && ship.role !== 'leader') {
                    other.role = 'leader';
                    other.squadId = Math.random();
                    other.squadSlots = createSquadSlots();
                    foundLeader = other;
                    foundSlot = other.squadSlots[0];
                    break;
                }
            }
        }
    }

    if (foundLeader && foundSlot) {
        ship.leaderRef = foundLeader;
        ship.aiState = 'FORMATION';
        ship.formationOffset = { x: foundSlot.x, y: foundSlot.y };
        foundSlot.occupant = ship;
        return;
    }

    proactiveCombatScanner(ship);

    let patrolCenter = { x: ship.x, y: ship.y };
    let baseRadius = 0;
    if (ship.homeStation) {
        if (ship.homeStation.hostPlanet && !ship.homeStation.hostPlanet._destroyed) {
            patrolCenter = { x: ship.homeStation.hostPlanet.x, y: ship.homeStation.hostPlanet.y };
            baseRadius = ship.homeStation.hostPlanet.r;
        } else if (!ship.homeStation.dead) {
            patrolCenter = { x: ship.homeStation.x, y: ship.homeStation.y };
            baseRadius = ship.homeStation.r;
        }
    }

    const distToCenter = dist(ship.x, ship.y, patrolCenter.x, patrolCenter.y);
    const orbitRadius = baseRadius > 0 ? (baseRadius * 1.8 + ship.r) : 300;

    if (distToCenter > orbitRadius + 100) {
        const angle = Math.atan2(patrolCenter.y - ship.y, patrolCenter.x - ship.x);
        ship.xv += Math.cos(angle) * 0.5;
        ship.yv += Math.sin(angle) * 0.5;
    } else if (distToCenter < orbitRadius - 100) {
        const angle = Math.atan2(ship.y - patrolCenter.y, ship.x - patrolCenter.x);
        ship.xv += Math.cos(angle) * 0.5;
        ship.yv += Math.sin(angle) * 0.5;
    } else {
        const orbitAngle = Math.atan2(ship.y - patrolCenter.y, ship.x - patrolCenter.x);
        if (!ship.orbitDir) ship.orbitDir = Math.random() > 0.5 ? 1 : -1;
        const tangentAngle = orbitAngle + (Math.PI / 2) * ship.orbitDir;
        ship.xv += Math.cos(tangentAngle) * 0.3;
        ship.yv += Math.sin(tangentAngle) * 0.3;
    }

    ship.a = rotateTowards(ship.a, Math.atan2(ship.yv, ship.xv), 0.1);
    ship.xv *= 0.95;
    ship.yv *= 0.95;
}

function updateCombatAI(ship) {
    let target = null;
    let maxThreatScore = -Infinity;
    let minDistToRival = Infinity;

    for (const other of State.ships) {
        if (other === ship) continue;
        if (other === State.playerShip && State.playerShip.dead) continue;

        const isRival = ship.fleetHue !== other.fleetHue ||
            ((other === State.playerShip || ship === State.playerShip) && State.playerShip.loneWolf);

        if (isRival && (other.type === 'ship' || other.type === 'station')) {
            const targetX = other === State.playerShip ? State.worldOffsetX : other.x;
            const targetY = other === State.playerShip ? State.worldOffsetY : other.y;
            const d = dist(ship.x, ship.y, targetX, targetY);

            if (d < 3000) {
                let threatScore = 3000 - d;
                if (other.type === 'station') threatScore -= 1000;
                if (other === State.playerShip && d < 1500) threatScore += 500;

                if (threatScore > maxThreatScore) {
                    maxThreatScore = threatScore;
                    target = other;
                    minDistToRival = d;
                }
            }
        }
    }

    if (!target) {
        ship.aiState = 'FORMATION';
        return;
    }

    const tx = target === State.playerShip ? State.worldOffsetX : target.x;
    const ty = target === State.playerShip ? State.worldOffsetY : target.y;
    const d = minDistToRival;

    let targetAngle = Math.atan2(ty - ship.y, tx - ship.x);
    if (ship.isFriendly && ship.role !== 'leader' && ship.leaderRef === State.playerShip) {
        targetAngle = State.playerShip.a;
    }

    const angleDiff = normalizeAngle(targetAngle - ship.a);
    ship.a = normalizeAngle(ship.a + angleDiff * 0.04);

    // 1. Radial Force
    const radialForce = (d - SHIP_CONFIG.COMBAT_ORBIT_DISTANCE) * 0.002;
    ship.xv += Math.cos(targetAngle) * radialForce;
    ship.yv += Math.sin(targetAngle) * radialForce;

    // 2. Tangential Force
    const orbitDir = (ship.squadId && ship.squadId > 0.5) ? 1 : -1;
    const orbAngle = targetAngle + (Math.PI / 2 * orbitDir);
    ship.xv += Math.cos(orbAngle) * 0.08;
    ship.yv += Math.sin(orbAngle) * 0.08;

    // 3. Separation Logic
    for (const other of State.ships) {
        if (other === ship || other.type !== 'ship' || other === State.playerShip) continue;
        const distToOther = dist(ship.x, ship.y, other.x, other.y);
        if (distToOther < SHIP_CONFIG.SEPARATION_DISTANCE) {
            const ang = Math.atan2(ship.y - other.y, ship.x - other.x);
            const force = (SHIP_CONFIG.SEPARATION_DISTANCE - distToOther) * 0.01;
            ship.xv += Math.cos(ang) * force;
            ship.yv += Math.sin(ang) * force;
        }
    }

    ship.xv *= 0.96;
    ship.yv *= 0.96;

    const maxSpeed = ship.tier >= SHIP_CONFIG.GODSHIP_TIER ? SHIP_CONFIG.MAX_SPEED * 2 : SHIP_CONFIG.MAX_SPEED;
    const currentSpeed = Math.hypot(ship.xv, ship.yv);
    if (currentSpeed > maxSpeed) {
        const scale = maxSpeed / currentSpeed;
        ship.xv *= scale;
        ship.yv *= scale;
    }

    if (ship.reloadTime <= 0 && Math.abs(angleDiff) < 0.4) {
        const bullets = ship.isFriendly ? State.playerShipBullets : State.enemyShipBullets;
        fireEntityWeapon(ship, bullets, !ship.isFriendly);
        ship.reloadTime = 30 + Math.random() * 50;
    }

    if (ship.reloadTime <= 0) {
        const combatThreats = spatialGrid.query(ship);
        for (const r of combatThreats) {
            if (r.z > 0.5 || r.isPlanet) continue;
            if (dist(ship.x, ship.y, r.x, r.y) < 1000) {
                const roidAngle = Math.atan2(r.y - ship.y, r.x - ship.x);
                if (Math.abs(normalizeAngle(roidAngle - ship.a)) < 0.5) {
                    const bullets = ship.isFriendly ? State.playerShipBullets : State.enemyShipBullets;
                    fireEntityWeapon(ship, bullets, !ship.isFriendly);
                    ship.reloadTime = 30 + Math.random() * 50;
                    break;
                }
            }
        }
    }
}

export function updateAllShipsAndStations(hitPlayerShip) {
    const shipsToDraw = [];

    for (let i = State.ships.length - 1; i >= 0; i--) {
        const ship = State.ships[i];

        if (!ship.vaporized && ship.structureHP > 0) {
            let factionPlanetDestroyed = false;
            if (ship.type === 'station' && ship.hostPlanetId) {
                if (!State.roids.some(r => r.id === ship.hostPlanetId && r.isPlanet)) factionPlanetDestroyed = true;
            } else if (ship.type === 'ship' && ship.homeStation && ship.homeStation.hostPlanetId) {
                if (!State.roids.some(r => r.id === ship.homeStation.hostPlanetId && r.isPlanet)) factionPlanetDestroyed = true;
            }
            if (ship.isFriendly && State.homePlanetId) {
                if (!State.roids.some(r => r.id === State.homePlanetId && r.isPlanet)) factionPlanetDestroyed = true;
            }

            if (factionPlanetDestroyed) {
                ship.vaporized = true;
                ship.structureHP = -1;
            }
        }

        if (ship.vaporized || ship.structureHP <= -1) {
            const vpX = (ship.x - State.worldOffsetX) + State.width / 2;
            const vpY = (ship.y - State.worldOffsetY) + State.height / 2;
            createExplosion(vpX, vpY, 60, '#00ffff', 5, 'spark');

            const killer = ship.vaporized ? State.playerShip : null;
            if (ship.type === 'station') onStationDestroyed(ship, killer);
            else onShipDestroyed(ship, killer);

            State.ships.splice(i, 1);
            AudioEngine.playExplosion('large', ship.x, ship.y, ship.z);
            continue;
        }

        if (ship === State.playerShip) {
            continue;
        }

        if (ship.blinkNum > 0) ship.blinkNum--;

        if (State.victoryState) {
            const time = Date.now() / 1000;
            const orbitR = 300 + Math.sin(time + i) * 100;
            const destX = State.worldOffsetX + Math.cos(time * 0.5 + i * 0.5) * orbitR;
            const destY = State.worldOffsetY + Math.sin(time * 0.5 + i * 0.5) * orbitR;

            ship.xv = (ship.xv + (destX - ship.x) * 0.05) * 0.95;
            ship.yv = (ship.yv + (destY - ship.y) * 0.05) * 0.95;
            ship.a += 0.1;
        }

        if (ship.type === 'station') {
            updateStationOrbit(ship);
        }

        ship.x += ship.xv;
        ship.y += ship.yv;

        const distFromCenter = Math.hypot(ship.x, ship.y);
        if (distFromCenter > WORLD_BOUNDS) {
            const angleToCenter = Math.atan2(ship.y, ship.x);
            ship.xv -= Math.cos(angleToCenter) * BOUNDARY_CONFIG.CORRECTION_FORCE * 2;
            ship.yv -= Math.sin(angleToCenter) * BOUNDARY_CONFIG.CORRECTION_FORCE * 2;
        }

        const depthScale = ship.z > 0 ? 1 / (1 + ship.z) : 1;
        const vpX = (ship.x - State.worldOffsetX) * depthScale + State.width / 2;
        const vpY = (ship.y - State.worldOffsetY) * depthScale + State.height / 2;

        // Asteroid collisions for ships/stations
        let shipDestroyedByAsteroid = false;
        const nearbyColliders = spatialGrid.query(ship);
        for (const r of nearbyColliders) {
            if (r.z > 0.5 || r.isPlanet) continue;
            if ((ship.type === 'station' && ship.hostPlanetId && r.id === ship.hostPlanetId) || ship.blinkNum > 0) {
                continue;
            }

            const dx = ship.x - r.x;
            const dy = ship.y - r.y;
            const d = Math.hypot(dx, dy);
            const minDist = ship.r + r.r;

            if (d < minDist && ship.z <= 0.5) {
                const angle = Math.atan2(dy, dx);
                const overlap = minDist - d;
                ship.x += Math.cos(angle) * overlap;
                ship.y += Math.sin(angle) * overlap;
                ship.xv += Math.cos(angle) * 2;
                ship.yv += Math.sin(angle) * 2;

                const tier = getShipTier(ship);
                if (tier < SHIP_CONFIG.GODSHIP_TIER) {
                    ship.structureHP--;
                    ship.shieldHitTimer = 10;
                }

                const rVpX = r.x - State.worldOffsetX + State.width / 2;
                const rVpY = r.y - State.worldOffsetY + State.height / 2;

                if (tier >= SHIP_CONFIG.GODSHIP_TIER) {
                    createExplosion(rVpX, rVpY, 15, '#0ff', 2, 'spark');
                    splitAsteroid(r, 0, 30);
                    r._destroyed = true;
                    const roidIdx = State.roids.indexOf(r);
                    if (roidIdx !== -1) State.roids.splice(roidIdx, 1);
                    increaseShipScore(ship, SCORE_REWARDS.ASTEROID_DESTROYED);
                } else {
                    createExplosion(rVpX, rVpY, 5, '#aa00ff', 1, 'debris');
                }

                if (ship.structureHP <= 0) {
                    createExplosion(vpX, vpY, 30, '#ffaa00', 3, 'spark');
                    ship.dead = true;
                    State.ships.splice(i, 1);
                    shipDestroyedByAsteroid = true;
                    break;
                }
            }
        }
        if (shipDestroyedByAsteroid) continue;

        if (ship.type === 'station') {
            updateStationBehavior(ship);
        } else {
            const distToPlayer = dist(ship.x, ship.y, State.worldOffsetX, State.worldOffsetY);
            const tier = getShipTier(ship);

            if (!ship.isFriendly && !State.activeNemesis && tier >= NEMESIS_CONFIG.MIN_TIER) {
                promoteToNemesis(ship);
            }

            if (tier >= SHIP_CONFIG.GODSHIP_TIER) {
                if (ship.leaderRef) {
                    if (ship.leaderRef.squadSlots) {
                        const slot = ship.leaderRef.squadSlots.find(s => s.occupant === ship);
                        if (slot) slot.occupant = null;
                    }
                    ship.leaderRef = null;
                    if (ship.role !== 'leader') ship.role = 'stray';
                }
                if (ship.squadSlots && ship.squadSlots.length > 0) {
                    ship.squadSlots.forEach(s => {
                        if (s.occupant) s.occupant.leaderRef = null;
                        s.occupant = null;
                    });
                    ship.squadSlots = null;
                    ship.role = 'stray';
                }
                ship.aiState = 'SAFE_ZONE_HUNTER';
            } else if (ship.isNemesis) {
                ship.aiState = (distToPlayer < SHIP_CONFIG.SIGHT_RANGE * 1.5 && !State.playerShip.dead) ? 'COMBAT' : 'SAFE_ZONE_HUNTER';
            } else if (!ship.isFriendly && distToPlayer < SHIP_CONFIG.SIGHT_RANGE && !State.playerShip.dead) {
                ship.aiState = 'COMBAT';
            } else if (distToPlayer > SHIP_CONFIG.SIGHT_RANGE * 1.5 && ship.aiState === 'COMBAT') {
                ship.aiState = 'FORMATION';
            }

            checkAttackWarnings(ship, tier);

            if (ship.aiState === 'SAFE_ZONE_HUNTER') {
                updateSafeZoneHunter(ship);
            } else if (ship.aiState === 'FORMATION') {
                const isRetreating = updateWingmanRetreat(ship);
                proactiveCombatScanner(ship);

                if (!isRetreating) {
                    if (ship.role === 'leader') {
                        updateSquadLeader(ship);
                    } else {
                        if (ship.leaderRef && (ship.leaderRef.dead || (!State.ships.includes(ship.leaderRef) && ship.leaderRef !== State.playerShip))) {
                            ship.leaderRef = null;
                            ship.squadId = null;
                        }

                        if (ship.leaderRef) {
                            updateFormationFollower(ship);
                        } else {
                            tryJoinOrOrbitSquad(ship);
                        }
                    }
                }
            } else if (ship.aiState === 'COMBAT') {
                updateCombatAI(ship);
            }

            applyEvasionForces(ship);
            ship.reloadTime--;
            if (State.solarStorm.activeTimer > 0 || ship.isNemesis) {
                ship.reloadTime--;
            }
        }

        // Player collision with enemy ship/station
        if (!State.playerShip.dead && (!ship.z || ship.z < 0.5)) {
            const distToPlayer = dist(ship.x, ship.y, State.worldOffsetX, State.worldOffsetY);
            const collisionThreshold = (State.playerShip.effectiveR || State.playerShip.r) + ship.r + 10;
            if (distToPlayer < collisionThreshold) {
                if (ship.isFriendly) {
                    shipsToDraw.push(ship);
                    continue;
                }

                if (ship.structureHP > 0) {
                    ship.structureHP--;
                    ship.shieldHitTimer = 10;
                    createExplosion(vpX, vpY, 20, '#ff0055', 2, 'spark');
                    if (State.playerShip.tier < SHIP_CONFIG.GODSHIP_TIER) {
                        hitPlayerShip(1);
                    }
                    AudioEngine.playSoftThud(ship.x, ship.y, ship.z);
                    const ang = Math.atan2(ship.y - State.worldOffsetY, ship.x - State.worldOffsetX);
                    ship.x += Math.cos(ang) * 60;
                    ship.y += Math.sin(ang) * 60;
                } else {
                    State.ships.splice(i, 1);
                    AudioEngine.playExplosion('large', ship.x, ship.y, ship.z);
                    continue;
                }

                if (ship.structureHP <= 0) {
                    destroyShipEntity(ship, i, State.playerShip);
                    continue;
                }
            }
        }

        shipsToDraw.push(ship);
    }

    return shipsToDraw;
}
