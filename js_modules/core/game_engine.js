import { ASTEROID_CONFIG, BOUNDARY_CONFIG, GALAXY_CONFIG, GLOBAL_LIGHT, PLANET_CONFIG, PLAYER_CONFIG, SCORE_REWARDS, SHIP_CONFIG, STATION_CONFIG, FPS, FRICTION, G_CONST, MAX_Z_DEPTH, MIN_DURATION_TAP_TO_MOVE, SCALE_IN_MOUSE_MODE, SCALE_IN_TOUCH_MODE, WORLD_BOUNDS, ZOOM_LEVELS, suffixes, syllables, DOM } from './config.js';
import { State } from './state.js';
import { SpatialHash, mulberry32, getShapeName } from '../utils/utils.js';
import { AudioEngine } from '../audio/audio.js';
import { newPlayerShip, createAsteroid, initializePlanetAttributes, createAsteroidBelt, spawnStation, spawnShipsSquad, generatePlanetName } from '../entities/entities.js';
import { initBackground, createGalaxy, createAmbientFog } from '../graphics/background.js';
import { createExplosion, createShockwave, createExplosionDebris } from '../graphics/fx.js';
import { getShipTier, increaseShipScore, onShipDestroyed, onStationDestroyed } from '../systems/scoring.js';
import { drawPlanetTexture, drawRadar, drawHeart, drawLives, updateHUD, updateAsteroidCounter, showInfoLEDText, addScreenMessage, drawRings, drawShipShape, drawBullet } from '../graphics/render.js';
import { changeRadarZoom, shootLaser } from './input.js';
import { fireEntityWeapon, fireGodWeapon } from '../systems/combat.js';
import { enemyShoot, isTrajectoryClear, proactiveCombatScanner, applyEvasionForces } from '../entities/ai.js';
import { t } from '../utils/i18n.js';

import { setupInputEvents, isTouching, touchStartTime } from './events.js';
import { spatialGrid, updatePhysics, resolveInteraction } from '../systems/physics.js';

/* * AI DISCLAIMER: This code was developed with the assistance of a large language model. 
 * The author (Aron Galdon Gines) retains all copyrights.
 */

let originalPlanetLimit = null;
let homeAttackWarningTimer = 0;
let stationAttackWarningTimer = 0;



export function createLevel() {
    State.roids = []; State.enemyShipBullets = []; State.playerShipBullets = []; State.shockwaves = [];
    // State.ships = []; // REMOVED: Don't clear State.ships here, clear it in startGame instead

    if (PLANET_CONFIG.LIMIT === 0) {
        State.homePlanetId = null;
    }
    else {
        let planetX = (Math.random() - 0.5) * 5000;
        let planetY = (Math.random() - 0.5) * 5000;
        let firstPlanet = createAsteroid(planetX, planetY, PLANET_CONFIG.SIZE, 0, t("game.home_planet_name"));
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

    updateAsteroidCounter();
}

export function hitPlayerShip(damageAmount, sourceIsNearPlanet = false) {
    if (State.playerShip.blinkNum > 0 || State.playerShip.dead || State.victoryState) return;

    State.playerShip.structureHP--;

    const vpX = State.width / 2; const vpY = State.height / 2;
    createExplosion(vpX, vpY, 10, '#0ff', 2);

    if (State.playerShip.structureHP <= 0) {
        State.playerShip.structureHP = 0;
        killPlayerShip();
    }
    else {
        State.playerShip.blinkNum = 15;
        State.velocity.x *= -0.5; State.velocity.y *= -0.5;
    }
}

export function killPlayerShip(reason = 'normal') {
    const vpX = State.width / 2; const vpY = State.height / 2;
    createExplosion(vpX, vpY, 60, '#0ff', 3);
    AudioEngine.playExplosion('large', State.worldOffsetX, State.worldOffsetY);

    State.playerShip.dead = true;
    State.playerShip.leaderRef = null;
    State.playerShip.lives--;
    State.screenMessages = []; // Clear warning messages immediately
    drawLives(); // Ensure HUD reflects 0 immediately
    State.playerShip.squadId = null;

    State.velocity = { x: 0, y: 0 };

    increaseShipScore(State.playerShip, -1000);

    if (State.playerShip.lives > 0) setTimeout(() => {
        State.playerShip.dead = false;
        State.playerShip.structureHP = SHIP_CONFIG.RESISTANCE;

        drawLives();
    }, 3000);
    else {
        // MOVE PLANETS TO Z (Far background)
        State.roids.forEach(r => {
            if (r.isPlanet) {
                r.z = MAX_Z_DEPTH;
            }
        });

        // HIDE HUD DURING GAME OVER
        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer) uiLayer.style.display = 'none';

        setTimeout(() => {
            DOM.fadeOverlay.style.background = 'rgba(0, 0, 0, 0.4)'; // Trigger semi-transparent fade
            DOM.startScreen.classList.remove('fade-out'); // Reset before fade
            DOM.startScreen.classList.add('game-over');
            DOM.startScreen.style.display = 'flex';

            State.gameRunning = false;

            // Audio: Game Over Sequence
            AudioEngine.playGameOverMusic();
            DOM.startScreen.addEventListener('click', window.audioStopper);

            // Philosophical Game Over Messages
            if (reason === 'player') {
                showInfoLEDText(t("game.gameover_player"));
            } else if (reason === 'enemy') {
                showInfoLEDText(t("game.gameover_enemy"));
            } else if (reason === 'collision') {
                showInfoLEDText(t("game.gameover_collision"));
            } else {
                showInfoLEDText(t("game.gameover_normal"));
            }

            // Bring up the button and initiate the slow fade of the BG image
            setTimeout(() => {
                DOM.startBtn.style.display = 'block';
                DOM.startBtn.innerText = t("ui.restart");
                DOM.startScreen.classList.add('fade-out');
            }, 3000);
        }, 5000);
    }
}

export function triggerHomePlanetLost(reason) {
    State.playerShip.lives = 0; // Force game over
    killPlayerShip(reason);

    if (reason === 'player') {
        State.screenMessages = [];
        addScreenMessage(t("game.home_lost_player"), "#ff0000");
    } else if (reason === 'enemy') {
        State.screenMessages = [];
        addScreenMessage(t("game.home_lost_enemy"), "#ff0000");
    } else {
        addScreenMessage(t("game.home_lost_collision"), "#ff0000");
    }
}

function handleTouchVictoryInteraction(e) {
    if (!State.victoryState) return;
    const duration = Date.now() - touchStartTime;
    // Only trigger Congratulations if it was a short tap
    if (duration < MIN_DURATION_TAP_TO_MOVE && e.changedTouches && e.changedTouches.length === 1) {
        handleVictoryInteraction();
    }
}

function handleVictoryInteraction() {
    if (!State.victoryState) return;

    // Show Congratulations
    showInfoLEDText(t("game.victory_msg"));
    addScreenMessage(t("game.mission_accomplished"), "#00ff00");

    DOM.startScreen.classList.remove('fade-out');
    DOM.startScreen.classList.add('victory');
    DOM.startScreen.style.display = 'flex';
    DOM.startScreen.addEventListener('click', window.audioStopper); // Allow stopping music
    DOM.startBtn.style.display = 'block';
    DOM.startBtn.innerText = t("ui.restart");
    DOM.startBtn.onclick = () => {
        State.victoryState = false;
        DOM.startScreen.removeEventListener('click', window.audioStopper);
        startGame();
    };

    window.removeEventListener('mousedown', handleVictoryInteraction);
    window.removeEventListener('touchend', handleTouchVictoryInteraction);
};

export function winGame() {
    if (State.victoryState) return;
    State.victoryState = true;

    // Play Victory Music
    AudioEngine.playVictoryMusic();

    // ALL ENEMIES BECOME FRIENDS
    State.ships.forEach(s => {
        if (!s.isFriendly) {
            s.isFriendly = true;
            s.aiState = 'FORMATION';
            s.leaderRef = State.playerShip;
            addScreenMessage(t("game.system_purified"), "#00ffff");
        }
    });

    // MOVE PLANETS TO Z (Far background) to avoid further collisions
    State.roids.forEach(r => {
        if (r.isPlanet) {
            r.z = MAX_Z_DEPTH;
        }
    });

    // No text or buttons until click/tap
    // Wait a short bit to avoid capturing the click that destroyed the last asteroid
    setTimeout(() => {
        window.addEventListener('mousedown', handleVictoryInteraction);
        window.addEventListener('touchend', handleTouchVictoryInteraction);
    }, 1000);
}

