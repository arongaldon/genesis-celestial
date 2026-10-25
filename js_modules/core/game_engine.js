import {
    ASTEROID_CONFIG, BOUNDARY_CONFIG, PLANET_CONFIG, PLAYER_CONFIG,
    SCORE_REWARDS, SHIP_CONFIG, STATION_CONFIG, FRICTION, G_CONST,
    MAX_Z_DEPTH, MIN_DURATION_TAP_TO_MOVE, SCALE_IN_MOUSE_MODE,
    SCALE_IN_TOUCH_MODE, WORLD_BOUNDS, ZOOM_LEVELS, DOM
} from './config.js';
import { State } from './state.js';
import { dist } from '../utils/utils.js';
import { AudioEngine } from '../audio/audio.js';
import { newPlayerShip, createAsteroid, createAsteroidBelt, spawnStation, splitAsteroid } from '../entities/entities.js';
import { initBackground } from '../graphics/background.js';
import { createExplosion } from '../graphics/fx.js';
import { increaseShipScore } from '../systems/scoring.js';
import {
    drawRadar, drawLives, updateHUD, showInfoLEDText, addScreenMessage,
    drawWorldBoundary, drawBackgroundAndFog, drawRoidOrPlanet,
    drawEntity, drawPlayerShip, updateAndDrawParticles,
    drawOffScreenIndicators, drawScreenMessages
} from '../graphics/render.js';
import { shootLaser } from './input.js';
import { updateAndDrawShockwaves, updateAndDrawBullets } from '../systems/combat.js';
import { resetAIWarningTimers, tickAIWarningTimers, updateAllShipsAndStations } from '../entities/ai.js';
import { t } from '../utils/i18n.js';
import { isTouching, touchStartTime } from './events.js';
import { updatePhysics } from '../systems/physics.js';

/* * AI DISCLAIMER: This code was developed with the assistance of a large language model. 
 * The author (Aron Galdon Gines) retains all copyrights.
 */

export function createLevel() {
    State.roids = [];
    State.enemyShipBullets = [];
    State.playerShipBullets = [];
    State.shockwaves = [];

    if (PLANET_CONFIG.LIMIT === 0) {
        State.homePlanetId = null;
    } else {
        const planetX = (Math.random() - 0.5) * PLANET_CONFIG.HOME_SPAWN_RANGE;
        const planetY = (Math.random() - 0.5) * PLANET_CONFIG.HOME_SPAWN_RANGE;
        const firstPlanet = createAsteroid(planetX, planetY, PLANET_CONFIG.SIZE, 0, t("game.home_planet_name"));
        firstPlanet.blinkNum = 120; // Safety window at start
        State.roids.push(firstPlanet);
        State.homePlanetId = firstPlanet.id;

        if (firstPlanet.textureData) {
            firstPlanet.textureData.waterColor = `hsl(${SHIP_CONFIG.FRIENDLY_BLUE_HUE}, 60%, 30%)`;
        }
    }

    createAsteroidBelt(0, 0, ASTEROID_CONFIG.INIT_INNER, WORLD_BOUNDS * 0.9, ASTEROID_CONFIG.COUNT);

    State.roids.filter(r => r.isPlanet).forEach(planet => {
        const stationCount = Math.floor(Math.random() * STATION_CONFIG.PER_PLANET) + 1;
        for (let i = 0; i < stationCount; i++) {
            spawnStation(planet);
        }
    });

    updateHUD();
}

export function hitPlayerShip(damageAmount = 1) {
    if (State.playerShip.blinkNum > 0 || State.playerShip.dead || State.victoryState) return;

    State.playerShip.structureHP -= damageAmount;
    createExplosion(State.width / 2, State.height / 2, 10, '#0ff', 2);

    if (State.playerShip.structureHP <= 0) {
        State.playerShip.structureHP = 0;
        killPlayerShip();
    } else {
        State.playerShip.blinkNum = 15;
        State.velocity.x *= -0.5;
        State.velocity.y *= -0.5;
    }
}

