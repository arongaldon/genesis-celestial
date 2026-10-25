// ============================================================================
// CORE ENGINE & WORLD SETTINGS
// ============================================================================
export const FPS = 60;
export const FRICTION = 0.99;
export const G_CONST = 0.9;
export const MAX_Z_DEPTH = 4.0;
export const WORLD_BOUNDS = 55000;

export const GLOBAL_LIGHT = {
    X: WORLD_BOUNDS * 2, // Distant sun far out of bounds
    Y: -WORLD_BOUNDS * 2
};

// ============================================================================
// INPUT, CAMERA & RADAR SETTINGS
// ============================================================================
export const MIN_DURATION_TAP_TO_MOVE = 200;
export const SCALE_IN_MOUSE_MODE = 0.72;
export const SCALE_IN_TOUCH_MODE = 0.36;
export const ZOOM_LEVELS = Array.from({ length: 16 }, (_, i) => 1500 + (i * 500) + (i * i * 220));

// ============================================================================
// WORLD BOUNDARY SETTINGS
// ============================================================================
export const BOUNDARY_CONFIG = {
    CORRECTION_FORCE: 0.05,
    TOLERANCE: 100,
    TOLERANCE_ROIDS: 1000,
    MAGNETIC_ZONE_FACTOR: 0.95, // Start pushing player back at 95% of bounds
    HARD_CAP_FACTOR: 1.05,      // Hard cap player distance at 105% of bounds
    SHADOW_SIZE: 50             // Size of the red inset border warning (px)
};

// ============================================================================
// ASTEROIDS & PLANETS SETTINGS
// ============================================================================
export const ASTEROID_CONFIG = {
    COUNT: 3500,
    INIT_INNER: 8000,
    MAX_ROIDS: 4000,
    MAX_SIZE: 500,
    MAX_SPEED: 12,
    MIN_SIZE: 50,
    PLANET_DEBRIS: 20,
    SPLIT_OFFSET: 200
};

export const PLANET_CONFIG = {
    LIMIT: 5,
    SIZE: 2000,
    HP: 70,
    MIN_SQUAD_TO_DAMAGE: 2,
    HOME_SPAWN_RANGE: 5000,
    INITIAL_DISTANT_PLANETS: 1,
    DISTANT_SPAWN_INTERVAL_FRAMES: 3600, // ~60s at 60 FPS
    DISTANT_MIN_DIST_FACTOR: 0.38,       // Minimum distance from origin (fraction of WORLD_BOUNDS)
    DISTANT_MAX_DIST_FACTOR: 0.85,       // Maximum distance from origin (fraction of WORLD_BOUNDS)
    DISTANT_ENEMY_MIN_TIER: 1,
    DISTANT_ENEMY_MAX_TIER: 5,
    NAMES: [
        'KRYSTA PRIME', 'ASTRA', 'VALKOR', 'NYXARA', 'HYPERIA',
        'SOLARIS V', 'OBSIDIA', 'AETHERIA', 'CHRONOS', 'VORTEXIA',
        'ELYSIUM', 'TARTARUS'
    ]
};

// ============================================================================
// BACKGROUND & GALAXY SETTINGS
// ============================================================================
export const GALAXY_CONFIG = {
    ARMS_LIMIT: 18,
    BRIGHTNESS: 0.3,
    LIMIT: 5,
    MIN_DIST: 5000,
    NEBULA_COUNT: 6,
    AMBIENT_FOG_COUNT: 3,
    STARS_FAR_COUNT: 20,
    STARS_MID_COUNT: 15,
    STARS_NEAR_COUNT: 10
};

// ============================================================================
// PLAYER, SHIPS & STATIONS SETTINGS
// ============================================================================
export const PLAYER_CONFIG = {
    INITIAL_LIVES: 3,
    RELOAD_TIME_MAX: 8,
    RELOAD_TIME_MS: 80, // Faster shooting (Reduced from 130)
    ROTATION_SPEED: 0.08,
    BRAKE_FRICTION: 0.92,
    STRAFE_MULTIPLIER: 0.7,
    DEATH_SCORE_PENALTY: -1000,
    RESPAWN_DELAY_MS: 3000,
    GAMEOVER_DELAY_MS: 5000
};

