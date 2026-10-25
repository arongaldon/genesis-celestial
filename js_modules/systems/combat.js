import { ASTEROID_CONFIG, DOM, G_CONST, PLANET_CONFIG, PLAYER_CONFIG, SCORE_REWARDS, SHIP_CONFIG, WORLD_BOUNDS } from '../core/config.js';
import { State } from '../core/state.js';
import { AudioEngine } from '../audio/audio.js';
import { addScreenMessage, drawBullet } from '../graphics/render.js';
import { createExplosion, createPlanetExplosionFX, createShockwave } from '../graphics/fx.js';
import { splitAsteroid } from '../entities/entities.js';
import { getShipTier, hasActiveSquad, increaseShipScore, onShipDestroyed, onStationDestroyed } from './scoring.js';
import { spatialGrid } from './physics.js';
import { dist } from '../utils/utils.js';
import { t } from '../utils/i18n.js';

export function fireEntityWeapon(ship, bulletList, isEnemy = true) {
    const isPlayer = ship === State.playerShip;
    const tier = isPlayer ? ship.tier : getShipTier(ship);

    if (tier >= SHIP_CONFIG.GODSHIP_TIER) {
        if (ship.transformationTimer > 0) {
            if (isPlayer && State.playerReloadTime <= 0) {
                addScreenMessage("ENERGY UNSTABLE: TRANSFORMING...", "#ffaa00");
                State.playerReloadTime = 30;
            }
            return;
        }
        fireGodWeapon(ship);
        return;
    }

    const hue = ship.fleetHue !== undefined ? ship.fleetHue : ((isPlayer || ship.isFriendly) ? SHIP_CONFIG.FRIENDLY_BLUE_HUE : 0);
    const a = isPlayer ? State.playerShip.a : ship.a;

    const pushBullet = (angleOffset, isPrimary = true) => {
        const shootAngle = a + angleOffset;
        const speedScale = 1 + (tier * 0.1);
        const sizeScale = 1 + (tier * 0.18);
        const visualScale = 1 + (tier * 0.1);
        const spawnRadius = ((ship.effectiveR || ship.r) * visualScale) + 20;

        const fwdX = Math.cos(a);
        const fwdY = Math.sin(a);

        const startX = (isPlayer ? State.worldOffsetX : ship.x) + (fwdX * spawnRadius);
        const startY = (isPlayer ? State.worldOffsetY : ship.y) + (fwdY * spawnRadius);

        const bSpeed = (ship.bulletSpeed || 18) * speedScale;
        const bLife = ship.bulletLife || (isPrimary ? SHIP_CONFIG.BULLET1_LIFETIME : SHIP_CONFIG.BULLET2_LIFETIME);
        const bSize = (ship.bulletSize || 5) * sizeScale;

        const velX = (Math.cos(shootAngle) * bSpeed) + (isPlayer ? State.velocity.x : ship.xv);
        const velY = (Math.sin(shootAngle) * bSpeed) + (isPlayer ? State.velocity.y : ship.yv);

        bulletList.push({
            x: startX,
            y: startY,
            xv: velX,
            yv: velY,
            a: shootAngle,
            dist: 0,
            life: bLife,
            size: bSize,
            tier,
            hue,
            isFriendly: isPlayer || ship.isFriendly,
            owner: ship,
            ignoreGravity: tier >= 8
        });
    };

    // --- TIER PATTERNS (Clearly more powerful with each step) ---
    if (tier === 11) { // THE HYPERION
        pushBullet(0, true);
        for (let i = 1; i <= 10; i++) {
            pushBullet(i * 0.02, true);
            pushBullet(-i * 0.02, true);
        }
    } else if (tier === 10) { // THE TITAN
        pushBullet(0, true);
        for (let i = 1; i <= 6; i++) {
            pushBullet(i * 0.04, true);
            pushBullet(-i * 0.04, true);
        }
    } else if (tier === 9) { // THE CELESTIAL
        pushBullet(0, true);
        for (let i = 1; i <= 3; i++) {
            pushBullet(i * 0.08, true);
            pushBullet(-i * 0.08, true);
        }
    } else if (tier === 8) { // THE SPHERE
        pushBullet(0, true);
        pushBullet(0.12, true); pushBullet(-0.12, true);
        pushBullet(0.24, true); pushBullet(-0.24, true);
    } else if (tier === 7) { // DECAGON
        pushBullet(0, true);
        pushBullet(0.1, true); pushBullet(-0.1, true);
        pushBullet(0.2, false); pushBullet(-0.2, false);
        pushBullet(0.3, false); pushBullet(-0.3, false);
    } else if (tier === 6) { // NONAGON
        pushBullet(0, true);
        pushBullet(0.12, true); pushBullet(-0.12, true);
        pushBullet(0.24, false); pushBullet(-0.24, false);
    } else if (tier === 5) { // OCTAGON
        pushBullet(0, true);
        pushBullet(0.15, true); pushBullet(-0.15, true);
        pushBullet(0.3, false); pushBullet(-0.3, false);
    } else if (tier === 4) { // HEPTAGON
        pushBullet(0, true);
        pushBullet(0.2, false); pushBullet(-0.2, false);
    } else if (tier === 3) { // HEXAGON
        pushBullet(0, true);
        pushBullet(0.1, true); pushBullet(-0.1, true);
    } else if (tier === 2) { // PENTAGON
        pushBullet(0, true);
        pushBullet(0, true);
    } else { // TIER 0 & 1
        pushBullet(0, true);
    }

    if (isPlayer) AudioEngine.playLaser(State.worldOffsetX, State.worldOffsetY, tier);
    else AudioEngine.playLaser(ship.x, ship.y, tier);
}

