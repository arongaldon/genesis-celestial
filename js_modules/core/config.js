
export const ASTEROID_CONFIG = {
   COUNT: 1000,
   INIT_INNER: 5000,
   INIT_OUTER: 20000,
   MAX_SIZE: 500,
   MAX_SPEED: 10,
   MIN_SIZE: 50,
   PLANET_DEBRIS: 25,
   SPLIT_OFFSET: 300
};

export const BOUNDARY_CONFIG = {
   CORRECTION_FORCE: 0.05,
   TOLERANCE: 100,
   TOLERANCE_ROIDS: 1000
};

export const FPS = 60;
export const FRICTION = 0.99;
export const G_CONST = 0.9;
export const MAX_Z_DEPTH = 2.0;
export const MIN_DURATION_TAP_TO_MOVE = 200;

export const GALAXY_CONFIG = {
   ARMS_LIMIT: 18,
   BRIGHTNESS: 0.2,
   LIMIT: 3,
   MIN_DIST: 3000
};

export const PLANET_CONFIG = {
   LIMIT: 3,
   MAX_SIZE: 2000
};

export const PLAYER_CONFIG = {
   INITIAL_LIVES: 3,
   RELOAD_TIME_MAX: 6,
   RELOAD_TIME_MS: 100 // ~6 frames at 60fps
};

export const SHIP_CONFIG = {
   BASE_MAX_SHIELD: 100,
   BULLET1_LIFETIME: 90,
   BULLET2_LIFETIME: 20,
   BULLET_FADE_FRAMES: 5,
   BULLET_GRAVITY_FACTOR: 10,
   COMBAT_ORBIT_DISTANCE: 340,
   EVOLUTION_SCORE_STEP: 1000,
   FRIENDLY_BLUE_HUE: 210,
   PLANET_LIMIT: 7,
   MAX_SPEED: 90,
   RESISTANCE: 2,
   SEPARATION_DISTANCE: 30,
   SIGHT_RANGE: 2000,
   SIZE: 50,
   SPAWN_TIME: 1000,
   THRUST: 0.9
};

export const SCALE_IN_MOUSE_MODE = 1.0;
export const SCALE_IN_TOUCH_MODE = 0.5;

export const SCORE_REWARDS = {
   ASTEROID_DESTROYED: 100,
   PLANET_DESTROYED: 1000,
   SHIP_KILLED: 200,
   STATION_KILLED: 500
};

export const STATION_CONFIG = {
   PER_PLANET: 1,
   SPAWN_TIMER: 300,
   RESISTANCE: 6
};

export const WORLD_BOUNDS = 20000;

export const GLOBAL_LIGHT = {
   X: WORLD_BOUNDS * 2, // Distant sun far out of bounds
   Y: -WORLD_BOUNDS * 2
};

export const ZOOM_LEVELS = Array.from({ length: 12 }, (_, i) => 1000 + (i * 200) + (i * i * 100));

export const suffixes = ["PRIME", "IV", "X", "ALPHA", "BETA", "MAJOR", "MINOR", "ZERO", "AEON"];
export const syllables = ["KRON", "XER", "ZAN", "TOR", "AER", "ION", "ULA", "PROX", "VEX", "NOV", "SOL", "LUNA", "TER", "MAR", "JUP"];

// DOM elements initialized late to ensure they exist
export const DOM = {
   canvas: null,
   canvasRadar: null,
   radarWrapper: null,
   fadeOverlay: null,
   hudTop: null,
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