export function killPlayerShip(reason = 'normal') {
    createExplosion(State.width / 2, State.height / 2, 60, '#0ff', 3);
    AudioEngine.playExplosion('large', State.worldOffsetX, State.worldOffsetY);

    State.playerShip.dead = true;
    State.playerShip.leaderRef = null;
    State.playerShip.lives--;
    State.screenMessages = [];
    drawLives();
    State.playerShip.squadId = null;
    State.velocity = { x: 0, y: 0 };

    increaseShipScore(State.playerShip, PLAYER_CONFIG.DEATH_SCORE_PENALTY);

    if (State.playerShip.lives > 0) {
        setTimeout(() => {
            State.playerShip.dead = false;
            State.playerShip.structureHP = SHIP_CONFIG.RESISTANCE;
            drawLives();
        }, PLAYER_CONFIG.RESPAWN_DELAY_MS);
    } else {
        // Move planets to far background during Game Over
        State.roids.forEach(r => {
            if (r.isPlanet) r.z = MAX_Z_DEPTH;
        });

        if (DOM.uiLayer) DOM.uiLayer.style.display = 'none';

        setTimeout(() => {
            DOM.fadeOverlay.style.background = 'rgba(0, 0, 0, 0.4)';
            DOM.startScreen.classList.remove('fade-out');
            DOM.startScreen.classList.add('game-over');
            DOM.startScreen.style.display = 'flex';

            State.gameRunning = false;

            AudioEngine.playGameOverMusic();
            DOM.startScreen.addEventListener('click', window.audioStopper);

            const gameOverKey = {
                player: "game.gameover_player",
                enemy: "game.gameover_enemy",
                collision: "game.gameover_collision"
            }[reason] || "game.gameover_normal";
            showInfoLEDText(t(gameOverKey));

            setTimeout(() => {
                DOM.startBtn.style.display = 'block';
                DOM.startBtn.innerText = t("ui.restart");
                DOM.startScreen.classList.add('fade-out');
            }, 3000);
        }, PLAYER_CONFIG.GAMEOVER_DELAY_MS);
    }
}

export function triggerHomePlanetLost(reason) {
    State.homePlanetDestroyed = true;
    State.playerShip.lives = 0;
    killPlayerShip(reason);

    if (reason === 'player' || reason === 'enemy') {
        State.screenMessages = [];
    }
    const lostMsgKey = {
        player: "game.home_lost_player",
        enemy: "game.home_lost_enemy"
    }[reason] || "game.home_lost_collision";
    addScreenMessage(t(lostMsgKey), "#ff0000");
}

function handleTouchVictoryInteraction(e) {
    if (!State.victoryState) return;
    const duration = Date.now() - touchStartTime;
    if (duration < MIN_DURATION_TAP_TO_MOVE && e.changedTouches && e.changedTouches.length === 1) {
        handleVictoryInteraction();
    }
}

function handleVictoryInteraction() {
    if (!State.victoryState) return;

    showInfoLEDText(t("game.victory_msg"));
    addScreenMessage(t("game.mission_accomplished"), "#00ff00");

    DOM.startScreen.classList.remove('fade-out');
    DOM.startScreen.classList.add('victory');
    DOM.startScreen.style.display = 'flex';
    DOM.startScreen.addEventListener('click', window.audioStopper);
    DOM.startBtn.style.display = 'block';
    DOM.startBtn.innerText = t("ui.restart");

    window.removeEventListener('mousedown', handleVictoryInteraction);
    window.removeEventListener('touchend', handleTouchVictoryInteraction);
}

export function winGame() {
    if (State.victoryState) return;
    State.victoryState = true;

    AudioEngine.playVictoryMusic();

    State.ships.forEach(s => {
        if (!s.isFriendly) {
            s.isFriendly = true;
            s.aiState = 'FORMATION';
            s.leaderRef = State.playerShip;
            addScreenMessage(t("game.system_purified"), "#00ffff");
        }
    });

    State.roids.forEach(r => {
        if (r.isPlanet) r.z = MAX_Z_DEPTH;
    });

    setTimeout(() => {
        window.addEventListener('mousedown', handleVictoryInteraction);
        window.addEventListener('touchend', handleTouchVictoryInteraction);
    }, 1000);
}

