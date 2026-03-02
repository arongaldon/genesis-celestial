import { ASTEROID_CONFIG, BOUNDARY_CONFIG, GLOBAL_LIGHT, PLANET_CONFIG, PLAYER_CONFIG, SCORE_REWARDS, SHIP_CONFIG, STATION_CONFIG, FPS, FRICTION, G_CONST, MAX_Z_DEPTH, MIN_DURATION_TAP_TO_MOVE, SCALE_IN_MOUSE_MODE, SCALE_IN_TOUCH_MODE, WORLD_BOUNDS, ZOOM_LEVELS, suffixes, syllables, DOM } from '../core/config.js';
import { State } from '../core/state.js';

export function drawPlanetTexture(ctx, x, y, r, textureData, worldX = 0, worldY = 0) {
    if (!textureData || isNaN(x) || isNaN(y) || isNaN(r)) return;

    // 1. Base ocean gradient (softer, deep)
    let grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    grad.addColorStop(0, textureData.waterColor);
    grad.addColorStop(0.8, textureData.innerGradColor);
    grad.addColorStop(1, textureData.innerGradColor); // Deep edge

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // 2. Landmasses (Bezier curves for smoother shorelines)
    ctx.fillStyle = textureData.landColor;
    textureData.landmasses.forEach(lm => {
        ctx.beginPath();
        const radius = r * lm.radiusFactor;
        const centerX = x + Math.cos(lm.startAngle) * radius * 0.5;
        const centerY = y + Math.sin(lm.startAngle) * radius * 0.5;

        let firstPt = null;
        for (let j = 0; j < lm.vertices; j++) {
            const angle = (j / lm.vertices) * Math.PI * 2;
            const dist = radius * lm.vertexOffsets[j];
            const px = centerX + Math.cos(angle) * dist;
            const py = centerY + Math.sin(angle) * dist;

            if (j === 0) {
                firstPt = { x: px, y: py };
                ctx.moveTo(px, py);
            } else {
                // Approximate smooth curve
                const prevAngle = ((j - 1) / lm.vertices) * Math.PI * 2;
                const prevDist = radius * lm.vertexOffsets[j - 1];
                const prevX = centerX + Math.cos(prevAngle) * prevDist;
                const prevY = centerY + Math.sin(prevAngle) * prevDist;

                const cpX = (prevX + px) / 2;
                const cpY = (prevY + py) / 2;
                ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
            }
        }
        if (firstPt) ctx.quadraticCurveTo(firstPt.x, firstPt.y, firstPt.x, firstPt.y); // close
        ctx.fill();
    });

    // 3. Craters
    ctx.fillStyle = textureData.craterColor;
    textureData.craters.forEach(cr => {
        const cx = x + cr.xFactor * r;
        const cy = y + cr.yFactor * r;
        const crr = r * cr.rFactor;
        if (Math.hypot(cx - x, cy - y) + crr < r) {
            ctx.beginPath(); ctx.arc(cx, cy, crr, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = `rgba(0, 0, 0, 0.4)`; ctx.lineWidth = 1; ctx.stroke();
        }
    });

    // We establish a dynamic light source direction from GLOBAL_LIGHT outside bounds

    // Calculate light vector based on world coordinates
    const dx = GLOBAL_LIGHT.X - worldX;
    const dy = GLOBAL_LIGHT.Y - worldY;
    const lDist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const lightDirX = dx / lDist;
    const lightDirY = dy / lDist;

    // 6. Atmospheric scattering (Outer Glow)
    // Smooth radial fade instead of sharp edge
    const outerAtm = r * 1.25;
    let atmGrad = ctx.createRadialGradient(x, y, r * 0.95, x, y, outerAtm);

    // Extract hsl to manipulate alpha for the atmosphere
    const hslBase = textureData.atmosphereColor; // format `hsl(h, s%, l%)`
    // Convert to hsla string representation for gradient
    const hslaBase = hslBase.replace(')', ', 0.4)').replace('hsl', 'hsla');
    const hslaFade = hslBase.replace(')', ', 0)').replace('hsl', 'hsla');

    atmGrad.addColorStop(0, hslaBase);
    atmGrad.addColorStop(1, hslaFade);

    ctx.fillStyle = atmGrad;
    ctx.beginPath();
    ctx.arc(x, y, outerAtm, 0, Math.PI * 2);
    ctx.fill();

    // 7. Day/Night Shadow Overlay (drawn LAST to darken everything on the night side)
    // A linear gradient from the dark side to the light side
    const shadowGrad = ctx.createLinearGradient(
        x + lightDirX * r, y + lightDirY * r, // Lightest point (closest to sun)
        x - lightDirX * r, y - lightDirY * r  // Darkest point (furthest from sun)
    );
    shadowGrad.addColorStop(0.1, "rgba(0,0,0,0)");    // Extended bright day side
    shadowGrad.addColorStop(0.5, "rgba(0,0,0,0.6)");  // Harsher terminator line
    shadowGrad.addColorStop(0.8, "rgba(0,0,0,1.0)");  // Pitch black reaching from the edge

    // Mask the shadow strictly to the planet circle, but let the atmosphere glow remain outside?
    // Actually, we want the shadow to cover the atmosphere too on the dark side, so we use outerAtm for the mask.
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, outerAtm, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(x - outerAtm, y - outerAtm, outerAtm * 2, outerAtm * 2);
    ctx.restore();
}

export function drawRadar() {
    try {
        const rW = DOM.canvasRadar.width; const rH = DOM.canvasRadar.height;
        const cX = rW / 2; const cY = rH / 2;
        DOM.canvasRadarContext.clearRect(0, 0, rW, rH);

        const radarRadius = rW / 2;
        const scale = radarRadius / Math.max(1, State.RADAR_RANGE);

        const drawBlip = (worldX, worldY, type, color, size, z = 0) => {
            if (!isFinite(worldX) || !isFinite(worldY) || isNaN(worldX) || isNaN(worldY)) return;

            let dx = worldX - State.worldOffsetX;
            let dy = worldY - State.worldOffsetY;

            // Safety check for worldOffset being invalid
            if (isNaN(dx) || isNaN(dy)) return;

            // FAST PRE-CHECK: Skip math if way out of bounds (save CPU)
            const maxRadarDist = State.RADAR_RANGE + size;
            if (Math.abs(dx) > maxRadarDist || Math.abs(dy) > maxRadarDist) {
                // If it's not a planet or asteroid (which we scale to edge), don't draw it at all
                if (type !== 'planet' && type !== 'asteroid' && type !== 'background_planet') return;
            }

            let dist = Math.sqrt(dx * dx + dy * dy);

            // Ensure large objects like planets are drawn if their edge touches the radar range
            if (dist - size > State.RADAR_RANGE || !isFinite(dist)) {
                if (type !== 'planet' && type !== 'asteroid' && type !== 'background_planet') return;
            }

            let angle = Math.atan2(dy, dx);
            let radarDist = dist * scale;
            let radarSize = (size * scale) / (1 + z);

            // Ensure elements are visible on the radar regardless of zoom
            if (type === 'planet') radarSize = Math.max(4, radarSize);
            else if (type === 'asteroid') radarSize = Math.max(1.5, radarSize);
            else radarSize = Math.max(2, radarSize); // Default minimum for State.ships/etc

            // Safety check for radarSize
            if (isNaN(radarSize) || !isFinite(radarSize)) radarSize = 2;

            // Snap small objects to the radar border, but let massive planets overflow naturally
            if (type !== 'planet' && type !== 'asteroid' && type !== 'background_planet' && radarDist > radarRadius - radarSize) {
                radarDist = Math.max(0, radarRadius - radarSize - 1);
            }

            if (isNaN(radarDist) || !isFinite(radarDist)) return;

            let rx = cX + radarDist * Math.cos(angle);
            let ry = cY + radarDist * Math.sin(angle);

            if (isNaN(rx) || isNaN(ry)) return;

            DOM.canvasRadarContext.fillStyle = color;
            DOM.canvasRadarContext.strokeStyle = color;

            if (type === 'station') {
                DOM.canvasRadarContext.font = "bold 12px Courier New";
                DOM.canvasRadarContext.textAlign = 'center';
                DOM.canvasRadarContext.textBaseline = 'middle';
                DOM.canvasRadarContext.fillText('O', rx, ry);
            } else if (type === 'asteroid') {
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.arc(rx, ry, radarSize, 0, Math.PI * 2);
                DOM.canvasRadarContext.stroke();
            } else {
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.arc(rx, ry, radarSize, 0, Math.PI * 2);
                DOM.canvasRadarContext.fill();
            }
        };

        for (let i = 0; i < State.roids.length; i++) {
            let r = State.roids[i];
            if (r.isPlanet) {
                const color = r.textureData ? r.textureData.waterColor : 'rgba(0, 150, 255, 0.7)';
                if (r.z < 0.5) {
                    drawBlip(r.x, r.y, 'planet', color, r.r, r.z);
                } else {
                    drawBlip(r.x, r.y, 'background_planet', color, 4, r.z); // Small dot for far away planets
                }
            } else if (r.z <= 0.1) {
                drawBlip(r.x, r.y, 'asteroid', 'rgba(200, 200, 200, 0.9)', Math.max(10, r.r), r.z); // Make tiny asteroids slightly larger for radar
            }
        }

        for (let i = 0; i < State.ships.length; i++) {
            let e = State.ships[i];
            if (e.z <= 0.1) {
                const color = e.isFriendly ? '#0088FF' : '#FF0000';
                if (e.type === 'station') {
                    drawBlip(e.x, e.y, 'station', color, 0, e.z);
                } else {
                    drawBlip(e.x, e.y, 'ship', color, 2, e.z);
                }
            }
        }

        DOM.canvasRadarContext.strokeStyle = 'rgba(0, 255, 255, 0.2)'; DOM.canvasRadarContext.lineWidth = 1;
        DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.moveTo(cX, 0); DOM.canvasRadarContext.lineTo(cX, rH); DOM.canvasRadarContext.stroke();
        DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.moveTo(0, cY); DOM.canvasRadarContext.lineTo(rW, cY); DOM.canvasRadarContext.stroke();
        DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.arc(cX, cY, rW / 2 - 1, 0, Math.PI * 2); DOM.canvasRadarContext.stroke();
        DOM.canvasRadarContext.fillStyle = '#0ff'; DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.arc(cX, cY, 3, 0, Math.PI * 2); DOM.canvasRadarContext.fill();

        // 4. HOME PLANET NAVIGATOR (Dotted path to home)
        if (State.homePlanetId) {
            const home = State.roids.find(r => r.id === State.homePlanetId);
            if (home) {
                let dx = home.x - State.worldOffsetX;
                let dy = home.y - State.worldOffsetY;
                let dist = Math.sqrt(dx * dx + dy * dy);
                let angle = Math.atan2(dy, dx);

                // Calculate radar position for home planet blip
                let radarDist = dist * scale;
                if (radarDist > radarRadius - 5) radarDist = radarRadius - 5;

                let rx = cX + radarDist * Math.cos(angle);
                let ry = cY + radarDist * Math.sin(angle);

                // Draw dotted line
                DOM.canvasRadarContext.setLineDash([3, 5]);
                DOM.canvasRadarContext.strokeStyle = 'rgba(0, 255, 255, 0.5)';
                DOM.canvasRadarContext.lineWidth = 1;
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.moveTo(cX, cY);
                DOM.canvasRadarContext.lineTo(rx, ry);
                DOM.canvasRadarContext.stroke();
                DOM.canvasRadarContext.setLineDash([]); // Reset dash

                // Ensure home blip is always visible on radar edge if far away
                DOM.canvasRadarContext.fillStyle = '#00ffaa';
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.arc(rx, ry, 4, 0, Math.PI * 2);
                DOM.canvasRadarContext.fill();

                // Pulse effect for home planet
                if (Date.now() % 1000 < 500) {
                    DOM.canvasRadarContext.strokeStyle = '#00ffaa';
                    DOM.canvasRadarContext.beginPath();
                    DOM.canvasRadarContext.arc(rx, ry, 7, 0, Math.PI * 2);
                    DOM.canvasRadarContext.stroke();
                }
            }
        }
    } catch (e) {
        console.error("Radar drawing error:", e);
    }
}

export function drawHeart(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-size, -size, -size * 1.5, size / 2, 0, size);
    ctx.bezierCurveTo(size * 1.5, size / 2, size, -size, 0, 0);
    ctx.fillStyle = '#ff0000';
    ctx.fill();
    ctx.restore();
}

