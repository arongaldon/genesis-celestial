import { State } from '../core/state.js';
import { GALAXY_CONFIG, WORLD_BOUNDS } from '../core/config.js';
import { mulberry32 } from '../utils/utils.js';

export function initBackground() {
    // Resets and populates background layers for parallax
    State.backgroundLayers = { nebulas: [], galaxies: [], starsNear: [], starsMid: [], starsFar: [] };
    State.ambientFogs = []; // NEW: Reset ambient fog
    for (let i = 0; i < 6; i++) State.backgroundLayers.nebulas.push({ x: Math.random() * State.width, y: Math.random() * State.height, r: State.width * 0.6, hue: Math.random() * 60 + 200, alpha: 0.1 });
    const galaxyCount = GALAXY_CONFIG.LIMIT;
    for (let i = 0; i < galaxyCount; i++) {
        let newGalaxy;
        let attempts = 0;
        let tooClose;
        do {
            newGalaxy = createGalaxy();
            tooClose = State.backgroundLayers.galaxies.some(g => {
                const dx = g.x - newGalaxy.x;
                const dy = g.y - newGalaxy.y;
                return Math.sqrt(dx * dx + dy * dy) < GALAXY_CONFIG.MIN_DIST;
            });
            attempts++;
        } while (tooClose && attempts < 20);

        // Scatter globally across parallax world (0.05 scale)
        const parallaxSpread = WORLD_BOUNDS * 2 * 0.05;
        newGalaxy.x = State.width / 2 + (Math.random() - 0.5) * parallaxSpread;
        newGalaxy.y = State.height / 2 + (Math.random() - 0.5) * parallaxSpread;

        State.backgroundLayers.galaxies.push(newGalaxy);
    }
    // Galaxies are pre-sorted during initBackground for performance
    State.backgroundLayers.galaxies.sort((a, b) => a.size - b.size);
    for (let i = 0; i < 3; i++) State.ambientFogs.push(createAmbientFog()); // NEW: Initial ambient fogs
    const createStar = () => ({ x: Math.random() * State.width, y: Math.random() * State.height, size: Math.random() * 1.5 + 0.5, alpha: Math.random() * 0.5 + 0.3 });
    for (let i = 0; i < 20; i++) State.backgroundLayers.starsFar.push(createStar());
    for (let i = 0; i < 15; i++) State.backgroundLayers.starsMid.push(createStar());
    for (let i = 0; i < 10; i++) State.backgroundLayers.starsNear.push(createStar());
}

export function createGalaxy() {
    const arms = Math.floor(Math.random() * (GALAXY_CONFIG.ARMS_LIMIT - 1)) + 2;
    const squish = 0.2 + Math.random() * 0.8;
    let sizeRng = Math.random();
    let size = sizeRng > 0.85 ? (2000 + Math.random() * 2000) : (400 + Math.random() * 1000);
    const starCount = Math.floor(size * (1.5 + Math.random()));

    const hueSeed = Math.random();
    let coreColor, edgeColor;
    if (hueSeed > 0.6) {
        coreColor = { r: 255, g: 220, b: 150 };
        edgeColor = { r: 50, g: 100, b: 255 };
    } else if (hueSeed > 0.3) {
        coreColor = { r: 200, g: 230, b: 255 };
        edgeColor = { r: 100, g: 50, b: 200 };
    } else {
        coreColor = { r: 255, g: 180, b: 100 };
        edgeColor = { r: 255, g: 100, b: 50 };
    }

    const stars = [];
    const armSeparation = (Math.PI * 2) / arms;
    const spiralSwirl = 1.5 + Math.random() * 1.5;

    for (let i = 0; i < starCount; i++) {
        const distRatio = Math.pow(Math.random(), 2);
        const dist = distRatio * size;
        const baseAngle = (i % arms) * armSeparation;
        const spiralAngle = distRatio * Math.PI * spiralSwirl;
        const scatter = (Math.random() - 0.5) * (0.2 + distRatio * 0.8);
        const finalAngle = baseAngle + spiralAngle + scatter;
        const r = coreColor.r * (1 - distRatio) + edgeColor.r * distRatio;
        const g = coreColor.g * (1 - distRatio) + edgeColor.g * distRatio;
        const b = coreColor.b * (1 - distRatio) + edgeColor.b * distRatio;
        const starSize = Math.random() > 0.9 ? (1 + Math.random() * 2) : (0.5 + Math.random());
        const alpha = Math.min(1.0, (1.0 - distRatio) + Math.random() * 0.3);

        stars.push({
            r: dist,
            theta: finalAngle,
            size: starSize,
            alpha,
            color: `rgba(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)}, `
        });
    }

    // Prerender to offscreen canvas
    const maxDimension = size * 2.5;
    const oCanvas = document.createElement('canvas');
    oCanvas.width = maxDimension;
    oCanvas.height = maxDimension;
    const oCtx = oCanvas.getContext('2d');
    const center = maxDimension / 2;

    oCtx.globalCompositeOperation = 'screen';
    const coreRad = size * 0.3;
    let coreGrad = oCtx.createRadialGradient(center, center, 0, center, center, coreRad);
    coreGrad.addColorStop(0, `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${GALAXY_CONFIG.BRIGHTNESS})`);
    coreGrad.addColorStop(0.2, `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${GALAXY_CONFIG.BRIGHTNESS * 0.6})`);
    coreGrad.addColorStop(1, `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, 0)`);

    oCtx.fillStyle = coreGrad;
    oCtx.beginPath();
    oCtx.arc(center, center, coreRad, 0, Math.PI * 2);
    oCtx.fill();

    stars.forEach(s => {
        oCtx.fillStyle = `${s.color}${s.alpha * GALAXY_CONFIG.BRIGHTNESS})`;
        oCtx.beginPath();
        oCtx.arc(center + s.r * Math.cos(s.theta), center + s.r * Math.sin(s.theta), s.size, 0, Math.PI * 2);
        oCtx.fill();
    });

    return {
        x: Math.random() * State.width,
        y: Math.random() * State.height,
        size,
        cachedCanvas: oCanvas,
        angle: Math.random() * Math.PI,
        squish
    };
}

export function createAmbientFog() {
    const side = Math.floor(Math.random() * 4);
    let x, y, xv, yv;
    const padding = 500;
    const speed = 0.5;
    if (side === 0) { x = State.width * Math.random(); y = -padding; xv = (Math.random() - 0.5) * 0.1; yv = speed; }
    else if (side === 1) { x = State.width + padding; y = State.height * Math.random(); xv = -speed; yv = (Math.random() - 0.5) * 0.1; }
    else if (side === 2) { x = State.width * Math.random(); y = State.height + padding; xv = (Math.random() - 0.5) * 0.1; yv = -speed; }
    else { x = -padding; y = State.height * Math.random(); xv = speed; yv = (Math.random() - 0.5) * 0.1; }
    return {
        x, y, xv, yv,
        r: Math.max(State.width, State.height) * (0.8 + Math.random() * 0.5),
        hue: Math.random() < 0.5 ? 240 : 0,
        alpha: 0.05 + Math.random() * 0.1,
        life: 500
    };
}
