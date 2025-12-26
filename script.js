// Droplet Physics Simulator - Advanced Edition
// Features: 3D, Faraday Waves, Walker Droplets, Replay System

class Droplet3D {
    constructor(x, y, z, mass, size, scene) {
        this.position = new THREE.Vector3(x, y, z);
        this.velocity = new THREE.Vector3(0, 0, 0);

        this.mass = mass;
        this.radius = size * 0.1;
        this.scene = scene;

        this.mesh = this.createMesh();
        this.scene.add(this.mesh);

        this.isDead = false;
        this.lastBounceTime = 0;
    }

    createMesh() {
        const geometry = new THREE.SphereGeometry(this.radius, 16, 16);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x4cc9f0,
            metalness: 0.1,
            roughness: 0,
            transmission: 0.9,
            thickness: 0.5,
            clearcoat: 1.0,
            ior: 1.33
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(this.position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    update(deltaTime, gravity, airResistance, surfaceY, surfaceVelY, time) {
        // 1. Gravity
        const gravityForce = new THREE.Vector3(0, -this.mass * gravity, 0);

        // 2. Air Drag (Quadratic)
        const speedSq = this.velocity.lengthSq();
        if (speedSq > 0.0001) {
            const dragMag = airResistance * speedSq;
            const dragDir = this.velocity.clone().normalize().negate();
            gravityForce.add(dragDir.multiplyScalar(dragMag));
        }

        // Apply Forces
        const acceleration = gravityForce.divideScalar(this.mass);
        this.velocity.add(acceleration.multiplyScalar(deltaTime));
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime * 10));

        // 3. Surface Interaction (Walker Physics)
        // Check collision with dynamic surface height at current x,z
        if (this.position.y - this.radius <= surfaceY) {
            // Impact!
            this.handleSurfaceCollision(surfaceY, surfaceVelY, time);
        }

        this.mesh.position.copy(this.position);

        // Kill if fell too far
        if (this.position.y < -50) this.isDead = true;
    }

    handleSurfaceCollision(surfaceY, surfaceVelY, time) {
        // Weber Number Calculation: We = rho * v^2 * D / sigma
        // Simplified check: Impact Velocity vs Threshold

        const relativeVelY = this.velocity.y - surfaceVelY;

        // If moving down relative to surface
        if (relativeVelY < 0) {
            // Determine bounce vs coalescence
            // For simulation fun: Moderate speed + Upward Moving Surface = Bounce
            // High speed = Splash (Die)

            const impactSpeed = Math.abs(relativeVelY);

            // "Walking" condition: Surface must be moving UP to kick the droplet
            // and impact must effectively be "soft" enough not to break tension.

            const bounceThreshold = 25.0; // Arbitrary unit

            if (impactSpeed < bounceThreshold && surfaceVelY > -2) {
                // BOUNCE
                // Reflect velocity with coefficient of restitution
                // Add some horizontal kick from wave gradient? (Walker mechanism)
                // Simplified walker: just bounce vertically mostly

                this.velocity.y = Math.abs(this.velocity.y) * 0.8; // Damping

                // Add energy from vibrating surface
                this.velocity.y += Math.max(0, surfaceVelY * 0.5);

                // Adjust pos to sit on surface
                this.position.y = surfaceY + this.radius;
            } else {
                // SPLASH / COALESCE
                this.isDead = true;
                // Could spawn particles here
            }
        }
    }

    dispose() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }
}

class SimulatorAdvanced {
    constructor() {
        this.canvasContainer = document.querySelector('.canvas-container');
        this.canvas = document.getElementById('simulationCanvas');

        // --- Three.js Setup ---
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e17);
        this.scene.fog = new THREE.FogExp2(0x0a0e17, 0.008);

        this.camera = new THREE.PerspectiveCamera(60, this.canvasContainer.clientWidth / 700, 0.1, 1000);
        this.camera.position.set(0, 30, 60);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(this.canvasContainer.clientWidth, 700);
        this.renderer.shadowMap.enabled = true;

        // --- Simulation State ---
        this.droplets = [];
        this.isRunning = false;
        this.time = 0;
        this.rainMode = false;
        this.rainInterval = null;

        // Physics Params
        this.gravity = 9.8;
        this.mass = 5;
        this.airResistance = 0.02;
        this.dropletSize = 8;

        // Vibration Params
        this.freq = 30; // Hz
        this.amp = 0.5; // Amplitude unit

        // Replay System
        this.history = []; // Array of snapshots
        this.isReplaying = false;
        this.replayFrame = 0;
        this.MAX_HISTORY = 60 * 20; // 20 seconds at 60fps

