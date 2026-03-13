export class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
        this._queryResults = [];
    }

    getKey(x, y) {
        const gx = (x / this.cellSize) | 0;
        const gy = (y / this.cellSize) | 0;
        return (gx << 16) ^ gy;
    }

    clear() {
        this.grid.clear();
    }

    insert(obj) {
        const key = this.getKey(obj.x, obj.y);
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(obj);
    }

    query(obj) {
        const cx = (obj.x / this.cellSize) | 0;
        const cy = (obj.y / this.cellSize) | 0;
        this._queryResults.length = 0;

        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                const key = ((cx + i) << 16) ^ (cy + j);
                if (this.grid.has(key)) {
                    const cellObjects = this.grid.get(key);
                    for (let k = 0; k < cellObjects.length; k++) {
                        this._queryResults.push(cellObjects[k]);
                    }
                }
            }
        }
        return this._queryResults;
    }
}

export function mulberry32(a) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

import { t } from './i18n.js';

export function getShapeName(tier) {
    if (tier >= 12) return t("shape.godship");
    if (tier === 11) return t("shape.hyperion");
    if (tier === 10) return t("shape.titan");
    if (tier === 9) return t("shape.celestial");
    if (tier === 8) return t("shape.sphere");
    const shapes = [t("shape.triangle"), t("shape.square"), t("shape.pentagon"), t("shape.hexagon"), t("shape.heptagon"), t("shape.octagon"), t("shape.nonagon"), t("shape.decagon")];
    return shapes[Math.min(tier, shapes.length - 1)];
}

