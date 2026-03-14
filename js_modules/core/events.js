import { State } from './state.js';
import { changeRadarZoom, shootLaser } from './input.js';
import { ASTEROID_CONFIG, BOUNDARY_CONFIG, PLANET_CONFIG, PLAYER_CONFIG, SCORE_REWARDS, SHIP_CONFIG, STATION_CONFIG, FPS, FRICTION, G_CONST, MAX_Z_DEPTH, MIN_DURATION_TAP_TO_MOVE, SCALE_IN_MOUSE_MODE, SCALE_IN_TOUCH_MODE, WORLD_BOUNDS, ZOOM_LEVELS, DOM } from './config.js';

export let isTouching = false;
export let touchStartTime = 0;

export function setupInputEvents() {
    // Function to handle zoom change (used by Z key and Mouse Wheel)
    document.addEventListener('keydown', (e) => {
        // Start/Restart with Space or Enter
        if ((e.code === 'Space' || e.code === 'Enter') && !State.gameRunning && DOM.startBtn && DOM.startBtn.style.display !== 'none') {
            e.preventDefault(); // Prevent page scrolling/default behavior
            window.startGame();
            return;
        }

        if (e.code === 'Space') shootLaser();

        // NOTE: The logic for KeyE to create matter has been permanently removed.

        if (e.code === 'KeyZ') {
            changeRadarZoom(1); // Zoom Out (next State.level)
        }

        if (e.code === 'KeyX') {
            changeRadarZoom(-1); // Zoom In (previous State.level)
        }

        if (e.code === 'KeyW' || e.code === 'ArrowUp') State.keys.ArrowUp = true;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') State.keys.ArrowDown = true; // KeyS is brake

        if (e.code === 'ArrowLeft') State.keys.ArrowLeft = true;
        if (e.code === 'ArrowRight') State.keys.ArrowRight = true;

        if (e.code === 'KeyA') State.keys.KeyA = true;
        if (e.code === 'KeyD') State.keys.KeyD = true;

        if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code) && !e.shiftKey) {
            State.inputMode = 'keyboard';
            document.body.classList.add('keyboard-mode');
        }
        
        State.keys.Shift = e.shiftKey;
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'KeyW' || e.code === 'ArrowUp') State.keys.ArrowUp = false;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') State.keys.ArrowDown = false;

        if (e.code === 'ArrowLeft') State.keys.ArrowLeft = false;
        if (e.code === 'ArrowRight') State.keys.ArrowRight = false;

        if (e.code === 'KeyA') State.keys.KeyA = false;
        if (e.code === 'KeyD') State.keys.KeyD = false;

        State.keys.Shift = e.shiftKey;
    });
    document.addEventListener('mousemove', (e) => {
        if (e.target.closest('.btn')) return; // Ignore if over a button
        State.inputMode = 'mouse'; State.mouse.x = e.clientX; State.mouse.y = e.clientY;
        document.body.classList.remove('keyboard-mode');
    });
    document.addEventListener('mousedown', (e) => {
        if (!State.gameRunning || e.target.closest('button')) return;
        State.inputMode = 'mouse';
        if (e.button === 2) {
            // Right-click = Thrust (same as ArrowUp / W)
            State.keys.ArrowUp = true;
        } else {
            shootLaser();
        }
    });
    document.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            State.keys.ArrowUp = false;
        }
    });
    document.addEventListener('contextmenu', (e) => {
        if (State.gameRunning) e.preventDefault(); // Suppress right-click menu during gameplay
    });

    // NEW: Mouse Wheel Event Listener for Zoom
    document.addEventListener('wheel', (e) => {
        if (!State.gameRunning) return;
        e.preventDefault(); // Prevent page scrolling

        // DeltaY is positive when scrolling down (zoom out), negative when scrolling up (zoom in)
        const direction = e.deltaY > 0 ? 1 : -1;
        changeRadarZoom(direction);
    }, { passive: false });

    let touchStartX = 0;
    let touchStartY = 0;


    let initialPinchDistance = 0;
    let wasPinching = false;

    document.addEventListener('touchstart', (e) => {
        if (!State.gameRunning) return; // Allow interaction with start screen
        if (e.target.closest('.btn') || e.target.closest('.start-btn')) return;

        State.inputMode = 'touch';
        isTouching = true;

        if (e.touches.length === 1) {
            // Joystick Anchor
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();

            // Rotate ship to face the tap immediately
            const dx = touchStartX - State.width / 2;
            const dy = touchStartY - State.height / 2;
            State.playerShip.a = Math.atan2(dy, dx);
        } else if (e.touches.length === 2) {
            // Prepare for pinch zoom
            wasPinching = true;
            initialPinchDistance = Math.sqrt((e.touches[0].clientX - e.touches[1].clientX) * (e.touches[0].clientX - e.touches[1].clientX) + (e.touches[0].clientY - e.touches[1].clientY) * (e.touches[0].clientY - e.touches[1].clientY));
        }

        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isTouching || !State.gameRunning || State.playerShip.dead) return;
        e.preventDefault();

        if (e.touches.length === 1) {
            const duration = Date.now() - touchStartTime;
            if (duration < MIN_DURATION_TAP_TO_MOVE) {
                return;
            }

            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;

            const dx = currentX - touchStartX;
            const dy = currentY - touchStartY;

            // Deadzone to prevent jitter
            if (Math.sqrt((dx) * (dx) + (dy) * (dy)) > 10) {
                // Steer towards the drag vector
                // Note: dy is screen coordinates (down is positive).
                let targetAngle = Math.atan2(dy, dx);

                // Smooth rotate towards target
                let angleDiff = targetAngle - State.playerShip.a;

                // Safety check for NaN or Infinity
                if (isNaN(angleDiff) || !isFinite(angleDiff)) angleDiff = 0;

                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;

                State.playerShip.a += angleDiff * 0.2; // Responsiveness

                // Normalize a to [-PI, PI] to prevent overflow over long gameplay
                while (State.playerShip.a > Math.PI) State.playerShip.a -= 2 * Math.PI;
                while (State.playerShip.a <= -Math.PI) State.playerShip.a += 2 * Math.PI;
            }
        } else if (e.touches.length === 2) {
            const currentDistance = Math.sqrt((e.touches[0].clientX - e.touches[1].clientX) * (e.touches[0].clientX - e.touches[1].clientX) + (e.touches[0].clientY - e.touches[1].clientY) * (e.touches[0].clientY - e.touches[1].clientY));
            const diff = currentDistance - initialPinchDistance;

            // Sensivity threshold for zoom change
            if (Math.abs(diff) > 40) {
                const direction = diff > 0 ? -1 : 1; // Pinch out (diff > 0) -> Zoom In (-1 index)
                changeRadarZoom(direction);
                initialPinchDistance = currentDistance;
            }
        }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (!State.gameRunning) return;
        if (e.target.closest('.btn') || e.target.closest('.start-btn')) return;

        if (e.touches.length === 0) {
            isTouching = false;
            initialPinchDistance = 0;
            // Reset wasPinching after a short delay to allow the last touchend to check it
            setTimeout(() => { wasPinching = false; }, 0);
        }

        // Short tap => shoot still (only if it was a single touch interaction and no pinch occurred)
        const duration = Date.now() - touchStartTime;
        if (duration < MIN_DURATION_TAP_TO_MOVE && e.changedTouches.length === 1 && !wasPinching) {
            shootLaser();
        }
        e.preventDefault();
    });


}