export function drawLives() {
    DOM.livesDisplay.innerText = `${State.playerShip.lives}`;
    DOM.livesDisplay.style.color = '#0ff';
    DOM.livesDisplay.style.marginTop = '5px';
}

export function updateHUD() {
    if (DOM.radarWrapper) {
        if (State.inputMode === 'touch') {
            DOM.radarWrapper.classList.add('touch-mode');
        } else {
            DOM.radarWrapper.classList.remove('touch-mode');
        }
    }

    if (DOM.scoreDisplay && State.playerShip) {
        const currentScore = State.playerShip.score || 0;
        DOM.scoreDisplay.innerText = isNaN(currentScore) ? 0 : currentScore;
    }
    if (DOM.asteroidCountDisplay) {
        DOM.asteroidCountDisplay.innerText = State.roids.filter(r => !r.isPlanet).length;
    }
    if (DOM.hudTop && State.velocity && State.playerShip && !State.playerShip.dead) {
        const spd = Math.sqrt(State.velocity.x ** 2 + State.velocity.y ** 2);
        // Decrease opacity as speed increases. Min opacity is 0.05 when at max speed.
        let opacity = 1.0 - (spd / SHIP_CONFIG.MAX_SPEED) * 0.95;
        opacity = Math.max(0.05, Math.min(1.0, opacity));
        DOM.hudTop.style.opacity = opacity.toFixed(2);
    } else if (DOM.hudTop) {
        DOM.hudTop.style.opacity = 1.0;
    }
}