export function loop() {
    requestAnimationFrame(loop);

    // Reset global transformation and context state to prevent accumulation of effects
    DOM.canvasContext.resetTransform();
    DOM.canvasContext.shadowBlur = 0;
    DOM.canvasContext.globalAlpha = 1;
    DOM.canvasContext.filter = 'none';

    // Sync HUD with game state
    updateHUD();

    // Removed 'if (!State.gameRunning) return' to keep the background world visible even when not playing.

    // killPlayerShip is handled in hitShip and collision logic.
    // Calling it here every frame causes a recursion bug during Game Over.

    // Decrement player reload timer
    // Decrement player reload timer (Used for UI/Legacy, but shootLaser uses time now)
    if (State.playerReloadTime > 0) State.playerReloadTime--;
    if (homeAttackWarningTimer > 0) homeAttackWarningTimer--;
    if (stationAttackWarningTimer > 0) stationAttackWarningTimer--;

    // Handle Tier 12 transformation
    if (State.playerShip && State.playerShip.transformationTimer > 0) {
        State.playerShip.transformationTimer--;



        if (State.playerShip.transformationTimer % 60 === 0 && State.playerShip.transformationTimer > 0) {
            const secondsLeft = Math.ceil(State.playerShip.transformationTimer / 60);
            addScreenMessage(t("game.metamorphosis", { seconds: secondsLeft }), "#00ffff");
        }

        // COMPLETION
        if (State.playerShip.transformationTimer === 0) {
            addScreenMessage(t("game.godship_activated"), "#00ffff");
            AudioEngine.playExplosion('large', State.worldOffsetX, State.worldOffsetY);
            // Flash effect
            DOM.canvasContext.fillStyle = "white";
            DOM.canvasContext.fillRect(0, 0, State.width, State.height);
        }
    }

    // Safety check against NaN/Infinity in State.velocity/world calculation
    if (isNaN(State.velocity.x) || isNaN(State.velocity.y) || !isFinite(State.velocity.x) || !isFinite(State.velocity.y)) {
        State.velocity = { x: 0, y: 0 };
    }
    if (isNaN(State.worldOffsetX) || isNaN(State.worldOffsetY) || !isFinite(State.worldOffsetX) || !isFinite(State.worldOffsetY)) {
        State.worldOffsetX = 0; State.worldOffsetY = 0;
    }

    if (State.stationSpawnTimer > 0) State.stationSpawnTimer--;
    if (State.stationSpawnTimer <= 0 && State.ships.length < 3) {
        spawnStation();
    }

    const isSafe = (obj) => !isNaN(obj.x) && !isNaN(obj.y) && isFinite(obj.x) && isFinite(obj.y);
    State.roids = State.roids.filter(isSafe);
    State.ships = State.ships.filter(isSafe);
    State.playerShipBullets = State.playerShipBullets.filter(isSafe);
    State.enemyShipBullets = State.enemyShipBullets.filter(isSafe);

    const activePlanets = State.roids.filter(r => r.isPlanet && !r._destroyed);

    // Track last known home planet position for cinematic camera
    if (State.homePlanetId) {
        const homeNode = State.roids.find(r => r.id === State.homePlanetId);
        if (homeNode) {
            State.lastHomeX = homeNode.x;
            State.lastHomeY = homeNode.y;
        }
    }

    // --- Tier 12 Godship Warning System ---
    if (!State.playerShip.dead && State.playerShip.tier >= 12) {
        let warningNeeded = false;
        const lethalRange = Math.max(State.width, State.height) * 3; // Synced with the shockwave's maxR

        // Check Home Planet
        if (State.homePlanetId) {
            const home = State.roids.find(r => r.id === State.homePlanetId);
            if (home) {
                const d = Math.sqrt((home.x - State.worldOffsetX) * (home.x - State.worldOffsetX) + (home.y - State.worldOffsetY) * (home.y - State.worldOffsetY));
                if (d < lethalRange + home.r) warningNeeded = true;
            }
        }

        // Check Allies
        if (!warningNeeded) {
            for (let s of State.ships) {
                if (s.isFriendly && s !== State.playerShip) {
                    const d = Math.sqrt((s.x - State.worldOffsetX) * (s.x - State.worldOffsetX) + (s.y - State.worldOffsetY) * (s.y - State.worldOffsetY));
                    if (d < lethalRange + 100) {
                        warningNeeded = true;
                        break;
                    }
                }
            }
        }

        if (!State.victoryState && !State.playerShip.dead) {
            if (warningNeeded && Date.now() % 1000 < 500) {
                addScreenMessage(t("game.lethal_radius_warning"), "#ffaa00");
            }
        }
    }

    // Clear DOM.canvas
    DOM.canvasContext.save(); // PUSH 0: Global Frame State
    DOM.canvasContext.fillStyle = '#010103'; DOM.canvasContext.fillRect(0, 0, State.width, State.height);

    // Handle Tier 12 metamorphosis EPIC VISUALS
    if (State.playerShip && State.playerShip.transformationTimer > 0) {
        const progress = 1 - (State.playerShip.transformationTimer / 600);

        // Intensity increases as timer goes down
        if (State.playerShip.transformationTimer < 300) {
            // Screen shake intensifies
            const shake = 15 * progress;
            DOM.canvasContext.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        }

        // Background strobe / flashes
        if (State.playerShip.transformationTimer < 180 && Math.random() < 0.15) {
            const jitterX = (Math.random() - 0.5) * 800;
            const jitterY = (Math.random() - 0.5) * 800;
            createExplosion(State.width / 2 + jitterX, State.height / 2 + jitterY, 30, '#0ff', 5, 'spark');
        }

        // Pulsing white overlay
        if (State.playerShip.transformationTimer < 120) {
            const flashAlpha = (Math.sin(Date.now() / 50) + 1) * 0.1 * progress;
            DOM.canvasContext.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
            DOM.canvasContext.fillRect(0, 0, State.width, State.height);
        }
    }

    // --- Viewport Zoom Calculation ---
    // Priority: Victory/GameOver > Input Mode (Touch/Mouse) > Tier 12 Godship modifier
    const isGameOverOrVictory = (State.playerShip.dead && State.playerShip.lives <= 0) || State.victoryState;
    let targetScale;

    if (isGameOverOrVictory) {
        // Grand cinematic zoom-out to show the universe
        targetScale = Math.max(0.08, Math.min(State.width, State.height) / (WORLD_BOUNDS * 0.75));
    } else if (State.inputMode === 'touch') {
        targetScale = (State.playerShip.tier >= 12 ? SCALE_IN_TOUCH_MODE / 2 : SCALE_IN_TOUCH_MODE);
    } else {
        targetScale = (State.playerShip.tier >= 12 ? SCALE_IN_MOUSE_MODE / 2 : SCALE_IN_MOUSE_MODE);
    }

    // --- Speed-Based Dynamic Zoom ---
    // Gradually zoom out as the ship gains speed, and zoom back in when decelerating.
    if (!isGameOverOrVictory && !State.playerShip.dead) {
        const maxSpd = (State.playerShip.tier >= 12 ? SHIP_CONFIG.MAX_SPEED * 2 : SHIP_CONFIG.MAX_SPEED);
        const currentSpd = Math.sqrt(State.velocity.x ** 2 + State.velocity.y ** 2);
        const speedFactor = Math.min(1.0, currentSpd / Math.max(1, maxSpd));
        // Up to 50% zoom out at maximum speed for a sense of momentum
        targetScale *= (1.0 - speedFactor * 0.5);
    }

    // Use a slow, smooth factor for cinematic reveals, and a more responsive one for gameplay scaling
    const zoomInterpolationFactor = isGameOverOrVictory ? 0.001 : 0.02;
    State.viewScale += (targetScale - State.viewScale) * zoomInterpolationFactor;

    if (State.viewScale !== 1.0) {
        // Scale and translate to keep (State.width/2, State.height/2) at the center
        DOM.canvasContext.translate(State.width / 2 * (1 - State.viewScale), State.height / 2 * (1 - State.viewScale));
        DOM.canvasContext.scale(State.viewScale, State.viewScale);
    }

    // DRAW CIRCULAR WORLD BOUNDARY (In World Space)
    DOM.canvasContext.save();
    const boundVpX = -State.worldOffsetX + State.width / 2;
    const boundVpY = -State.worldOffsetY + State.height / 2;
    DOM.canvasContext.beginPath();
    DOM.canvasContext.arc(boundVpX, boundVpY, WORLD_BOUNDS, 0, Math.PI * 2);
    DOM.canvasContext.strokeStyle = 'rgba(0, 255, 255, 0.05)';
    DOM.canvasContext.lineWidth = 100;
    DOM.canvasContext.stroke();

    // Neon edge
    DOM.canvasContext.strokeStyle = 'rgba(0, 255, 255, 0.15)';
    DOM.canvasContext.lineWidth = 20;
    DOM.canvasContext.stroke();
    DOM.canvasContext.restore();

    // Win condition check: make this very robust. Directly check the State.roids array.
    const activeAsteroids = State.roids.filter(r => !r.isPlanet).length;
    if (State.gameRunning && !State.victoryState && activeAsteroids === 0) {
        winGame();
    }

    // HUD Victory Effects (Flashing)
    if (State.victoryState && Date.now() % 400 < 200) {
        if (DOM.asteroidCountDisplay) DOM.asteroidCountDisplay.style.color = '#fff';
        if (DOM.scoreDisplay) DOM.scoreDisplay.style.color = '#fff';
    } else if (State.victoryState) {
        if (DOM.asteroidCountDisplay) DOM.asteroidCountDisplay.style.color = '#0ff';
        if (DOM.scoreDisplay) DOM.scoreDisplay.style.color = '#0ff';
    }

    if (!State.playerShip.dead) {
        if (State.inputMode === 'mouse') { // Mouse/Pointer control: rotate towards cursor
            const dx = State.mouse.x - State.width / 2; const dy = State.mouse.y - State.height / 2;
            State.playerShip.a = Math.atan2(dy, dx);
        }
        else {
            // Keyboard/Touch swipe control: Arrow State.keys handle rotation
            if (State.keys.ArrowLeft) State.playerShip.a -= 0.1; if (State.keys.ArrowRight) State.playerShip.a += 0.1;
        }
        if (State.inputMode === 'touch') {
            State.playerShip.thrusting = isTouching && (Date.now() - touchStartTime >= MIN_DURATION_TAP_TO_MOVE);
        } else {
            State.playerShip.thrusting = State.keys.ArrowUp;
        }

        let deltaX = 0;
        let deltaY = 0;
        const strafeMultiplier = 0.7; // 70% power for strafing

        if (State.playerShip.thrusting) {
            deltaX += SHIP_CONFIG.THRUST * Math.cos(State.playerShip.a);
            deltaY += SHIP_CONFIG.THRUST * Math.sin(State.playerShip.a);
            if (Math.random() < 0.2) AudioEngine.playThrust(State.worldOffsetX, State.worldOffsetY);
        }

        if (State.keys.KeyA) { // Strafe Left
            const strafeAngle = State.playerShip.a - Math.PI / 2;
            deltaX += SHIP_CONFIG.THRUST * strafeMultiplier * Math.cos(strafeAngle);
            deltaY += SHIP_CONFIG.THRUST * strafeMultiplier * Math.sin(strafeAngle);
            if (Math.random() < 0.2) AudioEngine.playThrust(State.worldOffsetX, State.worldOffsetY);
        }
        if (State.keys.KeyD) { // Strafe Right
            const strafeAngle = State.playerShip.a + Math.PI / 2;
            deltaX += SHIP_CONFIG.THRUST * strafeMultiplier * Math.cos(strafeAngle);
            deltaY += SHIP_CONFIG.THRUST * strafeMultiplier * Math.sin(strafeAngle);
            if (Math.random() < 0.2) AudioEngine.playThrust(State.worldOffsetX, State.worldOffsetY);
        }

        State.velocity.x += deltaX;
        State.velocity.y += deltaY;

        // --- NEW: Orbital Capture for Player ---
        // If the player is near a planet and not actively thrusting, they are captured into orbit
        if (!State.playerShip.thrusting && !State.keys.ArrowDown && !State.keys.KeyA && !State.keys.KeyD && !State.playerShip.dead && !State.victoryState) {
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
                const dist = Math.sqrt(minDistSq);
                const orbitRadius = nearestPlanet.r * 1.8 + State.playerShip.r;
                const gravityRange = nearestPlanet.r * 8.0;

                if (dist < gravityRange) {
                    const dx = nearestPlanet.x - State.worldOffsetX;
                    const dy = nearestPlanet.y - State.worldOffsetY;
                    const angleToPlanet = Math.atan2(dy, dx);
                    const tangentAngle = angleToPlanet + Math.PI / 2;

                    // Desired orbital speed + planet's own movement
                    const theoreticalOrbitSpeed = Math.sqrt((G_CONST * nearestPlanet.mass * 8.0) / Math.max(dist, 10));
                    const targetXV = Math.cos(tangentAngle) * theoreticalOrbitSpeed + (nearestPlanet.xv || 0);
                    const targetYV = Math.sin(tangentAngle) * theoreticalOrbitSpeed + (nearestPlanet.yv || 0);

                    // Blend State.velocity towards orbital target
                    State.velocity.x += (targetXV - State.velocity.x) * 0.05;
                    State.velocity.y += (targetYV - State.velocity.y) * 0.05;

                    // Distance correction: maintain orbit State.height
                    const distError = dist - orbitRadius;
                    const maxCorrection = 0.15; // Limit max acceleration towards orbit
                    const correction = Math.sign(distError) * Math.min(Math.abs(distError * 0.001), maxCorrection);
                    State.velocity.x += (dx / Math.max(dist, 1)) * correction;
                    State.velocity.y += (dy / Math.max(dist, 1)) * correction;
                }
            }
        }

        // Apply braking/friction
        if (State.keys.ArrowDown) { State.velocity.x *= 0.92; State.velocity.y *= 0.92; }
        else { State.velocity.x *= FRICTION; State.velocity.y *= FRICTION; }

        // Limit max speed
        const currentSpeed = Math.sqrt(State.velocity.x ** 2 + State.velocity.y ** 2);
        if (currentSpeed > (State.playerShip.tier >= 12 ? SHIP_CONFIG.MAX_SPEED * 2 : SHIP_CONFIG.MAX_SPEED)) { const ratio = SHIP_CONFIG.MAX_SPEED / currentSpeed; State.velocity.x *= ratio; State.velocity.y *= ratio; }

        // 3. Update Player's World Position (State.worldOffsetX/Y)
        let nextWorldX = State.worldOffsetX + State.velocity.x;
        let nextWorldY = State.worldOffsetY + State.velocity.y;

        // 3. Update Player's World Position (State.worldOffsetX/Y)
        let shadow = [];
        const SHADOW_SIZE = 50; // Size of the inset shadow border

        // 3. Update Camera / World Offset (with soft magnetic boundary)
        let nextDist = Math.sqrt((State.worldOffsetX + State.velocity.x) * (State.worldOffsetX + State.velocity.x) + (State.worldOffsetY + State.velocity.y) * (State.worldOffsetY + State.velocity.y));
        const magneticZone = WORLD_BOUNDS * 0.95; // Start pushing back at 95% of bounds

        if (nextDist > magneticZone) {
            // Calculate repulsion force
            const distPastZone = Math.max(0, nextDist - magneticZone);
            const severity = Math.min(1.0, distPastZone / (WORLD_BOUNDS * 0.1)); // 0 to 1 based on how far past

            // Soft dampening
            State.velocity.x *= (1 - severity * 0.1);
            State.velocity.y *= (1 - severity * 0.1);

            // Push towards center
            const angleToCenter = Math.atan2(-State.worldOffsetY, -State.worldOffsetX);
            const pushForce = severity * 2.0; // Max 2.0 force per frame

            State.velocity.x += Math.cos(angleToCenter) * pushForce;
            State.velocity.y += Math.sin(angleToCenter) * pushForce;

            // Hard cap at absolute max (e.g., 105% of bounds)
            if (nextDist > WORLD_BOUNDS * 1.05) {
                const limitAngle = Math.atan2(State.worldOffsetY, State.worldOffsetX);
                State.worldOffsetX = Math.cos(limitAngle) * WORLD_BOUNDS * 1.05;
                State.worldOffsetY = Math.sin(limitAngle) * WORLD_BOUNDS * 1.05;
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

        // 4. Visual Boundary Alert (Directional)
        const currentDist = Math.sqrt((State.worldOffsetX) * (State.worldOffsetX) + (State.worldOffsetY) * (State.worldOffsetY));
        const RED_GLOW = 'rgba(255, 0, 0, 0.7)';
        if (currentDist >= WORLD_BOUNDS - BOUNDARY_CONFIG.TOLERANCE) {
            const angle = Math.atan2(State.worldOffsetY, State.worldOffsetX);
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            if (cos > 0.5) shadow.push(`${-SHADOW_SIZE}px 0 0 0 ${RED_GLOW} inset`);
            if (cos < -0.5) shadow.push(`${SHADOW_SIZE}px 0 0 0 ${RED_GLOW} inset`);
            if (sin > 0.5) shadow.push(`0 ${-SHADOW_SIZE}px 0 0 ${RED_GLOW} inset`);
            if (sin < -0.5) shadow.push(`0 ${SHADOW_SIZE}px 0 0 ${RED_GLOW} inset`);
        }

        if (shadow.length > 0) {
            DOM.canvas.style.boxShadow = shadow.join(', ');
        } else {
            DOM.canvas.style.boxShadow = 'none';
        }
    } else {
        // --- CINEMATIC CAMERA TRAVEL ---
        // Smoothly move the camera to the Home Planet when dead, or fast if destroyed
        if (State.homePlanetId) {
            const home = State.roids.find(r => r.id === State.homePlanetId);
            const targetX = home ? home.x : State.lastHomeX;
            const targetY = home ? home.y : State.lastHomeY;

            if (targetX !== undefined && targetY !== undefined) {
                const travelSpeed = home ? 0.02 : 0.15; // Fast travel if destroyed
                State.worldOffsetX += (targetX - State.worldOffsetX) * travelSpeed;
                State.worldOffsetY += (targetY - State.worldOffsetY) * travelSpeed;
            }
        }
        // Clear boundary shadow when dead
        DOM.canvas.style.boxShadow = 'none';
    }

    // --- Shockwave Update (All in World Coords) ---
    State.shockwaves.forEach((sw, index) => {
        if (sw.isGodRing) {
            sw.r += 120; // Fast expansion
            sw.alpha -= 0.003;

            // TERMINATE at maxR to prevent global sweep
            if (sw.maxR && sw.r > sw.maxR) {
                State.shockwaves.splice(index, 1);
                return;
            }
        } else {
            sw.r += 15; sw.alpha -= 0.01;
        }

        if (sw.alpha <= 0) { State.shockwaves.splice(index, 1); return; }

        // Calculate Viewport Position for drawing
        const vpX = sw.x - State.worldOffsetX + State.width / 2;
        const vpY = sw.y - State.worldOffsetY + State.height / 2;

        if (sw.isGodRing) {
            // God Ring Visuals (Force Lightning & Sparkles)
            DOM.canvasContext.save();
            DOM.canvasContext.strokeStyle = `rgba(0, 255, 255, ${Math.min(1, sw.alpha)})`;
            DOM.canvasContext.lineWidth = 15;
            DOM.canvasContext.shadowBlur = 40;
            DOM.canvasContext.shadowColor = '#00FFFF';

            // Neon core ring
            DOM.canvasContext.beginPath();
            DOM.canvasContext.arc(vpX, vpY, sw.r, 0, Math.PI * 2);
            DOM.canvasContext.stroke();

            // Force Lightning Tendrils
            DOM.canvasContext.lineWidth = 3;
            DOM.canvasContext.strokeStyle = `rgba(200, 255, 255, ${Math.min(1, sw.alpha)})`;
            for (let i = 0; i < 60; i++) {
                const ang = Math.random() * Math.PI * 2;
                const jitter = (Math.random() - 0.5) * 150;
                const lx1 = vpX + Math.cos(ang) * (sw.r - 30);
                const ly1 = vpY + Math.sin(ang) * (sw.r - 30);
                const lx2 = vpX + Math.cos(ang) * (sw.r + 100) + jitter;
                const ly2 = vpY + Math.sin(ang) * (sw.r + 100) + jitter;

                DOM.canvasContext.beginPath();
                DOM.canvasContext.moveTo(lx1, ly1);
                // Multi-segment jittery lightning path
                let curX = lx1, curY = ly1;
                for (let j = 0; j < 3; j++) {
                    curX += (lx2 - lx1) / 3 + (Math.random() - 0.5) * 80;
                    curY += (ly2 - ly1) / 3 + (Math.random() - 0.5) * 80;
                    DOM.canvasContext.lineTo(curX, curY);
                }
                DOM.canvasContext.stroke();

                // Static Sparkles
                if (Math.random() < 0.4) {
                    DOM.canvasContext.fillStyle = '#FFFFFF';
                    DOM.canvasContext.fillRect(lx2 + (Math.random() - 0.5) * 40, ly2 + (Math.random() - 0.5) * 40, 5, 5);
                }
            }
            DOM.canvasContext.restore();
        } else {
            DOM.canvasContext.beginPath(); DOM.canvasContext.arc(vpX, vpY, sw.r, 0, Math.PI * 2);
            DOM.canvasContext.strokeStyle = `rgba(255, 200, 50, ${sw.alpha})`; DOM.canvasContext.lineWidth = 5; DOM.canvasContext.stroke();
        }

        // Apply force/destruction to asteroids, State.ships, and player (Force is World Units)
        const applyShockwaveEffect = (obj) => {
            let dx = obj.x - sw.x; let dy = obj.y - sw.y; // World Distance Vector
            let dist = Math.sqrt(dx * dx + dy * dy);

            // Detection band
            const bandWidth = sw.isGodRing ? 600 : 30;

            if (Math.abs(dist - sw.r) < bandWidth) {
                if (sw.isGodRing) {
                    // Massive destruction: Indiscriminate except for the dealer
                    const dealer = sw.owner || State.playerShip;
                    if (obj === dealer) return;

                    if (obj.r !== undefined && !obj.type) { // Asteroid or Planet
                        if (obj.vaporized || obj.blinkNum > 0) return;

                        obj.r = 0; // Marked for instant removal (no split)
                        obj.vaporized = true;

                        // AWARD SCORE for Godship destruction
                        if (obj.isPlanet) {
                            addScreenMessage(t("game.planet_vaporized", { name: obj.name.toUpperCase() }), "#ff00ff");

                            const vpX = obj.x - State.worldOffsetX + State.width / 2;
                            const vpY = obj.y - State.worldOffsetY + State.height / 2;

                            createExplosion(vpX, vpY, 150, '#ffaa00', 8, 'flame');
                            createExplosion(vpX, vpY, 100, '#ff4400', 12, 'flame');
                            createExplosion(vpX, vpY, 80, '#550000', 15, 'smoke');
                            createExplosion(vpX, vpY, 50, '#ffff00', 4, 'spark');

                            AudioEngine.playPlanetExplosion(obj.x, obj.y, obj.z || 0);
                            State.pendingDebris.push({ x: obj.x, y: obj.y, count: ASTEROID_CONFIG.PLANET_DEBRIS, isHot: true });
                            createShockwave(obj.x, obj.y);
                            createShockwave(obj.x, obj.y);

                            const scorer = sw.owner || State.playerShip;
                            increaseShipScore(scorer, SCORE_REWARDS.PLANET_DESTROYED); // Score for planet

                            // Check if player destroyed their own home
                            if (obj.id === State.homePlanetId) {
                                if (scorer === State.playerShip) {
                                    triggerHomePlanetLost('player');
                                } else {
                                    triggerHomePlanetLost('enemy');
                                }
                            }
                        } else {
                            const scorer = sw.owner || State.playerShip;
                            increaseShipScore(scorer, SCORE_REWARDS.ASTEROID_DESTROYED);
                        }
                    } else if (obj.type === 'ship' || obj.type === 'station') {
                        obj.structureHP = -1; // Force death
                        obj.vaporized = true;
                    }
                } else {
                    let angle = Math.atan2(dy, dx);
                    let force = sw.strength * (1 - dist / sw.maxR);
                    if (force > 0) { obj.xv += Math.cos(angle) * force * 0.1; obj.yv += Math.sin(angle) * force * 0.1; }
                }
            }
        }
        State.roids.forEach(applyShockwaveEffect);
        State.ships.forEach(applyShockwaveEffect);

        // Player knockback (Regular State.shockwaves only)
        if (!sw.isGodRing) {
            let dx = State.worldOffsetX - sw.x; let dy = State.worldOffsetY - sw.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (Math.abs(dist - sw.r) < 30) {
                let angle = Math.atan2(dy, dx);
                let force = sw.strength * (1 - dist / sw.maxR);
                if (force > 0) { State.velocity.x += Math.cos(angle) * force * 0.05; State.velocity.y += Math.sin(angle) * force * 0.05; }
            }
        }
    });

    // --- Ambient Fog Drawing ---
    DOM.canvasContext.globalCompositeOperation = 'screen';
    for (let i = State.ambientFogs.length - 1; i >= 0; i--) {
        let f = State.ambientFogs[i];

        // Fog position is in Viewport Coordinates, so update as before
        f.x += f.xv; f.y += f.yv; // Absolute movement (slow drift)
        f.x -= State.velocity.x; // Parallax/Camera movement
        f.y -= State.velocity.y;

        f.life--;
        // Check if fog is off-screen or lifetime expired
        if (f.life <= 0 || f.x < -f.r * 0.5 || f.x > State.width + f.r * 0.5 || f.y > State.height + f.r * 0.5 || f.y < -f.r * 0.5) {
            State.ambientFogs.splice(i, 1);
            if (State.ambientFogs.length < 3) State.ambientFogs.push(createAmbientFog());
            continue;
        }

        let g = DOM.canvasContext.createRadialGradient(f.x, f.y, f.r * 0.1, f.x, f.y, f.r);
        g.addColorStop(0, `hsla(${f.hue}, 80%, 40%, ${f.alpha})`);
        g.addColorStop(1, 'transparent');
        DOM.canvasContext.fillStyle = g; DOM.canvasContext.beginPath(); DOM.canvasContext.arc(f.x, f.y, f.r, 0, Math.PI * 2); DOM.canvasContext.fill();
    }
    DOM.canvasContext.globalCompositeOperation = 'source-over'; // Reset blend mode

    // --- Background Parallax Drawing ---
    const moveLayer = (list, factor) => list.forEach(item => {
        // Background items use VIEWPORT coordinates for display, so update with State.velocity
        item.x -= State.velocity.x * factor; item.y -= State.velocity.y * factor;
        const e = item.r || item.size || 50;
        if (item.x < -e) item.x = State.width + e;
        else if (item.x > State.width + e) item.x = -e;
        if (item.y < -e) item.y = State.height + e;
        else if (item.y > State.height + e) item.y = -e;
    });

    DOM.canvasContext.globalCompositeOperation = 'screen';
    moveLayer(State.backgroundLayers.nebulas, 0.05);
    State.backgroundLayers.nebulas.forEach(n => {
        let g = DOM.canvasContext.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `hsla(${n.hue}, 80%, 40%, ${n.alpha})`); g.addColorStop(1, 'transparent');
        DOM.canvasContext.fillStyle = g; DOM.canvasContext.beginPath(); DOM.canvasContext.arc(n.x, n.y, n.r, 0, Math.PI * 2); DOM.canvasContext.fill();
    });
    DOM.canvasContext.globalCompositeOperation = 'source-over';
    // Draw distant galaxies - unaffected by camera zoom, but still world-anchored
    DOM.canvasContext.save();

    if (State.viewScale !== 1.0) {
        // Reverse the zoom scale by pivoting exactly at the screen center
        DOM.canvasContext.translate(State.width / 2, State.height / 2);
        DOM.canvasContext.scale(1 / State.viewScale, 1 / State.viewScale);
        DOM.canvasContext.translate(-State.width / 2, -State.height / 2);
    }

    // Sort galaxies by size (smallest to largest) for depth sorting
    State.backgroundLayers.galaxies.sort((a, b) => a.size - b.size);

    State.backgroundLayers.galaxies.forEach(g => {
        // Slow parallax relative to standard speed
        g.x -= State.velocity.x * 0.002;
        g.y -= State.velocity.y * 0.002;
        g.angle += 0.0005;

        g.angle += 0.0005; // Slower rotation

        // FAST PRE-CHECK: Skip rendering entirely if off-screen (with buffer)
        // Since coordinate system is reversed via translate above, we check against standard canvas bounds plus a generic buffer
        const buffer = g.size * 1.5;
        if (g.x < -buffer || g.x > State.width + buffer ||
            g.y < -buffer || g.y > State.height + buffer) {
            return;
        }

        DOM.canvasContext.save();
        DOM.canvasContext.translate(g.x, g.y);
        DOM.canvasContext.rotate(g.angle);
        DOM.canvasContext.scale(1, g.squish || 1); // Apply perspective tilt

        // 1. Draw glowing radiant core
        DOM.canvasContext.globalCompositeOperation = 'screen';
        const coreRad = g.size * 0.3; // Core size proportional to galaxy
        let coreGrad = DOM.canvasContext.createRadialGradient(0, 0, 0, 0, 0, coreRad);

        // Use the generated colors (core is very bright, edge scales off). Dimmed for distant effect.
        coreGrad.addColorStop(0, `rgba(${g.coreColor.r}, ${g.coreColor.g}, ${g.coreColor.b}, ${GALAXY_CONFIG.BRIGHTNESS})`);
        coreGrad.addColorStop(0.2, `rgba(${g.coreColor.r}, ${g.coreColor.g}, ${g.coreColor.b}, ${GALAXY_CONFIG.BRIGHTNESS * 0.6})`);
        coreGrad.addColorStop(1, `rgba(${g.edgeColor.r}, ${g.edgeColor.g}, ${g.edgeColor.b}, 0)`);

        DOM.canvasContext.fillStyle = coreGrad;
        DOM.canvasContext.beginPath();
        DOM.canvasContext.arc(0, 0, coreRad, 0, Math.PI * 2);
        DOM.canvasContext.fill();

        // 2. Draw stars (reduced alpha)
        g.stars.forEach(s => {
            // The color string was prepared in entities.js like: `rgba(R,G,B, `
            DOM.canvasContext.fillStyle = `${s.color}${s.alpha * GALAXY_CONFIG.BRIGHTNESS})`;
            DOM.canvasContext.beginPath();
            DOM.canvasContext.arc(s.r * Math.cos(s.theta), s.r * Math.sin(s.theta), s.size, 0, Math.PI * 2);
            DOM.canvasContext.fill();
        });

        DOM.canvasContext.restore();
    });
    DOM.canvasContext.restore(); // Restore global scale
    // Draw starfield parallax layers
    moveLayer(State.backgroundLayers.starsFar, 0.02); moveLayer(State.backgroundLayers.starsMid, 0.08); moveLayer(State.backgroundLayers.starsNear, 0.16);
    const drawStars = (list, c) => { DOM.canvasContext.fillStyle = c; list.forEach(s => DOM.canvasContext.fillRect(s.x, s.y, s.size, s.size)); };
    drawStars(State.backgroundLayers.starsFar, '#555'); drawStars(State.backgroundLayers.starsMid, '#888'); drawStars(State.backgroundLayers.starsNear, '#fff');

    updatePhysics(); // Run asteroid merging and gravity simulation (uses World Coords)

    DOM.canvasContext.lineCap = 'round'; DOM.canvasContext.lineJoin = 'round';

    // --- Enemy Update and MOVEMENT/AI (Separated from Drawing for Z-order) ---
    let shipsToDraw = [];
    for (let i = State.ships.length - 1; i >= 0; i--) {
        let ship = State.ships[i];

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
            let vpX = (ship.x - State.worldOffsetX) + State.width / 2;
            let vpY = (ship.y - State.worldOffsetY) + State.height / 2;
            createExplosion(vpX, vpY, 60, '#00ffff', 5, 'spark');

            // If vaporized, it was the player's God Ring
            const killer = ship.vaporized ? State.playerShip : null;

            if (ship.type === 'station') onStationDestroyed(ship, killer);
            else onShipDestroyed(ship, killer);
            State.ships.splice(i, 1);
            AudioEngine.playExplosion('large', ship.x, ship.y, ship.z);
            continue;
        }

        const cullRange = WORLD_BOUNDS * 1.5;

        if (ship.blinkNum > 0) ship.blinkNum--;

        // Ships dancing in victory (Refined: Synchronized spiral)
        if (State.victoryState) {
            const time = Date.now() / 1000;
            const orbitR = 300 + Math.sin(time + i) * 100;
            const destX = State.worldOffsetX + Math.cos(time * 0.5 + i * 0.5) * orbitR;
            const destY = State.worldOffsetY + Math.sin(time * 0.5 + i * 0.5) * orbitR;

            ship.xv += (destX - ship.x) * 0.05;
            ship.yv += (destY - ship.y) * 0.05;
            ship.xv *= 0.95; ship.yv *= 0.95;
            ship.a += 0.1;
        }

        let isOrbiting = false;
        if (ship.type === 'station' && ship.hostPlanetId) {
            const host = State.roids.find(r => r.id === ship.hostPlanetId);
            if (!host) {
                ship.hostPlanetId = null;
                ship.xv = (Math.random() - 0.5) * 0.5; ship.yv = (Math.random() - 0.5) * 0.5;
            } else {
                ship.orbitAngle += ship.orbitSpeed;

                // Dynamic distance: host.r + 30% of host.r + station radius
                // This ensures it stays "no much far" even if planet grows
                const effectiveOrbitDist = host.r * 1.3 + ship.r;

                const dx_orbit = Math.cos(ship.orbitAngle) * effectiveOrbitDist;
                const dy_orbit = Math.sin(ship.orbitAngle) * effectiveOrbitDist;

                const targetX = host.x + dx_orbit;
                const targetY = host.y + dy_orbit;

                // SPRING FORCE TO ORBIT (Soft Lock)
                // Instead of e.x = targetX, we apply force towards targetX
                const distToTargetX = targetX - ship.x;
                const distToTargetY = targetY - ship.y;

                // Strong spring to keep it in orbit, but allows deviation
                ship.xv += distToTargetX * 0.1;
                ship.yv += distToTargetY * 0.1;
                ship.xv *= 0.8; // Heavy damping to stop oscillation
                ship.yv *= 0.8;

                // Stations avoid crashing.
                let stationNeighbors = spatialGrid.query(ship);
                for (let r of stationNeighbors) {
                    if (r === host) continue; // Don't avoid host
                    if (r.z > 0.5 || r.isPlanet) continue;

                    let dx = ship.x - r.x;
                    let dy = ship.y - r.y;
                    let dist = Math.sqrt((dx) * (dx) + (dy) * (dy));
                    let minDist = ship.r + r.r + 100; // Buffer

                    if (dist < minDist && dist > 0) {
                        // Repulsion
                        let force = (minDist - dist) * 0.05;
                        ship.xv += (dx / dist) * force;
                        ship.yv += (dy / dist) * force;
                    }
                }

                // e.z = host.z; // REMOVED: Don't sync Z with planet

                isOrbiting = true; // Use physics integration below

                // Recover shield and make station effectively "gone" if far away
                if (ship.z >= 0.5) {
                    ship.structureHP = STATION_CONFIG.RESISTANCE;
                }
            }
        }



        ship.x += ship.xv;
        ship.y += ship.yv;

        // Circular boundary enforcement for ships
        const distFromCenter = Math.sqrt((ship.x) * (ship.x) + (ship.y) * (ship.y));
        if (distFromCenter > WORLD_BOUNDS) {
            const angleToCenter = Math.atan2(ship.y, ship.x);
            // Apply a correction force back towards the center
            ship.xv -= Math.cos(angleToCenter) * BOUNDARY_CONFIG.CORRECTION_FORCE * 2;
            ship.yv -= Math.sin(angleToCenter) * BOUNDARY_CONFIG.CORRECTION_FORCE * 2;
        }

        // Calculate Viewport Position for drawing (WITH PARALLAX)
        let depthScale = 1;
        if (ship.z > 0) {
            depthScale = 1 / (1 + ship.z);
        }

        const vpX = (ship.x - State.worldOffsetX) * depthScale + State.width / 2;
        const vpY = (ship.y - State.worldOffsetY) * depthScale + State.height / 2;

        // OPTIMIZED: Use spatial grid for collisions
        let nearbyColliders = spatialGrid.query(ship);
        for (let r of nearbyColliders) {
            if (r.z > 0.5) continue;

            if ((ship.type === 'station' && ship.hostPlanetId && r.id === ship.hostPlanetId) || ship.blinkNum > 0) {
                continue;
            }

            let dx = ship.x - r.x; let dy = ship.y - r.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            let minDist = ship.r + r.r;

            if (dist < minDist) {
                if (ship.z > 0.5) continue;
                if (r.isPlanet) continue; // Should not happen with grid, but safety

                let angle = Math.atan2(dy, dx);
                let overlap = minDist - dist;

                ship.x += Math.cos(angle) * overlap;
                ship.y += Math.sin(angle) * overlap;

                ship.xv += Math.cos(angle) * 2;
                ship.yv += Math.sin(angle) * 2;

                const tier = Math.floor((ship.score || 0) / SHIP_CONFIG.EVOLUTION_SCORE_STEP);

                if (tier < 12) {
                    ship.structureHP--;
                    ship.shieldHitTimer = 10;
                }

                const rVpX = r.x - State.worldOffsetX + State.width / 2;
                const rVpY = r.y - State.worldOffsetY + State.height / 2;

                // If the ship is a Godship, we should probably destroy the asteroid here just like the player does.
                if (tier >= 12) {
                    createExplosion(rVpX, rVpY, 15, '#0ff', 2, 'spark');
                    const newSize = r.r * 0.5;
                    if (newSize >= ASTEROID_CONFIG.MIN_SIZE) {
                        const dynamicOffset = r.r * (ASTEROID_CONFIG.SPLIT_OFFSET / ASTEROID_CONFIG.MAX_SIZE);
                        let westAst = createAsteroid(r.x - dynamicOffset, r.y, newSize);
                        westAst.xv = r.xv - ASTEROID_CONFIG.MAX_SPEED; westAst.yv = r.yv; westAst.blinkNum = 30;
                        State.roids.push(westAst);

                        let eastAst = createAsteroid(r.x + dynamicOffset, r.y, newSize);
                        eastAst.xv = r.xv + ASTEROID_CONFIG.MAX_SPEED; eastAst.yv = r.yv; eastAst.blinkNum = 30;
                        State.roids.push(eastAst);
                        updateAsteroidCounter();
                    }
                    r._destroyed = true;
                    const roidIdx = State.roids.indexOf(r);
                    if (roidIdx !== -1) State.roids.splice(roidIdx, 1);
                    updateAsteroidCounter();

                    increaseShipScore(ship, SCORE_REWARDS.ASTEROID_DESTROYED);
                } else {
                    createExplosion(rVpX, rVpY, 5, '#aa00ff', 1, 'debris');
                }

                if (ship.structureHP <= 0) {
                    createExplosion(vpX, vpY, 30, '#ffaa00', 3, 'spark');
                    ship.dead = true;
                    State.ships.splice(i, 1);
                    break;
                }
            }
        }
        if (i < 0) continue;

        let threat = null; let minThreatDist = Infinity;
        // Don't set player as threat if dead
        // (threat will remain null if player is dead and no asteroids are close)

        // Check for closer asteroid threats (avoidance), but prioritize player if somewhat close?
        // OPTIMIZED: Threat check using same grid query if possible? 
        // We can just query again (cheap)
        let potentialThreats = spatialGrid.query(ship);
        for (let r of potentialThreats) {
            if (r.z > 0.5) continue;
            let d = Math.sqrt((ship.x - r.x) * (ship.x - r.x) + (ship.y - r.y) * (ship.y - r.y));
            if (d < 300 && d < minThreatDist && d > ship.r + r.r) {
                threat = r;
                minThreatDist = d;
            }
        }

        if (ship.type === 'station') {
            ship.a += ship.rotSpeed;
            ship.spawnTimer--;
            if (ship.spawnTimer <= 0) {
                const currentFactionShips = State.ships.filter(en => en.type === 'ship' && en.homeStation && en.homeStation.hostPlanetId === ship.hostPlanetId).length;
                if (currentFactionShips < SHIP_CONFIG.PLANET_LIMIT) {
                    spawnShipsSquad(ship);
                }
                ship.spawnTimer = SHIP_CONFIG.SPAWN_TIME + Math.random() * SHIP_CONFIG.SPAWN_TIME;
            }

            // Stations shoot at nearby asteroids
            if (ship.reloadTime <= 0) {
                let targets = spatialGrid.query(ship);
                for (let r of targets) {
                    if (r.z > 0.5 || r.isPlanet) continue;
                    const distToRoid = Math.sqrt((r.x - ship.x) * (r.x - ship.x) + (r.y - ship.y) * (r.y - ship.y));
                    if (distToRoid < 1500) {
                        enemyShoot(ship, r.x, r.y);
                        if (ship.reloadTime > 0) break;
                    }
                }
            }
        } else {
            // --- ADVANCED SHIP AI ---
            const distToPlayer = Math.sqrt((State.worldOffsetX - ship.x) * (State.worldOffsetX - ship.x) + (State.worldOffsetY - ship.y) * (State.worldOffsetY - ship.y));
            const tier = Math.floor((ship.score || 0) / SHIP_CONFIG.EVOLUTION_SCORE_STEP);

            // 1. STATE TRANSITION
            if (tier >= 12) {
                // Godships are lone wolves. They never join squads.
                if (ship.leaderRef) {
                    if (ship.leaderRef.squadSlots) {
                        const slot = ship.leaderRef.squadSlots.find(s => s.occupant === ship);
                        if (slot) slot.occupant = null;
                    }
                    ship.leaderRef = null;
                    if (ship.role !== 'leader') ship.role = 'stray';
                }
                if (ship.squadSlots && ship.squadSlots.length > 0) {
                    ship.squadSlots.forEach(s => { if (s.occupant) s.occupant.leaderRef = null; s.occupant = null; });
                    ship.squadSlots = null;
                    ship.role = 'stray';
                }
                ship.aiState = 'SAFE_ZONE_HUNTER';
            } else if (!ship.isFriendly && distToPlayer < SHIP_CONFIG.SIGHT_RANGE && !State.playerShip.dead) { // Only Enemy State.ships auto-switch to combat by distance
                ship.aiState = 'COMBAT';
            } else if (distToPlayer > SHIP_CONFIG.SIGHT_RANGE * 1.5 && ship.aiState === 'COMBAT') {
                ship.aiState = 'FORMATION';
            }

            // --- NEAR HOME OR STATION ATTACK WARNING ---
            if (!ship.isFriendly && !State.victoryState) {
                let isThreat = false;
                if (tier >= 12) isThreat = true;
                if (ship.role === 'leader' && ship.squadSlots) {
                    let validSubordinates = ship.squadSlots.filter(s => s.occupant && !s.occupant.dead && State.ships.includes(s.occupant)).length;
                    if (validSubordinates > 0) isThreat = true;
                }

                if (isThreat) {
                    let warnedHome = false;
                    // Check Home Planet First
                    if (State.homePlanetId && homeAttackWarningTimer === 0) {
                        const home = State.roids.find(r => r.id === State.homePlanetId);
                        // User Request: Only valid if home planet is at default z (< 0.5)
                        if (home && home.z < 0.5 && Math.sqrt((ship.x - home.x) * (ship.x - home.x) + (ship.y - home.y) * (ship.y - home.y)) < 3000) {
                            addScreenMessage(t("game.warn_home_attack"), "#ff0000"); // Red warning
                            homeAttackWarningTimer = 600; // Warn every 10 seconds (assuming 60 FPS)
                            warnedHome = true;
                        }
                    }

                    // User Request: Fallback check for allied stations
                    if (!warnedHome && stationAttackWarningTimer === 0) {
                        for (let other of State.ships) {
                            if (other.isFriendly && other.type === 'station') {
                                if (Math.sqrt((ship.x - other.x) * (ship.x - other.x) + (ship.y - other.y) * (ship.y - other.y)) < 3000) {
                                    addScreenMessage(t("game.warn_station_attack"), "#ff8800"); // Orange warning
                                    stationAttackWarningTimer = 600; // 10 seconds
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // 2. BEHAVIOR EXECUTION
            if (ship.aiState === 'SAFE_ZONE_HUNTER') {
                proactiveCombatScanner(ship);

                // Pick a safe zone target if not having one
                if (!ship.safeZoneTarget) {
                    // Pick a random point far out
                    const angle = Math.random() * Math.PI * 2;
                    const r = WORLD_BOUNDS * 0.8 + Math.random() * (WORLD_BOUNDS * 0.1);
                    ship.safeZoneTarget = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
                }

                // If close to safe zone target, pick a new one
                const distToSafeZone = Math.sqrt((ship.safeZoneTarget.x - ship.x) * (ship.safeZoneTarget.x - ship.x) + (ship.safeZoneTarget.y - ship.y) * (ship.safeZoneTarget.y - ship.y));
                if (distToSafeZone < 500) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = WORLD_BOUNDS * 0.8 + Math.random() * (WORLD_BOUNDS * 0.1);
                    ship.safeZoneTarget = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
                }

                let moveTarget = ship.safeZoneTarget;

                // If there are enemies/asteroids nearby, we can slightly deviate to hunt them
                let huntTarget = null;
                let minThreatDist = Infinity;

                // --- HOME PLANET AGGRESSION ---
                // Enemy AI prioritizes hunting the home planet from massive distances if vulnerable
                if (!ship.isFriendly && State.homePlanetId) {
                    const home = State.roids.find(r => r.id === State.homePlanetId);
                    if (home && home.z < 0.5 && !home._destroyed) {
                        let d = Math.sqrt((home.x - ship.x) * (home.x - ship.x) + (home.y - ship.y) * (home.y - ship.y));
                        if (d < 5000) { // Will break patrol to swarm the planet
                            huntTarget = home;
                            minThreatDist = d;
                        }
                    }
                }

                // Normal roaming checks
                if (!huntTarget) {
                    let gridThreats = spatialGrid.query(ship);
                    for (let r of gridThreats) {
                        if (r.z > 0.5 || r.isPlanet) continue;
                        let d = Math.sqrt((ship.x - r.x) * (ship.x - r.x) + (ship.y - r.y) * (ship.y - r.y));
                        if (d < 1500 && d < minThreatDist) {
                            huntTarget = r;
                            minThreatDist = d;
                        }
                    }
                }

                if (!huntTarget) {
                    for (let other of State.ships) {
                        if (other === ship || other.type === 'station') continue;
                        let isRival = false;
                        if (ship.isFriendly && !other.isFriendly) isRival = true;
                        if (!ship.isFriendly && (other.isFriendly || other.fleetHue !== ship.fleetHue)) isRival = true;

                        if (isRival) {
                            let d = Math.sqrt((other.x - ship.x) * (other.x - ship.x) + (other.y - ship.y) * (other.y - ship.y));
                            if (d < 2000 && d < minThreatDist) { huntTarget = other; minThreatDist = d; }
                        }
                    }
                    if (!ship.isFriendly && !State.playerShip.dead) {
                        let d = Math.sqrt((State.worldOffsetX - ship.x) * (State.worldOffsetX - ship.x) + (State.worldOffsetY - ship.y) * (State.worldOffsetY - ship.y));
                        if (d < 2000 && d < minThreatDist) { huntTarget = { x: State.worldOffsetX, y: State.worldOffsetY }; minThreatDist = d; }
                    }
                }

                // If Godship retreats near its home, wingmen must attack approaching enemies aggressively
                if (ship.isFriendly && State.playerShip.tier >= 12 && State.homePlanetId) {
                    const home = State.roids.find(r => r.id === State.homePlanetId);
                    if (home) {
                        for (let other of State.ships) {
                            if (!other.isFriendly && other.type !== 'station') {
                                let distToHome = Math.sqrt((other.x - home.x) * (other.x - home.x) + (other.y - home.y) * (other.y - home.y));
                                if (distToHome < 3000) { // Intercept radius
                                    let distToRival = Math.sqrt((other.x - ship.x) * (other.x - ship.x) + (other.y - ship.y) * (other.y - ship.y));
                                    if (distToRival < minThreatDist) {
                                        huntTarget = other; minThreatDist = distToRival;
                                    }
                                }
                            }
                        }
                    }
                }

                if (huntTarget) {
                    moveTarget = huntTarget;
                }

                // Move towards target
                const moveAngle = Math.atan2(moveTarget.y - ship.y, moveTarget.x - ship.x);
                ship.xv += Math.cos(moveAngle) * 0.4;
                ship.yv += Math.sin(moveAngle) * 0.4;

                let angleDiff = moveAngle - ship.a;
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                ship.a += angleDiff * 0.05;

                ship.xv *= 0.95; ship.yv *= 0.95;
            } else if (ship.aiState === 'FORMATION') {
                let isRetreating = false;
                if (ship.isFriendly && State.playerShip.tier >= 12 && State.homePlanetId) {
                    // WINGMAN RETREAT: Orbit home when the player is a Godship to avoid the ring
                    const home = State.roids.find(r => r.id === State.homePlanetId);
                    if (home) {
                        const dx = home.x - ship.x;
                        const dy = home.y - ship.y;
                        const dist = Math.sqrt((dx) * (dx) + (dy) * (dy));
                        const ORBIT_RADIUS = home.r * 1.5 + ship.r;

                        if (dist > ORBIT_RADIUS + 100) {
                            ship.xv += (dx / dist) * 1.5;
                            ship.yv += (dy / dist) * 1.5;
                            let angleDiff = Math.atan2(ship.yv, ship.xv) - ship.a;
                            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                            while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                            ship.a += angleDiff * 0.1;
                        } else if (dist < ORBIT_RADIUS - 100) {
                            ship.xv -= (dx / dist) * 1.5;
                            ship.yv -= (dy / dist) * 1.5;
                            let angleDiff = Math.atan2(ship.yv, ship.xv) - ship.a;
                            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                            while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                            ship.a += angleDiff * 0.1;
                        } else {
                            if (!ship.orbitDir) ship.orbitDir = (Math.random() > 0.5 ? 1 : -1);
                            const orbitAngle = Math.atan2(dy, dx) + (Math.PI / 2) * ship.orbitDir;
                            ship.xv += Math.cos(orbitAngle) * 1.0;
                            ship.yv += Math.sin(orbitAngle) * 1.0;

                            let targetAngle = Math.atan2(ship.yv, ship.xv); // Default: face movement direction

                            // Scan for danger to put attention
                            let nearestThreat = null;
                            let minThreatDist = Infinity;
                            for (let r of State.roids) {
                                if (r.z > 0.5 || r.isPlanet) continue;
                                const distToStation = Math.sqrt((r.x - home.x) * (r.x - home.x) + (r.y - home.y) * (r.y - home.y));
                                if (distToStation < home.r * 8.0) {
                                    const distToShip = Math.sqrt((r.x - ship.x) * (r.x - ship.x) + (r.y - ship.y) * (r.y - ship.y));
                                    if (distToShip < minThreatDist && distToShip < 2000) {
                                        nearestThreat = r;
                                        minThreatDist = distToShip;
                                    }
                                }
                            }
                            for (let target of State.ships) {
                                if (target === ship || target.type === 'station') continue;
                                if (ship.isFriendly && !target.isFriendly) {
                                    const distToStation = Math.sqrt((target.x - home.x) * (target.x - home.x) + (target.y - home.y) * (target.y - home.y));
                                    if (distToStation < home.r * 8.0) {
                                        const distToShip = Math.sqrt((target.x - ship.x) * (target.x - ship.x) + (target.y - ship.y) * (target.y - ship.y));
                                        if (distToShip < minThreatDist && distToShip < 2000) {
                                            nearestThreat = target;
                                            minThreatDist = distToShip;
                                        }
                                    }
                                }
                            }

                            if (nearestThreat) {
                                targetAngle = Math.atan2(nearestThreat.y - ship.y, nearestThreat.x - ship.x);
                            }

                            let angleDiff = targetAngle - ship.a;
                            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                            while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                            ship.a += angleDiff * 0.15;
                        }
                        ship.xv *= 0.95; ship.yv *= 0.95;
                        isRetreating = true;
                    }
                }
                proactiveCombatScanner(ship);

                if (!isRetreating && ship.isFriendly && !State.playerShip.dead && ship.leaderRef === State.playerShip) {
                    // FRIENDLY: Follow Player in V-Formation
                    const lx = State.worldOffsetX;
                    const ly = State.worldOffsetY;
                    const la = State.playerShip.a;


                    const fwdX = Math.cos(la);
                    const fwdY = Math.sin(la); // Player uses Standard Canvas Coordinates (Y-Down)
                    // Right Vector: Rotate Forward +90 degrees (CW)
                    // in Y-Down: (x, y) -> (-y, x)
                    const rightX = -fwdY;
                    const rightY = fwdX;

                    const targetX = lx + (rightX * ship.formationOffset.x) + (fwdX * ship.formationOffset.y);
                    const targetY = ly + (rightY * ship.formationOffset.x) + (fwdY * ship.formationOffset.y);

                    const dx = targetX - ship.x;
                    const dy = targetY - ship.y;
                    const distToTarget = Math.sqrt((dx) * (dx) + (dy) * (dy));

                    // Check if strictly in visual slot
                    const isInVisualSlot = distToTarget < 40;

                    // Break formation if about to crash while player is active
                    const isPlayerActive = Math.abs(State.velocity.x) > 0.5 || Math.abs(State.velocity.y) > 0.5 ||
                        State.keys.KeyA || State.keys.KeyD || State.keys.ArrowLeft || State.keys.ArrowRight ||
                        State.keys.ArrowUp || State.keys.KeyW || State.keys.Space;

                    let obstacle = null;
                    const safetyDist = 50; // Much tighter tolerance, only break for immediate collision

                    // Check Asteroids
                    let nearbyObs = spatialGrid.query(ship);
                    for (let r of nearbyObs) {
                        if (r.z > 0.5 || r.isPlanet) continue;
                        let d = Math.sqrt((ship.x - r.x) * (ship.x - r.x) + (ship.y - r.y) * (ship.y - r.y));
                        if (d < r.r + ship.r + safetyDist) {
                            obstacle = r; break;
                        }
                    }
                    // Check Stations
                    if (!obstacle) {
                        for (let other of State.ships) {
                            if (other === ship || (other.isFriendly && other.type !== 'station')) continue;
                            let d = Math.sqrt((ship.x - other.x) * (ship.x - other.x) + (ship.y - other.y) * (ship.y - other.y));
                            if (d < other.r + ship.r + safetyDist) {
                                obstacle = other; break;
                            }
                        }
                    }

                    if (obstacle && isPlayerActive) ship.isAvoiding = true;
                    else if (!isPlayerActive) ship.isAvoiding = false;

                    let formationForce = 0.15; // Increased from 0.05
                    ship.arrivalDamping = 0.85;

                    if (ship.isAvoiding) {
                        if (obstacle) {
                            // STEER AWAY from obstacle
                            let avoidAng = Math.atan2(ship.y - obstacle.y, ship.x - obstacle.x);
                            ship.xv += Math.cos(avoidAng) * 2.5;
                            ship.yv += Math.sin(avoidAng) * 2.5;
                            ship.arrivalDamping = 0.92;
                        } else {
                            // ABANDONED: Just slow down and wait for player to stop
                            ship.arrivalDamping = 0.98;
                        }
                        // While avoiding, do NOT imitate leader
                    } else {
                        // Normal formation logic: Incorporate leader velocity to eliminate lag
                        const leaderVX = State.velocity.x;
                        const leaderVY = State.velocity.y;

                        // Smoothly match leader velocity
                        ship.xv += (leaderVX - ship.xv) * 0.1;
                        ship.yv += (leaderVY - ship.yv) * 0.1;

                        if (distToTarget < 200) {
                            const arrivalFactor = distToTarget / 200;
                            formationForce *= arrivalFactor;
                            ship.arrivalDamping = 0.85 + (1 - arrivalFactor) * 0.1;
                        }

                        ship.xv += dx * formationForce;
                        ship.yv += dy * formationForce;
                    }

                    // IMITATION LOGIC: Only if in visual slot
                    if (isInVisualSlot && !ship.isAvoiding) {
                        // Match player rotation EXACTLY when in V-formation with player
                        let angleDiff = la - ship.a;
                        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                        while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                        if (Math.abs(angleDiff) < 0.05) ship.a = la;
                        else ship.a += angleDiff * 0.4;
                    } else {
                        // Independent rotation - rotate toward movement/target
                        // If we are not in slot, we might look at enemies or look where we are going
                        const moveAngle = Math.atan2(ship.yv, ship.xv);
                        let angleDiff = moveAngle - ship.a;
                        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                        while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                        ship.a += angleDiff * 0.1;
                    }

                    // Damping and Speed Cap (IMPORTANT for stability)
                    const speed = Math.sqrt((ship.xv) * (ship.xv) + (ship.yv) * (ship.yv));
                    const maxFormationSpeed = 25;
                    if (speed > maxFormationSpeed) {
                        ship.xv = (ship.xv / speed) * maxFormationSpeed;
                        ship.yv = (ship.yv / speed) * maxFormationSpeed;
                    }
                    ship.xv *= (ship.arrivalDamping || 0.85); ship.yv *= (ship.arrivalDamping || 0.85); // Stronger damping for formation
                } else if (!isRetreating && ship.role === 'leader') {
                    // Update Squad Slots (Clean dead occupants)
                    // Update Squad Slots (Compact and Clean)
                    if (ship.squadSlots) {
                        // 1. Collect all valid living occupants
                        let validOccupants = [];
                        ship.squadSlots.forEach(slot => {
                            if (slot.occupant && !slot.occupant.dead && (State.ships.includes(slot.occupant) || slot.occupant === State.playerShip)) {
                                validOccupants.push(slot.occupant);
                            }
                            slot.occupant = null; // Clear all slots first
                        });

                        // 2. Re-assign occupants to slots in order (filling from closest to leader)
                        // 'squadSlots' is naturally ordered by creation (which is usually inner-to-outer in V-formation logic)
                        for (let i = 0; i < Math.min(validOccupants.length, ship.squadSlots.length); i++) {
                            const member = validOccupants[i];
                            const slot = ship.squadSlots[i];

                            slot.occupant = member;
                            // Update the member's target offset to the new slot's position
                            member.formationOffset = { x: slot.x, y: slot.y };
                        }

                        ship._lastSquadCount = validOccupants.length;
                    }

                    // LEADER: Patrol or Defend
                    let targetX, targetY;
                    let targetFound = false;

                    // 1. DEFEND HOME STATION (Priority)
                    if (ship.homeStation && !ship.homeStation.dead) {
                        // Check for asteroids threatening the home station
                        let threateningAst = null;
                        let minAstDist = Infinity;

                        let stationHazards = spatialGrid.query(ship.homeStation);
                        for (let r of stationHazards) {
                            if (r.z > 0.5 || r.isPlanet) continue;
                            const distToHome = Math.sqrt((r.x - ship.homeStation.x) * (r.x - ship.homeStation.x) + (r.y - ship.homeStation.y) * (r.y - ship.homeStation.y));

                            // If asteroid is dangerously close to home station (within 2500 units)
                            if (distToHome < 2500) {
                                if (distToHome < minAstDist) {
                                    minAstDist = distToHome;
                                    threateningAst = r;
                                }
                            }
                        }

                        if (threateningAst) {
                            targetX = threateningAst.x;
                            targetY = threateningAst.y;
                            targetFound = true;
                        }
                    }

                    // 2. PATROL (If no immediate threat at home)
                    if (!targetFound) {
                        if (!ship.patrolTarget) {
                            // Initialize patrol target
                            ship.patrolTarget = { x: ship.x, y: ship.y };
                        }

                        // Check if we reached the patrol target
                        const distToPatrol = Math.sqrt((ship.x - ship.patrolTarget.x) * (ship.x - ship.patrolTarget.x) + (ship.y - ship.patrolTarget.y) * (ship.y - ship.patrolTarget.y));
                        if (distToPatrol < 500) {
                            // Pick a new target
                            if (Math.random() < 0.5) {
                                // Random point in the world
                                let ang = Math.random() * Math.PI * 2;
                                let r = Math.random() * WORLD_BOUNDS * 0.9;
                                ship.patrolTarget.x = Math.cos(ang) * r;
                                ship.patrolTarget.y = Math.sin(ang) * r;
                            } else {
                                // Target check: find a rival station?
                                let rival = State.ships.find(s => s.type === 'station' && !s.isFriendly && s.fleetHue !== ship.fleetHue && !s.dead);
                                if (rival) {
                                    ship.patrolTarget.x = rival.x;
                                    ship.patrolTarget.y = rival.y;
                                } else {
                                    // Fallback to random
                                    ship.patrolTarget.x = (Math.random() - 0.5) * 1.8 * WORLD_BOUNDS;
                                    ship.patrolTarget.y = (Math.random() - 0.5) * 1.8 * WORLD_BOUNDS;
                                }
                            }
                        }
                        targetX = ship.patrolTarget.x;
                        targetY = ship.patrolTarget.y;
                    }

                    // Move towards target
                    let targetAngle = Math.atan2(targetY - ship.y, targetX - ship.x);

                    // Smooth rotation
                    let angleDiff = targetAngle - ship.a;
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                    ship.a += angleDiff * 0.05;

                    // Cruising Speed
                    const CRUISE_SPEED = 12;
                    ship.xv += Math.cos(ship.a) * 0.5;
                    ship.yv += Math.sin(ship.a) * 0.5;

                    // Cap speed
                    const speed = Math.sqrt((ship.xv) * (ship.xv) + (ship.yv) * (ship.yv));
                    if (speed > CRUISE_SPEED) {
                        ship.xv = (ship.xv / speed) * CRUISE_SPEED;
                        ship.yv = (ship.yv / speed) * CRUISE_SPEED;
                    }
                } else if (!isRetreating && ship.role !== 'leader') {
                    if (ship.leaderRef && (ship.leaderRef.dead || (!State.ships.includes(ship.leaderRef) && ship.leaderRef !== State.playerShip))) {
                        ship.leaderRef = null;
                        ship.squadId = null;
                    }

                    if (ship.leaderRef) {
                        const lx = ship.leaderRef.x || State.worldOffsetX; // Fallback for player
                        const ly = ship.leaderRef.y || State.worldOffsetY;
                        const la = ship.leaderRef.a;

                        const fwdX = Math.cos(la);
                        const fwdY = Math.sin(la); // State.ships use Screen Down (Positive Screen Y)
                        const rightX = -fwdY;
                        const rightY = fwdX;

                        const targetX = lx + (rightX * ship.formationOffset.x) + (fwdX * ship.formationOffset.y);
                        const targetY = ly + (rightY * ship.formationOffset.x) + (fwdY * ship.formationOffset.y);

                        // Spring Force to Target
                        const dx = targetX - ship.x;
                        const dy = targetY - ship.y;
                        const distToTarget = Math.sqrt((dx) * (dx) + (dy) * (dy));

                        const isInVisualSlot = distToTarget < 50;

                        let force = 0.25; // Greatly increased for agility
                        let damping = 0.90;

                        // Leader Velocity Inheritance
                        const lvx = ship.leaderRef === State.playerShip ? State.velocity.x : (ship.leaderRef.xv || 0);
                        const lvy = ship.leaderRef === State.playerShip ? State.velocity.y : (ship.leaderRef.yv || 0);

                        // Match leader velocity more aggressively
                        ship.xv += (lvx - ship.xv) * 0.25;
                        ship.yv += (lvy - ship.yv) * 0.25;

                        if (distToTarget < 200) {
                            const factor = distToTarget / 200;
                            force *= factor;
                            damping = 0.90 + (1 - factor) * 0.05;
                        } else if (distToTarget > 500) {
                            // Catch-up mode if very far
                            force *= 1.5;
                        }

                        ship.xv += dx * force;
                        ship.yv += dy * force;

                        // Physical separation from leader
                        const distToLeader = Math.sqrt((ship.x - lx) * (ship.x - lx) + (ship.y - ly) * (ship.y - ly));
                        const minSafeDist = ship.r + (ship.leaderRef.r || 30) + 10;
                        if (distToLeader < minSafeDist) {
                            const ang = Math.atan2(ship.y - ly, ship.x - lx);
                            ship.xv += Math.cos(ang) * 1.5;
                            ship.yv += Math.sin(ang) * 1.5;
                        }

                        // Separation from other State.ships (respect SHIP_CONFIG.SEPARATION_DISTANCE)
                        let sepX = 0;
                        let sepY = 0;
                        let sepCount = 0;

                        for (let other of State.ships) {
                            if (other === ship || other.type !== 'ship') continue;
                            // Separate from same fleet OR friendly State.ships (everyone avoids bumping)
                            const isTeammate = (ship.isFriendly && other.isFriendly) || (ship.fleetHue === other.fleetHue);

                            if (isTeammate) {
                                let dx = ship.x - other.x;
                                let dy = ship.y - other.y;
                                const requiredDist = SHIP_CONFIG.SEPARATION_DISTANCE + (ship.r + other.r) * 0.5; // Ensure padding

                                // Bounding box fast filter before hypot
                                if (Math.abs(dx) < requiredDist && Math.abs(dy) < requiredDist) {
                                    let distToOther = Math.sqrt(dx * dx + dy * dy);
                                    if (distToOther < requiredDist) {
                                        let ang = Math.atan2(dy, dx);
                                        // Stronger separation force (0.05 instead of 0.01) to act as a hard buffer
                                        let force = (requiredDist - distToOther) * 0.08;
                                        sepX += Math.cos(ang) * force;
                                        sepY += Math.sin(ang) * force;
                                        sepCount++;
                                    }
                                }
                            }
                        }

                        if (sepCount > 0) {
                            ship.xv += sepX;
                            ship.yv += sepY;
                        }

                        // Normal rotation logic: friendly State.ships only match rotation when following player
                        // Enemy State.ships and independent friendly State.ships rotate toward movement
                        if (isInVisualSlot) {
                            // Match leader rotation EXACTLY (Imitate)
                            let angleDiff = la - ship.a;
                            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                            while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                            if (Math.abs(angleDiff) < 0.05) ship.a = la;
                            else ship.a += angleDiff * 0.4;
                        } else {
                            // Independent rotation - rotate toward movement direction or threat
                            const moveAngle = Math.atan2(ship.yv, ship.xv);
                            let angleDiff = moveAngle - ship.a;
                            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                            while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                            ship.a += angleDiff * 0.1; // Slower rotation for smoother movement
                        }

                        ship.xv *= damping;
                        ship.yv *= damping;

                    } else {
                        // JOIN LOGIC: Search for a new Leader with open slots
                        // ship.leaderRef is null here
                        let foundLeader = null;
                        let foundSlot = null;
                        const PLAYER_JOIN_RANGE = 1500; // Large range to prioritize following player
                        const NPC_JOIN_RANGE = 300; // Smaller range for npc clumping

                        // 1. CHECK PLAYER FIRST (Priority)
                        if (ship.isFriendly && !State.playerShip.dead && !State.playerShip.loneWolf) {
                            if (State.playerShip.squadSlots) {
                                // Find open slot
                                const openSlot = State.playerShip.squadSlots.find(s => !s.occupant || s.occupant.dead || !State.ships.includes(s.occupant));
                                if (openSlot) {
                                    foundLeader = State.playerShip;
                                    foundSlot = openSlot;
                                }
                            }
                        }

                        // 2. CHECK NPC LEADERS OR STRAYS (If not joined player)
                        if (!foundLeader && !ship.isFriendly) {
                            for (let other of State.ships) {
                                if (other.dead || other === ship || other.type !== 'ship') continue;
                                if (other.fleetHue === ship.fleetHue && !other.isFriendly) {
                                    const dist = Math.sqrt((other.x - ship.x) * (other.x - ship.x) + (other.y - ship.y) * (other.y - ship.y));
                                    if (dist < NPC_JOIN_RANGE) {
                                        if (other.role === 'leader' && other.squadSlots) {
                                            const openSlot = other.squadSlots.find(s => !s.occupant || s.occupant.dead || !State.ships.includes(s.occupant));
                                            if (openSlot) {
                                                foundLeader = other;
                                                foundSlot = openSlot;
                                                break;
                                            }
                                        } else if (!other.leaderRef && other.role !== 'leader' && ship.role !== 'leader') {
                                            // Dynamic Promotion: Both are independent strays. Promote 'other' to leader.
                                            other.role = 'leader';
                                            other.squadId = Math.random();
                                            other.squadSlots = [
                                                { x: -150, y: -150, occupant: null }, { x: 150, y: -150, occupant: null },
                                                { x: -300, y: -300, occupant: null }, { x: 300, y: -300, occupant: null },
                                                { x: -450, y: -450, occupant: null }, { x: 450, y: -450, occupant: null } // 6 slots
                                            ];
                                            foundLeader = other;
                                            foundSlot = other.squadSlots[0];
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        if (foundLeader && foundSlot) {
                            ship.leaderRef = foundLeader;
                            ship.aiState = 'FORMATION';
                            ship.formationOffset = { x: foundSlot.x, y: foundSlot.y };
                            foundSlot.occupant = ship;
                        } else {
                            // BECOME FREE / INDEPENDENT / DEFENDER
                            // Act like a mini-leader (patrol/hunt)
                            proactiveCombatScanner(ship);

                            // Orbit / Defend behavior
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

                            const distToCenter = Math.sqrt((ship.x - patrolCenter.x) * (ship.x - patrolCenter.x) + (ship.y - patrolCenter.y) * (ship.y - patrolCenter.y));
                            const ORBIT_RADIUS = baseRadius > 0 ? (baseRadius * 1.8 + ship.r) : 300;

                            if (distToCenter > ORBIT_RADIUS + 100) {
                                // Move towards orbit radius
                                const angle = Math.atan2(patrolCenter.y - ship.y, patrolCenter.x - ship.x);
                                ship.xv += Math.cos(angle) * 0.5;
                                ship.yv += Math.sin(angle) * 0.5;
                            } else if (distToCenter < ORBIT_RADIUS - 100) {
                                // Move away to orbit radius
                                const angle = Math.atan2(ship.y - patrolCenter.y, ship.x - patrolCenter.x);
                                ship.xv += Math.cos(angle) * 0.5;
                                ship.yv += Math.sin(angle) * 0.5;
                            } else {
                                // Tangential orbit movement
                                const orbitAngle = Math.atan2(ship.y - patrolCenter.y, ship.x - patrolCenter.x);
                                if (!ship.orbitDir) ship.orbitDir = (Math.random() > 0.5 ? 1 : -1);
                                const tangentAngle = orbitAngle + (Math.PI / 2) * ship.orbitDir;
                                ship.xv += Math.cos(tangentAngle) * 0.3;
                                ship.yv += Math.sin(tangentAngle) * 0.3;
                            }

                            // Rotation
                            const moveAngle = Math.atan2(ship.yv, ship.xv);
                            let angleDiff = moveAngle - ship.a;
                            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                            while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
                            ship.a += angleDiff * 0.1;

                            ship.xv *= 0.95;
                            ship.yv *= 0.95;
                        }
                    }
                }
            }
            else if (ship.aiState === 'COMBAT') {
                // Only target alive player, not dead player's position
                let target = null;
                let maxThreatScore = -Infinity;
                let minDistToRival = Infinity;

                // Search for rivals
                for (let other of State.ships) {
                    if (other === ship) continue;

                    let isRival = false;
                    if (ship.isFriendly) {
                        if (!other.isFriendly) isRival = true;
                    } else {
                        // Enemy State.ships target different fleets AND friendly State.ships
                        if (other.isFriendly || other.fleetHue !== ship.fleetHue) isRival = true;
                    }

                    if (isRival && (other.type === 'ship' || other.type === 'station')) {
                        let d = Math.sqrt((other.x - ship.x) * (other.x - ship.x) + (other.y - ship.y) * (other.y - ship.y));

                        if (d < 3000) { // Max aggro range
                            // Tweak threat score heuristics
                            let threatScore = 3000 - d; // Closer is better

                            // Station priority down if there are ships closer
                            if (other.type === 'station') {
                                threatScore -= 1000;
                            }

                            // Highly prioritize the player if player is shooting or very close
                            if (other === State.playerShip) {
                                if (d < 1500) threatScore += 500;
                            }

                            if (threatScore > maxThreatScore) {
                                maxThreatScore = threatScore;
                                target = other;
                                target.isRival = true;
                                minDistToRival = d;
                            }
                        }
                    }
                }

                if (!target) {
                    // No target? Return to formation or stay put
                    ship.aiState = 'FORMATION';
                    continue;
                }

                let tx = target.x;
                let ty = target.y;
                let d = minDistToRival;

                let targetAngle = Math.atan2(ty - ship.y, tx - ship.x);

                // Friendly squad State.ships point the same way as player
                if (ship.isFriendly && ship.role !== 'leader' && ship.leaderRef === State.playerShip) {
                    targetAngle = State.playerShip.a;
                }

                let angleDiff = targetAngle - ship.a;
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;

                // Smoother elegant rotation (Reduced from 0.1 to 0.04)
                ship.a += angleDiff * 0.04;

                // 1. Radial Force (Push/Pull) - Proportional smooth spring
                // Instead of hard ±0.8, we scale by distance diff
                const distError = d - SHIP_CONFIG.COMBAT_ORBIT_DISTANCE;
                // If positive (too far), pull in. If negative (too close), push out.
                const radialForce = distError * 0.002; // Small spring constant

                ship.xv += Math.cos(targetAngle) * radialForce;
                ship.yv += Math.sin(targetAngle) * radialForce;

                // 2. Tangential Force (Strafe/Orbit)
                const orbitDir = (ship.squadId && ship.squadId > 0.5) ? 1 : -1;
                const orbAngle = targetAngle + (Math.PI / 2 * orbitDir);

                ship.xv += Math.cos(orbAngle) * 0.08; // Slower (Reduced from 0.20)
                ship.yv += Math.sin(orbAngle) * 0.08;

                // 3. Separation Logic (Avoid bunching up)
                let sepX = 0;
                let sepY = 0;
                let count = 0;

                for (let other of State.ships) {
                    if (other === ship || other.type !== 'ship') continue;
                    // Simple distance check
                    let distToOther = Math.sqrt((ship.x - other.x) * (ship.x - other.x) + (ship.y - other.y) * (ship.y - other.y));
                    if (distToOther < SHIP_CONFIG.SEPARATION_DISTANCE) {
                        // Push away relative to other
                        let ang = Math.atan2(ship.y - other.y, ship.x - other.x);
                        // Force stronger the closer they are
                        let force = (SHIP_CONFIG.SEPARATION_DISTANCE - distToOther) * 0.01;
                        sepX += Math.cos(ang) * force;
                        sepY += Math.sin(ang) * force;
                        count++;
                    }
                }

                if (count > 0) {
                    ship.xv += sepX;
                    ship.yv += sepY;
                }

                // Drag for control (slightly stronger to dampen spring effects)
                ship.xv *= 0.96;
                ship.yv *= 0.96;

                let currentSpeed = Math.sqrt((ship.xv) * (ship.xv) + (ship.yv) * (ship.yv));
                if (currentSpeed > (ship.tier >= 12 ? SHIP_CONFIG.MAX_SPEED * 2 : SHIP_CONFIG.MAX_SPEED)) {
                    let scale = (ship.tier >= 12 ? SHIP_CONFIG.MAX_SPEED * 2 : SHIP_CONFIG.MAX_SPEED) / currentSpeed;
                    ship.xv *= scale;
                    ship.yv *= scale;
                }

                // Shoot if lined up (slightly wider angle for smoother shooting feel)
                if (ship.reloadTime <= 0 && Math.abs(angleDiff) < 0.4) {
                    const bullets = ship.isFriendly ? State.playerShipBullets : State.enemyShipBullets;
                    fireEntityWeapon(ship, bullets, !ship.isFriendly);
                    ship.reloadTime = 30 + Math.random() * 50;
                }

                // Also shoot at nearby asteroids while in combat
                if (ship.reloadTime <= 0) {
                    let combatThreats = spatialGrid.query(ship);
                    for (let r of combatThreats) {
                        if (r.z > 0.5 || r.isPlanet) continue;
                        const distToRoid = Math.sqrt((r.x - ship.x) * (r.x - ship.x) + (r.y - ship.y) * (r.y - ship.y));
                        if (distToRoid < 1000) {
                            const roidAngle = Math.atan2(r.y - ship.y, r.x - ship.x);
                            let roidAngleDiff = roidAngle - ship.a;
                            while (roidAngleDiff > Math.PI) roidAngleDiff -= 2 * Math.PI;
                            while (roidAngleDiff <= -Math.PI) roidAngleDiff += 2 * Math.PI;
                            if (Math.abs(roidAngleDiff) < 0.5) {
                                const bullets = ship.isFriendly ? State.playerShipBullets : State.enemyShipBullets;
                                fireEntityWeapon(ship, bullets, !ship.isFriendly);
                                ship.reloadTime = 30 + Math.random() * 50;
                                break;
                            }
                        }
                    }
                }
            }

            // UNIVERSAL EVASION FOR ALL SHIPS
            applyEvasionForces(ship);

            ship.reloadTime--;
        }

        // Collisions
        if (!State.playerShip.dead && (!ship.z || ship.z < 0.5)) {
            let distToPlayer = Math.sqrt((State.worldOffsetX - ship.x) * (State.worldOffsetX - ship.x) + (State.worldOffsetY - ship.y) * (State.worldOffsetY - ship.y));
            let collisionThreshold = (State.playerShip.effectiveR || State.playerShip.r) + ship.r + 10;
            if (distToPlayer < collisionThreshold) {
                if (ship.isFriendly) {
                    shipsToDraw.push(ship);
                    continue; // Skip collision response but keep alive
                }

                if (ship.structureHP > 0) {
                    ship.structureHP--;
                    ship.shieldHitTimer = 10;
                    createExplosion(vpX, vpY, 20, '#ff0055', 2, 'spark');
                    if (State.playerShip.tier < 12) {
                        hitPlayerShip(1);
                    }
                    AudioEngine.playSoftThud(ship.x, ship.y, ship.z);
                    let ang = Math.atan2(ship.y - State.worldOffsetY, ship.x - State.worldOffsetX);
                    ship.x += Math.cos(ang) * 60; ship.y += Math.sin(ang) * 60;
                } else {
                    State.ships.splice(i, 1); i--;
                    AudioEngine.playExplosion('large', ship.x, ship.y, ship.z);
                    continue; // Ship is gone, don't draw
                }

                if (ship.structureHP <= 0) {
                    let debrisColor = ship.type === 'station' ? `hsl(${ship.fleetHue}, 100%, 50%)` : `hsl(${ship.fleetHue}, 100%, 40%)`;
                    createExplosion(vpX, vpY, 40, '#ffaa00', 3, 'spark'); createExplosion(vpX, vpY, 20, debrisColor, 4, 'debris');
                    if (ship.type === 'station') { onStationDestroyed(ship, State.playerShip); }
                    else { onShipDestroyed(ship, State.playerShip); }
                    State.ships.splice(i, 1); i--; AudioEngine.playExplosion('large', ship.x, ship.y, ship.z);
                    continue; // Ship is gone, don't draw
                }
            }
        }

        shipsToDraw.push(ship);

    }
    // --- End Enemy Update/AI ---

    DOM.canvasContext.shadowColor = '#ffffff';
    DOM.canvasContext.shadowBlur = 0;
    DOM.canvasContext.lineWidth = 1;


    // Sort asteroids from Near to Far (Small Z to Large Z) with safety
    State.roids.sort((a, b) => {
        const za = (isNaN(a.z) || !isFinite(a.z)) ? 0 : a.z;
        const zb = (isNaN(b.z) || !isFinite(b.z)) ? 0 : b.z;
        return za - zb;
    });

    // --- Asteroid/Planet DRAWING (Order 1: Behind State.ships) ---
    for (let i = State.roids.length - 1; i >= 0; i--) {
        let r = State.roids[i];

        // GOD RING VAPORIZATION
        if (r.r <= 0 || r.vaporized) {
            let vpX = (r.x - State.worldOffsetX) + State.width / 2;
            let vpY = (r.y - State.worldOffsetY) + State.height / 2;
            createExplosion(vpX, vpY, r.isPlanet ? 200 : 40, '#00ffff', r.isPlanet ? 15 : 4, 'spark');
            if (r.isPlanet) {
                const planetsBefore = State.roids.filter(plan => plan.isPlanet && !plan._destroyed).length;
                if (State.gameRunning) console.log("Count: " + (planetsBefore - 1) + ". Planet " + r.name + " destroyed.");
                PLANET_CONFIG.LIMIT = Math.max(0, PLANET_CONFIG.LIMIT - 1);
            }
            State.roids.splice(i, 1);
            if (!r.isPlanet) updateAsteroidCounter();
            AudioEngine.playExplosion(r.isPlanet ? 'large' : 'small', r.x, r.y, r.z);
            continue;
        }

        if (r.isPlanet) {
            if (r.isPlanet) {
                // Steering and Max Speed logic REMOVED to allow smooth orbital movement
            }
        }

        // Natural movement - no minimum speed enforcement for smoother physics

        let depthScale = 1; let depthAlpha = 1;

        // 1. Update Absolute World Position (World Coords)
        r.x += r.xv; r.y += r.yv;

        // 2. Calculate Parallax and Viewport Position
        let vpX, vpY;
        let depthBrightness = 1;

        if (r.isPlanet) {
            // Parallax is applied to the viewport position calculation only
            depthScale = 1 / (1 + r.z);
            // Planets darken instead of becoming transparent in the distance
            depthBrightness = Math.max(0.1, 1 - (r.z / MAX_Z_DEPTH));
            depthAlpha = 1;

            vpX = (r.x - State.worldOffsetX) * depthScale + State.width / 2;
            vpY = (r.y - State.worldOffsetY) * depthScale + State.height / 2;
        } else {
            // Standard asteroid: 1:1 scale
            vpX = r.x - State.worldOffsetX + State.width / 2;
            vpY = r.y - State.worldOffsetY + State.height / 2;
        }

        // FRUSTUM CULLING FOR ASTEROIDS AND PLANETS
        const pad = Math.max(r.r * depthScale + 150, 200);
        const onScreen = vpX > -pad && vpX < State.width + pad && vpY > -pad && vpY < State.height + pad;

        if (onScreen) {
            // Apply transformations for depth
            DOM.canvasContext.save();
            DOM.canvasContext.translate(vpX, vpY); // Translate to Viewport Position
            DOM.canvasContext.scale(depthScale, depthScale);

            // Apply calculated depth alpha / brightness
            DOM.canvasContext.globalAlpha = depthAlpha;
            if (r.isPlanet && depthBrightness < 1) {
                DOM.canvasContext.filter = `brightness(${depthBrightness})`;
            }

            // Draw asteroid blinking if newly created
            if (r.blinkNum % 2 !== 0) { DOM.canvasContext.globalAlpha *= 0.3; }


            if (r.isPlanet) {

                // === DRAW PLANET RINGS (BACK HALF) ===
                if (r.rings) {
                    drawRings(DOM.canvasContext, r.rings, r.r, depthScale);
                }

                // Draw planet texture and name
                drawPlanetTexture(DOM.canvasContext, 0, 0, r.r, r.textureData);

                // === DRAW PLANET RINGS (FRONT HALF) ===
                if (r.rings) {
                    DOM.canvasContext.save();
                    DOM.canvasContext.rotate(r.rings.tilt);
                    r.rings.bands.forEach(band => {
                        const bandRadius = r.r * band.rRatio;
                        const bandWidth = r.r * band.wRatio;
                        const outerRadius = bandRadius * depthScale;

                        DOM.canvasContext.lineWidth = bandWidth * depthScale;
                        DOM.canvasContext.strokeStyle = band.color;
                        DOM.canvasContext.globalAlpha = band.alpha * depthAlpha;
                        DOM.canvasContext.shadowBlur = 0;

                        DOM.canvasContext.beginPath();
                        DOM.canvasContext.ellipse(0, 0, outerRadius, outerRadius * 0.15, 0, Math.PI, Math.PI * 2, false);
                        DOM.canvasContext.stroke();
                    });
                    DOM.canvasContext.restore();
                }

                // Draw Name
                DOM.canvasContext.globalAlpha = depthAlpha;
                DOM.canvasContext.fillStyle = 'white';
                DOM.canvasContext.font = `bold ${28 / depthScale}px Courier New`;
                DOM.canvasContext.textAlign = 'center';

                DOM.canvasContext.fillText(r.name, 0, r.r + (40 / depthScale));

            } else {
                // Draw standard asteroid shape
                if (r.isHot) {
                    DOM.canvasContext.shadowBlur = 20;
                    DOM.canvasContext.shadowColor = '#ff6600';
                    DOM.canvasContext.strokeStyle = '#ffcc00';
                } else {
                    DOM.canvasContext.shadowBlur = 0; // Optimization: Disable blur for standard asteroids
                }

                DOM.canvasContext.fillStyle = r.color; // Dark gray base fill
                DOM.canvasContext.beginPath();
                for (let j = 0; j < r.vert; j++) {
                    const px = r.r * r.offs[j] * Math.cos(r.a + j * Math.PI * 2 / r.vert);
                    const py = r.r * r.offs[j] * Math.sin(r.a + j * Math.PI * 2 / r.vert);
                    if (j === 0) DOM.canvasContext.moveTo(px, py); else DOM.canvasContext.lineTo(px, py);
                }
                DOM.canvasContext.closePath();
                DOM.canvasContext.fill();

                // Dynamic volumetric shadow based on global light source
                const dx = GLOBAL_LIGHT.X - r.x;
                const dy = GLOBAL_LIGHT.Y - r.y;
                const lDist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const lDirX = dx / lDist;
                const lDirY = dy / lDist;

                let shadowGrad = DOM.canvasContext.createLinearGradient(
                    lDirX * r.r, lDirY * r.r, // Bright side facing light
                    -lDirX * r.r, -lDirY * r.r // Dark side away from light
                );
                shadowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.15)'); // Soft highlight on light side
                shadowGrad.addColorStop(0.4, 'rgba(0, 0, 0, 0)');        // Transparent mid
                shadowGrad.addColorStop(0.8, 'rgba(0, 0, 0, 1.0)');      // Pitch black on dark side
                DOM.canvasContext.fillStyle = shadowGrad;
                DOM.canvasContext.fill();

                // Draw Craters (Only on larger asteroids, and only on half of them for performance/variety)
                if (r.r >= ASTEROID_CONFIG.MIN_SIZE * 1.5 && r.id % 2 === 0) {
                    DOM.canvasContext.fillStyle = 'rgba(0, 0, 0, 0.4)';
                    DOM.canvasContext.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                    DOM.canvasContext.lineWidth = 1;
                    // Deterministic pseudo-random generation to keep craters bound to specific asteroid ID
                    const craterCount = 2 + (r.id % 3);
                    for (let c = 0; c < craterCount; c++) {
                        let pseudoRand1 = ((r.id * 13 + c * 29) % 100) / 100;
                        let pseudoRand2 = ((r.id * 17 + c * 31) % 100) / 100;
                        let pseudoRand3 = ((r.id * 19 + c * 37) % 100) / 100;

                        let dist = r.r * 0.5 * pseudoRand1;
                        let angle = pseudoRand2 * Math.PI * 2 + r.a; // Revolve with asteroid rotation
                        let crx = Math.cos(angle) * dist;
                        let cry = Math.sin(angle) * dist;
                        let crr = r.r * 0.08 + (pseudoRand3 * r.r * 0.15); // Scale crater size relative to asteroid

                        DOM.canvasContext.beginPath();
                        // Perspective crater ellipse orienting towards center
                        DOM.canvasContext.ellipse(crx, cry, crr, crr * 0.85, angle, 0, Math.PI * 2);
                        DOM.canvasContext.fill();
                        DOM.canvasContext.stroke();
                    }
                }

                // Draw lava veins if hot
                if (r.isHot) {
                    DOM.canvasContext.globalAlpha = 0.6;
                    DOM.canvasContext.strokeStyle = '#ff3300';
                    DOM.canvasContext.lineWidth = 2;
                    DOM.canvasContext.beginPath();
                    for (let j = 0; j < r.vert; j += 2) {
                        const px = r.r * 0.5 * r.offs[j] * Math.cos(r.a + j * Math.PI * 2 / r.vert);
                        const py = r.r * 0.5 * r.offs[j] * Math.sin(r.a + j * Math.PI * 2 / r.vert);
                        if (j === 0) DOM.canvasContext.moveTo(px, py); else DOM.canvasContext.lineTo(px, py);
                    }
                    DOM.canvasContext.stroke();
                    DOM.canvasContext.globalAlpha = 1;
                }
            }
            DOM.canvasContext.restore(); // Restore context
        } // End onScreen check

        // Check collision with player (World Coords)
        if (r.z < 0.5 && !State.playerShip.dead) {
            let distToPlayer = Math.sqrt((r.x - State.worldOffsetX) * (r.x - State.worldOffsetX) + (r.y - State.worldOffsetY) * (r.y - State.worldOffsetY));
            if (distToPlayer < (State.playerShip.effectiveR || State.playerShip.r) + r.r * depthScale) {

                const isNearPlanetCollision = r.isPlanet && r.z < 0.5;

                // Go through planets.
                if (r.isPlanet) {
                    continue;
                }

                // ASTEROID COLLISION: Player takes 1 hit, asteroid is destroyed.
                if (r.blinkNum === 0) {
                    if (State.playerShip.tier < 12) {
                        hitPlayerShip(1, isNearPlanetCollision);
                    }
                    AudioEngine.playSoftThud(r.x, r.y, r.z);

                    // Create explosions
                    createExplosion(vpX, vpY, 15, '#0ff', 2, 'spark');
                    createExplosion(vpX, vpY, 8, '#fff', 1, 'debris');

                    const newSize = r.r * 0.5;
                    if (newSize >= ASTEROID_CONFIG.MIN_SIZE) {
                        const dynamicOffset = r.r * (ASTEROID_CONFIG.SPLIT_OFFSET / ASTEROID_CONFIG.MAX_SIZE);
                        // West asteroid
                        let westAst = createAsteroid(r.x - dynamicOffset, r.y, newSize);
                        westAst.xv = r.xv - ASTEROID_CONFIG.MAX_SPEED;
                        westAst.yv = r.yv;
                        westAst.blinkNum = 30;
                        State.roids.push(westAst);

                        // East asteroid
                        let eastAst = createAsteroid(r.x + dynamicOffset, r.y, newSize);
                        eastAst.xv = r.xv + ASTEROID_CONFIG.MAX_SPEED;
                        eastAst.yv = r.yv;
                        eastAst.blinkNum = 30;
                        State.roids.push(eastAst);
                        updateAsteroidCounter();
                    }

                    if (State.playerShip.tier >= 12) increaseShipScore(State.playerShip, SCORE_REWARDS.ASTEROID_DESTROYED);
                    State.roids.splice(i, 1);
                    updateAsteroidCounter();

                    let ang = Math.atan2(r.y - State.worldOffsetY, r.x - State.worldOffsetX); // World Angle
                    r.x += Math.cos(ang) * 50; r.y += Math.sin(ang) * 50; // Knockback in World Coords (though it's removed next frame)
                }
            }
        }
    }
    // --- End Asteroid Drawing ---

    // --- Enemy DRAWING (Order 2: In Front of Planets) ---
    shipsToDraw.forEach(shipToDraw => {
        let depthScale = 1; let depthAlpha = 1;
        if (shipToDraw.z > 0) {
            depthScale = 1 / (1 + shipToDraw.z);
            depthAlpha = Math.max(0.1, 1 - (shipToDraw.z / MAX_Z_DEPTH));
        }

        const vpX = (shipToDraw.x - State.worldOffsetX) * depthScale + State.width / 2;
        const vpY = (shipToDraw.y - State.worldOffsetY) * depthScale + State.height / 2;

        if (shipToDraw.shieldHitTimer > 0) {
            shipToDraw.shieldHitTimer--;
        }

        // FRUSTUM CULLING FOR SHIPS
        const pad = Math.max((shipToDraw.r || 50) * depthScale + 150, 200);
        const onScreen = vpX > -pad && vpX < State.width + pad && vpY > -pad && vpY < State.height + pad;

        if (onScreen) {
            // Drawing enemy
            DOM.canvasContext.shadowBlur = 15;

            // Proximity fading for friends
            let alpha = depthAlpha;
            if (shipToDraw.isFriendly) {
                const distToPlayer = Math.sqrt((State.worldOffsetX - shipToDraw.x) * (State.worldOffsetX - shipToDraw.x) + (State.worldOffsetY - shipToDraw.y) * (State.worldOffsetY - shipToDraw.y));
                const fadeStart = 300;
                const fadeEnd = 50;
                if (distToPlayer < fadeStart) {
                    const ratio = Math.max(0, (distToPlayer - fadeEnd) / (fadeStart - fadeEnd));
                    alpha *= 0.4 + 0.6 * ratio; // Fades to 40% alpha (more visible)
                }
            }

            // If blinking, reduce opacity (for invulnerability feedback)
            if (shipToDraw.blinkNum % 2 !== 0) { DOM.canvasContext.globalAlpha = 0.5; }
            else { DOM.canvasContext.globalAlpha = alpha; } // Apply fading/depth alpha

            DOM.canvasContext.save();
            DOM.canvasContext.translate(vpX, vpY); // Translate to Viewport Position
            DOM.canvasContext.scale(depthScale, depthScale); // Apply depth scaling
            DOM.canvasContext.rotate(shipToDraw.a); // Standard rotation (CW positive)

            if (shipToDraw.type === 'ship') {

                // Individual evolution: State.ships match their OWN score visuals
                const tier = Math.floor((shipToDraw.score || 0) / SHIP_CONFIG.EVOLUTION_SCORE_STEP);
                const r = shipToDraw.r;

                // Generate Palette based on fleetHue (Host Planet)
                const HULL_COLOR = `hsl(${shipToDraw.fleetHue}, 60%, 30%)`;
                const HULL_BORDER = `hsl(${shipToDraw.fleetHue}, 40%, 50%)`; // Lighter border
                const DETAIL_COLOR = `hsl(${shipToDraw.fleetHue}, 80%, 60%)`;
                const ACCENT_COLOR = `hsl(${(shipToDraw.fleetHue + 180) % 360}, 90%, 60%)`; // Complementary accent
                const THRUST_COLOR = `hsl(${shipToDraw.fleetHue}, 100%, 70%)`;
                const COCKPIT_GRAD_1 = `hsl(${shipToDraw.fleetHue}, 100%, 80%)`;
                const COCKPIT_GRAD_2 = `hsl(${shipToDraw.fleetHue}, 100%, 50%)`;

                // Draw generic shapes using standard function
                drawShipShape({
                    ctx: DOM.canvasContext,
                    r: r,
                    tier: tier,
                    hullColor: HULL_COLOR,
                    borderColor: HULL_BORDER,
                    detailColor: DETAIL_COLOR,
                    accentColor: ACCENT_COLOR,
                    thrustColor: THRUST_COLOR,
                    isThrusting: true, // Always slightly thrusting for effect
                    cockpitGrad1: COCKPIT_GRAD_1,
                    cockpitGrad2: COCKPIT_GRAD_2
                });



                DOM.canvasContext.shadowBlur = 0;
                // DRAW HEART FOR FRIENDS
                if (shipToDraw.isFriendly) {
                    drawHeart(DOM.canvasContext, 0, -5, 8);
                }
            }
            else {
                // MODERN HEXAGONAL STATION DESIGN
                // Sleek geometric station with glowing energy rings and pulsing core

                const haloColor = `hsl(${shipToDraw.fleetHue}, 100%, 70%)`;
                const bodyColor = `hsl(${shipToDraw.fleetHue}, 80%, 50%)`;
                const coreColor = `hsl(${(shipToDraw.fleetHue + 120) % 360}, 100%, 60%)`;
                const accentColor = `hsl(${shipToDraw.fleetHue}, 90%, 65%)`;

                const stationR = shipToDraw.r;

                // === OUTER HEXAGONAL STRUCTURE ===
                DOM.canvasContext.shadowBlur = 25;
                DOM.canvasContext.shadowColor = haloColor;

                // Draw hexagon
                DOM.canvasContext.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI / 3) + shipToDraw.a;
                    const x = Math.cos(angle) * stationR * 1.1;
                    const y = Math.sin(angle) * stationR * 1.1;
                    if (i === 0) DOM.canvasContext.moveTo(x, y);
                    else DOM.canvasContext.lineTo(x, y);
                }
                DOM.canvasContext.closePath();

                // Hexagon fill with gradient
                let hexGrad = DOM.canvasContext.createRadialGradient(0, 0, 0, 0, 0, stationR * 1.1);
                hexGrad.addColorStop(0, `hsl(${shipToDraw.fleetHue}, 60%, 40%)`);
                hexGrad.addColorStop(0.7, `hsl(${shipToDraw.fleetHue}, 70%, 25%)`);
                hexGrad.addColorStop(1, `hsl(${shipToDraw.fleetHue}, 50%, 15%)`);

                DOM.canvasContext.fillStyle = hexGrad;
                DOM.canvasContext.fill();

                // Glowing hexagon outline
                DOM.canvasContext.lineWidth = 4;
                DOM.canvasContext.strokeStyle = haloColor;
                DOM.canvasContext.stroke();

                // === ROTATING ENERGY RINGS ===
                DOM.canvasContext.shadowBlur = 20;

                // Outer ring
                DOM.canvasContext.lineWidth = 3;
                DOM.canvasContext.strokeStyle = accentColor;
                DOM.canvasContext.beginPath();
                DOM.canvasContext.arc(0, 0, stationR * 0.9, 0, Math.PI * 2);
                DOM.canvasContext.stroke();

                // Middle ring (slightly rotated)
                DOM.canvasContext.lineWidth = 2;
                DOM.canvasContext.strokeStyle = bodyColor;
                DOM.canvasContext.beginPath();
                DOM.canvasContext.arc(0, 0, stationR * 0.7, 0, Math.PI * 2);
                DOM.canvasContext.stroke();

                // === CONNECTING SPOKES (6 spokes to match hexagon) ===
                DOM.canvasContext.shadowBlur = 15;
                DOM.canvasContext.lineWidth = 2;
                DOM.canvasContext.strokeStyle = accentColor;

                for (let k = 0; k < 6; k++) {
                    const angle = (k * Math.PI / 3) + shipToDraw.a;
                    const rInner = stationR * 0.4;
                    const rOuter = stationR * 0.95;

                    DOM.canvasContext.beginPath();
                    DOM.canvasContext.moveTo(Math.cos(angle) * rInner, Math.sin(angle) * rInner);
                    DOM.canvasContext.lineTo(Math.cos(angle) * rOuter, Math.sin(angle) * rOuter);
                    DOM.canvasContext.stroke();

                    // Small nodes at spoke ends
                    DOM.canvasContext.fillStyle = haloColor;
                    DOM.canvasContext.beginPath();
                    DOM.canvasContext.arc(Math.cos(angle) * rOuter, Math.sin(angle) * rOuter, stationR * 0.06, 0, Math.PI * 2);
                    DOM.canvasContext.fill();
                }

                // === PULSING CORE ===
                DOM.canvasContext.shadowBlur = 30;
                DOM.canvasContext.shadowColor = coreColor;

                // Pulsing effect
                const pulsePhase = (Date.now() % 2000) / 2000; // 0 to 1 over 2 seconds
                const pulseSize = 0.3 + Math.sin(pulsePhase * Math.PI * 2) * 0.05;

                // Core gradient
                let coreGrad = DOM.canvasContext.createRadialGradient(0, 0, 0, 0, 0, stationR * pulseSize);
                coreGrad.addColorStop(0, '#ffffff');
                coreGrad.addColorStop(0.3, coreColor);
                coreGrad.addColorStop(1, bodyColor);

                DOM.canvasContext.fillStyle = coreGrad;
                DOM.canvasContext.beginPath();
                DOM.canvasContext.arc(0, 0, stationR * pulseSize, 0, Math.PI * 2);
                DOM.canvasContext.fill();

                // Core bright outline
                DOM.canvasContext.strokeStyle = '#ffffff';
                DOM.canvasContext.lineWidth = 2;
                DOM.canvasContext.stroke();

                // === ENERGY PARTICLES (Small glowing dots around the station) ===
                DOM.canvasContext.shadowBlur = 10;
                for (let p = 0; p < 8; p++) {
                    const particleAngle = (p * Math.PI / 4) + (Date.now() / 1000) + shipToDraw.a;
                    const particleR = stationR * (0.8 + Math.sin((Date.now() / 500) + p) * 0.1);
                    const px = Math.cos(particleAngle) * particleR;
                    const py = Math.sin(particleAngle) * particleR;

                    DOM.canvasContext.fillStyle = `hsla(${shipToDraw.fleetHue}, 100%, 80%, ${0.6 + Math.random() * 0.4})`;
                    DOM.canvasContext.beginPath();
                    DOM.canvasContext.arc(px, py, stationR * 0.03, 0, Math.PI * 2);
                    DOM.canvasContext.fill();
                }

                DOM.canvasContext.shadowBlur = 0;

                // DRAW HEART FOR FRIENDLY STATIONS
                if (shipToDraw.isFriendly) {
                    drawHeart(DOM.canvasContext, 0, -shipToDraw.r * 0.1, shipToDraw.r * 0.2);
                }
            }

            DOM.canvasContext.restore();
            DOM.canvasContext.globalAlpha = 1;

            let currentHP = shipToDraw.structureHP;
            let maxHP = shipToDraw.type === 'station' ? STATION_CONFIG.RESISTANCE : SHIP_CONFIG.RESISTANCE;
            let shieldOpacity = 0;
            let r, g, b;

            if (currentHP === maxHP) {
                r = 0; g = 255; b = 255; // Cian
                shieldOpacity = 0.8;
            } else {
                shieldOpacity = 0;
            }

            if (shipToDraw.type === 'station') {
                // Shield is invisible when at far Z
                if (shipToDraw.z >= 0.5) {
                    return;
                }
                if (currentHP >= STATION_CONFIG.RESISTANCE * 2 / 3) { // Phase 1: Green/Blue - High Shield
                    r = 0; g = 255; b = 255; // Cian
                    shieldOpacity = 1.0;
                } else if (currentHP >= STATION_CONFIG.RESISTANCE / 2) { // Phase 2: Yellow/Orange - Mid Shield/Warning
                    r = 255; g = 165; b = 0;
                    shieldOpacity = 0.7;
                } else { // Phase 3: Red - Critical Structure
                    r = 255; g = 0; b = 0;
                    shieldOpacity = 0.5;
                }
            }

            DOM.canvasContext.lineWidth = 2;
            if (shieldOpacity > 0) {
                if (shipToDraw.shieldHitTimer > 0) {
                    DOM.canvasContext.shadowColor = '#fff';
                    DOM.canvasContext.strokeStyle = `rgba(255,255,255,${shieldOpacity})`;
                }
                else {
                    DOM.canvasContext.shadowColor = `rgb(${r},${g},${b})`;
                    DOM.canvasContext.strokeStyle = `rgba(${r},${g},${b},${shieldOpacity})`;
                }
                DOM.canvasContext.beginPath(); DOM.canvasContext.arc(vpX, vpY, shipToDraw.r + 10, 0, Math.PI * 2); DOM.canvasContext.stroke();
            }
        } // End onScreen check
    });

    DOM.canvasContext.shadowBlur = 10; DOM.canvasContext.lineCap = 'round'; DOM.canvasContext.lineJoin = 'round'; DOM.canvasContext.globalAlpha = 1;

    if (!State.playerShip.dead) {
        DOM.canvasContext.save(); // PUSH 1: Isolate entire player ship rendering block

        // Regeneration is now solely for visual/Tesla effect, as structureHP manages hits
        if (State.playerShip.shield < State.playerShip.maxShield) State.playerShip.shield += 0.05;

        let isTesla = State.playerShip.maxShield > SHIP_CONFIG.BASE_MAX_SHIELD;

        const tier = State.playerShip.tier;

        const BASE_SHIP_RADIUS = SHIP_CONFIG.SIZE / 2;
        const MAX_TIER_RADIUS = BASE_SHIP_RADIUS + (7 * 2); // Tier 7 size
        if (tier >= 8) State.playerShip.effectiveR = MAX_TIER_RADIUS;
        else State.playerShip.effectiveR = BASE_SHIP_RADIUS + (tier * 2);

        const centerX = State.width / 2; const centerY = State.height / 2;
        const r = State.playerShip.effectiveR;

        if (State.playerShip.blinkNum % 2 === 0) { // Invulnerability blink effect

            let shieldAlpha = 0;
            let strokeWidth = 1;
            let shieldRadius = State.playerShip.effectiveR + 10;

            const EPIC_SHIELD_FACTOR = 1.7;

            if (tier >= 8) {
                shieldRadius = State.playerShip.effectiveR * EPIC_SHIELD_FACTOR;
            }

            if (State.playerShip.structureHP === SHIP_CONFIG.RESISTANCE) {
                shieldAlpha = isTesla ? (0.5 + Math.random() * 0.2) : 0.5;
                strokeWidth = isTesla ? 1.5 : 1;
            }

            if (shieldAlpha > 0) {

                DOM.canvasContext.lineWidth = strokeWidth;

                let baseColor, shadowColor;

                if (State.playerShip.structureHP <= SHIP_CONFIG.RESISTANCE && tier < 8) {
                    baseColor = '#0ff'; shadowColor = 'rgba(0, 255, 255, 0.7)';
                } else if (State.playerShip.structureHP >= 7) {
                    baseColor = '#0ff'; shadowColor = 'rgba(0, 255, 255, 0.7)';
                } else if (State.playerShip.structureHP >= 4) {
                    baseColor = '#ffaa00'; shadowColor = 'rgba(255, 170, 0, 0.7)';
                } else {
                    baseColor = '#0ff'; shadowColor = 'rgba(0, 255, 255, 0.7)';
                }

                DOM.canvasContext.shadowColor = shadowColor;
                DOM.canvasContext.strokeStyle = `rgba(0, 255, 255, ${shieldAlpha})`;

                DOM.canvasContext.beginPath();
                DOM.canvasContext.arc(centerX, centerY, shieldRadius, 0, Math.PI * 2);
                DOM.canvasContext.stroke();
            }

            DOM.canvasContext.save();
            DOM.canvasContext.translate(centerX, centerY);
            DOM.canvasContext.rotate(State.playerShip.a);

            DOM.canvasContext.globalAlpha = 1;

            // --- Drawing logic for Ship Tiers ---
            const PLAYER_HUE = SHIP_CONFIG.FRIENDLY_BLUE_HUE; // 210 (cyan/blue)

            let norm = 1.0;
            let transformationProgress = 1.0;

            if (tier >= 12) {
                norm = 1.2;
                if (State.playerShip && State.playerShip.transformationTimer > 0) {
                    transformationProgress = 1 - (State.playerShip.transformationTimer / 600);
                    norm = 1.0 + (norm - 1.0) * transformationProgress;
                }
            }

            // Player Blue Theme
            const HULL_COLOR = `hsl(${PLAYER_HUE}, 60%, 20%)`;
            const BORDER_COLOR = `hsl(${PLAYER_HUE}, 100%, 70%)`;
            const DETAIL_COLOR = `hsl(${PLAYER_HUE}, 100%, 60%)`;
            const ACCENT_COLOR = `hsl(${(PLAYER_HUE + 180) % 360}, 90%, 60%)`;
            const THRUST_COLOR = `#ffaa00`; // Orange thrust for player
            const COCKPIT_GRAD_1 = `hsl(${PLAYER_HUE}, 100%, 80%)`;
            const COCKPIT_GRAD_2 = `hsl(${PLAYER_HUE}, 100%, 50%)`;

            drawShipShape({
                ctx: DOM.canvasContext,
                r: r,
                tier: tier,
                norm: norm,
                transformationProgress: transformationProgress,
                hullColor: HULL_COLOR,
                borderColor: BORDER_COLOR,
                detailColor: DETAIL_COLOR,
                accentColor: ACCENT_COLOR,
                thrustColor: THRUST_COLOR,
                isThrusting: State.playerShip.thrusting,
                cockpitGrad1: COCKPIT_GRAD_1,
                cockpitGrad2: COCKPIT_GRAD_2
            });
        }
        DOM.canvasContext.restore();
    }
    if (State.playerShip.blinkNum > 0) State.playerShip.blinkNum--;
    DOM.canvasContext.restore(); // POP 1: Restore state after ship block

    DOM.canvasContext.shadowColor = '#ff0000'; DOM.canvasContext.fillStyle = '#ff0000';
    for (let i = State.enemyShipBullets.length - 1; i >= 0; i--) {
        let enemyShipBullet = State.enemyShipBullets[i];

        // Optimized Gravity (World Coords)
        if (!enemyShipBullet.ignoreGravity) {
            for (let r of activePlanets) {
                if (r.z < 0.5) {
                    const dx = r.x - enemyShipBullet.x;
                    const dy = r.y - enemyShipBullet.y;
                    const reach = r.r * 8;

                    // FAST PRE-CHECK (Bounding Box)
                    if (Math.abs(dx) < reach && Math.abs(dy) < reach) {
                        const distSq = dx * dx + dy * dy;
                        if (distSq < reach * reach && distSq > 100) {
                            const dist = Math.sqrt(distSq);
                            const force = (G_CONST * r.mass) / distSq;
                            enemyShipBullet.xv += (dx / dist) * force * SHIP_CONFIG.BULLET_GRAVITY_FACTOR;
                            enemyShipBullet.yv += (dy / dist) * force * SHIP_CONFIG.BULLET_GRAVITY_FACTOR;
                        }
                    }
                }
            }
        }

        enemyShipBullet.x += enemyShipBullet.xv; enemyShipBullet.y += enemyShipBullet.yv;
        enemyShipBullet.life--;

        if (enemyShipBullet.life <= 0 || Math.sqrt((State.worldOffsetX - enemyShipBullet.x) * (State.worldOffsetX - enemyShipBullet.x) + (State.worldOffsetY - enemyShipBullet.y) * (State.worldOffsetY - enemyShipBullet.y)) > WORLD_BOUNDS * 1.5) {
            State.enemyShipBullets.splice(i, 1); continue;
        }

        const vpX = enemyShipBullet.x - State.worldOffsetX + State.width / 2;
        const vpY = enemyShipBullet.y - State.worldOffsetY + State.height / 2;

        let alpha = 1.0;
        if (enemyShipBullet.life < SHIP_CONFIG.BULLET_FADE_FRAMES) {
            alpha = enemyShipBullet.life / SHIP_CONFIG.BULLET_FADE_FRAMES;
        }
        enemyShipBullet.alpha = alpha; // Pass alpha to drawBullet

        // FRUSTUM CULLING: Only draw if on screen
        const pad = 50;
        if (vpX > -pad && vpX < State.width + pad && vpY > -pad && vpY < State.height + pad) {
            drawBullet(DOM.canvasContext, enemyShipBullet, vpX, vpY);
        }

        DOM.canvasContext.globalAlpha = 1; // Reset alpha for next operations

        let hit = false;
        // Collision with player (World Coords)
        if (!State.playerShip.dead && !enemyShipBullet.isFriendly && Math.sqrt((State.worldOffsetX - enemyShipBullet.x) * (State.worldOffsetX - enemyShipBullet.x) + (State.worldOffsetY - enemyShipBullet.y) * (State.worldOffsetY - enemyShipBullet.y)) < (State.playerShip.effectiveR || State.playerShip.r) + 5) {
            hitPlayerShip(1);

            // INDIVIDUAL EVOLUTION: Gain score for hitting/killing player
            if (enemyShipBullet.owner && State.ships.includes(enemyShipBullet.owner)) {
                enemyShipBullet.owner.score += SCORE_REWARDS.SHIP_KILLED;
            }

            State.enemyShipBullets.splice(i, 1);
            hit = true;
        }
        if (hit) continue;

        // NEW: Collision with RIVAL SHIPS (Faction War)
        for (let k = State.ships.length - 1; k >= 0; k--) {
            let e = State.ships[k];
            if (e.z > 0.5) continue; // Ignore background State.ships

            // Basic collision check
            const dx = enemyShipBullet.x - e.x;
            const dy = enemyShipBullet.y - e.y;
            const reach = e.r + enemyShipBullet.size;
            if (Math.abs(dx) < reach && Math.abs(dy) < reach && (dx * dx + dy * dy) < reach * reach) {
                // Friendly fire exclusion
                if (enemyShipBullet.isFriendly && e.isFriendly) continue;
                if (!enemyShipBullet.isFriendly && !e.isFriendly && enemyShipBullet.hue === e.fleetHue) continue; // Same fleet enemy State.ships

                e.structureHP--;
                e.shieldHitTimer = 10;
                createExplosion(enemyShipBullet.x - State.worldOffsetX + State.width / 2, enemyShipBullet.y - State.worldOffsetY + State.height / 2, 5, '#ff0055', 1, 'spark');

                if (e.structureHP <= 0) {
                    let debrisColor = e.type === 'station' ? `hsl(${e.fleetHue}, 100%, 50%)` : `hsl(${e.fleetHue}, 100%, 40%)`;
                    createExplosion(e.x - State.worldOffsetX + State.width / 2, e.y - State.worldOffsetY + State.height / 2, 40, debrisColor, 4, 'debris');
                    if (e.type === 'station') { onStationDestroyed(e, enemyShipBullet.owner); }
                    else { onShipDestroyed(e, enemyShipBullet.owner); }

                    // INDIVIDUAL EVOLUTION: Gain score for killing rival
                    if (enemyShipBullet.owner && State.ships.includes(enemyShipBullet.owner)) {
                        enemyShipBullet.owner.score += (e.type === 'station') ? SCORE_REWARDS.STATION_KILLED : SCORE_REWARDS.SHIP_KILLED;
                    }

                    State.ships.splice(k, 1);
                    AudioEngine.playExplosion('large', e.x, e.y, e.z);
                }

                State.enemyShipBullets.splice(i, 1);
                hit = true;
                break;
            }
        }
        if (hit) continue;

        // Collision with asteroids (World Coords)
        let nearbyRoids = spatialGrid.query(enemyShipBullet);
        for (let j = nearbyRoids.length - 1; j >= 0; j--) {
            let r = nearbyRoids[j];
            if (r.z > 0.5 || r._destroyed) continue;

            const dx = enemyShipBullet.x - r.x;
            const dy = enemyShipBullet.y - r.y;
            const reach = r.r + enemyShipBullet.size;
            if (Math.abs(dx) < reach && Math.abs(dy) < reach && (dx * dx + dy * dy) < reach * reach) {
                const rVpX = r.x - State.worldOffsetX + State.width / 2;
                const rVpY = r.y - State.worldOffsetY + State.height / 2;

                if (r.isPlanet) {
                    let planet = r;
                    let hasSquad = false;
                    let shooter = enemyShipBullet.owner;
                    if (shooter && shooter.role === 'leader') {
                        let squadCount = 0;
                        if (shooter.squadSlots) {
                            shooter.squadSlots.forEach(s => {
                                if (s.occupant && !s.occupant.dead && State.ships.includes(s.occupant)) squadCount++;
                            });
                        }
                        if (squadCount >= 2) hasSquad = true;
                    }

                    if (hasSquad) {
                        if (planet.hp === undefined) planet.hp = 70;
                        if (planet.hp > 0) {
                            planet.hp--;
                            planet.blinkNum = 10;
                            createExplosion(vpX, vpY, 20, '#ffaa00', 3, 'spark');

                            if (planet.hp <= 0) {
                                planet.r = 0;
                                planet.vaporized = true;
                                planet._destroyed = true;
                                const pIdx = State.roids.indexOf(planet);
                                if (pIdx !== -1) State.roids.splice(pIdx, 1);

                                const pVpX = planet.x - State.worldOffsetX + State.width / 2;
                                const pVpY = planet.y - State.worldOffsetY + State.height / 2;
                                createExplosion(pVpX, pVpY, 150, '#ffaa00', 8, 'flame');
                                createExplosion(pVpX, pVpY, 100, '#ff4400', 12, 'flame');
                                createExplosion(pVpX, pVpY, 80, '#550000', 15, 'smoke');
                                createExplosion(pVpX, pVpY, 50, '#ffff00', 4, 'spark');
                                AudioEngine.playPlanetExplosion(planet.x, planet.y, planet.z || 0);

                                PLANET_CONFIG.LIMIT = Math.max(0, PLANET_CONFIG.LIMIT - 1);
                                if (planet.id === State.homePlanetId) {
                                    triggerHomePlanetLost('enemy');
                                } else {
                                    if (shooter && State.ships.includes(shooter)) {
                                        shooter.score += SCORE_REWARDS.PLANET_DESTROYED;
                                    }
                                    State.pendingDebris.push({ x: planet.x, y: planet.y, count: ASTEROID_CONFIG.PLANET_DEBRIS, isHot: true });
                                    createShockwave(planet.x, planet.y);
                                }
                            }
                        }
                    } else {
                        createExplosion(vpX, vpY, 3, '#fff', 1); // Bullet destroyed by planet shield
                    }
                }
                else {
                    createExplosion(rVpX, rVpY, 10, '#aa00ff', 1, 'debris');

                    // INDIVIDUAL EVOLUTION: Gain score for destroying asteroids
                    if (enemyShipBullet.owner && State.ships.includes(enemyShipBullet.owner)) {
                        enemyShipBullet.owner.score += SCORE_REWARDS.ASTEROID_DESTROYED;
                    }

                    const newSize = r.r * 0.5;
                    if (newSize >= ASTEROID_CONFIG.MIN_SIZE) {
                        const bulletAngle = Math.atan2(enemyShipBullet.yv, enemyShipBullet.xv);
                        const perpAngle1 = bulletAngle + Math.PI / 2;
                        const perpAngle2 = bulletAngle - Math.PI / 2;
                        const dynamicOffset = r.r * (ASTEROID_CONFIG.SPLIT_OFFSET / ASTEROID_CONFIG.MAX_SIZE);

                        let frag1 = createAsteroid(r.x + Math.cos(perpAngle1) * dynamicOffset, r.y + Math.sin(perpAngle1) * dynamicOffset, newSize);
                        frag1.xv = r.xv + Math.cos(perpAngle1) * ASTEROID_CONFIG.MAX_SPEED;
                        frag1.yv = r.yv + Math.sin(perpAngle1) * ASTEROID_CONFIG.MAX_SPEED;
                        frag1.blinkNum = 30;
                        State.roids.push(frag1);

                        let frag2 = createAsteroid(r.x + Math.cos(perpAngle2) * dynamicOffset, r.y + Math.sin(perpAngle2) * dynamicOffset, newSize);
                        frag2.xv = r.xv + Math.cos(perpAngle2) * ASTEROID_CONFIG.MAX_SPEED;
                        frag2.yv = r.yv + Math.sin(perpAngle2) * ASTEROID_CONFIG.MAX_SPEED;
                        frag2.blinkNum = 30;
                        State.roids.push(frag2);

                        updateAsteroidCounter();
                    }
                    const roidIdx = State.roids.indexOf(r);
                    if (roidIdx !== -1) State.roids.splice(roidIdx, 1);
                    r._destroyed = true;
                    updateAsteroidCounter();
                    AudioEngine.playExplosion('small', r.x, r.y, r.z); // Added for asteroid destruction by enemy
                }
                State.enemyShipBullets.splice(i, 1); hit = true; break;
            }
        }
    }

    // --- Player Bullet Logic (All in World Coords) ---
    DOM.canvasContext.shadowColor = '#ff0055'; DOM.canvasContext.fillStyle = '#ff0055';
    for (let i = State.playerShipBullets.length - 1; i >= 0; i--) {
        let playerShipBullet = State.playerShipBullets[i];

        // Optimized Gravity (World Coords)
        if (!playerShipBullet.ignoreGravity) {
            for (let r of activePlanets) {
                if (r.z < 0.5) {
                    const dx = r.x - playerShipBullet.x;
                    const dy = r.y - playerShipBullet.y;
                    const reach = r.r * 8;

                    // FAST PRE-CHECK (Bounding Box)
                    if (Math.abs(dx) < reach && Math.abs(dy) < reach) {
                        const distSq = dx * dx + dy * dy;
                        if (distSq < reach * reach && distSq > 100) {
                            const dist = Math.sqrt(distSq);
                            const force = (G_CONST * r.mass) / distSq;
                            playerShipBullet.xv += (dx / dist) * force * SHIP_CONFIG.BULLET_GRAVITY_FACTOR;
                            playerShipBullet.yv += (dy / dist) * force * SHIP_CONFIG.BULLET_GRAVITY_FACTOR;
                        }
                    }
                }
            }
        }

        playerShipBullet.x += playerShipBullet.xv; playerShipBullet.y += playerShipBullet.yv;
        playerShipBullet.life--;

        if (playerShipBullet.life <= 0 || Math.sqrt((State.worldOffsetX - playerShipBullet.x) * (State.worldOffsetX - playerShipBullet.x) + (State.worldOffsetY - playerShipBullet.y) * (State.worldOffsetY - playerShipBullet.y)) > WORLD_BOUNDS * 1.5) {
            State.playerShipBullets.splice(i, 1); continue;
        }

        const vpX = playerShipBullet.x - State.worldOffsetX + State.width / 2;
        const vpY = playerShipBullet.y - State.worldOffsetY + State.height / 2;

        // NEW: Bullet Fade Effect
        let alpha = 1.0;
        if (playerShipBullet.life < SHIP_CONFIG.BULLET_FADE_FRAMES) {
            alpha = playerShipBullet.life / SHIP_CONFIG.BULLET_FADE_FRAMES;
        }
        playerShipBullet.alpha = alpha; // Pass alpha to drawBullet

        // FRUSTUM CULLING: Only draw if on screen
        const pad = 50;
        if (vpX > -pad && vpX < State.width + pad && vpY > -pad && vpY < State.height + pad) {
            drawBullet(DOM.canvasContext, playerShipBullet, vpX, vpY);
        }

        DOM.canvasContext.globalAlpha = 1; // Reset alpha for next operations
        let hit = false;

        // Collision with asteroids/planets (World Coords)
        let playerNearbyRoids = spatialGrid.query(playerShipBullet);
        for (let j = playerNearbyRoids.length - 1; j >= 0; j--) {
            let r = playerNearbyRoids[j];
            if (r.z > 0.5 || r._destroyed) continue;

            // Use bullet size for effective collision radius
            const dx = playerShipBullet.x - r.x;
            const dy = playerShipBullet.y - r.y;
            const reach = r.r + playerShipBullet.size;
            if (Math.abs(dx) < reach && Math.abs(dy) < reach && (dx * dx + dy * dy) < reach * reach) {
                const rVpX = r.x - State.worldOffsetX + State.width / 2;
                const rVpY = r.y - State.worldOffsetY + State.height / 2;

                if (r.isPlanet) {
                    if (r.id === State.homePlanetId) {
                        r.friendlyHits = (r.friendlyHits || 0) + 1;
                        if (r.friendlyHits === 2 || r.friendlyHits % 10 === 0) {
                            addScreenMessage(t("game.warn_shoot_home"), "#ff8800");
                        }
                        createExplosion(vpX, vpY, 3, '#fff', 1);
                        State.playerShipBullets.splice(i, 1);
                        hit = true;
                        break;
                    }
                    let planet = r;
                    let hasSquad = false;
                    let shooter = playerShipBullet.owner;

                    if (shooter === State.playerShip) {
                        if (!State.playerShip.loneWolf) {
                            let squadCount = 0;
                            if (State.playerShip.squadSlots) {
                                State.playerShip.squadSlots.forEach(s => {
                                    if (s.occupant && !s.occupant.dead && State.ships.includes(s.occupant)) squadCount++;
                                });
                            }
                            if (squadCount >= 2) hasSquad = true;
                        }
                    } else if (shooter && shooter.role === 'leader') {
                        let squadCount = 0;
                        if (shooter.squadSlots) {
                            shooter.squadSlots.forEach(s => {
                                if (s.occupant && !s.occupant.dead && State.ships.includes(s.occupant)) squadCount++;
                            });
                        }
                        if (squadCount >= 2) hasSquad = true;
                    }

                    if (hasSquad) {
                        if (planet.hp === undefined) planet.hp = 70;
                        if (planet.hp > 0) {
                            planet.hp--;
                            planet.blinkNum = 10;
                            createExplosion(vpX, vpY, 20, '#ffaa00', 3, 'spark');

                            if (planet.hp <= 0) {
                                planet.r = 0;
                                planet.vaporized = true;
                                planet._destroyed = true;
                                const pIdx = State.roids.indexOf(planet);
                                if (pIdx !== -1) State.roids.splice(pIdx, 1);

                                const pVpX = planet.x - State.worldOffsetX + State.width / 2;
                                const pVpY = planet.y - State.worldOffsetY + State.height / 2;
                                createExplosion(pVpX, pVpY, 150, '#ffaa00', 8, 'flame');
                                createExplosion(pVpX, pVpY, 100, '#ff4400', 12, 'flame');
                                AudioEngine.playPlanetExplosion(planet.x, planet.y, planet.z || 0);

                                PLANET_CONFIG.LIMIT = Math.max(0, PLANET_CONFIG.LIMIT - 1);
                                if (planet.id === State.homePlanetId) {
                                    triggerHomePlanetLost('player');
                                } else {
                                    increaseShipScore(State.playerShip, SCORE_REWARDS.PLANET_DESTROYED);
                                    State.pendingDebris.push({ x: planet.x, y: planet.y, count: ASTEROID_CONFIG.PLANET_DEBRIS, isHot: true });
                                    createShockwave(planet.x, planet.y);
                                }
                            }
                        }
                    } else {
                        createExplosion(vpX, vpY, 3, '#fff', 1); // Bullet destroyed by planet shield
                    }

                    State.playerShipBullets.splice(i, 1); hit = true; break;
                } else {
                    if (r.blinkNum > 0) {
                        State.playerShipBullets.splice(i, 1); hit = true; break;
                    }
                    createExplosion(rVpX, rVpY, 15, '#ff0055', 1, 'spark');
                    createExplosion(rVpX, rVpY, 5, '#888', 2, 'debris');

                    const newSize = r.r * 0.5;
                    if (newSize >= ASTEROID_CONFIG.MIN_SIZE) {
                        const bulletAngle = Math.atan2(playerShipBullet.yv, playerShipBullet.xv);
                        const perpAngle1 = bulletAngle + Math.PI / 2;
                        const perpAngle2 = bulletAngle - Math.PI / 2;
                        const dynamicOffset = r.r * (ASTEROID_CONFIG.SPLIT_OFFSET / ASTEROID_CONFIG.MAX_SIZE);

                        let frag1 = createAsteroid(r.x + Math.cos(perpAngle1) * dynamicOffset, r.y + Math.sin(perpAngle1) * dynamicOffset, newSize);
                        frag1.xv = r.xv + Math.cos(perpAngle1) * ASTEROID_CONFIG.MAX_SPEED;
                        frag1.yv = r.yv + Math.sin(perpAngle1) * ASTEROID_CONFIG.MAX_SPEED;
                        frag1.blinkNum = 30;
                        State.roids.push(frag1);

                        let frag2 = createAsteroid(r.x + Math.cos(perpAngle2) * dynamicOffset, r.y + Math.sin(perpAngle2) * dynamicOffset, newSize);
                        frag2.xv = r.xv + Math.cos(perpAngle2) * ASTEROID_CONFIG.MAX_SPEED;
                        frag2.yv = r.yv + Math.sin(perpAngle2) * ASTEROID_CONFIG.MAX_SPEED;
                        frag2.blinkNum = 30;
                        State.roids.push(frag2);

                        updateAsteroidCounter();
                    }

                    const roidIdx = State.roids.indexOf(r);
                    if (roidIdx !== -1) State.roids.splice(roidIdx, 1);
                    r._destroyed = true;
                    updateAsteroidCounter();
                    AudioEngine.playExplosion('small', r.x, r.y, r.z);
                }
                if (!r.isPlanet) {
                    increaseShipScore(State.playerShip, SCORE_REWARDS.ASTEROID_DESTROYED);
                }
                State.playerShipBullets.splice(i, 1); hit = true; break;
            }
        }
        if (hit) continue;

        // Collision with State.ships (World Coords)
        for (let j = State.ships.length - 1; j >= 0; j--) {
            let ship = State.ships[j];

            const dx = playerShipBullet.x - ship.x;
            const dy = playerShipBullet.y - ship.y;
            const reach = ship.r + playerShipBullet.size;
            if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;

            // If we are NOT a lone wolf, hitting friends triggers a warning
            if (ship.isFriendly && !State.playerShip.loneWolf && !State.victoryState && !State.playerShip.dead) {
                if ((dx * dx + dy * dy) < reach * reach) {
                    addScreenMessage(t("game.warn_cease_fire"), "#ffcc00");
                    ship.structureHP -= 1.0;
                    ship.shieldHitTimer = 5;
                    State.playerShipBullets.splice(i, 1);
                    hit = true;

                    if (ship.structureHP <= 0) {
                        const eVpX = ship.x - State.worldOffsetX + State.width / 2;
                        const eVpY = ship.y - State.worldOffsetY + State.height / 2;
                        let debrisColor = ship.type === 'station' ? `hsl(${ship.fleetHue}, 100%, 50%)` : `hsl(${ship.fleetHue}, 100%, 40%)`;
                        createExplosion(eVpX, eVpY, 40, '#ffaa00', 3, 'spark');
                        createExplosion(eVpX, eVpY, 20, debrisColor, 4, 'debris');

                        if (ship.type === 'station') {
                            onStationDestroyed(ship, State.playerShip);
                        } else {
                            onShipDestroyed(ship, State.playerShip);
                        }

                        State.ships.splice(j, 1);
                        AudioEngine.playExplosion('large', ship.x, ship.y, ship.z);
                    }
                    break;
                }
                continue;
            }

            // Use bullet size for effective collision radius
            if (ship.blinkNum === 0 && (dx * dx + dy * dy) < reach * reach) {
                ship.structureHP--;
                ship.shieldHitTimer = 5;
                State.playerShipBullets.splice(i, 1);
                hit = true;

                const eVpX = ship.x - State.worldOffsetX + State.width / 2;
                const eVpY = ship.y - State.worldOffsetY + State.height / 2;

                if (ship.structureHP <= 0) {
                    let debrisColor = ship.type === 'station' ? `hsl(${ship.fleetHue}, 100%, 50%)` : `hsl(${ship.fleetHue}, 100%, 40%)`;
                    createExplosion(eVpX, eVpY, 40, '#ffaa00', 3, 'spark'); createExplosion(eVpX, eVpY, 20, debrisColor, 4, 'debris');
                    if (ship.type === 'station') { onStationDestroyed(ship, playerShipBullet.owner); }
                    else { onShipDestroyed(ship, playerShipBullet.owner); }
                    State.ships.splice(j, 1);
                    AudioEngine.playExplosion('large', ship.x, ship.y, ship.z);
                }
                break;
            } else if (ship.blinkNum > 0 && (dx * dx + dy * dy) < reach * reach) {
                State.playerShipBullets.splice(i, 1); hit = true; break;
            }
        }
    }
    // --- End Player Bullet Logic ---

    // Particle update (movement and decay)
    for (let i = State.particles.length - 1; i >= 0; i--) {
        let p = State.particles[i];
        // Particle position is World Coords + Velocity, but drawing uses Viewport Coords
        p.x += p.xv; p.y += p.yv;

        const vpX = p.x - State.worldOffsetX + State.width / 2;
        const vpY = p.y - State.worldOffsetY + State.height / 2;

        if (p.type === 'flame') {
            DOM.canvasContext.globalAlpha = p.life / 60;
            DOM.canvasContext.shadowBlur = 15;
            DOM.canvasContext.shadowColor = p.color;
            DOM.canvasContext.fillStyle = p.color;
            DOM.canvasContext.beginPath();
            // Flames pulsate and grow slightly then shrink
            const flameSize = Math.max(0.1, p.size * (1 + Math.sin(p.life * 0.2) * 0.3));
            DOM.canvasContext.arc(vpX, vpY, flameSize, 0, Math.PI * 2);
            DOM.canvasContext.fill();
        } else if (p.type === 'smoke') {
            DOM.canvasContext.globalAlpha = (p.life / 100) * 0.4;
            DOM.canvasContext.fillStyle = p.color;
            DOM.canvasContext.beginPath();
            const smokeSize = Math.max(0.1, p.size * (1 + (100 - p.life) * 0.05));
            DOM.canvasContext.arc(vpX, vpY, smokeSize, 0, Math.PI * 2);
            DOM.canvasContext.fill();
        } else {
            DOM.canvasContext.shadowColor = p.color; DOM.canvasContext.fillStyle = p.color; DOM.canvasContext.globalAlpha = p.life / 60;
            if (p.type === 'debris' || p.type === 'spark') {
                // fillRect is hardware accelerated and avoids expensive arc computations
                DOM.canvasContext.fillRect(vpX - p.size / 2, vpY - p.size / 2, p.size, p.size);
            } else {
                DOM.canvasContext.beginPath();
                DOM.canvasContext.arc(vpX, vpY, p.size, 0, Math.PI * 2);
                DOM.canvasContext.fill();
            }
        }
        DOM.canvasContext.globalAlpha = 1;
        DOM.canvasContext.shadowBlur = 0;

        p.life--; if (p.life <= 0) State.particles.splice(i, 1);
    }

    // Auto-spawn asteroid if count is too low
    /* DISABLED: Victory is based on cleaning the map
    if (State.roids.length < 5 + State.level && !State.victoryState) {
        let x, y, d;
        // Spawning logic (off-screen in World Coords)
        const spawnRadius = WORLD_BOUNDS * 0.9;
        do { x = (Math.random() - 0.5) * spawnRadius * 2; y = (Math.random() - 0.5) * spawnRadius * 2; d = Math.sqrt(x ** 2 + y ** 2); } while (d < 300);
        State.roids.push(createAsteroid(x, y, 60));
        updateAsteroidCounter();
    }
    */

    drawRadar();

    DOM.canvasContext.restore();
    DOM.canvasContext.shadowBlur = 0;

    // --- Off-Screen Enemy Indicators ---
    // Show red dots at screen borders for State.ships that are approaching but not visible
    // Draw in screen space (unscaled) to work correctly in touch mode
    if (!(State.playerShip.dead && State.playerShip.lives <= 0)) {
        DOM.canvasContext.save();
        DOM.canvasContext.resetTransform(); // Draw in screen space, not affected by viewport scaling
        const INDICATOR_SIZE = 8;
        const BORDER_PADDING = 20;
        const DETECTION_RANGE = 3000; // How far off-screen to detect State.ships

        State.ships.forEach(e => {
            if (e.isFriendly || e.z > 0.5) return; // Skip friendly State.ships and far-away State.ships

            // Calculate viewport position (in world viewport space)
            const depthScale = 1 / (1 + e.z);
            const worldVpX = (e.x - State.worldOffsetX) * depthScale + State.width / 2;
            const worldVpY = (e.y - State.worldOffsetY) * depthScale + State.height / 2;

            // Apply State.viewScale transformation to get screen position
            const vpX = worldVpX * State.viewScale + State.width / 2 * (1 - State.viewScale);
            const vpY = worldVpY * State.viewScale + State.height / 2 * (1 - State.viewScale);

            const screenLeft = 0;
            const screenRight = State.width;
            const screenTop = 0;
            const screenBottom = State.height;

            // Check if enemy is off-screen but within detection range
            const isOffScreen = vpX < screenLeft || vpX > screenRight || vpY < screenTop || vpY > screenBottom;
            const distToPlayer = Math.sqrt((e.x - State.worldOffsetX) * (e.x - State.worldOffsetX) + (e.y - State.worldOffsetY) * (e.y - State.worldOffsetY));

            if (isOffScreen && distToPlayer < DETECTION_RANGE) {
                // Calculate indicator position at screen border
                let indicatorX = vpX;
                let indicatorY = vpY;

                // Clamp to screen borders with padding
                if (vpX < screenLeft) indicatorX = screenLeft + BORDER_PADDING;
                else if (vpX > screenRight) indicatorX = screenRight - BORDER_PADDING;

                if (vpY < screenTop) indicatorY = screenTop + BORDER_PADDING;
                else if (vpY > screenBottom) indicatorY = screenBottom - BORDER_PADDING;

                // Draw pulsing red indicator
                const pulseAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.3;
                DOM.canvasContext.globalAlpha = pulseAlpha;
                DOM.canvasContext.fillStyle = '#FF0000';
                DOM.canvasContext.shadowColor = '#FF0000';
                DOM.canvasContext.shadowBlur = 10;

                // Draw arrow pointing towards enemy
                const angleToEnemy = Math.atan2(vpY - indicatorY, vpX - indicatorX);
                DOM.canvasContext.save();
                DOM.canvasContext.translate(indicatorX, indicatorY);
                DOM.canvasContext.rotate(angleToEnemy);

                // Draw triangle arrow
                DOM.canvasContext.beginPath();
                DOM.canvasContext.moveTo(INDICATOR_SIZE, 0);
                DOM.canvasContext.lineTo(-INDICATOR_SIZE / 2, -INDICATOR_SIZE / 2);
                DOM.canvasContext.lineTo(-INDICATOR_SIZE / 2, INDICATOR_SIZE / 2);
                DOM.canvasContext.closePath();
                DOM.canvasContext.fill();

                DOM.canvasContext.restore();
                DOM.canvasContext.globalAlpha = 1;
            }
        });



        DOM.canvasContext.restore();
        DOM.canvasContext.shadowBlur = 0;

        // --- Render Screen Messages ---
        if (State.screenMessages.length > 0) {
            DOM.canvasContext.save();
            DOM.canvasContext.resetTransform(); // Draw in screen space
            DOM.canvasContext.textAlign = 'center';

            // Responsive font size based on screen State.width
            const baseFontSize = 24;
            const fontSize = Math.max(14, Math.min(baseFontSize, State.width / 30)); // Scale between 14px and 24px
            DOM.canvasContext.font = `bold ${fontSize}px Courier New`;

            for (let i = State.screenMessages.length - 1; i >= 0; i--) {
                const m = State.screenMessages[i];
                const alpha = Math.min(1, m.life / 30);
                DOM.canvasContext.globalAlpha = alpha;
                DOM.canvasContext.fillStyle = m.color;
                DOM.canvasContext.shadowBlur = 10;
                DOM.canvasContext.shadowColor = m.color;

                // Draw relative to center, offset by message index
                const yPos = State.height * 0.3 + (i * (fontSize + 16));

                // Use maxWidth to prevent text overflow (90% of screen State.width)
                const maxWidth = State.width * 0.9;
                DOM.canvasContext.fillText(m.text, State.width / 2, yPos, maxWidth);

                m.life--;
                if (m.life <= 0) State.screenMessages.splice(i, 1);
            }
            DOM.canvasContext.restore();
        }

        // Victory Fireworks
        if (State.victoryState && Math.random() < 0.05) {
            const fx = (Math.random() - 0.5) * State.width;
            const fy = (Math.random() - 0.5) * State.height;
            const hue = Math.floor(Math.random() * 360);
            createExplosion(State.width / 2 + fx, State.height / 2 + fy, 40, `hsl(${hue}, 100%, 50%)`, 3, 'spark');
        }
    }
}

window.startGame = startGame;
export function startGame() {
    // Stop menu music
    AudioEngine.stopMusic();
    AudioEngine.setTrack('game');

    // Hide start/restart button in order to gradually show it again in the game over screen.
    DOM.startBtn.style.display = 'none';

    // RESTORE HUD
    const uiLayer = document.getElementById('ui-layer');
    if (uiLayer) uiLayer.style.display = 'flex';

    if (originalPlanetLimit === null) originalPlanetLimit = PLANET_CONFIG.LIMIT;
    else PLANET_CONFIG.LIMIT = originalPlanetLimit;

    DOM.startScreen.style.display = 'none';
    DOM.startScreen.classList.remove('game-over', 'game-over-bg', 'victory', 'fade-out');
    DOM.startScreen.removeEventListener('click', window.audioStopper);

    State.level = 0;
    State.homePlanetId = null;
    State.screenMessages = [];
    State.victoryState = false;
    State.viewScale = 1.0;

    DOM.fadeOverlay.style.background = 'rgba(0, 0, 0, 0)';

    State.velocity = { x: 0, y: 0 };
    State.worldOffsetX = 0;
    State.worldOffsetY = 0;
    State.stationSpawnTimer = STATION_CONFIG.SPAWN_TIMER;
    State.playerReloadTime = 0; // Reset reload timer

    State.particles = [];
    State.ambientFogs = [];
    State.playerShipBullets = [];
    State.enemyShipBullets = [];
    State.shockwaves = [];
    State.ships = []; // NEW: Reset State.ships here, safely before adding player and stations

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

    // NEW: Spawn player at Home Planet if it exists
    if (State.homePlanetId) {
        const home = State.roids.find(r => r.id === State.homePlanetId);
        if (home) {
            State.worldOffsetX = home.x;
            State.worldOffsetY = home.y;
        }
    }

    drawLives();
    updateAsteroidCounter(); // Sync score/count immediately

    // Reset radar zoom to default (2500)
    State.currentZoomIndex = 2;
    State.RADAR_RANGE = ZOOM_LEVELS[State.currentZoomIndex];
    // radarRangeEl.innerText = State.RADAR_RANGE; // REMOVED

    // Determine initial input mode based on device
    if (window.matchMedia("(pointer: coarse)").matches) { State.inputMode = 'touch'; }
    else { State.inputMode = 'mouse'; }

    if (!State.loopStarted) {
        State.loopStarted = true;
        loop();
    }
}



