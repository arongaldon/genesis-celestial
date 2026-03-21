import { SHIP_CONFIG, SCORE_REWARDS, ASTEROID_CONFIG } from '../core/config.js';
import { State } from '../core/state.js';
import { addScreenMessage, updateAsteroidCounter, drawLives } from '../graphics/render.js';
import { t } from '../utils/i18n.js';
import { getShapeName } from '../utils/utils.js';
import { createAsteroid } from '../entities/entities.js';

export function getShipTier(ship) {
    let score = Math.max(0, ship.score);
    let step = SHIP_CONFIG.EVOLUTION_SCORE_STEP || 1000;

    let tier = 0;
    let requiredScoreForNextTier = step;
    let currentTierThreshold = 0;

    while (score >= currentTierThreshold + requiredScoreForNextTier) {
        currentTierThreshold += requiredScoreForNextTier;
        tier++;
        if (tier >= 7) {
            requiredScoreForNextTier = (tier - 5) * step; // Tier 7->8: 2000, Tier 8->9: 3000...
        } else {
            requiredScoreForNextTier = step;
        }
    }

    return tier;
}

export function increaseShipScore(ship, reward) {
    ship.score += reward;
    const newTier = getShipTier(ship);

    if (ship === State.playerShip) {
        // Only show message if tier <= 12 OR if we are devolving
        if (newTier !== ship.tier) {
            if (newTier > ship.tier) {
                if (newTier === 12 && ship.tier < 12) {
                    addScreenMessage(t("game.divine_meta_begins"), "#00ffff");
                    addScreenMessage(t("game.dangerous_shots"), "#ffaa00");
                    ship.transformationTimer = 600; // ~10 seconds at 60fps
                } else if (newTier < 12) {
                    addScreenMessage(t("game.evolved_to", { shape: getShapeName(newTier) }), "#00ff00");
                }
            }
            else if (ship.tier < 12) {
                addScreenMessage(t("game.devolved_to", { shape: getShapeName(newTier) }), "#ff0000");
            } else {
                ship.transformationTimer = 0; // Cancel transformation if devolved
            }
        }
    }

    ship.tier = newTier;
}

export function onShipDestroyed(ship, killerShip = null) {
    if (killerShip === State.playerShip) {
        if (ship.isFriendly && !State.playerShip.loneWolf) {
            increaseShipScore(killerShip, -SCORE_REWARDS.SHIP_KILLED);
            triggerBetrayal();
            return;
        }

        increaseShipScore(killerShip, SCORE_REWARDS.SHIP_KILLED);
    }
}

export function onStationDestroyed(station, killerShip = null) {
    if (station) {
        let junkAst = createAsteroid(station.x + ASTEROID_CONFIG.SPLIT_OFFSET, station.y, ASTEROID_CONFIG.MIN_SIZE);
        junkAst.xv = station.xv + ASTEROID_CONFIG.MAX_SPEED;
        junkAst.yv = station.yv;
        junkAst.blinkNum = 30;
        State.roids.push(junkAst);
        updateAsteroidCounter();
    };

    if (killerShip === State.playerShip) {
        if (station.isFriendly && !State.playerShip.loneWolf) {
            increaseShipScore(killerShip, -SCORE_REWARDS.STATION_KILLED);
            triggerBetrayal();
            return;
        }

        State.playerShip.shield = State.playerShip.maxShield;
        increaseShipScore(killerShip, SCORE_REWARDS.STATION_KILLED);

        State.playerShip.lives++;
        drawLives();
        addScreenMessage(t("game.extra_life"));

        State.playerShip.structureHP = SHIP_CONFIG.RESISTANCE;
        State.playerShip.shield = State.playerShip.maxShield;
    }
}

export function triggerBetrayal() {
    if (State.playerShip.loneWolf) return;
    State.playerShip.leaderRef = null;
    State.playerShip.loneWolf = true;
    State.playerShip.squadId = null;
    addScreenMessage(t("game.betrayal"), "#ff0000");

    State.ships.forEach(ship => {
        if (ship !== State.playerShip && ship.isFriendly) {
            ship.isFriendly = false;
            ship.aiState = 'COMBAT';
            ship.fleetHue = 0;
        }
    });
}