export const SHIP_CONFIG = {
    BASE_MAX_SHIELD: 100,
    BULLET1_LIFETIME: 150,
    BULLET2_LIFETIME: 50,
    BULLET_FADE_FRAMES: 5,
    BULLET_GRAVITY_FACTOR: 10,
    COMBAT_ORBIT_DISTANCE: 340,
    EVOLUTION_SCORE_STEP: 1000,
    FRIENDLY_BLUE_HUE: 210,
    PLANET_LIMIT: 10,
    MAX_SPEED: 100,
    RESISTANCE: 2,
    SEPARATION_DISTANCE: 30,
    SIGHT_RANGE: 2000,
    SIZE: 50,
    SPAWN_TIME: 1000,
    THRUST: 0.9,
    GODSHIP_TIER: 12,
    TRANSFORMATION_FRAMES: 600,
    SQUAD_SLOTS: [
        { x: -150, y: -150 }, { x: 150, y: -150 },
        { x: -300, y: -300 }, { x: 300, y: -300 },
        { x: -450, y: -450 }, { x: 450, y: -450 } // 6 wingman slots in V-formation
    ]
};

export const STATION_CONFIG = {
    PER_PLANET: 2,
    SPAWN_TIMER: 300,
    RESISTANCE: 6,
    RADIUS: 70,
    ORBIT_FACTOR: 0.3,
    ROT_SPEED: 0.005,
    ORBIT_SPEED: 0.002
};

export const SCORE_REWARDS = {
    ASTEROID_DESTROYED: 100,
    PLANET_DESTROYED: 1000,
    SHIP_KILLED: 200,
    STATION_KILLED: 500
};

// ============================================================================
// COSMIC ANOMALIES & NEMESIS BOSS SETTINGS
// ============================================================================
export const ANOMALY_CONFIG = {
    WORMHOLE_PAIRS: 2,
    WORMHOLE_RADIUS: 180,
    WORMHOLE_PULL_RANGE: 900,
    WORMHOLE_COOLDOWN_FRAMES: 90,
    SOLAR_STORM_INTERVAL_FRAMES: 3600, // ~60s at 60 FPS
    SOLAR_STORM_WARNING_FRAMES: 180,   // 3s warning before impact
    SOLAR_STORM_DURATION_FRAMES: 480,  // 8s active solar storm
    SOLAR_STORM_PUSH_FORCE: 0.12
};

export const NEMESIS_CONFIG = {
    MIN_TIER: 8,
    FALLBACK_SPAWN_FRAMES: 3600, // Promote strongest enemy after ~60s if none reached MIN_TIER yet
    HP_MULTIPLIER: 4,
    SCORE_REWARD: 2500,
    HUE: 345,
    NAMES: ['VALERIUS', 'KAELEN', 'NYX', 'VEX', 'MOROS']
};

// ============================================================================
// AUDIO SETTINGS
// ============================================================================
export const AUDIO_CONFIG = {
    MASTER_VOLUME: 0.3,
    DELAY_TIME: 0.8,
    DELAY_FEEDBACK: 0.4,
    PIANO_FILTER_FREQ: 1500,
    PIANO_FILTER_Q: 10
};

// ============================================================================
// DOM ELEMENTS CACHE (Initialized on window load)
// ============================================================================
export const DOM = {
    canvas: null,
    canvasRadar: null,
    radarWrapper: null,
    fadeOverlay: null,
    hudTop: null,
    uiLayer: null,
    infoLED: null,
    livesDisplay: null,
    asteroidCountDisplay: null,
    scoreDisplay: null,
    startBtn: null,
    startScreen: null,
    canvasContext: null,
    canvasRadarContext: null,
    init() {
        this.canvas = document.getElementById('gameCanvas');
        this.canvasRadar = document.getElementById('radar-canvas');
        this.radarWrapper = document.querySelector('.radar-wrapper');
        this.fadeOverlay = document.getElementById('fade-overlay');
        this.hudTop = document.querySelector('.hud-top');
        this.uiLayer = document.getElementById('ui-layer');
        this.infoLED = document.getElementById('info-led');
        this.livesDisplay = document.getElementById('livesEl');
        this.asteroidCountDisplay = document.getElementById('asteroidCountEl');
        this.scoreDisplay = document.getElementById('scoreEl');
        this.startBtn = document.getElementById('start-btn');
        this.startScreen = document.getElementById('start-screen');
        if (this.canvas) this.canvasContext = this.canvas.getContext('2d');
        if (this.canvasRadar) this.canvasRadarContext = this.canvasRadar.getContext('2d');
    }
};