function updatePlayerAndCamera() {
    if (!State.playerShip.dead && !State.homePlanetDestroyed) {
        let isRotating = false;
        if ((State.keys.ArrowLeft || State.keys.KeyA) && !State.keys.Shift) {
            State.playerShip.a -= PLAYER_CONFIG.ROTATION_SPEED;
            isRotating = true;
        }
        if ((State.keys.ArrowRight || State.keys.KeyD) && !State.keys.Shift) {
            State.playerShip.a += PLAYER_CONFIG.ROTATION_SPEED;
            isRotating = true;
        }

        if (State.inputMode === 'mouse' && !isRotating) {
            const dx = State.mouse.x - State.width / 2;
            const dy = State.mouse.y - State.height / 2;
            State.playerShip.a = Math.atan2(dy, dx);
        }

        if (State.inputMode === 'touch') {
            State.playerShip.thrusting = isTouching && (Date.now() - touchStartTime >= MIN_DURATION_TAP_TO_MOVE);
        } else {
            State.playerShip.thrusting = State.keys.ArrowUp;
        }

        let deltaX = 0;
        let deltaY = 0;
        const strafeThrust = SHIP_CONFIG.THRUST * PLAYER_CONFIG.STRAFE_MULTIPLIER;

        if (State.playerShip.thrusting) {
            deltaX += SHIP_CONFIG.THRUST * Math.cos(State.playerShip.a);
            deltaY += SHIP_CONFIG.THRUST * Math.sin(State.playerShip.a);
            if (Math.random() < 0.2) AudioEngine.playThrust(State.worldOffsetX, State.worldOffsetY);
        }

        if ((State.keys.KeyA || State.keys.ArrowLeft) && State.keys.Shift) {
            const strafeAngle = State.playerShip.a - Math.PI / 2;
            deltaX += strafeThrust * Math.cos(strafeAngle);
            deltaY += strafeThrust * Math.sin(strafeAngle);
            if (Math.random() < 0.2) AudioEngine.playThrust(State.worldOffsetX, State.worldOffsetY);
        }
        if ((State.keys.KeyD || State.keys.ArrowRight) && State.keys.Shift) {
            const strafeAngle = State.playerShip.a + Math.PI / 2;
            deltaX += strafeThrust * Math.cos(strafeAngle);
            deltaY += strafeThrust * Math.sin(strafeAngle);
            if (Math.random() < 0.2) AudioEngine.playThrust(State.worldOffsetX, State.worldOffsetY);
        }

        if (State.keys.ArrowDown && State.keys.Shift) {
            deltaX -= strafeThrust * Math.cos(State.playerShip.a);
            deltaY -= strafeThrust * Math.sin(State.playerShip.a);
            if (Math.random() < 0.2) AudioEngine.playThrust(State.worldOffsetX, State.worldOffsetY);
        }

        State.velocity.x += deltaX;
        State.velocity.y += deltaY;

        // Orbital Capture for Player when near a planet and not actively thrusting
        if (!State.playerShip.thrusting && !State.keys.ArrowDown && !State.keys.KeyA && !State.keys.KeyD && !State.victoryState) {
            let nearestPlanet = null;
            let minDistSq = Infinity;
            for (const r of State.roids) {
                if (r.isPlanet && Math.abs(r.z) < 0.5) {
                    const dSq = (r.x - State.worldOffsetX) ** 2 + (r.y - State.worldOffsetY) ** 2;
                    if (dSq < minDistSq) {
                        minDistSq = dSq;
                        nearestPlanet = r;
                    }
                }
            }

            if (nearestPlanet) {
                const d = Math.sqrt(minDistSq);
                const orbitRadius = nearestPlanet.r * 1.8 + State.playerShip.r;
                const gravityRange = nearestPlanet.r * 8.0;

                if (d < gravityRange) {
                    const dx = nearestPlanet.x - State.worldOffsetX;
                    const dy = nearestPlanet.y - State.worldOffsetY;
                    const tangentAngle = Math.atan2(dy, dx) + Math.PI / 2;

                    const theoreticalOrbitSpeed = Math.sqrt((G_CONST * nearestPlanet.mass * 8.0) / Math.max(d, 10));
                    const targetXV = Math.cos(tangentAngle) * theoreticalOrbitSpeed + (nearestPlanet.xv || 0);
                    const targetYV = Math.sin(tangentAngle) * theoreticalOrbitSpeed + (nearestPlanet.yv || 0);

                    State.velocity.x += (targetXV - State.velocity.x) * 0.05;
                    State.velocity.y += (targetYV - State.velocity.y) * 0.05;

                    const distError = d - orbitRadius;
                    const correction = Math.sign(distError) * Math.min(Math.abs(distError * 0.001), 0.15);
                    State.velocity.x += (dx / Math.max(d, 1)) * correction;
                    State.velocity.y += (dy / Math.max(d, 1)) * correction;
                }
            }
        }

        // Apply braking or standard friction
        const frictionFactor = (State.keys.ArrowDown && !State.keys.Shift) ? PLAYER_CONFIG.BRAKE_FRICTION : FRICTION;
        State.velocity.x *= frictionFactor;
        State.velocity.y *= frictionFactor;

        // Limit max speed
        const maxSpeed = State.playerShip.tier >= SHIP_CONFIG.GODSHIP_TIER ? SHIP_CONFIG.MAX_SPEED * 2 : SHIP_CONFIG.MAX_SPEED;
        const currentSpeed = Math.hypot(State.velocity.x, State.velocity.y);
        if (currentSpeed > maxSpeed) {
            const ratio = SHIP_CONFIG.MAX_SPEED / currentSpeed;
            State.velocity.x *= ratio;
            State.velocity.y *= ratio;
        }

        // Update Camera / World Offset (with soft magnetic boundary)
        const nextDist = Math.hypot(State.worldOffsetX + State.velocity.x, State.worldOffsetY + State.velocity.y);
        const magneticZone = WORLD_BOUNDS * BOUNDARY_CONFIG.MAGNETIC_ZONE_FACTOR;
        const hardCap = WORLD_BOUNDS * BOUNDARY_CONFIG.HARD_CAP_FACTOR;

        if (nextDist > magneticZone) {
            const distPastZone = Math.max(0, nextDist - magneticZone);
            const severity = Math.min(1.0, distPastZone / (WORLD_BOUNDS * 0.1));

            State.velocity.x *= (1 - severity * 0.1);
            State.velocity.y *= (1 - severity * 0.1);

            const angleToCenter = Math.atan2(-State.worldOffsetY, -State.worldOffsetX);
            const pushForce = severity * 2.0;

            State.velocity.x += Math.cos(angleToCenter) * pushForce;
            State.velocity.y += Math.sin(angleToCenter) * pushForce;

            if (nextDist > hardCap) {
                const limitAngle = Math.atan2(State.worldOffsetY, State.worldOffsetX);
                State.worldOffsetX = Math.cos(limitAngle) * hardCap;
                State.worldOffsetY = Math.sin(limitAngle) * hardCap;
                State.velocity.x = 0;
                State.velocity.y = 0;
            } else {
                State.worldOffsetX += State.velocity.x;
                State.worldOffsetY += State.velocity.y;
            }
        } else {
            State.worldOffsetX += State.velocity.x;
            State.worldOffsetY += State.velocity.y;
        }

        // Visual Boundary Alert (Directional)
        const currentDist = Math.hypot(State.worldOffsetX, State.worldOffsetY);
        const shadow = [];
        const RED_GLOW = 'rgba(255, 0, 0, 0.7)';
        const sSize = BOUNDARY_CONFIG.SHADOW_SIZE;

        if (currentDist >= WORLD_BOUNDS - BOUNDARY_CONFIG.TOLERANCE) {
            const angle = Math.atan2(State.worldOffsetY, State.worldOffsetX);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            if (cos > 0.5) shadow.push(`${-sSize}px 0 0 0 ${RED_GLOW} inset`);
            if (cos < -0.5) shadow.push(`${sSize}px 0 0 0 ${RED_GLOW} inset`);
            if (sin > 0.5) shadow.push(`0 ${-sSize}px 0 0 ${RED_GLOW} inset`);
            if (sin < -0.5) shadow.push(`0 ${sSize}px 0 0 ${RED_GLOW} inset`);
        }

        DOM.canvas.style.boxShadow = shadow.length > 0 ? shadow.join(', ') : 'none';
    } else {
        // Cinematic camera travel to Home Planet when dead or destroyed
        if (State.homePlanetId) {
            const home = State.roids.find(r => r.id === State.homePlanetId);
            const targetX = home ? home.x : State.lastHomeX;
            const targetY = home ? home.y : State.lastHomeY;

            if (targetX !== undefined && targetY !== undefined) {
                const travelSpeed = home ? 0.02 : 0.15;
                State.worldOffsetX += (targetX - State.worldOffsetX) * travelSpeed;
                State.worldOffsetY += (targetY - State.worldOffsetY) * travelSpeed;
            }
        }
        DOM.canvas.style.boxShadow = 'none';
    }
}

