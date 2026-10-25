import { State } from './state.js';
import { changeRadarZoom, shootLaser } from './input.js';
import { MIN_DURATION_TAP_TO_MOVE, DOM } from './config.js';
import { startGame } from './game_engine.js';
import { dist, rotateTowards } from '../utils/utils.js';

export let isTouching = false;
export let touchStartTime = 0;

export function setupInputEvents() {
    document.addEventListener('keydown', (e) => {
        // Start/Restart with Space or Enter
        if ((e.code === 'Space' || e.code === 'Enter') && !State.gameRunning && DOM.startBtn && DOM.startBtn.style.display !== 'none') {
            e.preventDefault();
            startGame();
            return;
        }

        if (e.code === 'Space') {
            State.keys.Space = true;
            shootLaser();
        }

        if (e.code === 'KeyZ') changeRadarZoom(1);  // Zoom Out
        if (e.code === 'KeyX') changeRadarZoom(-1); // Zoom In

        if (e.code === 'KeyW' || e.code === 'ArrowUp') State.keys.ArrowUp = true;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') State.keys.ArrowDown = true;

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
        if (e.code === 'Space') State.keys.Space = false;
        if (e.code === 'KeyW' || e.code === 'ArrowUp') State.keys.ArrowUp = false;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') State.keys.ArrowDown = false;

        if (e.code === 'ArrowLeft') State.keys.ArrowLeft = false;
        if (e.code === 'ArrowRight') State.keys.ArrowRight = false;

        if (e.code === 'KeyA') State.keys.KeyA = false;
        if (e.code === 'KeyD') State.keys.KeyD = false;

        State.keys.Shift = e.shiftKey;
    });

    document.addEventListener('mousemove', (e) => {
        if (e.target.closest('.btn')) return;
        State.inputMode = 'mouse';
        State.mouse.x = e.clientX;
        State.mouse.y = e.clientY;
        document.body.classList.remove('keyboard-mode');
    });

    document.addEventListener('mousedown', (e) => {
        if (!State.gameRunning || e.target.closest('button')) return;
        State.inputMode = 'mouse';
        if (e.button === 2) {
            State.keys.ArrowUp = true;
        } else {
            State.keys.Space = true;
            shootLaser();
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            State.keys.ArrowUp = false;
        } else {
            State.keys.Space = false;
        }
    });

    document.addEventListener('contextmenu', (e) => {
        if (State.gameRunning) e.preventDefault();
    });

    document.addEventListener('wheel', (e) => {
        if (!State.gameRunning) return;
        e.preventDefault();
        changeRadarZoom(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    let touchStartX = 0;
    let touchStartY = 0;
    let initialPinchDistance = 0;
    let wasPinching = false;

    document.addEventListener('touchstart', (e) => {
        if (!State.gameRunning) return;
        if (e.target.closest('.btn') || e.target.closest('.start-btn')) return;

        State.inputMode = 'touch';
        isTouching = true;

        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();

            const dx = touchStartX - State.width / 2;
            const dy = touchStartY - State.height / 2;
            State.playerShip.a = Math.atan2(dy, dx);
        } else if (e.touches.length === 2) {
            wasPinching = true;
            initialPinchDistance = dist(
                e.touches[0].clientX, e.touches[0].clientY,
                e.touches[1].clientX, e.touches[1].clientY
            );
        }

        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isTouching || !State.gameRunning || State.playerShip.dead) return;
        e.preventDefault();

        if (e.touches.length === 1) {
            if (Date.now() - touchStartTime < MIN_DURATION_TAP_TO_MOVE) return;

            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;

            // Deadzone to prevent jitter
            if (Math.hypot(dx, dy) > 10) {
                const targetAngle = Math.atan2(dy, dx);
                State.playerShip.a = rotateTowards(State.playerShip.a, targetAngle, 0.2);
            }
        } else if (e.touches.length === 2) {
            const currentDistance = dist(
                e.touches[0].clientX, e.touches[0].clientY,
                e.touches[1].clientX, e.touches[1].clientY
            );
            const diff = currentDistance - initialPinchDistance;

            if (Math.abs(diff) > 40) {
                changeRadarZoom(diff > 0 ? -1 : 1);
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
            setTimeout(() => { wasPinching = false; }, 0);
        }

        const duration = Date.now() - touchStartTime;
        if (duration < MIN_DURATION_TAP_TO_MOVE && e.changedTouches.length === 1 && !wasPinching) {
            shootLaser();
        }
        e.preventDefault();
    });
}
