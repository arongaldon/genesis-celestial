import { ANOMALY_CONFIG, ASTEROID_CONFIG, GLOBAL_LIGHT, MAX_Z_DEPTH, SHIP_CONFIG, STATION_CONFIG, WORLD_BOUNDS, DOM } from '../core/config.js';
import { State } from '../core/state.js';
import { createAmbientFog } from './background.js';
import { getShipTier } from '../systems/scoring.js';
import { dist } from '../utils/utils.js';

export function drawPlanetTexture(ctx, x, y, r, textureData) {
    if (!textureData || isNaN(x) || isNaN(y) || isNaN(r)) return;

    // 1. Base ocean (Flat color for performance)
    ctx.fillStyle = textureData.waterColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // 2. Landmasses (Simple lines)
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = textureData.landColor;
    textureData.landmasses.forEach(lm => {
        ctx.beginPath();
        const radius = r * lm.radiusFactor;
        const centerX = x + Math.cos(lm.startAngle) * radius * 0.5;
        const centerY = y + Math.sin(lm.startAngle) * radius * 0.5;

        for (let j = 0; j < lm.vertices; j += 2) { // Skip vertices for speed
            const angle = (j / lm.vertices) * Math.PI * 2;
            const d = radius * lm.vertexOffsets[j];
            const px = centerX + Math.cos(angle) * d;
            const py = centerY + Math.sin(angle) * d;
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.fill();
    });
    ctx.restore();

    // 3. Craters (Flat circles, no strokes)
    ctx.fillStyle = textureData.craterColor;
    const craterSkipRate = r > 600 ? 3 : 1;

    for (let c = 0; c < textureData.craters.length; c += craterSkipRate) {
        const cr = textureData.craters[c];
        const cx = x + cr.xFactor * r;
        const cy = y + cr.yFactor * r;
        const crr = r * cr.rFactor;

        if (dist(x, y, cx, cy) + crr < r) {
            ctx.beginPath();
            ctx.arc(cx, cy, crr, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

export function drawWorldBoundary() {
    const ctx = DOM.canvasContext;
    ctx.save();
    const boundVpX = -State.worldOffsetX + State.width / 2;
    const boundVpY = -State.worldOffsetY + State.height / 2;
    ctx.beginPath();
    ctx.arc(boundVpX, boundVpY, WORLD_BOUNDS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
    ctx.lineWidth = 100;
    ctx.stroke();

    // Neon edge
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
    ctx.lineWidth = 20;
    ctx.stroke();
    ctx.restore();
}

export function drawBackgroundAndFog() {
    const ctx = DOM.canvasContext;

    // --- Ambient Fog Drawing ---
    ctx.globalCompositeOperation = 'screen';
    for (let i = State.ambientFogs.length - 1; i >= 0; i--) {
        const f = State.ambientFogs[i];

        // Fog position is in Viewport Coordinates
        f.x += f.xv - State.velocity.x;
        f.y += f.yv - State.velocity.y;
        f.life--;

        if (f.life <= 0 || f.x < -f.r * 0.5 || f.x > State.width + f.r * 0.5 || f.y > State.height + f.r * 0.5 || f.y < -f.r * 0.5) {
            State.ambientFogs.splice(i, 1);
            if (State.ambientFogs.length < 3) State.ambientFogs.push(createAmbientFog());
            continue;
        }

        if (!isFinite(f.x) || !isFinite(f.y) || !isFinite(f.r) || f.r <= 0) continue;
        const g = ctx.createRadialGradient(f.x, f.y, f.r * 0.1, f.x, f.y, f.r);
        g.addColorStop(0, `hsla(${f.hue}, 80%, 40%, ${f.alpha})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // --- Background Parallax Drawing ---
    const moveLayer = (list, factor) => list.forEach(item => {
        item.x -= State.velocity.x * factor;
        item.y -= State.velocity.y * factor;
        const e = item.r || item.size || 50;
        if (item.x < -e) item.x = State.width + e;
        else if (item.x > State.width + e) item.x = -e;
        if (item.y < -e) item.y = State.height + e;
        else if (item.y > State.height + e) item.y = -e;
    });

    ctx.globalCompositeOperation = 'screen';
    moveLayer(State.backgroundLayers.nebulas, 0.05);
    State.backgroundLayers.nebulas.forEach(n => {
        if (!isFinite(n.x) || !isFinite(n.y) || !isFinite(n.r) || n.r <= 0) return;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `hsla(${n.hue}, 80%, 40%, ${n.alpha})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    // Draw distant galaxies - unaffected by camera zoom, but still world-anchored
    ctx.save();
    if (State.viewScale !== 1.0) {
        ctx.translate(State.width / 2, State.height / 2);
        ctx.scale(1 / State.viewScale, 1 / State.viewScale);
        ctx.translate(-State.width / 2, -State.height / 2);
    }

    State.backgroundLayers.galaxies.forEach(g => {
        g.x -= State.velocity.x * 0.002;
        g.y -= State.velocity.y * 0.002;
        g.angle += 0.0005;

        const buffer = g.size * 1.5;
        if (g.x < -buffer || g.x > State.width + buffer || g.y < -buffer || g.y > State.height + buffer) {
            return;
        }

        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.angle);
        ctx.scale(1, g.squish || 1);

        const center = g.cachedCanvas.width / 2;
        ctx.drawImage(g.cachedCanvas, -center, -center);
        ctx.restore();
    });
    ctx.restore();

    // Draw starfield parallax layers
    moveLayer(State.backgroundLayers.starsFar, 0.02);
    moveLayer(State.backgroundLayers.starsMid, 0.08);
    moveLayer(State.backgroundLayers.starsNear, 0.16);
    const drawStars = (list, c) => {
        ctx.fillStyle = c;
        list.forEach(s => ctx.fillRect(s.x, s.y, s.size, s.size));
    };
    drawStars(State.backgroundLayers.starsFar, '#555');
    drawStars(State.backgroundLayers.starsMid, '#888');
    drawStars(State.backgroundLayers.starsNear, '#fff');
}

export function drawWormholes() {
    const ctx = DOM.canvasContext;
    for (const w of State.wormholes) {
        const vpX = w.x - State.worldOffsetX + State.width / 2;
        const vpY = w.y - State.worldOffsetY + State.height / 2;
        const pad = w.r * 2.5;
        if (vpX < -pad || vpX > State.width + pad || vpY < -pad || vpY > State.height + pad) continue;

        ctx.save();
        ctx.translate(vpX, vpY);

        // Outer gravitational pull ring
        const pulse = 0.85 + Math.sin(Date.now() / 300) * 0.15;
        const outerGrad = ctx.createRadialGradient(0, 0, w.r * 0.2, 0, 0, w.r * 1.8 * pulse);
        outerGrad.addColorStop(0, `hsla(${w.hue}, 100%, 70%, 0.6)`);
        outerGrad.addColorStop(0.5, `hsla(${w.hue}, 90%, 50%, 0.25)`);
        outerGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = outerGrad;
        ctx.beginPath();
        ctx.arc(0, 0, w.r * 1.8 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Swirling spiral accretion arms
        ctx.save();
        ctx.rotate(w.angle);
        ctx.strokeStyle = `hsla(${w.hue}, 100%, 75%, 0.75)`;
        ctx.lineWidth = 3;
        for (let arm = 0; arm < 4; arm++) {
            ctx.beginPath();
            const baseAngle = (arm * Math.PI) / 2;
            for (let t = 0; t <= 1; t += 0.1) {
                const rad = w.r * (0.25 + t * 0.9);
                const ang = baseAngle + t * Math.PI * 1.2;
                const px = Math.cos(ang) * rad;
                const py = Math.sin(ang) * rad;
                if (t === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
        ctx.restore();

        // Event horizon dark core
        ctx.fillStyle = '#020008';
        ctx.strokeStyle = `hsl(${w.hue}, 100%, 80%)`;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 20;
        ctx.shadowColor = `hsl(${w.hue}, 100%, 60%)`;
        ctx.beginPath();
        ctx.arc(0, 0, w.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }
}

export function drawSolarStorm() {
    const ctx = DOM.canvasContext;
    const storm = State.solarStorm;
    if (storm.warningTimer <= 0 && storm.activeTimer <= 0) return;

    if (storm.activeTimer > 0) {
        // Draw cool cyan planetary shadow safe-zone cones behind foreground planets
        for (const r of State.roids) {
            if (!r.isPlanet || r.z >= 0.5 || r._destroyed) continue;
            const vpX = r.x - State.worldOffsetX + State.width / 2;
            const vpY = r.y - State.worldOffsetY + State.height / 2;
            const ldx = r.x - GLOBAL_LIGHT.X;
            const ldy = r.y - GLOBAL_LIGHT.Y;
            const shadowAngle = Math.atan2(ldy, ldx);
            const shadowLength = r.r * 3.5;

            ctx.save();
            ctx.translate(vpX, vpY);
            ctx.rotate(shadowAngle);

            const shadowGrad = ctx.createLinearGradient(0, 0, shadowLength, 0);
            shadowGrad.addColorStop(0, 'rgba(0, 255, 220, 0.22)');
            shadowGrad.addColorStop(1, 'rgba(0, 255, 220, 0.0)');
            ctx.fillStyle = shadowGrad;
            ctx.beginPath();
            ctx.rect(0, -r.r * 0.95, shadowLength, r.r * 1.9);
            ctx.fill();

            ctx.strokeStyle = 'rgba(0, 255, 220, 0.35)';
            ctx.setLineDash([12, 12]);
            ctx.lineWidth = 2;
            ctx.strokeRect(0, -r.r * 0.95, shadowLength, r.r * 1.9);
            ctx.restore();
        }

        // Draw animated solar flare wind streaks in screen space
        ctx.save();
        ctx.resetTransform();
        const windDx = State.worldOffsetX - GLOBAL_LIGHT.X;
        const windDy = State.worldOffsetY - GLOBAL_LIGHT.Y;
        const windAngle = Math.atan2(windDy, windDx);

        const flareAlpha = Math.min(0.22, (storm.activeTimer / ANOMALY_CONFIG.SOLAR_STORM_DURATION_FRAMES) * 0.25);
        ctx.fillStyle = `rgba(255, 140, 0, ${flareAlpha * 0.5})`;
        ctx.fillRect(0, 0, State.width, State.height);

        ctx.strokeStyle = `rgba(255, 200, 80, ${flareAlpha * 1.8})`;
        ctx.lineWidth = 2;
        const now = Date.now();
        const cosA = Math.cos(windAngle);
        const sinA = Math.sin(windAngle);

        for (let i = 0; i < 28; i++) {
            const seedX = ((i * 197 + Math.floor(now * 0.8)) % (State.width + 400)) - 200;
            const seedY = ((i * 353 + Math.floor(now * 0.5)) % (State.height + 400)) - 200;
            const len = 80 + (i % 5) * 35;
            ctx.beginPath();
            ctx.moveTo(seedX, seedY);
            ctx.lineTo(seedX + cosA * len, seedY + sinA * len);
            ctx.stroke();
        }
        ctx.restore();
    } else if (storm.warningTimer > 0) {
        // Subtle pulsing amber border warning before storm hits
        ctx.save();
        ctx.resetTransform();
        const pulse = (Math.sin(Date.now() / 120) + 1) * 0.5;
        ctx.strokeStyle = `rgba(255, 150, 0, ${0.15 + pulse * 0.25})`;
        ctx.lineWidth = 16;
        ctx.strokeRect(0, 0, State.width, State.height);
        ctx.restore();
    }
}

export function drawRoidOrPlanet(r, depthScale, depthAlpha, vpX, vpY) {
    const ctx = DOM.canvasContext;
    const pad = Math.max(r.r * depthScale + 150, 200);
    if (vpX <= -pad || vpX >= State.width + pad || vpY <= -pad || vpY >= State.height + pad) return;

    ctx.save();
    ctx.translate(vpX, vpY);
    ctx.scale(depthScale, depthScale);
    ctx.globalAlpha = depthAlpha;

    if (r.blinkNum % 2 !== 0) {
        ctx.globalAlpha *= 0.3;
    }

    if (r.isPlanet) {
        drawPlanetTexture(ctx, 0, 0, r.r, r.textureData);
        ctx.globalAlpha = depthAlpha;
        ctx.fillStyle = 'white';
        ctx.font = `bold ${28 / depthScale}px Courier New`;
        ctx.textAlign = 'center';
        ctx.fillText(r.name, 0, r.r + (40 / depthScale));
    } else {
        if (r.isHot) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ff6600';
            ctx.strokeStyle = '#ffcc00';
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.fillStyle = r.color;
        ctx.beginPath();
        for (let j = 0; j < r.vert; j++) {
            const px = r.r * r.offs[j] * Math.cos(r.a + j * Math.PI * 2 / r.vert);
            const py = r.r * r.offs[j] * Math.sin(r.a + j * Math.PI * 2 / r.vert);
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // Dynamic volumetric shadow based on global light source
        const dx = GLOBAL_LIGHT.X - r.x;
        const dy = GLOBAL_LIGHT.Y - r.y;
        const lDist = Math.max(1, Math.hypot(dx, dy));
        const lDirX = dx / lDist;
        const lDirY = dy / lDist;

        const shadowGrad = ctx.createLinearGradient(
            lDirX * r.r, lDirY * r.r,
            -lDirX * r.r, -lDirY * r.r
        );
        shadowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
        shadowGrad.addColorStop(0.4, 'rgba(0, 0, 0, 0)');
        shadowGrad.addColorStop(0.8, 'rgba(0, 0, 0, 1.0)');
        ctx.fillStyle = shadowGrad;
        ctx.fill();

        // Draw Craters on larger asteroids
        if (r.r >= ASTEROID_CONFIG.MAX_SIZE * 0.8 && r.id % 2 === 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = 1;
            const craterCount = 1 + (r.id % 2);
            for (let c = 0; c < craterCount; c++) {
                const pseudoRand1 = ((r.id * 13 + c * 29) % 100) / 100;
                const pseudoRand2 = ((r.id * 17 + c * 31) % 100) / 100;
                const pseudoRand3 = ((r.id * 19 + c * 37) % 100) / 100;

                const d = r.r * 0.5 * pseudoRand1;
                const angle = pseudoRand2 * Math.PI * 2 + r.a;
                const crx = Math.cos(angle) * d;
                const cry = Math.sin(angle) * d;
                const crr = r.r * 0.08 + (pseudoRand3 * r.r * 0.15);

                ctx.beginPath();
                ctx.ellipse(crx, cry, crr, crr * 0.85, angle, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        // Draw lava veins if hot
        if (r.isHot) {
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#ff3300';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let j = 0; j < r.vert; j += 2) {
                const px = r.r * 0.5 * r.offs[j] * Math.cos(r.a + j * Math.PI * 2 / r.vert);
                const py = r.r * 0.5 * r.offs[j] * Math.sin(r.a + j * Math.PI * 2 / r.vert);
                if (j === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
    ctx.restore();
}

export function drawStationShape(ctx, station) {
    const haloColor = `hsl(${station.fleetHue}, 100%, 70%)`;
    const bodyColor = `hsl(${station.fleetHue}, 80%, 50%)`;
    const coreColor = `hsl(${(station.fleetHue + 120) % 360}, 100%, 60%)`;
    const accentColor = `hsl(${station.fleetHue}, 90%, 65%)`;
    const stationR = station.r;

    // === OUTER HEXAGONAL STRUCTURE ===
    ctx.shadowBlur = 25;
    ctx.shadowColor = haloColor;

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI / 3) + station.a;
        const x = Math.cos(angle) * stationR * 1.1;
        const y = Math.sin(angle) * stationR * 1.1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const hexGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, stationR * 1.1);
    hexGrad.addColorStop(0, `hsl(${station.fleetHue}, 60%, 40%)`);
    hexGrad.addColorStop(0.7, `hsl(${station.fleetHue}, 70%, 25%)`);
    hexGrad.addColorStop(1, `hsl(${station.fleetHue}, 50%, 15%)`);

    ctx.fillStyle = hexGrad;
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = haloColor;
    ctx.stroke();

    // === ROTATING ENERGY RINGS ===
    ctx.shadowBlur = 20;
    ctx.lineWidth = 3;
    ctx.strokeStyle = accentColor;
    ctx.beginPath();
    ctx.arc(0, 0, stationR * 0.9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(0, 0, stationR * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    // === CONNECTING SPOKES (6 spokes to match hexagon) ===
    ctx.shadowBlur = 15;
    ctx.lineWidth = 2;
    ctx.strokeStyle = accentColor;

    for (let k = 0; k < 6; k++) {
        const angle = (k * Math.PI / 3) + station.a;
        const rInner = stationR * 0.4;
        const rOuter = stationR * 0.95;

        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * rInner, Math.sin(angle) * rInner);
        ctx.lineTo(Math.cos(angle) * rOuter, Math.sin(angle) * rOuter);
        ctx.stroke();

        ctx.fillStyle = haloColor;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * rOuter, Math.sin(angle) * rOuter, stationR * 0.06, 0, Math.PI * 2);
        ctx.fill();
    }

    // === PULSING CORE ===
    ctx.shadowBlur = 30;
    ctx.shadowColor = coreColor;

    const pulsePhase = (Date.now() % 2000) / 2000;
    const pulseSize = 0.3 + Math.sin(pulsePhase * Math.PI * 2) * 0.05;

    const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, stationR * pulseSize);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.3, coreColor);
    coreGrad.addColorStop(1, bodyColor);

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, stationR * pulseSize, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // === ENERGY PARTICLES ===
    ctx.shadowBlur = 10;
    for (let p = 0; p < 8; p++) {
        const particleAngle = (p * Math.PI / 4) + (Date.now() / 1000) + station.a;
        const particleR = stationR * (0.8 + Math.sin((Date.now() / 500) + p) * 0.1);
        const px = Math.cos(particleAngle) * particleR;
        const py = Math.sin(particleAngle) * particleR;

        ctx.fillStyle = `hsla(${station.fleetHue}, 100%, 80%, ${0.6 + Math.random() * 0.4})`;
        ctx.beginPath();
        ctx.arc(px, py, stationR * 0.03, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.shadowBlur = 0;
    if (station.isFriendly) {
        drawHeart(ctx, 0, -station.r * 0.1, station.r * 0.2);
    }
}

export function drawEntity(shipToDraw) {
    const ctx = DOM.canvasContext;
    let depthScale = 1;
    let depthAlpha = 1;
    if (shipToDraw.z > 0) {
        depthScale = 1 / (1 + shipToDraw.z);
        depthAlpha = Math.max(0.1, 1 - (shipToDraw.z / MAX_Z_DEPTH));
    }

    const vpX = (shipToDraw.x - State.worldOffsetX) * depthScale + State.width / 2;
    const vpY = (shipToDraw.y - State.worldOffsetY) * depthScale + State.height / 2;

    if (shipToDraw.shieldHitTimer > 0) {
        shipToDraw.shieldHitTimer--;
    }

    const pad = Math.max((shipToDraw.r || 50) * depthScale + 150, 200);
    if (vpX <= -pad || vpX >= State.width + pad || vpY <= -pad || vpY >= State.height + pad) return;

    ctx.shadowBlur = 15;

    // Proximity fading for friends
    let alpha = depthAlpha;
    if (shipToDraw.isFriendly) {
        const distToPlayer = dist(shipToDraw.x, shipToDraw.y, State.worldOffsetX, State.worldOffsetY);
        const fadeStart = 300;
        const fadeEnd = 50;
        if (distToPlayer < fadeStart) {
            const ratio = Math.max(0, (distToPlayer - fadeEnd) / (fadeStart - fadeEnd));
            alpha *= 0.4 + 0.6 * ratio;
        }
    }

    ctx.globalAlpha = (shipToDraw.blinkNum % 2 !== 0) ? 0.5 : alpha;

    ctx.save();
    ctx.translate(vpX, vpY);
    ctx.scale(depthScale, depthScale);
    ctx.rotate(shipToDraw.a);

    if (shipToDraw.type === 'ship') {
        const tier = getShipTier(shipToDraw);
        drawShipShape({
            ctx,
            r: shipToDraw.r,
            tier,
            hullColor: `hsl(${shipToDraw.fleetHue}, 60%, 30%)`,
            borderColor: `hsl(${shipToDraw.fleetHue}, 40%, 50%)`,
            detailColor: `hsl(${shipToDraw.fleetHue}, 80%, 60%)`,
            accentColor: `hsl(${(shipToDraw.fleetHue + 180) % 360}, 90%, 60%)`,
            thrustColor: `hsl(${shipToDraw.fleetHue}, 100%, 70%)`,
            isThrusting: true
        });
        ctx.shadowBlur = 0;
        if (shipToDraw.isFriendly) {
            drawHeart(ctx, 0, -5, 8);
        }
    } else {
        drawStationShape(ctx, shipToDraw);
    }

    ctx.restore();
    ctx.globalAlpha = 1;

    if (shipToDraw.isNemesis) {
        ctx.save();
        const nemesisPulse = 0.7 + Math.sin(Date.now() / 150) * 0.3;
        ctx.strokeStyle = `rgba(255, 204, 0, ${nemesisPulse})`;
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 20;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(vpX, vpY, (shipToDraw.r + 18) * depthScale, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffcc00';
        ctx.font = `bold ${Math.max(12, Math.round(16 * depthScale))}px Courier New`;
        ctx.textAlign = 'center';
        ctx.fillText(`★ ${shipToDraw.nemesisName} ★`, vpX, vpY - (shipToDraw.r + 26) * depthScale);
        ctx.restore();
    }

    // Entity shield rendering
    const currentHP = shipToDraw.structureHP;
    const maxHP = shipToDraw.type === 'station' ? STATION_CONFIG.RESISTANCE : (shipToDraw.maxStructureHP || SHIP_CONFIG.RESISTANCE);
    let shieldOpacity = 0;
    let r = 0, g = 255, b = 255;

    if (currentHP === maxHP) {
        shieldOpacity = 0.8;
    }

    if (shipToDraw.type === 'station') {
        if (shipToDraw.z >= 0.5) return;
        if (currentHP >= STATION_CONFIG.RESISTANCE * 2 / 3) {
            r = 0; g = 255; b = 255;
            shieldOpacity = 1.0;
        } else if (currentHP >= STATION_CONFIG.RESISTANCE / 2) {
            r = 255; g = 165; b = 0;
            shieldOpacity = 0.7;
        } else {
            r = 255; g = 0; b = 0;
            shieldOpacity = 0.5;
        }
    }

    ctx.lineWidth = 2;
    if (shieldOpacity > 0) {
        if (shipToDraw.shieldHitTimer > 0) {
            ctx.shadowColor = '#fff';
            ctx.strokeStyle = `rgba(255,255,255,${shieldOpacity})`;
        } else {
            ctx.shadowColor = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = `rgba(${r},${g},${b},${shieldOpacity})`;
        }
        ctx.beginPath();
        ctx.arc(vpX, vpY, shipToDraw.r + 10, 0, Math.PI * 2);
        ctx.stroke();
    }
}

export function drawPlayerShip() {
    const ctx = DOM.canvasContext;
    ctx.shadowBlur = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;

    if (!State.playerShip.dead) {
        ctx.save();

        if (State.playerShip.shield < State.playerShip.maxShield) {
            State.playerShip.shield += 0.05;
        }

        const isTesla = State.playerShip.maxShield > SHIP_CONFIG.BASE_MAX_SHIELD;
        const tier = State.playerShip.tier;

        const baseShipRadius = SHIP_CONFIG.SIZE / 2;
        const maxTierRadius = baseShipRadius + (7 * 2);
        State.playerShip.effectiveR = tier >= 8 ? maxTierRadius : baseShipRadius + (tier * 2);

        const centerX = State.width / 2;
        const centerY = State.height / 2;
        const r = State.playerShip.effectiveR;

        if (State.playerShip.blinkNum % 2 === 0) {
            let shieldAlpha = 0;
            let strokeWidth = 1;
            const shieldRadius = tier >= 8 ? r * 1.7 : r + 10;

            if (State.playerShip.structureHP === SHIP_CONFIG.RESISTANCE) {
                shieldAlpha = isTesla ? (0.5 + Math.random() * 0.2) : 0.5;
                strokeWidth = isTesla ? 1.5 : 1;
            }

            if (shieldAlpha > 0) {
                ctx.lineWidth = strokeWidth;
                ctx.shadowColor = 'rgba(0, 255, 255, 0.7)';
                ctx.strokeStyle = `rgba(0, 255, 255, ${shieldAlpha})`;
                ctx.beginPath();
                ctx.arc(centerX, centerY, shieldRadius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(State.playerShip.a);
            ctx.globalAlpha = 1;

            const playerHue = SHIP_CONFIG.FRIENDLY_BLUE_HUE;
            let norm = 1.0;
            let transformationProgress = 1.0;

            if (tier >= SHIP_CONFIG.GODSHIP_TIER) {
                norm = 1.2;
                if (State.playerShip.transformationTimer > 0) {
                    transformationProgress = 1 - (State.playerShip.transformationTimer / SHIP_CONFIG.TRANSFORMATION_FRAMES);
                    norm = 1.0 + (norm - 1.0) * transformationProgress;
                }
            }

            drawShipShape({
                ctx,
                r,
                tier,
                norm,
                transformationProgress,
                hullColor: `hsl(${playerHue}, 60%, 20%)`,
                borderColor: `hsl(${playerHue}, 100%, 70%)`,
                detailColor: `hsl(${playerHue}, 100%, 60%)`,
                accentColor: `hsl(${(playerHue + 180) % 360}, 90%, 60%)`,
                thrustColor: '#ffaa00',
                isThrusting: State.playerShip.thrusting
            });
            ctx.restore();
        }
        ctx.restore();
    }

    if (State.playerShip.blinkNum > 0) {
        State.playerShip.blinkNum--;
    }
}

export function updateAndDrawParticles() {
    const ctx = DOM.canvasContext;
    for (let i = State.particles.length - 1; i >= 0; i--) {
        const p = State.particles[i];
        p.x += p.xv;
        p.y += p.yv;

        const vpX = p.x - State.worldOffsetX + State.width / 2;
        const vpY = p.y - State.worldOffsetY + State.height / 2;

        if (p.type === 'flame') {
            ctx.globalAlpha = p.life / 60;
            ctx.shadowBlur = 15;
            ctx.shadowColor = p.color;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            const flameSize = Math.max(0.1, p.size * (1 + Math.sin(p.life * 0.2) * 0.3));
            ctx.arc(vpX, vpY, flameSize, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.type === 'smoke') {
            ctx.globalAlpha = (p.life / 100) * 0.4;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            const smokeSize = Math.max(0.1, p.size * (1 + (100 - p.life) * 0.05));
            ctx.arc(vpX, vpY, smokeSize, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.shadowColor = p.color;
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life / 60;
            if (p.type === 'debris' || p.type === 'spark') {
                ctx.fillRect(vpX - p.size / 2, vpY - p.size / 2, p.size, p.size);
            } else {
                ctx.beginPath();
                ctx.arc(vpX, vpY, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        p.life--;
        if (p.life <= 0) State.particles.splice(i, 1);
    }
}

export function drawOffScreenIndicators() {
    if (State.playerShip.dead && State.playerShip.lives <= 0) return;
    const ctx = DOM.canvasContext;

    ctx.save();
    ctx.resetTransform();
    const INDICATOR_SIZE = 8;
    const BORDER_PADDING = 20;
    const DETECTION_RANGE = 3000;

    State.ships.forEach(e => {
        if (e.isFriendly || e.z > 0.5) return;

        const depthScale = 1 / (1 + e.z);
        const worldVpX = (e.x - State.worldOffsetX) * depthScale + State.width / 2;
        const worldVpY = (e.y - State.worldOffsetY) * depthScale + State.height / 2;

        const vpX = worldVpX * State.viewScale + State.width / 2 * (1 - State.viewScale);
        const vpY = worldVpY * State.viewScale + State.height / 2 * (1 - State.viewScale);

        const isOffScreen = vpX < 0 || vpX > State.width || vpY < 0 || vpY > State.height;
        const distToPlayer = dist(e.x, e.y, State.worldOffsetX, State.worldOffsetY);
        const maxRange = e.isNemesis ? DETECTION_RANGE * 2.5 : DETECTION_RANGE;

        if (isOffScreen && distToPlayer < maxRange) {
            const indicatorX = Math.max(BORDER_PADDING, Math.min(State.width - BORDER_PADDING, vpX));
            const indicatorY = Math.max(BORDER_PADDING, Math.min(State.height - BORDER_PADDING, vpY));

            const pulseAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.3;
            const size = e.isNemesis ? INDICATOR_SIZE * 1.6 : INDICATOR_SIZE;
            ctx.globalAlpha = e.isNemesis ? 0.95 : pulseAlpha;
            ctx.fillStyle = e.isNemesis ? '#ffcc00' : '#FF0000';
            ctx.shadowColor = e.isNemesis ? '#ff0055' : '#FF0000';
            ctx.shadowBlur = e.isNemesis ? 16 : 10;

            const angleToEnemy = Math.atan2(vpY - indicatorY, vpX - indicatorX);
            ctx.save();
            ctx.translate(indicatorX, indicatorY);
            ctx.rotate(angleToEnemy);

            ctx.beginPath();
            ctx.moveTo(size, 0);
            ctx.lineTo(-size / 2, -size / 2);
            ctx.lineTo(-size / 2, size / 2);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
            ctx.globalAlpha = 1;
        }
    });

    ctx.restore();
    ctx.shadowBlur = 0;
}

export function drawScreenMessages() {
    if (State.playerShip.dead && State.playerShip.lives <= 0) return;
    if (State.screenMessages.length === 0) return;

    const ctx = DOM.canvasContext;
    ctx.save();
    ctx.resetTransform();
    ctx.textAlign = 'center';

    const fontSize = Math.max(14, Math.min(24, State.width / 30));
    ctx.font = `bold ${fontSize}px Courier New`;

    for (let i = State.screenMessages.length - 1; i >= 0; i--) {
        const m = State.screenMessages[i];
        ctx.globalAlpha = Math.min(1, m.life / 30);
        ctx.fillStyle = m.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = m.color;

        const yPos = State.height * 0.3 + (i * (fontSize + 16));
        ctx.fillText(m.text, State.width / 2, yPos, State.width * 0.9);

        m.life--;
        if (m.life <= 0) State.screenMessages.splice(i, 1);
    }
    ctx.restore();
}

export function drawRadar() {
    try {
        const rW = DOM.canvasRadar.width;
        const rH = DOM.canvasRadar.height;
        const cX = rW / 2;
        const cY = rH / 2;
        DOM.canvasRadarContext.clearRect(0, 0, rW, rH);

        const radarRadius = rW / 2;
        const scale = radarRadius / Math.max(1, State.RADAR_RANGE);

        const drawBlip = (worldX, worldY, type, color, size, z = 0) => {
            if (!isFinite(worldX) || !isFinite(worldY)) return;

            const dx = worldX - State.worldOffsetX;
            const dy = worldY - State.worldOffsetY;
            if (isNaN(dx) || isNaN(dy)) return;

            const maxRadarDist = State.RADAR_RANGE + size;
            if (Math.abs(dx) > maxRadarDist || Math.abs(dy) > maxRadarDist) {
                if (type !== 'planet' && type !== 'background_planet') return;
            }

            const d = Math.hypot(dx, dy);
            if (d - size > State.RADAR_RANGE || !isFinite(d)) {
                if (type !== 'planet' && type !== 'background_planet') return;
            }

            const angle = Math.atan2(dy, dx);
            let radarDist = d * scale;
            let radarSize = (size * scale) / (1 + z);

            if (type === 'planet') radarSize = Math.max(4, radarSize);
            else if (type === 'asteroid') radarSize = Math.max(1.5, radarSize);
            else radarSize = Math.max(2, radarSize);

            if (!isFinite(radarSize)) radarSize = 2;

            if (type !== 'planet' && type !== 'background_planet' && radarDist > radarRadius - radarSize) {
                radarDist = Math.max(0, radarRadius - radarSize - 1);
            }
            if (!isFinite(radarDist)) return;

            const rx = cX + radarDist * Math.cos(angle);
            const ry = cY + radarDist * Math.sin(angle);
            if (isNaN(rx) || isNaN(ry)) return;

            DOM.canvasRadarContext.fillStyle = color;
            DOM.canvasRadarContext.strokeStyle = color;

            if (type === 'station') {
                DOM.canvasRadarContext.font = "bold 12px Courier New";
                DOM.canvasRadarContext.textAlign = 'center';
                DOM.canvasRadarContext.textBaseline = 'middle';
                DOM.canvasRadarContext.fillText('O', rx, ry);
            } else if (type === 'wormhole') {
                DOM.canvasRadarContext.font = "bold 11px Courier New";
                DOM.canvasRadarContext.textAlign = 'center';
                DOM.canvasRadarContext.textBaseline = 'middle';
                DOM.canvasRadarContext.fillText('@', rx, ry);
            } else if (type === 'asteroid' || type === 'planet' || type === 'background_planet') {
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.arc(rx, ry, radarSize, 0, Math.PI * 2);
                DOM.canvasRadarContext.stroke();
            } else {
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.arc(rx, ry, radarSize, 0, Math.PI * 2);
                DOM.canvasRadarContext.fill();
            }
        };

        for (let i = 0; i < State.wormholes.length; i++) {
            const w = State.wormholes[i];
            drawBlip(w.x, w.y, 'wormhole', `hsl(${w.hue}, 100%, 70%)`, w.r, 0);
        }

        for (let i = 0; i < State.roids.length; i++) {
            const r = State.roids[i];
            if (r.isPlanet) {
                const color = r.textureData ? r.textureData.waterColor : 'rgba(0, 150, 255, 0.7)';
                if (r.z < 0.5) {
                    drawBlip(r.x, r.y, 'planet', color, r.r, r.z);
                } else {
                    drawBlip(r.x, r.y, 'background_planet', color, 4, r.z);
                }
            } else if (r.z <= 0.1) {
                drawBlip(r.x, r.y, 'asteroid', 'rgba(200, 200, 200, 0.9)', Math.max(10, r.r), r.z);
            }
        }

        for (let i = 0; i < State.ships.length; i++) {
            const e = State.ships[i];
            if (e.z <= 0.1) {
                const color = e.isFriendly ? '#0088FF' : (e.isNemesis ? '#FFCC00' : '#FF0000');
                const blipSize = e.type === 'station' ? 0 : (e.isNemesis ? 4 : 2);
                drawBlip(e.x, e.y, e.type === 'station' ? 'station' : 'ship', color, blipSize, e.z);
            }
        }

        DOM.canvasRadarContext.strokeStyle = 'rgba(0, 255, 255, 0.2)';
        DOM.canvasRadarContext.lineWidth = 1;
        DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.moveTo(cX, 0); DOM.canvasRadarContext.lineTo(cX, rH); DOM.canvasRadarContext.stroke();
        DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.moveTo(0, cY); DOM.canvasRadarContext.lineTo(rW, cY); DOM.canvasRadarContext.stroke();
        DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.arc(cX, cY, rW / 2 - 1, 0, Math.PI * 2); DOM.canvasRadarContext.stroke();
        DOM.canvasRadarContext.fillStyle = '#0ff';
        DOM.canvasRadarContext.beginPath(); DOM.canvasRadarContext.arc(cX, cY, 3, 0, Math.PI * 2); DOM.canvasRadarContext.fill();

        // 4. HOME PLANET NAVIGATOR (Dotted path to home)
        if (State.homePlanetId) {
            const home = State.roids.find(r => r.id === State.homePlanetId);
            if (home) {
                const dx = home.x - State.worldOffsetX;
                const dy = home.y - State.worldOffsetY;
                const d = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx);

                const radarDist = Math.min(d * scale, radarRadius - 5);
                const rx = cX + radarDist * Math.cos(angle);
                const ry = cY + radarDist * Math.sin(angle);

                DOM.canvasRadarContext.setLineDash([3, 5]);
                DOM.canvasRadarContext.strokeStyle = 'rgba(0, 255, 255, 0.5)';
                DOM.canvasRadarContext.lineWidth = 1;
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.moveTo(cX, cY);
                DOM.canvasRadarContext.lineTo(rx, ry);
                DOM.canvasRadarContext.stroke();
                DOM.canvasRadarContext.setLineDash([]);

                DOM.canvasRadarContext.fillStyle = '#00ffaa';
                DOM.canvasRadarContext.beginPath();
                DOM.canvasRadarContext.arc(rx, ry, 4, 0, Math.PI * 2);
                DOM.canvasRadarContext.fill();

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
        let asteroidCount = 0;
        for (let i = 0; i < State.roids.length; i++) {
            if (!State.roids[i].isPlanet) asteroidCount++;
        }
        DOM.asteroidCountDisplay.innerText = asteroidCount;
    }
    if (DOM.hudTop && State.velocity && State.playerShip && !State.playerShip.dead) {
        const spd = Math.hypot(State.velocity.x, State.velocity.y);
        let opacity = 1.0 - (spd / SHIP_CONFIG.MAX_SPEED) * 0.4;
        opacity = Math.max(0.4, Math.min(1.0, opacity));
        DOM.hudTop.style.opacity = opacity.toFixed(2);
    } else if (DOM.hudTop) {
        DOM.hudTop.style.opacity = 1.0;
    }
}

export function showInfoLEDText(text) {
    DOM.infoLED.innerHTML = '';
    const characters = text.split('');
    let i = 0;
    let line = '';
    function show() {
        if (i < characters.length) {
            line += characters[i];
            DOM.infoLED.textContent = line;
            i++;
            setTimeout(show, 50);
        }
    }
    show();
}

export function addScreenMessage(text, color = "white") {
    if (State.screenMessages.length > 0 && State.screenMessages[State.screenMessages.length - 1].text === text) return;
    State.screenMessages.push({ text, color, life: 180 }); // 3 seconds at 60fps

    if (State.screenMessages.length > 2) {
        State.screenMessages.shift();
    }
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
        if (transformationProgress < 1) {
            ctx.save();
            ctx.globalAlpha = 1 - transformationProgress;
            const sides = 3 + 11;
            ctx.beginPath();
            for (let i = 0; i <= sides; i++) {
                const ang = i * (2 * Math.PI / sides);
                if (i === 0) ctx.moveTo(r * Math.cos(ang), -r * Math.sin(ang));
                else ctx.lineTo(r * Math.cos(ang), -r * Math.sin(ang));
            }
            ctx.closePath();
            const chassisGrad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
            chassisGrad.addColorStop(0, '#0055aa');
            chassisGrad.addColorStop(1, '#002244');
            ctx.fillStyle = chassisGrad;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#0088ff';
            ctx.stroke();
            ctx.restore();
        }

        ctx.globalAlpha = transformationProgress;
        const HULL_COLOR = hullColor || '#050505';
        const BORDER_COLOR = borderColor || '#00FFFF';
        const CORE_COLOR = thrustColor || '#FFFFFF';

        ctx.beginPath();
        ctx.moveTo(r * 2.5 * norm, 0);
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

        ctx.beginPath();
        ctx.moveTo(r * 2 * norm, 0);
        ctx.lineTo(-r * 1.5 * norm, r * 0.8 * norm);
        ctx.moveTo(r * 2 * norm, 0);
        ctx.lineTo(-r * 1.5 * norm, -r * 0.8 * norm);
        ctx.stroke();

        const pulse = 0.7 + Math.sin(Date.now() / 200) * 0.3;
        ctx.fillStyle = CORE_COLOR;
        ctx.beginPath();
        ctx.arc(0, 0, r * norm * 0.6 * pulse, 0, Math.PI * 2);
        ctx.fill();

        const EXHAUST_X = -r * 3 * norm;
        if (isThrusting) {
            ctx.fillStyle = `${thrustColor || 'rgba(0, 255, 255)'}`.replace(')', ', 0.6)').replace('rgb', 'rgba');
            ctx.beginPath();
            ctx.moveTo(EXHAUST_X, -r * 1.2 * norm);
            ctx.lineTo(EXHAUST_X, r * 1.2 * norm);
            ctx.lineTo(EXHAUST_X - r * 12 * norm * (0.8 + Math.random() * 0.4), 0);
            ctx.closePath();
            ctx.fill();
        }
    } else if (tier === 11) { // THE HYPERION - "The Celestial Dreadnought"
        ctx.lineWidth = 3;
        ctx.fillStyle = hullColor;
        ctx.strokeStyle = borderColor;
        ctx.beginPath();
        ctx.moveTo(r * 2.0, 0);
        ctx.lineTo(r * 0.5, r * 0.8);
        ctx.lineTo(-r * 1.2, r * 0.6);
        ctx.lineTo(-r * 1.5, 0);
        ctx.lineTo(-r * 1.2, -r * 0.6);
        ctx.lineTo(r * 0.5, -r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = detailColor;
        ctx.strokeStyle = accentColor;

        ctx.beginPath();
        ctx.moveTo(r * 0.2, -r * 0.9);
        ctx.lineTo(r * 1.2, -r * 1.4);
        ctx.lineTo(r * 0.8, -r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(r * 0.2, r * 0.9);
        ctx.lineTo(r * 1.2, r * 1.4);
        ctx.lineTo(r * 0.8, r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r * 2.0, 0);
        ctx.lineTo(r * 0.5, 0);
        ctx.stroke();
    } else if (tier === 10) { // THE TITAN - Heavy Dreadnought
        ctx.fillStyle = hullColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 4;

        ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
        ctx.strokeRect(-r, -r * 0.6, r * 2, r * 1.2);

        ctx.fillStyle = detailColor;
        ctx.fillRect(-r * 0.5, -r * 1.2, r * 1.5, r * 0.6);
        ctx.strokeRect(-r * 0.5, -r * 1.2, r * 1.5, r * 0.6);
        ctx.fillRect(-r * 0.5, r * 0.6, r * 1.5, r * 0.6);
        ctx.strokeRect(-r * 0.5, r * 0.6, r * 1.5, r * 0.6);
    } else if (tier === 9) { // THE CELESTIAL - Radiant Star
        ctx.fillStyle = hullColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;

        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = i * Math.PI / 4;
            const rad = (i % 2 === 0) ? r * 1.5 : r * 0.4;
            const px = Math.cos(angle) * rad;
            const py = Math.sin(angle) * rad;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = accentColor;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
        ctx.stroke();
    } else if (tier === 8) { // THE SPHERE - Energy Orb
        const grad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(0.5, accentColor);
        grad.addColorStop(1, hullColor);
        ctx.fillStyle = grad;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.rotate(Date.now() / 500);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.4, r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    } else if (tier >= 1 && tier <= 7) {
        // GEOMETRIC SHAPES (1-7)
        const sides = tier + 3;
        ctx.fillStyle = hullColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 3;

        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = i * (Math.PI * 2 / sides) - Math.PI / 2;
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = accentColor;
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
                const px = Math.cos(angle) * innerR;
                const py = Math.sin(angle) * innerR;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
        }
        ctx.stroke();
    } else {
        // TIER 0: TRIANGLE (Classic Modern)
        const baseSize = r;
        const noseLength = 1.3;
        const wingSpan = 0.8;

        ctx.beginPath();
        ctx.moveTo(baseSize * noseLength, 0);
        ctx.lineTo(-baseSize * 0.6, baseSize * wingSpan);
        ctx.lineTo(-baseSize * 0.6, -baseSize * wingSpan);
        ctx.closePath();

        const hullGrad = ctx.createLinearGradient(baseSize * 0.6, 0, -baseSize * 0.6, 0);
        hullGrad.addColorStop(0, detailColor);
        hullGrad.addColorStop(1, hullColor);
        ctx.fillStyle = hullGrad;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = borderColor;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(r * 0.5, 0);
        ctx.lineTo(-r * 0.2, 0);
        ctx.stroke();
    }

    // === COMMON THRUSTER LOGIC ===
    if (isThrusting && tier < 12) {
        ctx.fillStyle = `${thrustColor}`.replace(')', ', 0.6)').replace('rgb', 'rgba').replace('hsl', 'hsla');
        const thrustL = 30 + Math.random() * 10;

        if (tier === 10) { // Titan: Dual Thrusters
            [-r * 0.9, r * 0.9].forEach(yPos => {
                ctx.beginPath();
                ctx.moveTo(-r, yPos - 5);
                ctx.lineTo(-r - thrustL, yPos);
                ctx.lineTo(-r, yPos + 5);
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

    const xv = bullet.xv;
    const yv = bullet.yv;
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
        const bLen = size * 10;
        ctx.fillStyle = _getBulletColor(hue, 100, 50, 0.15);
        ctx.fillRect(-bLen, -size * 3, bLen * 1.5, size * 6);

        ctx.fillStyle = _getBulletColor(hue, 100, 75, 0.8);
        ctx.fillRect(-bLen * 0.5, -size * 0.6, bLen * 1.2, size * 1.2);

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, -size * 0.3, bLen * 0.6, size * 0.6);
    } else if (tier >= 4) {
        ctx.fillStyle = _getBulletColor(hue, 100, 65, 0.3);
        ctx.beginPath(); ctx.arc(0, 0, size * 4, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = _getBulletColor(hue, 100, 80, 1);
        ctx.beginPath(); ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(size * 0.5, 0, size * 0.8, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.rotate(bullet.life * 0.1);
        const sides = 3 + tier;

        ctx.fillStyle = _getBulletColor(hue, 100, 70, 1);
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const a = i * (Math.PI * 2 / sides);
            ctx[i === 0 ? 'moveTo' : 'lineTo'](size * Math.cos(a), size * Math.sin(a));
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, size * 0.35, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
}