export function updateAsteroidCounter() {
    updateHUD();
}

export function showInfoLEDText(text) {
    DOM.infoLED.innerHTML = '';
    const characters = text.split('');
    let i = 0;
    let line = '';
    function show() {
        if (i < characters.length) {
            const char = characters[i];
            line += char;
            DOM.infoLED.textContent = line;
            i++;
            setTimeout(show, 50);
        }
    }
    show();
}

export function addScreenMessage(text, color = "white") {
    // Avoid duplicate messages if they are the same
    if (State.screenMessages.length > 0 && State.screenMessages[State.screenMessages.length - 1].text === text) return;
    State.screenMessages.push({ text, color, life: 180 }); // 3 seconds at 60fps

    // Limit to 2 most recent messages
    if (State.screenMessages.length > 2) {
        State.screenMessages.shift();
    }
}

export function drawRings(ctx, rings, planetRadius, depthScale) {
    ctx.save();
    ctx.rotate(rings.tilt);
    rings.bands.forEach(band => {
        const bandRadius = planetRadius * band.rRatio;
        const bandWidth = planetRadius * band.wRatio;
        const outerRadius = bandRadius * depthScale;
        ctx.lineWidth = bandWidth * depthScale;
        ctx.strokeStyle = band.color;
        ctx.globalAlpha = band.alpha * depthScale;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.ellipse(0, 0, outerRadius, outerRadius * 0.15, 0, 0, Math.PI, false);
        ctx.stroke();
    });
    ctx.restore();
}