        this.initScene();
        this.initListeners();
        this.animate(0);
    }

    initScene() {
        // Lights
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(20, 50, 20);
        dirLight.castShadow = true;
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0x404040));

        // Dynamic Water Surface
        // High segment plane for wave deformation
        const geometry = new THREE.PlaneGeometry(100, 100, 64, 64);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x1a2e49,
            metalness: 0.9,
            roughness: 0.2,
            clearcoat: 1.0
        });

        this.waterMesh = new THREE.Mesh(geometry, material);
        this.waterMesh.rotation.x = -Math.PI / 2;
        this.waterMesh.receiveShadow = true;
        this.scene.add(this.waterMesh);

        // Grid for reference (slightly offset)
        const grid = new THREE.GridHelper(100, 20, 0x444444, 0x222222);
        grid.position.y = -5;
        this.scene.add(grid);
    }

    initListeners() {
        // Standard controls
        document.getElementById('startBtn').onclick = () => { this.isRunning = true; this.isReplaying = false; };
        document.getElementById('pauseBtn').onclick = () => { this.isRunning = false; };
        document.getElementById('resetBtn').onclick = () => this.reset();
        document.getElementById('addDropletBtn').onclick = () => this.spawnDroplet();

        // Rain
        document.getElementById('rainModeBtn').onclick = () => this.toggleRain();

        // Sliders
        const bindSlider = (id, target, displayId) => {
            document.getElementById(id).addEventListener('input', (e) => {
                this[target] = parseFloat(e.target.value);
                if (displayId) document.getElementById(displayId).textContent = this[target].toFixed(1);
            });
        };
        bindSlider('gravitySlider', 'gravity', 'gravityDisplay');
        bindSlider('massSlider', 'mass', 'massDisplay');
        bindSlider('airResistanceSlider', 'airResistance', 'airResistanceDisplay');
        bindSlider('freqSlider', 'freq', 'freqDisplay');
        bindSlider('ampSlider', 'amp', 'ampDisplay');

        // Replay Controls
        document.getElementById('recordBtn').onclick = (e) => {
            // Toggle recording visual state? 
            // For now, we ALWAYS record. This button could be a marker.
            e.target.classList.toggle('btn-danger');
        };

        document.getElementById('replayBtn').onclick = () => this.startReplay();

        document.getElementById('replaySlider').addEventListener('input', (e) => {
            if (this.isReplaying) {
                this.replayFrame = parseInt(e.target.value);
            }
        });

        window.addEventListener('resize', () => {
            const w = this.canvasContainer.clientWidth;
            this.renderer.setSize(w, 700);
            this.camera.aspect = w / 700;
            this.camera.updateProjectionMatrix();
        });
    }

    spawnDroplet() {
        const x = (Math.random() - 0.5) * 40;
        const z = (Math.random() - 0.5) * 40;
        this.droplets.push(new Droplet3D(x, 40, z, this.mass, this.dropletSize, this.scene));
    }

    toggleRain() {
        this.rainMode = !this.rainMode;
        const btn = document.getElementById('rainModeBtn');
        if (this.rainMode) {
            btn.classList.add('btn-danger');
            this.isRunning = true;
            this.rainInterval = setInterval(() => this.spawnDroplet(), 100);
        } else {
            btn.classList.remove('btn-danger');
            clearInterval(this.rainInterval);
        }
    }

    reset() {
        this.droplets.forEach(d => d.dispose());
        this.droplets = [];
        this.history = [];
        this.time = 0;
        this.isRunning = false;
        this.isReplaying = false;
        if (this.rainMode) this.toggleRain();
        document.getElementById('timeElapsed').textContent = "0.0s";
    }

    // --- Physics Logic ---

    getWaveHeight(x, z, t) {
        // Faraday Standing Wave Approximation
        // y = A * cos(kx) * cos(kz) * cos(omega * t)
        const k = 0.2; // Wave number
        const omega = this.freq * 0.1; // Scale freq for visual
        return this.amp * Math.cos(k * x) * Math.cos(k * z) * Math.cos(omega * t);
    }

    getSurfaceVelY(x, z, t) {
        // Derivative of height with respect to time
        // v = -A * omega * cos(kx) * cos(kz) * sin(omega * t)
        const k = 0.2;
        const omega = this.freq * 0.1;
        return -this.amp * omega * Math.cos(k * x) * Math.cos(k * z) * Math.sin(omega * t);
    }

    updateWaterSurface(time) {
        const positions = this.waterMesh.geometry.attributes.position;
        const count = positions.count;

        for (let i = 0; i < count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const y = this.getWaveHeight(x, z, time);
            positions.setY(i, y);
        }
        positions.needsUpdate = true;
        this.waterMesh.geometry.computeVertexNormals(); // Update lighting
    }

    recordFrame() {
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }

        // Snapshot
        const frame = {
            droplets: this.droplets.map(d => ({
                pos: d.position.clone(),
                radius: d.radius,
                dead: d.isDead
            })),
            waterTime: this.time
        };
        this.history.push(frame);

        const slider = document.getElementById('replaySlider');
        slider.max = this.history.length - 1;
        if (!this.isReplaying) slider.value = this.history.length - 1;
    }

    startReplay() {
        this.isReplaying = !this.isReplaying;
        this.isRunning = !this.isReplaying; // Pause sim during replay

        const btn = document.getElementById('replayBtn');
        const group = document.getElementById('timelineGroup');

        if (this.isReplaying) {
            btn.textContent = "Exit Replay";
            btn.classList.add('btn-accent');
            group.style.display = 'block';
            this.replayFrame = this.history.length - 1;
        } else {
            btn.textContent = "Replay";
            btn.classList.remove('btn-accent');
            group.style.display = 'none';
        }
    }

    renderReplay() {
        const frame = this.history[this.replayFrame];
        if (!frame) return;

        // 1. Sync Water
        this.updateWaterSurface(frame.waterTime);

        // 2. Sync Droplets (Visual only)
        // This is tricky because droplets array changes. 
        // Simple approach: Clear scene droplets, spawn temp meshes for replay frame.
        // Better: Pool meshes.
        // Lazy: Just hide real droplets, show replay proxies? 
        // For simplicity in this task: We manually set positions of existing droplets if count matches, 
        // else we might get artifacts. 
        // Correct way for robust replay: Destroy all current meshes, rebuild from frame data.

        this.droplets.forEach(d => d.mesh.visible = false);

        // Re-use or create visualizers
        if (!this.replayPool) this.replayPool = [];

        // Ensure pool size
        while (this.replayPool.length < frame.droplets.length) {
            const m = new Droplet3D(0, 0, 0, 1, 1, this.scene).mesh; // Hacky access to createMesh
            this.replayPool.push(m);
        }

        // Update pool
        this.replayPool.forEach(m => m.visible = false);
        frame.droplets.forEach((dData, i) => {
            const mesh = this.replayPool[i];
            mesh.visible = true;
            mesh.position.copy(dData.pos);
            const scale = dData.radius / 0.8; // Approximate normalization
            mesh.scale.setScalar(1); // Reset scale logic if needed
        });
    }

    animate(now) {
        requestAnimationFrame((t) => this.animate(t));

        // Time management
        // now is ms
        const dt = 0.016; // Fixed step for stability or use clamped delta

        if (this.isReplaying) {
            this.renderReplay();
            // Optional: Auto-play replay?
            // this.replayFrame++;
            // if(this.replayFrame >= this.history.length) this.replayFrame = 0;
            // Update slider
            document.getElementById('replaySlider').value = this.replayFrame;
            document.getElementById('replayTimeDisplay').textContent = (this.replayFrame * dt).toFixed(2) + 's';
        }
        else if (this.isRunning) {
            this.time += dt * (this.freq / 30); // scale time by freq slightly for wave speed? or independent.

            // Update Physics
            this.updateWaterSurface(this.time);

            for (let i = this.droplets.length - 1; i >= 0; i--) {
                const d = this.droplets[i];
                if (d.mesh) d.mesh.visible = true; // Ensure visible if coming back from replay

                // Get surface state at droplet pos
                const sY = this.getWaveHeight(d.position.x, d.position.z, this.time);
                const sVy = this.getSurfaceVelY(d.position.x, d.position.z, this.time);

                d.update(dt, this.gravity, this.airResistance, sY, sVy, this.time);

                if (d.isDead) {
                    d.dispose();
                    this.droplets.splice(i, 1);
                }
            }

            this.recordFrame();

            document.getElementById('timeElapsed').textContent = (this.history.length * dt).toFixed(1) + 's';
        }

        // Cleanup replay pool if running normal sim
        if (!this.isReplaying && this.replayPool) {
            this.replayPool.forEach(m => m.visible = false);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// Init
window.addEventListener('onload', () => { // Wait for resources
    // actually DOMContentLoaded is faster
});
window.addEventListener('DOMContentLoaded', () => {
    new SimulatorAdvanced();
});