function updateAndDrawAsteroidsAndPlanets() {
    DOM.canvasContext.shadowColor = '#ffffff';
    DOM.canvasContext.shadowBlur = 0;
    DOM.canvasContext.lineWidth = 1;

    // Sort asteroids from Near to Far (Small Z to Large Z)
    State.roids.sort((a, b) => {
        const za = isFinite(a.z) ? a.z : 0;
        const zb = isFinite(b.z) ? b.z : 0;
        return za - zb;
    });

    for (let i = State.roids.length - 1; i >= 0; i--) {
        const r = State.roids[i];

        if (r.r <= 0 || r.vaporized) {
            const vpX = (r.x - State.worldOffsetX) + State.width / 2;
            const vpY = (r.y - State.worldOffsetY) + State.height / 2;
            createExplosion(vpX, vpY, r.isPlanet ? 200 : 40, '#00ffff', r.isPlanet ? 15 : 4, 'spark');
            if (r.isPlanet && State.gameRunning) {
                const planetsBefore = State.roids.filter(plan => plan.isPlanet && !plan._destroyed).length;
                console.log("Count: " + (planetsBefore - 1) + ". Planet " + r.name + " destroyed.");
            }
            State.roids.splice(i, 1);
            AudioEngine.playExplosion(r.isPlanet ? 'large' : 'small', r.x, r.y, r.z);
            continue;
        }

        r.x += r.xv;
        r.y += r.yv;

        const depthScale = r.isPlanet ? 1 / (1 + r.z) : 1;
        const depthAlpha = 1;
        const vpX = (r.x - State.worldOffsetX) * depthScale + State.width / 2;
        const vpY = (r.y - State.worldOffsetY) * depthScale + State.height / 2;

        drawRoidOrPlanet(r, depthScale, depthAlpha, vpX, vpY);

        // Player collision with asteroids
        if (r.z < 0.5 && !State.playerShip.dead && !r.isPlanet) {
            const distToPlayer = dist(r.x, r.y, State.worldOffsetX, State.worldOffsetY);
            if (distToPlayer < (State.playerShip.effectiveR || State.playerShip.r) + r.r * depthScale && r.blinkNum === 0) {
                if (State.playerShip.tier < SHIP_CONFIG.GODSHIP_TIER) {
                    hitPlayerShip(1);
                } else {
                    increaseShipScore(State.playerShip, SCORE_REWARDS.ASTEROID_DESTROYED);
                }
                AudioEngine.playSoftThud(r.x, r.y, r.z);

                createExplosion(vpX, vpY, 15, '#0ff', 2, 'spark');
                createExplosion(vpX, vpY, 8, '#fff', 1, 'debris');

                splitAsteroid(r, 0, 30);
                State.roids.splice(i, 1);
            }
        }
    }
}