export function fireGodWeapon(ship) {
    const isPlayer = ship === State.playerShip;

    if (isPlayer) {
        State.playerReloadTime = PLAYER_CONFIG.RELOAD_TIME_MAX * 5;
    } else {
        ship.reloadTime = 300;
    }

    const originX = isPlayer ? State.worldOffsetX : ship.x;
    const originY = isPlayer ? State.worldOffsetY : ship.y;

    AudioEngine.playLaser(originX, originY, 12);

    State.shockwaves.push({
        x: originX,
        y: originY,
        r: 100,
        maxR: Math.max(State.width, State.height) * 3,
        strength: 2000,
        alpha: 3.0,
        isGodRing: true,
        type: 'lightning',
        owner: ship
    });
}

export function updateAndDrawShockwaves(triggerHomePlanetLost) {
    const ctx = DOM.canvasContext;

    for (let index = State.shockwaves.length - 1; index >= 0; index--) {
        const sw = State.shockwaves[index];
        if (sw.isGodRing) {
            sw.r += 120;
            sw.alpha -= 0.003;
            if (sw.maxR && sw.r > sw.maxR) {
                State.shockwaves.splice(index, 1);
                continue;
            }
        } else {
            sw.r += 15;
            sw.alpha -= 0.01;
        }

        if (sw.alpha <= 0) {
            State.shockwaves.splice(index, 1);
            continue;
        }

        const vpX = sw.x - State.worldOffsetX + State.width / 2;
        const vpY = sw.y - State.worldOffsetY + State.height / 2;

        if (sw.isGodRing) {
            ctx.save();
            ctx.strokeStyle = `rgba(0, 255, 255, ${Math.min(1, sw.alpha)})`;
            ctx.lineWidth = 15;
            ctx.shadowBlur = 40;
            ctx.shadowColor = '#00FFFF';

            ctx.beginPath();
            ctx.arc(vpX, vpY, sw.r, 0, Math.PI * 2);
            ctx.stroke();

            ctx.lineWidth = 3;
            ctx.strokeStyle = `rgba(200, 255, 255, ${Math.min(1, sw.alpha)})`;
            for (let i = 0; i < 60; i++) {
                const ang = Math.random() * Math.PI * 2;
                const jitter = (Math.random() - 0.5) * 150;
                const lx1 = vpX + Math.cos(ang) * (sw.r - 30);
                const ly1 = vpY + Math.sin(ang) * (sw.r - 30);
                const lx2 = vpX + Math.cos(ang) * (sw.r + 100) + jitter;
                const ly2 = vpY + Math.sin(ang) * (sw.r + 100) + jitter;

                ctx.beginPath();
                ctx.moveTo(lx1, ly1);
                let curX = lx1, curY = ly1;
                for (let j = 0; j < 3; j++) {
                    curX += (lx2 - lx1) / 3 + (Math.random() - 0.5) * 80;
                    curY += (ly2 - ly1) / 3 + (Math.random() - 0.5) * 80;
                    ctx.lineTo(curX, curY);
                }
                ctx.stroke();

                if (Math.random() < 0.4) {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(lx2 + (Math.random() - 0.5) * 40, ly2 + (Math.random() - 0.5) * 40, 5, 5);
                }
            }
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(vpX, vpY, sw.r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 200, 50, ${sw.alpha})`;
            ctx.lineWidth = 5;
            ctx.stroke();
        }

        const applyShockwaveEffect = (obj) => {
            const dx = obj.x - sw.x;
            const dy = obj.y - sw.y;
            const d = Math.hypot(dx, dy);
            const bandWidth = sw.isGodRing ? 600 : 30;

            if (Math.abs(d - sw.r) < bandWidth) {
                if (sw.isGodRing) {
                    const dealer = sw.owner || State.playerShip;
                    if (obj === dealer) return;

                    if (obj.r !== undefined && !obj.type) {
                        if (obj.vaporized || obj.blinkNum > 0) return;
                        obj.r = 0;
                        obj.vaporized = true;

                        if (obj.isPlanet) {
                            addScreenMessage(t("game.planet_vaporized", { name: obj.name.toUpperCase() }), "#ff00ff");
                            createPlanetExplosionFX(obj.x, obj.y, obj.z || 0);
                            State.pendingDebris.push({ x: obj.x, y: obj.y, count: ASTEROID_CONFIG.PLANET_DEBRIS, isHot: true });
                            createShockwave(obj.x, obj.y);

                            increaseShipScore(dealer, SCORE_REWARDS.PLANET_DESTROYED);

                            if (obj.id === State.homePlanetId) {
                                triggerHomePlanetLost(dealer === State.playerShip ? 'player' : 'enemy');
                            }
                        } else {
                            increaseShipScore(dealer, SCORE_REWARDS.ASTEROID_DESTROYED);
                        }
                    } else if (obj.type === 'ship' || obj.type === 'station') {
                        obj.structureHP = -1;
                        obj.vaporized = true;
                    }
                } else {
                    const angle = Math.atan2(dy, dx);
                    const force = sw.strength * (1 - d / sw.maxR);
                    if (force > 0) {
                        obj.xv += Math.cos(angle) * force * 0.1;
                        obj.yv += Math.sin(angle) * force * 0.1;
                    }
                }
            }
        };

        State.roids.forEach(applyShockwaveEffect);
        State.ships.forEach(applyShockwaveEffect);

        if (!sw.isGodRing) {
            const dx = State.worldOffsetX - sw.x;
            const dy = State.worldOffsetY - sw.y;
            const d = Math.hypot(dx, dy);
            if (Math.abs(d - sw.r) < 30) {
                const angle = Math.atan2(dy, dx);
                const force = sw.strength * (1 - d / sw.maxR);
                if (force > 0) {
                    State.velocity.x += Math.cos(angle) * force * 0.05;
                    State.velocity.y += Math.sin(angle) * force * 0.05;
                }
            }
        }
    }
}

function applyBulletGravity(bullet, activePlanets) {
    if (bullet.ignoreGravity) return;
    for (const r of activePlanets) {
        if (r.z < 0.5) {
            const dx = r.x - bullet.x;
            const dy = r.y - bullet.y;
            const reach = r.r * 8;
            if (Math.abs(dx) < reach && Math.abs(dy) < reach) {
                const distSq = dx * dx + dy * dy;
                if (distSq < reach * reach && distSq > 100) {
                    const d = Math.sqrt(distSq);
                    const force = (G_CONST * r.mass) / distSq;
                    bullet.xv += (dx / d) * force * SHIP_CONFIG.BULLET_GRAVITY_FACTOR;
                    bullet.yv += (dy / d) * force * SHIP_CONFIG.BULLET_GRAVITY_FACTOR;
                }
            }
        }
    }
}

function handleBulletRoidCollision(bullet, vpX, vpY, isPlayerBullets, triggerHomePlanetLost) {
    const nearbyRoids = spatialGrid.query(bullet);
    for (let j = nearbyRoids.length - 1; j >= 0; j--) {
        const r = nearbyRoids[j];
        if (r.z > 0.5 || r._destroyed) continue;

        const dx = bullet.x - r.x;
        const dy = bullet.y - r.y;
        const reach = r.r + bullet.size;
        if (Math.abs(dx) >= reach || Math.abs(dy) >= reach || (dx * dx + dy * dy) >= reach * reach) continue;

        const rVpX = r.x - State.worldOffsetX + State.width / 2;
        const rVpY = r.y - State.worldOffsetY + State.height / 2;

        if (r.isPlanet) {
            if (isPlayerBullets && r.id === State.homePlanetId) {
                r.friendlyHits = (r.friendlyHits || 0) + 1;
                if (r.friendlyHits === 2 || r.friendlyHits % 10 === 0) {
                    addScreenMessage(t("game.warn_shoot_home"), "#ff8800");
                }
                createExplosion(vpX, vpY, 3, '#fff', 1);
                return true;
            }

            const shooter = bullet.owner;
            if (hasActiveSquad(shooter)) {
                if (r.hp === undefined) r.hp = PLANET_CONFIG.HP;
                if (r.hp > 0) {
                    r.hp--;
                    r.blinkNum = 10;
                    createExplosion(vpX, vpY, 20, '#ffaa00', 3, 'spark');

                    if (r.hp <= 0) {
                        r.r = 0;
                        r.vaporized = true;
                        r._destroyed = true;
                        const pIdx = State.roids.indexOf(r);
                        if (pIdx !== -1) State.roids.splice(pIdx, 1);

                        createPlanetExplosionFX(r.x, r.y, r.z || 0);

                        if (r.id === State.homePlanetId) {
                            triggerHomePlanetLost(isPlayerBullets ? 'player' : 'enemy');
                        } else {
                            if (isPlayerBullets) {
                                increaseShipScore(State.playerShip, SCORE_REWARDS.PLANET_DESTROYED);
                            } else if (shooter && State.ships.includes(shooter)) {
                                increaseShipScore(shooter, SCORE_REWARDS.PLANET_DESTROYED);
                            }
                            State.pendingDebris.push({ x: r.x, y: r.y, count: ASTEROID_CONFIG.PLANET_DEBRIS, isHot: true });
                            createShockwave(r.x, r.y);
                        }
                    }
                }
            } else {
                createExplosion(vpX, vpY, 3, '#fff', 1);
            }
            return true;
        }

        // Standard Asteroid Hit
        if (isPlayerBullets && r.blinkNum > 0) {
            return true;
        }

        if (isPlayerBullets) {
            createExplosion(rVpX, rVpY, 15, '#ff0055', 1, 'spark');
            createExplosion(rVpX, rVpY, 5, '#888', 2, 'debris');
            increaseShipScore(State.playerShip, SCORE_REWARDS.ASTEROID_DESTROYED);
        } else {
            createExplosion(rVpX, rVpY, 10, '#aa00ff', 1, 'debris');
            if (bullet.owner && State.ships.includes(bullet.owner)) {
                increaseShipScore(bullet.owner, SCORE_REWARDS.ASTEROID_DESTROYED);
            }
        }

        const bulletAngle = Math.atan2(bullet.yv, bullet.xv);
        splitAsteroid(r, bulletAngle + Math.PI / 2, 30);

        const roidIdx = State.roids.indexOf(r);
        if (roidIdx !== -1) State.roids.splice(roidIdx, 1);
        r._destroyed = true;
        AudioEngine.playExplosion('small', r.x, r.y, r.z);
        return true;
    }
    return false;
}

export function destroyShipEntity(entity, entityIndex, killer) {
    const eVpX = entity.x - State.worldOffsetX + State.width / 2;
    const eVpY = entity.y - State.worldOffsetY + State.height / 2;
    const debrisColor = entity.type === 'station' ? `hsl(${entity.fleetHue}, 100%, 50%)` : `hsl(${entity.fleetHue}, 100%, 40%)`;

    createExplosion(eVpX, eVpY, 40, '#ffaa00', 3, 'spark');
    createExplosion(eVpX, eVpY, 20, debrisColor, 4, 'debris');

    if (entity.type === 'station') {
        onStationDestroyed(entity, killer);
    } else {
        onShipDestroyed(entity, killer);
    }

    State.ships.splice(entityIndex, 1);
    AudioEngine.playExplosion('large', entity.x, entity.y, entity.z);
}

function updateBulletList(bullets, isPlayerBullets, activePlanets, hitPlayerShip, triggerHomePlanetLost) {
    const ctx = DOM.canvasContext;
    ctx.shadowColor = isPlayerBullets ? '#ff0055' : '#ff0000';
    ctx.fillStyle = isPlayerBullets ? '#ff0055' : '#ff0000';

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];

        applyBulletGravity(bullet, activePlanets);
        bullet.x += bullet.xv;
        bullet.y += bullet.yv;
        bullet.life--;

        if (bullet.life <= 0 || dist(State.worldOffsetX, State.worldOffsetY, bullet.x, bullet.y) > WORLD_BOUNDS * 1.5) {
            bullets.splice(i, 1);
            continue;
        }

        const vpX = bullet.x - State.worldOffsetX + State.width / 2;
        const vpY = bullet.y - State.worldOffsetY + State.height / 2;

        bullet.alpha = bullet.life < SHIP_CONFIG.BULLET_FADE_FRAMES
            ? bullet.life / SHIP_CONFIG.BULLET_FADE_FRAMES
            : 1.0;

        const pad = 50;
        if (vpX > -pad && vpX < State.width + pad && vpY > -pad && vpY < State.height + pad) {
            drawBullet(ctx, bullet, vpX, vpY);
        }
        ctx.globalAlpha = 1;

        if (!isPlayerBullets) {
            // 1. Enemy bullet hitting player
            if (!State.playerShip.dead && !bullet.isFriendly && dist(State.worldOffsetX, State.worldOffsetY, bullet.x, bullet.y) < (State.playerShip.effectiveR || State.playerShip.r) + 5) {
                hitPlayerShip(1);
                if (bullet.owner && State.ships.includes(bullet.owner)) {
                    increaseShipScore(bullet.owner, SCORE_REWARDS.SHIP_KILLED);
                }
                bullets.splice(i, 1);
                continue;
            }

            // 2. Enemy/AI bullet hitting rival ships
            let hitShip = false;
            for (let k = State.ships.length - 1; k >= 0; k--) {
                const e = State.ships[k];
                if (e === State.playerShip || e.z > 0.5) continue;

                const dx = bullet.x - e.x;
                const dy = bullet.y - e.y;
                const reach = e.r + bullet.size;
                if (Math.abs(dx) < reach && Math.abs(dy) < reach && (dx * dx + dy * dy) < reach * reach) {
                    if (bullet.isFriendly && e.isFriendly) continue;
                    if (!bullet.isFriendly && !e.isFriendly && bullet.hue === e.fleetHue) continue;

                    e.structureHP--;
                    e.shieldHitTimer = 10;
                    createExplosion(vpX, vpY, 5, '#ff0055', 1, 'spark');

                    if (e.structureHP <= 0) {
                        destroyShipEntity(e, k, bullet.owner);
                    }

                    bullets.splice(i, 1);
                    hitShip = true;
                    break;
                }
            }
            if (hitShip) continue;

            // 3. Enemy/AI bullet hitting asteroids or planets
            if (handleBulletRoidCollision(bullet, vpX, vpY, false, triggerHomePlanetLost)) {
                bullets.splice(i, 1);
            }
        } else {
            // 1. Player/Friendly bullet hitting asteroids or planets
            if (handleBulletRoidCollision(bullet, vpX, vpY, true, triggerHomePlanetLost)) {
                bullets.splice(i, 1);
                continue;
            }

            // 2. Player/Friendly bullet hitting ships or stations
            for (let j = State.ships.length - 1; j >= 0; j--) {
                const ship = State.ships[j];
                if (ship === State.playerShip) continue;

                const dx = bullet.x - ship.x;
                const dy = bullet.y - ship.y;
                const reach = ship.r + bullet.size;
                if (Math.abs(dx) > reach || Math.abs(dy) > reach || (dx * dx + dy * dy) >= reach * reach) continue;

                if (ship.isFriendly && !State.playerShip.loneWolf && !State.victoryState && !State.playerShip.dead) {
                    addScreenMessage(t("game.warn_cease_fire"), "#ffcc00");
                    ship.structureHP -= 1.0;
                    ship.shieldHitTimer = 5;
                    bullets.splice(i, 1);

                    if (ship.structureHP <= 0) {
                        destroyShipEntity(ship, j, State.playerShip);
                    }
                    break;
                }

                if (ship.blinkNum === 0) {
                    ship.structureHP--;
                    ship.shieldHitTimer = 5;
                    bullets.splice(i, 1);

                    if (ship.structureHP <= 0) {
                        destroyShipEntity(ship, j, bullet.owner);
                    }
                    break;
                } else {
                    bullets.splice(i, 1);
                    break;
                }
            }
        }
    }
}

export function updateAndDrawBullets(activePlanets, hitPlayerShip, triggerHomePlanetLost) {
    updateBulletList(State.enemyShipBullets, false, activePlanets, hitPlayerShip, triggerHomePlanetLost);
    updateBulletList(State.playerShipBullets, true, activePlanets, hitPlayerShip, triggerHomePlanetLost);
}
