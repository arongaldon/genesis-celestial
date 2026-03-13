import { State } from '../core/state.js';
import { ASTEROID_CONFIG } from '../core/config.js';
import { createAsteroid } from '../entities/entities.js';
import { updateAsteroidCounter } from './render.js';

export function createExplosion(vpX, vpY, n, color = 'white', sizeBase = 1, type = 'spark') {
    // Hard cap to prevent FPS drops during massive chains
    if ((type === 'spark' || type === 'smoke') && State.particles.length > 600) return;

    for (let i = 0; i < n; i++) {
        const pWorldX = vpX - State.width / 2 + State.worldOffsetX;
        const pWorldY = vpY - State.height / 2 + State.worldOffsetY;
        let life = 30 + Math.random() * 20;
        let speed = 10;
        if (type === 'debris') { life = 60 + Math.random() * 40; speed = 3; }
        if (type === 'flame') { life = 40 + Math.random() * 40; speed = 5 + Math.random() * 10; }
        if (type === 'smoke') { life = 80 + Math.random() * 60; speed = 2 + Math.random() * 3; }

        State.particles.push({
            x: pWorldX,
            y: pWorldY,
            xv: (Math.random() - 0.5) * speed,
            yv: (Math.random() - 0.5) * speed,
            life,
            color,
            size: Math.random() * 2 + sizeBase,
            type
        });
    }
}

export function createShockwave(worldX, worldY) {
    State.shockwaves.push({ x: worldX, y: worldY, r: 10, maxR: 1200, strength: 30, alpha: 1 });
}

export function createExplosionDebris(cx, cy, count, isHot = false) {
    // If we're already crowded, don't spawn as many debris pieces
    let spawnLimit = count;
    if (State.roids.length > ASTEROID_CONFIG.MAX_ROIDS * 0.8) spawnLimit = Math.floor(count * 0.5);
    if (State.roids.length >= ASTEROID_CONFIG.MAX_ROIDS) spawnLimit = 0;

    for (let i = 0; i < spawnLimit; i++) {
        const angle = Math.random() * Math.PI * 2;
        const offset = Math.random() * 600; // Spread them out widely to prevent overlap cascades
        const x = cx + Math.cos(angle) * offset;
        const y = cy + Math.sin(angle) * offset;

        // Make debris smaller than MAX_SIZE to avoid instant giant splitting chains
        const maxDebrisSize = ASTEROID_CONFIG.MAX_SIZE * 0.5;
        const r = ASTEROID_CONFIG.MIN_SIZE + Math.random() * (maxDebrisSize - ASTEROID_CONFIG.MIN_SIZE);
        const roid = createAsteroid(x, y, r);

        if (isHot) {
            roid.isHot = true;
            roid.color = `hsl(${20 + Math.random() * 30}, 80%, 30%)`;
        }

        const speedBase = isHot ? ASTEROID_CONFIG.MAX_SPEED * 4.0 : ASTEROID_CONFIG.MAX_SPEED * 2.0;
        const speed = (0.5 + Math.random() * 0.5) * speedBase;

        roid.xv = Math.cos(angle) * speed;
        roid.yv = Math.sin(angle) * speed;
        roid.rotSpeed = (Math.random() - 0.5) * 0.4;
        roid.blinkNum = 120; // 2 seconds of ghosting to give them time to spread out

        State.roids.push(roid);
    }
    updateAsteroidCounter();
}