export function loop() {
    requestAnimationFrame(loop);

    const ctx = DOM.canvasContext;
    ctx.resetTransform();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.filter = 'none';

    updateHUD();

    if (State.playerReloadTime > 0) State.playerReloadTime--;
    tickAIWarningTimers();

    if (State.keys.Space && State.gameRunning) shootLaser();

    // Handle Tier 12 transformation countdown
    if (State.playerShip && State.playerShip.transformationTimer > 0) {
        State.playerShip.transformationTimer--;

        if (State.playerShip.transformationTimer % 60 === 0 && State.playerShip.transformationTimer > 0) {
            const secondsLeft = Math.ceil(State.playerShip.transformationTimer / 60);
            addScreenMessage(t("game.metamorphosis", { seconds: secondsLeft }), "#00ffff");
        }

        if (State.playerShip.transformationTimer === 0) {
            addScreenMessage(t("game.godship_activated"), "#00ffff");
            AudioEngine.playExplosion('large', State.worldOffsetX, State.worldOffsetY);
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, State.width, State.height);
        }
    }

    if (!isFinite(State.velocity.x) || !isFinite(State.velocity.y)) {
        State.velocity = { x: 0, y: 0 };
    }
    if (!isFinite(State.worldOffsetX) || !isFinite(State.worldOffsetY)) {
        State.worldOffsetX = 0;
        State.worldOffsetY = 0;
    }

    if (State.stationSpawnTimer > 0) State.stationSpawnTimer--;
    if (State.stationSpawnTimer <= 0 && State.ships.length < 3) {
        spawnStation();
    }

    const activePlanets = State.roids.filter(r => r.isPlanet && !r._destroyed);

    if (State.homePlanetId) {
        const homeNode = State.roids.find(r => r.id === State.homePlanetId);
        if (homeNode) {
            State.lastHomeX = homeNode.x;
            State.lastHomeY = homeNode.y;
        }
    }

    // Tier 12 Godship Warning System
    if (!State.playerShip.dead && State.playerShip.tier >= SHIP_CONFIG.GODSHIP_TIER) {
        let warningNeeded = false;
        const lethalRange = Math.max(State.width, State.height) * 3;

        if (State.homePlanetId) {
            const home = State.roids.find(r => r.id === State.homePlanetId);
            if (home && dist(home.x, home.y, State.worldOffsetX, State.worldOffsetY) < lethalRange + home.r) {
                warningNeeded = true;
            }
        }

        if (!warningNeeded) {
            warningNeeded = State.ships.some(
                s => s.isFriendly && s !== State.playerShip && dist(s.x, s.y, State.worldOffsetX, State.worldOffsetY) < lethalRange + 100
            );
        }

        if (!State.victoryState && warningNeeded && Date.now() % 1000 < 500) {
            addScreenMessage(t("game.lethal_radius_warning"), "#ffaa00");
        }
    }

    ctx.save();
    ctx.fillStyle = '#010103';
    ctx.fillRect(0, 0, State.width, State.height);

    // Handle Tier 12 metamorphosis visuals
    if (State.playerShip && State.playerShip.transformationTimer > 0) {
        const progress = 1 - (State.playerShip.transformationTimer / SHIP_CONFIG.TRANSFORMATION_FRAMES);

        if (State.playerShip.transformationTimer < 300) {
            const shake = 15 * progress;
            ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        }

        if (State.playerShip.transformationTimer < 180 && Math.random() < 0.15) {
            const jitterX = (Math.random() - 0.5) * 800;
            const jitterY = (Math.random() - 0.5) * 800;
            createExplosion(State.width / 2 + jitterX, State.height / 2 + jitterY, 30, '#0ff', 5, 'spark');
        }

        if (State.playerShip.transformationTimer < 120) {
            const flashAlpha = (Math.sin(Date.now() / 50) + 1) * 0.1 * progress;
            ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
            ctx.fillRect(0, 0, State.width, State.height);
        }
    }

    // Viewport Zoom Calculation
    const isGameOverOrVictory = (State.playerShip.dead && State.playerShip.lives <= 0) || State.victoryState;
    let targetScale;

    if (isGameOverOrVictory) {
        targetScale = Math.max(0.08, Math.min(State.width, State.height) / (WORLD_BOUNDS * 0.75));
    } else if (State.inputMode === 'touch') {
        targetScale = State.playerShip.tier >= SHIP_CONFIG.GODSHIP_TIER ? SCALE_IN_TOUCH_MODE / 2 : SCALE_IN_TOUCH_MODE;
    } else {
        targetScale = State.playerShip.tier >= SHIP_CONFIG.GODSHIP_TIER ? SCALE_IN_MOUSE_MODE / 2 : SCALE_IN_MOUSE_MODE;
    }

    if (!isGameOverOrVictory && !State.playerShip.dead) {
        const maxSpd = State.playerShip.tier >= SHIP_CONFIG.GODSHIP_TIER ? SHIP_CONFIG.MAX_SPEED * 2 : SHIP_CONFIG.MAX_SPEED;
        const currentSpd = Math.hypot(State.velocity.x, State.velocity.y);
        const speedFactor = Math.min(1.0, currentSpd / Math.max(1, maxSpd));
        targetScale *= (1.0 - speedFactor * 0.5);
    }

    const zoomInterpolationFactor = isGameOverOrVictory ? 0.001 : 0.02;
    State.viewScale += (targetScale - State.viewScale) * zoomInterpolationFactor;

    if (State.viewScale !== 1.0) {
        ctx.translate(State.width / 2 * (1 - State.viewScale), State.height / 2 * (1 - State.viewScale));
        ctx.scale(State.viewScale, State.viewScale);
    }

    drawWorldBoundary();

    const hasAsteroids = State.roids.some(r => !r.isPlanet);
    if (State.gameRunning && !State.victoryState && !hasAsteroids) {
        winGame();
    }

    if (State.victoryState) {
        const flashColor = Date.now() % 400 < 200 ? '#fff' : '#0ff';
        if (DOM.asteroidCountDisplay) DOM.asteroidCountDisplay.style.color = flashColor;
        if (DOM.scoreDisplay) DOM.scoreDisplay.style.color = flashColor;
    }

    updatePlayerAndCamera();
    updateAndDrawShockwaves(triggerHomePlanetLost);
    drawBackgroundAndFog();
    updatePhysics();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const shipsToDraw = updateAllShipsAndStations(hitPlayerShip);
    updateAndDrawAsteroidsAndPlanets();
    shipsToDraw.forEach(drawEntity);
    drawPlayerShip();
    updateAndDrawBullets(activePlanets, hitPlayerShip, triggerHomePlanetLost);
    updateAndDrawParticles();

    drawRadar();

    ctx.restore();
    ctx.shadowBlur = 0;

    drawOffScreenIndicators();
    drawScreenMessages();

    // Victory Fireworks
    if (State.victoryState && !(State.playerShip.dead && State.playerShip.lives <= 0) && Math.random() < 0.05) {
        const fx = (Math.random() - 0.5) * State.width;
        const fy = (Math.random() - 0.5) * State.height;
        const hue = Math.floor(Math.random() * 360);
        createExplosion(State.width / 2 + fx, State.height / 2 + fy, 40, `hsl(${hue}, 100%, 50%)`, 3, 'spark');
    }
}