// -----------------------------------------------------
// SHIP DRAWING ABSTRACTION
// -----------------------------------------------------
export function drawShipShape({
    ctx, r, tier, norm = 1, transformationProgress = 1,
    hullColor, borderColor, detailColor, accentColor,
    thrustColor, isThrusting
}) {
    if (tier >= 12) {
        // THE GODSHIP: Massive, glowing, advanced
        // DRAW TIER 11 FORM (Fading out if transforming)
        if (transformationProgress < 1) {
            ctx.save();
            ctx.globalAlpha = 1 - transformationProgress;
            let sides = 3 + 11; // Tier 11
            ctx.beginPath();
            for (let i = 0; i <= sides; i++) {
                let ang = i * (2 * Math.PI / sides);
                if (i === 0) ctx.moveTo(r * Math.cos(ang), -r * Math.sin(ang));
                else ctx.lineTo(r * Math.cos(ang), -r * Math.sin(ang));
            }
            ctx.closePath();
            let chassisGrad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
            chassisGrad.addColorStop(0, '#0055aa'); chassisGrad.addColorStop(1, '#002244');
            ctx.fillStyle = chassisGrad; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#0088ff'; ctx.stroke();
            ctx.restore();
        }

        ctx.globalAlpha = transformationProgress;
        const HULL_COLOR = hullColor || '#050505';
        const BORDER_COLOR = borderColor || '#00FFFF';
        const CORE_COLOR = thrustColor || '#FFFFFF';

        ctx.shadowBlur = 40;
        ctx.shadowColor = BORDER_COLOR;

        // Advanced Chassis Design - Wide and multi-segmented
        ctx.beginPath();
        ctx.moveTo(r * 2.5 * norm, 0); // Front
        ctx.lineTo(r * 1.5 * norm, r * 1.2 * norm);
        ctx.lineTo(0, r * 1.8 * norm);
        ctx.lineTo(-r * 1.5 * norm, r * 1.2 * norm);
        ctx.lineTo(-r * 2.5 * norm, r * 1.5 * norm);
        ctx.lineTo(-r * 3 * norm, r * 0.5 * norm);
        ctx.lineTo(-r * 3 * norm, -r * 0.5 * norm);
        ctx.lineTo(-r * 2.5 * norm, -r * 1.5 * norm);
        ctx.lineTo(-r * 1.5 * norm, -r * 1.2 * norm);
        ctx.lineTo(0, -r * 1.8 * norm);
        ctx.lineTo(r * 1.5 * norm, -r * 1.2 * norm);
        ctx.closePath();

        ctx.fillStyle = HULL_COLOR;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = BORDER_COLOR;
        ctx.stroke();

        // Tech Overlay (Inner hull patterns)
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.moveTo(r * 2 * norm, 0);
        ctx.lineTo(-r * 1.5 * norm, r * 0.8 * norm);
        ctx.moveTo(r * 2 * norm, 0);
        ctx.lineTo(-r * 1.5 * norm, -r * 0.8 * norm);
        ctx.stroke();

        // Pulsing Energy Core
        const pulse = 0.7 + Math.sin(Date.now() / 200) * 0.3;
        ctx.shadowBlur = 50 * pulse;
        ctx.fillStyle = CORE_COLOR;
        ctx.beginPath();
        ctx.arc(0, 0, r * norm * 0.6 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Heavy Thrusters
        const EXHAUST_X = -r * 3 * norm;
        if (isThrusting) {
            ctx.shadowBlur = 80;
            ctx.fillStyle = `${thrustColor || 'rgba(0, 255, 255)'}`.replace(')', ', 0.6)').replace('rgb', 'rgba');
            ctx.beginPath();
            ctx.moveTo(EXHAUST_X, -r * 1.2 * norm);
            ctx.lineTo(EXHAUST_X, r * 1.2 * norm);
            ctx.lineTo(EXHAUST_X - r * 12 * norm * (0.8 + Math.random() * 0.4), 0);
            ctx.closePath();
            ctx.fill();
        }
        ctx.shadowBlur = 0;

    } else if (tier === 11) { // THE HYPERION - "The Celestial Dreadnought"
        ctx.shadowBlur = 25; ctx.shadowColor = accentColor;
        ctx.lineWidth = 3;

        // 1. REINFORCED CHASSIS
        ctx.fillStyle = hullColor; ctx.strokeStyle = borderColor;
        ctx.beginPath();
        ctx.moveTo(r * 2.0, 0);               // Front Nose
        ctx.lineTo(r * 0.5, r * 0.8);          // Top Outer corner
        ctx.lineTo(-r * 1.2, r * 0.6);         // Top Back
        ctx.lineTo(-r * 1.5, 0);               // Rear Center
        ctx.lineTo(-r * 1.2, -r * 0.6);        // Bottom Back
        ctx.lineTo(r * 0.5, -r * 0.8);         // Bottom Outer corner
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // 2. ENERGY WINGS
        const pulse = 0.8 + Math.sin(Date.now() / 300) * 0.2;
        ctx.fillStyle = detailColor;
        ctx.strokeStyle = accentColor;

        // Top Wing
        ctx.beginPath();
        ctx.moveTo(r * 0.2, -r * 0.9);
        ctx.lineTo(r * 1.2, -r * 1.4);
        ctx.lineTo(r * 0.8, -r * 0.8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Bottom Wing
        ctx.beginPath();
        ctx.moveTo(r * 0.2, r * 0.9);
        ctx.lineTo(r * 1.2, r * 1.4);
        ctx.lineTo(r * 0.8, r * 0.8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // 3. CELESTIAL CORE
        ctx.shadowBlur = 40; ctx.shadowColor = '#fff';
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // 4. ENERGY CHANNELS
        ctx.shadowBlur = 0;
        ctx.strokeStyle = accentColor; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r * 2.0, 0); ctx.lineTo(r * 0.5, 0); // Core to nose
        ctx.stroke();

    } else if (tier === 10) { // THE TITAN - Heavy Dreadnought
        ctx.shadowBlur = 20; ctx.shadowColor = accentColor;
        ctx.fillStyle = hullColor; ctx.strokeStyle = borderColor; ctx.lineWidth = 4;

        // Main Block
        ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
        ctx.strokeRect(-r, -r * 0.6, r * 2, r * 1.2);

        // Side Armor
        ctx.fillStyle = detailColor;
        ctx.fillRect(-r * 0.5, -r * 1.2, r * 1.5, r * 0.6);
        ctx.strokeRect(-r * 0.5, -r * 1.2, r * 1.5, r * 0.6);
        ctx.fillRect(-r * 0.5, r * 0.6, r * 1.5, r * 0.6);
        ctx.strokeRect(-r * 0.5, r * 0.6, r * 1.5, r * 0.6);

    } else if (tier === 9) { // THE CELESTIAL - Radiant Star
        ctx.shadowBlur = 25; ctx.shadowColor = detailColor;
        ctx.fillStyle = hullColor; ctx.strokeStyle = borderColor; ctx.lineWidth = 2;

        // 4-Pointed Star
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = i * Math.PI / 4;
            const rad = (i % 2 === 0) ? r * 1.5 : r * 0.4;
            const px = Math.cos(angle) * rad; const py = Math.sin(angle) * rad;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Inner Spin
        ctx.strokeStyle = accentColor;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.stroke();

    } else if (tier === 8) { // THE SPHERE - Energy Orb
        ctx.shadowBlur = 20; ctx.shadowColor = accentColor;
        let grad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
        grad.addColorStop(0, '#fff'); grad.addColorStop(0.5, accentColor); grad.addColorStop(1, hullColor);
        ctx.fillStyle = grad;
        ctx.strokeStyle = borderColor; ctx.lineWidth = 2;

        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Rotating Ring
        ctx.save(); ctx.rotate(Date.now() / 500);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.4, r * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();

    } else if (tier >= 1 && tier <= 7) {
        // GEOMETRIC SHAPES (1-7)
        const sides = tier + 3;
        ctx.shadowBlur = 15; ctx.shadowColor = detailColor;
        ctx.fillStyle = hullColor;
        ctx.strokeStyle = borderColor; ctx.lineWidth = 3;

        // Polygon Body
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = i * (Math.PI * 2 / sides) - Math.PI / 2;
            const px = Math.cos(angle) * r; const py = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Internal "Cool" Details
        ctx.lineWidth = 1.5; ctx.strokeStyle = accentColor;
        ctx.beginPath();
        if (tier === 1) { // SQUARE
            ctx.moveTo(-r * 0.7, -r * 0.7); ctx.lineTo(r * 0.7, r * 0.7);
            ctx.moveTo(r * 0.7, -r * 0.7); ctx.lineTo(-r * 0.7, r * 0.7);
        } else if (tier === 2) { // PENTAGON
            for (let i = 0; i < 5; i++) {
                const a1 = i * (Math.PI * 2 / 5) - Math.PI / 2;
                const a2 = (i + 2) * (Math.PI * 2 / 5) - Math.PI / 2;
                ctx.moveTo(Math.cos(a1) * r, Math.sin(a1) * r);
                ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
            }
        } else if (tier === 3) { // HEXAGON
            ctx.moveTo(0, 0); ctx.lineTo(0, -r);
            ctx.moveTo(0, 0); ctx.lineTo(Math.cos(Math.PI / 6) * r, Math.sin(Math.PI / 6) * r);
            ctx.moveTo(0, 0); ctx.lineTo(Math.cos(Math.PI * 5 / 6) * r, Math.sin(Math.PI * 5 / 6) * r);
        } else { // HEPTAGON+
            const innerR = r * 0.5;
            for (let i = 0; i < sides; i++) {
                const angle = i * (Math.PI * 2 / sides) - Math.PI / 2;
                const px = Math.cos(angle) * innerR; const py = Math.sin(angle) * innerR;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
        }
        ctx.stroke();

    } else {
        // TIER 0: TRIANGLE (Classic Modern)
        const baseSize = r;
        const noseLength = 1.3;
        const wingSpan = 0.8;

        ctx.shadowBlur = 15; ctx.shadowColor = thrustColor;

        // Triangle
        ctx.beginPath();
        ctx.moveTo(baseSize * noseLength, 0);
        ctx.lineTo(-baseSize * 0.6, baseSize * wingSpan);
        ctx.lineTo(-baseSize * 0.6, -baseSize * wingSpan);
        ctx.closePath();

        let hullGrad = ctx.createLinearGradient(baseSize * 0.6, 0, -baseSize * 0.6, 0);
        hullGrad.addColorStop(0, detailColor);
        hullGrad.addColorStop(1, hullColor);
        ctx.fillStyle = hullGrad;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = borderColor;
        ctx.stroke();

        // Detail
        ctx.beginPath(); ctx.moveTo(r * 0.5, 0); ctx.lineTo(-r * 0.2, 0); ctx.stroke();
    }

    // === COMMON THRUSTER LOGIC ===
    if (isThrusting) {
        ctx.shadowBlur = 25; ctx.shadowColor = thrustColor;
        ctx.fillStyle = `${thrustColor}`.replace(')', ', 0.6)').replace('rgb', 'rgba').replace('hsl', 'hsla');
        const thrustL = 30 + Math.random() * 10;

        if (tier === 10) { // Titan: Dual Thrusters
            [-r * 0.9, r * 0.9].forEach(yPos => {
                ctx.beginPath();
                ctx.moveTo(-r, yPos - 5); ctx.lineTo(-r - thrustL, yPos); ctx.lineTo(-r, yPos + 5);
                ctx.fill();
            });
        } else if (tier === 11) { // Hyperion: Celestial Thrust
            ctx.beginPath();
            ctx.moveTo(-r * 1.5, -r * 0.3);
            ctx.lineTo(-r * 1.5 - thrustL * 1.5, 0);
            ctx.lineTo(-r * 1.5, r * 0.3);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(-r * 0.7, -r * 0.2);
            ctx.lineTo(-r * 0.7 - thrustL, 0);
            ctx.lineTo(-r * 0.7, r * 0.2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }
}

/**
 * Draws a futuristic bullet optimized for extreme performance.
 */
const _bulletColorCache = new Map();
function _getBulletColor(hue, s, l, a) {
    const key = `${hue},${s},${l},${a}`;
    if (!_bulletColorCache.has(key)) {
        _bulletColorCache.set(key, `hsla(${hue},${s}%,${l}%,${a})`);
    }
    return _bulletColorCache.get(key);
}

export function drawBullet(ctx, bullet, vpX, vpY) {
    const tier = bullet.tier || 0;
    const alpha = bullet.alpha !== undefined ? bullet.alpha : 1.0;
    const size = bullet.size || 5;
    const hue = bullet.hue !== undefined ? bullet.hue : (bullet.isFriendly ? 210 : 0);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';

    const xv = bullet.xv; const yv = bullet.yv;
    const ang = Math.atan2(yv, xv);

    // OPTIMIZED MOTION TRAIL: only draw if moving very fast AND higher tier to reduce overdraw
    const speedSq = xv * xv + yv * yv;
    if (speedSq > 100 && tier >= 4) {
        const speed = Math.sqrt(speedSq);
        const trailLen = Math.min(speed * 2, 100);
        ctx.strokeStyle = _getBulletColor(hue, 100, 60, 0.3);
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(vpX, vpY);
        ctx.lineTo(vpX - Math.cos(ang) * trailLen, vpY - Math.sin(ang) * trailLen);
        ctx.stroke();
    }

    ctx.translate(vpX, vpY);
    ctx.rotate(ang);

    if (tier >= 8) {
        // --- ULTIMATE: PERFORMANCE BOLT (fillRect is faster) ---
        // Fast paths, reduced pulse math
        const bLen = size * 10;

        ctx.fillStyle = _getBulletColor(hue, 100, 50, 0.15);
        ctx.fillRect(-bLen, -size * 3, bLen * 1.5, size * 6);

        ctx.fillStyle = _getBulletColor(hue, 100, 75, 0.8);
        ctx.fillRect(-bLen * 0.5, -size * 0.6, bLen * 1.2, size * 1.2);

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, -size * 0.3, bLen * 0.6, size * 0.6);

    } else if (tier >= 4) {
        // --- ADVANCED: PLASMA SPHERE ---
        ctx.fillStyle = _getBulletColor(hue, 100, 65, 0.3);
        ctx.beginPath(); ctx.arc(0, 0, size * 4, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = _getBulletColor(hue, 100, 80, 1);
        ctx.beginPath(); ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(size * 0.5, 0, size * 0.8, 0, Math.PI * 2); ctx.fill();

    } else {
        // --- STANDARD: KINETIC ---
        ctx.rotate(bullet.life * 0.1);
        const sides = 3 + tier;

        ctx.fillStyle = _getBulletColor(hue, 100, 70, 1);
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const a = i * (Math.PI * 2 / sides);
            const r = size;
            ctx[i === 0 ? 'moveTo' : 'lineTo'](r * Math.cos(a), r * Math.sin(a));
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, size * 0.35, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
}