export function startGame() {
    AudioEngine.stopMusic();
    AudioEngine.setTrack('game');

    DOM.startBtn.style.display = 'none';
    if (DOM.uiLayer) DOM.uiLayer.style.display = 'flex';

    DOM.startScreen.style.display = 'none';
    DOM.startScreen.classList.remove('game-over', 'game-over-bg', 'victory', 'fade-out');
    DOM.startScreen.removeEventListener('click', window.audioStopper);

    resetAIWarningTimers();
    State.homePlanetId = null;
    State.homePlanetDestroyed = false;
    State.screenMessages = [];
    State.victoryState = false;
    State.viewScale = 1.0;

    DOM.fadeOverlay.style.background = 'rgba(0, 0, 0, 0)';

    State.velocity = { x: 0, y: 0 };
    State.worldOffsetX = 0;
    State.worldOffsetY = 0;
    State.stationSpawnTimer = STATION_CONFIG.SPAWN_TIMER;
    State.playerReloadTime = 0;

    State.particles = [];
    State.ambientFogs = [];
    State.playerShipBullets = [];
    State.enemyShipBullets = [];
    State.shockwaves = [];
    State.ships = [];

    State.playerShip = newPlayerShip();
    increaseShipScore(State.playerShip, 0);
    State.ships.push(State.playerShip);

    if (State.playerShip.lives <= 0) {
        killPlayerShip();
        return;
    }

    State.gameRunning = true;
    initBackground();
    createLevel();

    if (State.homePlanetId) {
        const home = State.roids.find(r => r.id === State.homePlanetId);
        if (home) {
            State.worldOffsetX = home.x;
            State.worldOffsetY = home.y;
        }
    }

    drawLives();
    updateHUD();

    State.currentZoomIndex = 2;
    State.RADAR_RANGE = ZOOM_LEVELS[State.currentZoomIndex];

    State.inputMode = window.matchMedia("(pointer: coarse)").matches ? 'touch' : 'mouse';

    if (!State.loopStarted) {
        State.loopStarted = true;
        loop();
    }
}
