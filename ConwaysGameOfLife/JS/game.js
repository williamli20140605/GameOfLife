class ConwaysGame {
    constructor() {
        const config = window.GOL_CONFIG || {};

        // Canvas setup
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = null;
        this.gl = null;
        this.webglAvailable = false;
        this.useGpuSimulation = true;
        this.prevGpuFrame = null;
        this.gpuStatsBufferA = null;
        this.gpuStatsBufferB = null;
        this.gpuStatsHasPrevFrame = false;
        this.lastGpuStatsTick = -1;
        this.lastGpuStatsSampleTime = 0;
        this.gpuActiveBoundsBuffer = null;
        this.gpuActiveBoundsTickCounter = 0;
        this.GPU_ACTIVE_REGION_SAMPLE_INTERVAL = 10;
        this.GPU_ACTIVE_REGION_ENABLE_AREA_RATIO = 0.85;
        this.GPU_ACTIVE_REGION_MIN_GRID_CELLS = 250000;
        this.GPU_STATS_DISABLE_DURING_RUN_AREA = 12000000;
        this.cpuGridDirtyFromGpu = false;
        this.resizeCanvas();

        // Grid properties
        this.cellSize = 20;
        this.gridWidth = 500;
        this.gridHeight = 500;
        this.grid = this.createEmptyGrid();
        this.MAX_TOTAL_CELLS = 250000000;
        this.activeBounds = null;
        this.boundsMayNeedRecalc = false;

        // Camera properties
        const centeredCamera = this.getCenteredCamera(1.0);
        this.camera = {
            x: centeredCamera.x,
            y: centeredCamera.y,
            zoom: 1.0
        };
        this.MIN_ZOOM = 0.001;
        this.MAX_ZOOM = 5.0;
        this.ZOOM_SPEED = 0.1;
        this.MOVE_SPEED = 10;

        // Initialize target camera to match current camera position
        this.targetCamera = { 
            x: this.camera.x,
            y: this.camera.y
        };
        this.CAMERA_SMOOTHING = 0.1; // Adjust this value to change smoothing (0.1 = smooth, 0.9 = responsive)

        // Game state
        this.isRunning = false;
        this.isDragging = false;
        this.lastCell = null;
        this.dragPaintValue = null;

        // Statistics
        this.stats = { born: 0, died: 0, lasting: 0, total: 0 };
        this.history = [];
        this.tickCount = 0;
        this.birthOnSix = config.birthOnSix === true;
        this.ruleLabel = this.birthOnSix ? 'B36/S23' : 'B3/S23';
        this.MAX_HISTORY = 100;
        this.MIN_UPDATE_INTERVAL = 5;
        this.MAX_UPDATE_INTERVAL = 1000;
        this.LARGE_GRID_THRESHOLD = 2000;
        this.LARGE_GRID_MIN_UPDATE_INTERVAL = 25;
        this.MAX_STEPS_PER_FRAME = 6;

        // Add movement state tracking
        this.moveKeys = { w: false, s: false, a: false, d: false };

        // Add target zoom property
        this.targetZoom = 1.0;
        this.ZOOM_SMOOTHING = 0.1; // Adjust this value to change zoom smoothness

        // Setup
        this.initRenderingBackend();
        this.setupEventListeners();
        this.setupButtons();
        this.setupPersistenceControls();
        this.lastUpdateTime = 0;
        this.UPDATE_INTERVAL = 100; // default tick rate in milliseconds
        this.setupTickControl();
        this.animate();
    }

    createEmptyGrid() {
        return Array(this.gridHeight).fill().map(() => Array(this.gridWidth).fill(0));
    }

    getMaxAllowedGridSize() {
        const maxByCells = Math.floor(Math.sqrt(this.MAX_TOTAL_CELLS));
        let maxByTexture = Number.POSITIVE_INFINITY;
        if (this.webglAvailable && this.gl) {
            const gpuTextureLimit = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
            if (Number.isFinite(gpuTextureLimit) && gpuTextureLimit > 0) {
                maxByTexture = gpuTextureLimit;
            }
        }
        return Math.max(50, Math.floor(Math.min(maxByCells, maxByTexture)));
    }

    recomputeActiveBounds() {
        let minX = this.gridWidth;
        let maxX = -1;
        let minY = this.gridHeight;
        let maxY = -1;
        let total = 0;

        for (let y = 0; y < this.gridHeight; y++) {
            for (let x = 0; x < this.gridWidth; x++) {
                if (!this.grid[y][x]) {
                    continue;
                }
                total += 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }

        this.activeBounds = total > 0
            ? { minX, maxX, minY, maxY }
            : null;
        this.boundsMayNeedRecalc = false;
        return total;
    }

    updateActiveBoundsForCellChange(x, y, previousValue, nextValue) {
        if (previousValue === nextValue) {
            return;
        }

        if (nextValue === 1) {
            if (!this.activeBounds) {
                this.activeBounds = { minX: x, maxX: x, minY: y, maxY: y };
            } else {
                if (x < this.activeBounds.minX) this.activeBounds.minX = x;
                if (x > this.activeBounds.maxX) this.activeBounds.maxX = x;
                if (y < this.activeBounds.minY) this.activeBounds.minY = y;
                if (y > this.activeBounds.maxY) this.activeBounds.maxY = y;
            }
            return;
        }

        if (!this.activeBounds) {
            return;
        }

        if (
            x === this.activeBounds.minX ||
            x === this.activeBounds.maxX ||
            y === this.activeBounds.minY ||
            y === this.activeBounds.maxY
        ) {
            this.boundsMayNeedRecalc = true;
        }
    }

    getCenteredCamera(zoom = this.camera ? this.camera.zoom : 1.0) {
        return {
            x: this.canvas.width / 2 - (this.gridWidth * this.cellSize * zoom) / 2,
            y: this.canvas.height / 2 - (this.gridHeight * this.cellSize * zoom) / 2
        };
    }

    ensureGridVisibleOnScreen() {
        const scaledWidth = this.gridWidth * this.cellSize * this.camera.zoom;
        const scaledHeight = this.gridHeight * this.cellSize * this.camera.zoom;
        const left = this.camera.x;
        const top = this.camera.y;
        const right = left + scaledWidth;
        const bottom = top + scaledHeight;

        const intersectsScreen = right > 0 && bottom > 0 && left < this.canvas.width && top < this.canvas.height;
        if (!intersectsScreen) {
            const centered = this.getCenteredCamera();
            this.camera.x = centered.x;
            this.camera.y = centered.y;
            this.targetCamera.x = centered.x;
            this.targetCamera.y = centered.y;
            this.targetZoom = this.camera.zoom;
        }
    }

    resizeGrid(newWidth, newHeight) {
        const maxAllowed = this.getMaxAllowedGridSize();
        if (newWidth > maxAllowed || newHeight > maxAllowed) {
            alert(`Grid size too large for stable memory/GPU limits on this device. Max is ${maxAllowed}.`);
            return false;
        }

        let nextGrid;
        try {
            nextGrid = Array(newHeight).fill().map(() => Array(newWidth).fill(0));
        } catch (error) {
            alert('Failed to allocate grid memory. Try a smaller grid size.');
            return false;
        }
        const offsetX = Math.floor((newWidth - this.gridWidth) / 2);
        const offsetY = Math.floor((newHeight - this.gridHeight) / 2);

        for (let y = 0; y < this.gridHeight; y++) {
            for (let x = 0; x < this.gridWidth; x++) {
                if (!this.grid[y][x]) {
                    continue;
                }
                const nx = x + offsetX;
                const ny = y + offsetY;
                if (nx >= 0 && nx < newWidth && ny >= 0 && ny < newHeight) {
                    nextGrid[ny][nx] = 1;
                }
            }
        }

        this.gridWidth = newWidth;
        this.gridHeight = newHeight;
        this.grid = nextGrid;

        const centered = this.getCenteredCamera();
        this.camera.x = centered.x;
        this.camera.y = centered.y;
        this.targetCamera.x = centered.x;
        this.targetCamera.y = centered.y;
        this.stats.total = this.recomputeActiveBounds();

        if (this.webglAvailable) {
            this.recreateGpuStateTextures();
            this.uploadGridToGPU();
        }

        return true;
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    initRenderingBackend() {
        const gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
        if (!gl) {
            this.ctx = this.canvas.getContext('2d');
            this.webglAvailable = false;
            this.useGpuSimulation = false;
            return;
        }

        this.gl = gl;
        this.webglAvailable = this.initWebGLResources();
        if (!this.webglAvailable) {
            this.gl = null;
            this.ctx = this.canvas.getContext('2d');
            this.useGpuSimulation = false;
            return;
        }

        this.uploadGridToGPU();
    }

    initWebGLResources() {
        const gl = this.gl;
        const simVs = `#version 300 es
            in vec2 a_pos;
            void main() {
                gl_Position = vec4(a_pos, 0.0, 1.0);
            }
        `;
        const simFs = `#version 300 es
            precision highp float;
            precision highp sampler2D;
            uniform sampler2D u_state;
            uniform ivec2 u_gridSize;
            uniform int u_birthOnSix;
            out vec4 outColor;

            int cellAt(ivec2 p) {
                if (p.x < 0 || p.y < 0 || p.x >= u_gridSize.x || p.y >= u_gridSize.y) {
                    return 0;
                }
                return int(texelFetch(u_state, p, 0).r + 0.5);
            }

            void main() {
                ivec2 p = ivec2(gl_FragCoord.xy);
                if (p.x == 0 || p.y == 0 || p.x == u_gridSize.x - 1 || p.y == u_gridSize.y - 1) {
                    outColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }

                int alive = cellAt(p);
                int n = 0;
                n += cellAt(p + ivec2(-1, -1));
                n += cellAt(p + ivec2( 0, -1));
                n += cellAt(p + ivec2( 1, -1));
                n += cellAt(p + ivec2(-1,  0));
                n += cellAt(p + ivec2( 1,  0));
                n += cellAt(p + ivec2(-1,  1));
                n += cellAt(p + ivec2( 0,  1));
                n += cellAt(p + ivec2( 1,  1));

                int nextState = 0;
                if (alive == 1) {
                    nextState = (n == 2 || n == 3) ? 1 : 0;
                } else {
                    nextState = (n == 3 || (u_birthOnSix == 1 && n == 6)) ? 1 : 0;
                }

                outColor = vec4(float(nextState), 0.0, 0.0, 1.0);
            }
        `;

        const drawVs = `#version 300 es
            in vec2 a_pos;
            void main() {
                gl_Position = vec4(a_pos, 0.0, 1.0);
            }
        `;
        const drawFs = `#version 300 es
            precision highp float;
            precision highp sampler2D;
            uniform sampler2D u_state;
            uniform vec2 u_canvasSize;
            uniform vec2 u_camera;
            uniform float u_zoom;
            uniform float u_cellSize;
            uniform vec2 u_gridSize;
            out vec4 outColor;

            void main() {
                float yTop = u_canvasSize.y - gl_FragCoord.y;
                vec2 screen = vec2(gl_FragCoord.x, yTop);
                vec2 world = (screen - u_camera) / (u_cellSize * u_zoom);
                vec2 g = floor(world);

                if (g.x < 0.0 || g.y < 0.0 || g.x >= u_gridSize.x || g.y >= u_gridSize.y) {
                    outColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }

                ivec2 cell = ivec2(int(g.x), int(g.y));
                float alive = texelFetch(u_state, cell, 0).r;

                float pixelCell = u_cellSize * u_zoom;
                vec2 cellPixels = vec2(max(1.0, pixelCell));
                vec2 rel = mod(screen - u_camera, cellPixels);
                float lineX = 1.0 - step(1.0, rel.x);
                float lineY = 1.0 - step(1.0, rel.y);
                float line = max(lineX, lineY) * smoothstep(2.0, 5.0, pixelCell);

                vec3 bgBase = vec3(0.01);
                vec3 bg = mix(bgBase, vec3(0.196), line);
                vec3 fg = vec3(1.0);
                vec3 color = (alive > 0.5) ? fg : bg;
                outColor = vec4(color, 1.0);
            }
        `;

        this.simProgram = this.createProgram(simVs, simFs);
        this.drawProgram = this.createProgram(drawVs, drawFs);
        if (!this.simProgram || !this.drawProgram) {
            return false;
        }

        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1
        ]), gl.STATIC_DRAW);

        this.stateTextures = [null, null];
        this.stateFramebuffers = [null, null];
        this.sourceIndex = 0;
        if (!this.recreateGpuStateTextures()) {
            return false;
        }
        return true;
    }

    createProgram(vsSource, fsSource) {
        const gl = this.gl;
        const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = compile(gl.VERTEX_SHADER, vsSource);
        const fs = compile(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) {
            return null;
        }

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program);
            return null;
        }

        return program;
    }

    recreateGpuStateTextures() {
        if (!this.gl) {
            return false;
        }
        const gl = this.gl;
        for (let i = 0; i < 2; i++) {
            if (this.stateTextures[i]) {
                gl.deleteTexture(this.stateTextures[i]);
            }
            if (this.stateFramebuffers[i]) {
                gl.deleteFramebuffer(this.stateFramebuffers[i]);
            }

            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.gridWidth, this.gridHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                return false;
            }

            this.stateTextures[i] = texture;
            this.stateFramebuffers[i] = framebuffer;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.sourceIndex = 0;
        this.resetGpuStatsSampling();
        this.cpuGridDirtyFromGpu = false;
        return true;
    }

    flattenGridToBytes() {
        const bytes = new Uint8Array(this.gridWidth * this.gridHeight * 4);
        let idx = 0;
        for (let y = 0; y < this.gridHeight; y++) {
            for (let x = 0; x < this.gridWidth; x++) {
                const v = this.grid[y][x] ? 255 : 0;
                bytes[idx++] = v;
                bytes[idx++] = 0;
                bytes[idx++] = 0;
                bytes[idx++] = 255;
            }
        }
        return bytes;
    }

    uploadGridToGPU() {
        if (!this.webglAvailable) {
            return;
        }
        const gl = this.gl;
        const bytes = this.flattenGridToBytes();

        for (let i = 0; i < 2; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[i]);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gridWidth, this.gridHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        }
        this.resetGpuStatsSampling();
        this.cpuGridDirtyFromGpu = false;
    }

    pullGridFromGPU() {
        if (!this.webglAvailable) {
            return;
        }
        const gl = this.gl;
        const pixels = new Uint8Array(this.gridWidth * this.gridHeight * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFramebuffers[this.sourceIndex]);
        gl.readPixels(0, 0, this.gridWidth, this.gridHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        let minX = this.gridWidth;
        let maxX = -1;
        let minY = this.gridHeight;
        let maxY = -1;
        let total = 0;
        let idx = 0;
        for (let y = 0; y < this.gridHeight; y++) {
            for (let x = 0; x < this.gridWidth; x++) {
                const alive = pixels[idx] > 127 ? 1 : 0;
                this.grid[y][x] = alive;
                if (alive) {
                    total += 1;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
                idx += 4;
            }
        }
        this.activeBounds = total > 0 ? { minX, maxX, minY, maxY } : null;
        this.boundsMayNeedRecalc = false;
        this.gpuActiveBoundsTickCounter = 0;
        this.cpuGridDirtyFromGpu = false;
    }

    ensureCpuGridSynced() {
        if (this.webglAvailable && this.useGpuSimulation && this.cpuGridDirtyFromGpu) {
            this.pullGridFromGPU();
        }
    }

    setCellGPU(x, y, value) {
        if (!this.webglAvailable) {
            return;
        }
        const gl = this.gl;
        const pixel = new Uint8Array([value ? 255 : 0, 0, 0, 255]);
        for (let i = 0; i < 2; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[i]);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        }
    }

    shouldUseGpuActiveRegion() {
        if (!this.activeBounds) {
            return false;
        }
        const gridCells = this.gridWidth * this.gridHeight;
        if (gridCells < this.GPU_ACTIVE_REGION_MIN_GRID_CELLS) {
            return false;
        }

        const activeWidth = this.activeBounds.maxX - this.activeBounds.minX + 1;
        const activeHeight = this.activeBounds.maxY - this.activeBounds.minY + 1;
        if (activeWidth <= 0 || activeHeight <= 0) {
            return false;
        }

        const activeCells = activeWidth * activeHeight;
        return activeCells < gridCells * this.GPU_ACTIVE_REGION_ENABLE_AREA_RATIO;
    }

    getExpandedGpuActiveBounds() {
        if (!this.activeBounds) {
            return null;
        }

        const minX = Math.max(1, this.activeBounds.minX - 1);
        const minY = Math.max(1, this.activeBounds.minY - 1);
        const maxX = Math.min(this.gridWidth - 2, this.activeBounds.maxX + 1);
        const maxY = Math.min(this.gridHeight - 2, this.activeBounds.maxY + 1);
        if (minX > maxX || minY > maxY) {
            return null;
        }

        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    }

    sampleGpuActiveBoundsFromRect(rect) {
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            this.activeBounds = null;
            this.boundsMayNeedRecalc = false;
            return;
        }

        const gl = this.gl;
        const bufferSize = rect.width * rect.height * 4;
        if (!this.gpuActiveBoundsBuffer || this.gpuActiveBoundsBuffer.length !== bufferSize) {
            this.gpuActiveBoundsBuffer = new Uint8Array(bufferSize);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFramebuffers[this.sourceIndex]);
        gl.readPixels(rect.minX, rect.minY, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, this.gpuActiveBoundsBuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        let minX = this.gridWidth;
        let maxX = -1;
        let minY = this.gridHeight;
        let maxY = -1;
        let total = 0;

        let idx = 0;
        for (let y = 0; y < rect.height; y++) {
            const gy = rect.minY + y;
            for (let x = 0; x < rect.width; x++) {
                if (this.gpuActiveBoundsBuffer[idx] > 127) {
                    const gx = rect.minX + x;
                    total += 1;
                    if (gx < minX) minX = gx;
                    if (gx > maxX) maxX = gx;
                    if (gy < minY) minY = gy;
                    if (gy > maxY) maxY = gy;
                }
                idx += 4;
            }
        }

        this.activeBounds = total > 0 ? { minX, maxX, minY, maxY } : null;
        this.boundsMayNeedRecalc = false;

        if (this.gridWidth * this.gridHeight >= this.GPU_STATS_DISABLE_DURING_RUN_AREA) {
            this.stats.total = total;
            this.stats.born = 0;
            this.stats.died = 0;
            this.stats.lasting = 0;
            this.history.push(total);
            if (this.history.length > this.MAX_HISTORY) {
                this.history.shift();
            }
        }
    }

    runGpuStep() {
        if (!this.webglAvailable) {
            return;
        }
        const gl = this.gl;
        const src = this.sourceIndex;
        const dst = 1 - src;

        if (!this.activeBounds) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFramebuffers[dst]);
            gl.viewport(0, 0, this.gridWidth, this.gridHeight);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this.sourceIndex = dst;
            this.cpuGridDirtyFromGpu = true;
            return;
        }

        const useActiveRegion = this.shouldUseGpuActiveRegion();
        const rect = useActiveRegion ? this.getExpandedGpuActiveBounds() : null;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFramebuffers[dst]);
        if (useActiveRegion) {
            gl.viewport(0, 0, this.gridWidth, this.gridHeight);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (!rect) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                this.sourceIndex = dst;
                this.cpuGridDirtyFromGpu = true;
                this.activeBounds = null;
                this.gpuActiveBoundsTickCounter = 0;
                return;
            }
            gl.viewport(rect.minX, rect.minY, rect.width, rect.height);
        } else {
            gl.viewport(0, 0, this.gridWidth, this.gridHeight);
        }
        gl.useProgram(this.simProgram);

        const posLoc = gl.getAttribLocation(this.simProgram, 'a_pos');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[src]);
        gl.uniform1i(gl.getUniformLocation(this.simProgram, 'u_state'), 0);
        gl.uniform2i(gl.getUniformLocation(this.simProgram, 'u_gridSize'), this.gridWidth, this.gridHeight);
        gl.uniform1i(gl.getUniformLocation(this.simProgram, 'u_birthOnSix'), this.birthOnSix ? 1 : 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.sourceIndex = dst;
        this.cpuGridDirtyFromGpu = true;

        if (useActiveRegion && rect) {
            this.activeBounds = {
                minX: rect.minX,
                minY: rect.minY,
                maxX: rect.maxX,
                maxY: rect.maxY
            };

            this.gpuActiveBoundsTickCounter += 1;
            if (
                this.gpuActiveBoundsTickCounter >= this.GPU_ACTIVE_REGION_SAMPLE_INTERVAL ||
                (rect.width * rect.height <= 250000)
            ) {
                this.sampleGpuActiveBoundsFromRect(rect);
                this.gpuActiveBoundsTickCounter = 0;
            }
        } else {
            this.gpuActiveBoundsTickCounter = 0;
        }
    }

    drawWebGL() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.drawProgram);

        const posLoc = gl.getAttribLocation(this.drawProgram, 'a_pos');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[this.sourceIndex]);
        gl.uniform1i(gl.getUniformLocation(this.drawProgram, 'u_state'), 0);
        gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_canvasSize'), this.canvas.width, this.canvas.height);
        gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_camera'), this.camera.x, this.camera.y);
        gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_zoom'), this.camera.zoom);
        gl.uniform1f(gl.getUniformLocation(this.drawProgram, 'u_cellSize'), this.cellSize);
        gl.uniform2f(gl.getUniformLocation(this.drawProgram, 'u_gridSize'), this.gridWidth, this.gridHeight);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    resetGpuStatsSampling() {
        this.prevGpuFrame = null;
        this.gpuStatsBufferA = null;
        this.gpuStatsBufferB = null;
        this.gpuStatsHasPrevFrame = false;
        this.lastGpuStatsTick = -1;
        this.lastGpuStatsSampleTime = 0;
        this.gpuActiveBoundsBuffer = null;
        this.gpuActiveBoundsTickCounter = 0;
    }

    getGpuStatsSampleInterval() {
        const area = this.gridWidth * this.gridHeight;
        if (area >= 20000000) {
            return 32;
        }
        if (area >= 12000000) {
            return 24;
        }
        if (area >= 6000000) {
            return 12;
        }
        if (area >= 2000000) {
            return 6;
        }
        if (area >= 1000000) {
            return 3;
        }
        return 1;
    }

    getGpuStatsMinSampleMs() {
        const area = this.gridWidth * this.gridHeight;
        if (area >= 20000000) {
            return 6000;
        }
        if (area >= 12000000) {
            return 3500;
        }
        if (area >= 6000000) {
            return 1500;
        }
        if (area >= 2000000) {
            return 700;
        }
        if (area >= 1000000) {
            return 300;
        }
        return 0;
    }

    updateGpuStats(force = false) {
        if (!this.webglAvailable) {
            return;
        }

        const area = this.gridWidth * this.gridHeight;
        if (!force && this.isRunning && area >= this.GPU_STATS_DISABLE_DURING_RUN_AREA) {
            return;
        }

        const now = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        const minSampleMs = this.getGpuStatsMinSampleMs();
        if (!force && minSampleMs > 0 && this.lastGpuStatsSampleTime > 0 && (now - this.lastGpuStatsSampleTime) < minSampleMs) {
            return;
        }

        const interval = this.getGpuStatsSampleInterval();
        if (!force && this.lastGpuStatsTick >= 0 && (this.tickCount - this.lastGpuStatsTick) < interval) {
            return;
        }

        const bufferSize = this.gridWidth * this.gridHeight * 4;
        if (!this.gpuStatsBufferA || this.gpuStatsBufferA.length !== bufferSize) {
            this.gpuStatsBufferA = new Uint8Array(bufferSize);
            this.gpuStatsBufferB = new Uint8Array(bufferSize);
            this.gpuStatsHasPrevFrame = false;
        }

        const gl = this.gl;
        const pixels = this.gpuStatsBufferA;
        const prevPixels = this.gpuStatsBufferB;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFramebuffers[this.sourceIndex]);
        gl.readPixels(0, 0, this.gridWidth, this.gridHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        let total = 0;
        let born = 0;
        let died = 0;
        let lasting = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            const alive = pixels[i] > 127;
            if (alive) {
                total += 1;
            }
            if (this.gpuStatsHasPrevFrame) {
                const prevAlive = prevPixels[i] > 127;
                if (!prevAlive && alive) {
                    born += 1;
                } else if (prevAlive && !alive) {
                    died += 1;
                } else if (prevAlive && alive) {
                    lasting += 1;
                }
            }
        }

        this.stats.total = total;
        this.stats.born = born;
        this.stats.died = died;
        this.stats.lasting = lasting;
        this.history.push(total);
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }

        this.gpuStatsBufferA = prevPixels;
        this.gpuStatsBufferB = pixels;
        this.gpuStatsHasPrevFrame = true;
        this.lastGpuStatsTick = this.tickCount;
        this.lastGpuStatsSampleTime = now;
    }

    setGpuSimulationEnabled(enabled) {
        if (!this.webglAvailable) {
            this.useGpuSimulation = false;
            return;
        }

        if (enabled && !this.useGpuSimulation) {
            this.uploadGridToGPU();
            this.resetGpuStatsSampling();
        }

        if (!enabled && this.useGpuSimulation) {
            this.pullGridFromGPU();
        }

        this.useGpuSimulation = enabled;
        this.syncControlButtons();
    }

    isTypingInInput() {
        const active = document.activeElement;
        if (!active) {
            return false;
        }
        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') {
            return true;
        }
        return active.isContentEditable === true;
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.dragPaintValue = null;
            this.lastCell = null;
        });
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        
        // Wheel / touchpad two-finger vertical scroll zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            // Get mouse position relative to canvas
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Works with both mouse wheel and touchpad scrolling
            const delta = -e.deltaY;
            const zoomMultiplier = Math.pow(1 + this.ZOOM_SPEED, delta / 300);
            const newZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.targetZoom * zoomMultiplier));

            // Adjust camera position to zoom toward cursor position
            if (newZoom !== this.targetZoom) {
                const zoomFactor = newZoom / this.targetZoom;
                this.targetCamera.x = mouseX - (mouseX - this.targetCamera.x) * zoomFactor;
                this.targetCamera.y = mouseY - (mouseY - this.targetCamera.y) * zoomFactor;
                this.targetZoom = newZoom;
            }
        }, { passive: false });
        
        window.addEventListener('keydown', (e) => {
            if (this.isTypingInInput()) {
                this.moveKeys.w = false;
                this.moveKeys.a = false;
                this.moveKeys.s = false;
                this.moveKeys.d = false;
                return;
            }
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            switch(key) {
                case 'w': 
                case 's': 
                case 'a': 
                case 'd': 
                    this.moveKeys[key] = true;
                    e.preventDefault();
                    break;
                case 'ArrowLeft': // Zoom out
                    e.preventDefault();
                    const centerX = this.canvas.width / 2;
                    const centerY = this.canvas.height / 2;
                    const keyZoomMultiplier = 1 + this.ZOOM_SPEED;
                    const newZoomOut = Math.max(this.MIN_ZOOM, this.targetZoom / keyZoomMultiplier);
                    if (newZoomOut !== this.targetZoom) {
                        const zoomFactorOut = newZoomOut / this.targetZoom;
                        this.targetCamera.x = centerX - (centerX - this.targetCamera.x) * zoomFactorOut;
                        this.targetCamera.y = centerY - (centerY - this.targetCamera.y) * zoomFactorOut;
                        this.targetZoom = newZoomOut;
                    }
                    break;
                case 'ArrowRight': // Zoom in
                    e.preventDefault();
                    const centerX2 = this.canvas.width / 2;
                    const centerY2 = this.canvas.height / 2;
                    const keyZoomMultiplier2 = 1 + this.ZOOM_SPEED;
                    const newZoomIn = Math.min(this.MAX_ZOOM, this.targetZoom * keyZoomMultiplier2);
                    if (newZoomIn !== this.targetZoom) {
                        const zoomFactorIn = newZoomIn / this.targetZoom;
                        this.targetCamera.x = centerX2 - (centerX2 - this.targetCamera.x) * zoomFactorIn;
                        this.targetCamera.y = centerY2 - (centerY2 - this.targetCamera.y) * zoomFactorIn;
                        this.targetZoom = newZoomIn;
                    }
                    break;
                case 'p': // Reset camera position and zoom
                    e.preventDefault();
                    this.targetZoom = 1.0;
                    this.targetCamera = this.getCenteredCamera(this.targetZoom);
                    break;
                case ' ': 
                    e.preventDefault();
                    if (!this.isRunning) {
                        if (this.webglAvailable && this.useGpuSimulation) {
                            this.runGpuStep();
                            this.tickCount += 1;
                            this.updateGpuStats();
                        } else {
                            this.updateGrid();
                            if (this.webglAvailable) {
                                this.uploadGridToGPU();
                            }
                            this.tickCount += 1;
                        }
                    }
                    break;
            }
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            if (['w', 's', 'a', 'd'].includes(key)) {
                this.moveKeys[key] = false;
            }
        });

        // Prevent context menu on right-click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

    }

    setupButtons() {
        this.startButton = document.getElementById('startButton');
        this.gpuButton = document.getElementById('gpuButton');

        this.startButton.onclick = (e) => {
            this.isRunning = !this.isRunning;
            if (this.isRunning) {
                this.isDragging = false;
                this.dragPaintValue = null;
                this.lastCell = null;
            }
            if (!this.isRunning) {
                if (this.webglAvailable && this.useGpuSimulation) {
                    const area = this.gridWidth * this.gridHeight;
                    if (area < this.GPU_STATS_DISABLE_DURING_RUN_AREA) {
                        this.updateGpuStats(true);
                    }
                } else {
                    this.ensureCpuGridSynced();
                }
            }
            this.syncControlButtons();
            e.target.blur();
        };

        document.getElementById('clearButton').onclick = (e) => {
            this.grid = this.createEmptyGrid();
            this.isRunning = false;
            this.stats = { born: 0, died: 0, lasting: 0, total: 0 };
            this.history = [];
            this.tickCount = 0;
            this.activeBounds = null;
            this.boundsMayNeedRecalc = false;
            if (this.webglAvailable) {
                this.uploadGridToGPU();
            }
            this.syncControlButtons();
            e.target.blur();
        };

        document.getElementById('randomButton').onclick = (e) => {
            let randomDensity = 0.15;
            if (this.gridWidth >= 2000 || this.gridHeight >= 2000) {
                randomDensity = 0.08;
            } else if (this.gridWidth >= 1000 || this.gridHeight >= 1000) {
                randomDensity = 0.10;
            }

            this.grid = this.createEmptyGrid();

            let minX = this.gridWidth;
            let maxX = -1;
            let minY = this.gridHeight;
            let maxY = -1;
            let total = 0;
            for (let y = 1; y < this.gridHeight - 1; y++) {
                for (let x = 1; x < this.gridWidth - 1; x++) {
                    const alive = Math.random() < randomDensity ? 1 : 0;
                    this.grid[y][x] = alive;
                    if (alive) {
                        total += 1;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            this.activeBounds = total > 0 ? { minX, maxX, minY, maxY } : null;
            this.boundsMayNeedRecalc = false;
            this.stats = { born: 0, died: 0, lasting: 0, total };
            this.history = [];
            this.tickCount = 0;
            if (this.webglAvailable) {
                this.uploadGridToGPU();
            }
            e.target.blur();
        };

        if (this.gpuButton) {
            this.gpuButton.onclick = (e) => {
                this.setGpuSimulationEnabled(!this.useGpuSimulation);
                e.target.blur();
            };
        }

        this.syncControlButtons();
    }

    syncControlButtons() {
        if (this.startButton) {
            this.startButton.textContent = this.isRunning ? 'Stop' : 'Start';
        }
        if (this.gpuButton) {
            if (!this.webglAvailable) {
                this.gpuButton.textContent = 'GPU: N/A';
                this.gpuButton.disabled = true;
            } else {
                this.gpuButton.textContent = this.useGpuSimulation ? 'GPU: On' : 'GPU: Off';
                this.gpuButton.disabled = false;
            }
        }
    }

    setupPersistenceControls() {
        const exportButton = document.getElementById('exportButton');
        const importButton = document.getElementById('importButton');
        const importFileInput = document.getElementById('importFileInput');

        exportButton.onclick = (e) => {
            this.exportToFile();
            e.target.blur();
        };

        importButton.onclick = (e) => {
            importFileInput.click();
            e.target.blur();
        };

        importFileInput.addEventListener('change', async (event) => {
            const [file] = event.target.files;
            if (file) {
                await this.importFromFile(file);
            }
            event.target.value = '';
        });
    }

    getSerializableState() {
        if (this.webglAvailable && this.useGpuSimulation) {
            this.pullGridFromGPU();
        }

        const cells = [];
        for (let y = 0; y < this.gridHeight; y++) {
            for (let x = 0; x < this.gridWidth; x++) {
                if (this.grid[y][x] === 1) {
                    cells.push([x, y]);
                }
            }
        }

        return {
            version: 2,
            format: 'cells',
            rule: this.ruleLabel,
            savedAt: new Date().toISOString(),
            width: this.gridWidth,
            height: this.gridHeight,
            cells,
            camera: {
                x: this.camera.x,
                y: this.camera.y,
                zoom: this.camera.zoom
            }
        };
    }

    exportToFile() {
        const state = this.getSerializableState();
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        anchor.href = url;
        anchor.download = `conways-game-save-${timestamp}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    }

    async importFromFile(file) {
        try {
            const text = await file.text();
            const state = this.parseImportedText(text, this.getImportName(file.name));
            this.applyState(state);
            alert('Imported world successfully.');
        } catch (error) {
            alert('Failed to import file: ' + error.message);
        }
    }

    getImportName(fileName) {
        if (typeof fileName !== 'string' || fileName.length === 0) {
            return 'Imported Pattern';
        }
        const base = fileName.replace(/\.[^/.]+$/, '').trim();
        return base || 'Imported Pattern';
    }

    parseImportedText(text, fallbackName) {
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (!trimmed) {
            throw new Error('File is empty');
        }

        try {
            return JSON.parse(trimmed);
        } catch (jsonError) {
            if (trimmed.startsWith('[M2]')) {
                return this.parseMacrocellToState(trimmed, fallbackName);
            }
            return this.parseRleToState(trimmed, fallbackName);
        }
    }

    parseMacrocellToState(mcText, fallbackName) {
        const lines = mcText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        if (!lines[0] || !lines[0].startsWith('[M2]')) {
            throw new Error('Invalid macrocell file');
        }

        const nodes = [null];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('#')) {
                continue;
            }

            if (/^[.*$]+$/.test(line)) {
                const cells = [];
                let x = 0;
                let y = 0;
                for (let j = 0; j < line.length; j++) {
                    const token = line[j];
                    if (token === '.') {
                        x += 1;
                    } else if (token === '*') {
                        cells.push([x, y]);
                        x += 1;
                    } else if (token === '$') {
                        y += 1;
                        x = 0;
                    }
                }
                nodes.push({ type: 'leaf', level: 3, size: 8, cells });
                continue;
            }

            const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/);
            if (!match) {
                continue;
            }

            const level = parseInt(match[1], 10);
            const nw = parseInt(match[2], 10);
            const ne = parseInt(match[3], 10);
            const sw = parseInt(match[4], 10);
            const se = parseInt(match[5], 10);
            const size = Math.pow(2, level);
            nodes.push({ type: 'node', level, size, nw, ne, sw, se });
        }

        const rootId = nodes.length - 1;
        const root = nodes[rootId];
        if (!root) {
            throw new Error('Macrocell has no pattern data');
        }

        const sourceWidth = root.size;
        const sourceHeight = root.size;
        const startY = Math.floor((this.gridHeight - sourceHeight) / 2);
        const startX = Math.floor((this.gridWidth - sourceWidth) / 2);

        const minSourceX = Math.max(0, -startX);
        const minSourceY = Math.max(0, -startY);
        const maxSourceX = Math.min(sourceWidth - 1, this.gridWidth - 1 - startX);
        const maxSourceY = Math.min(sourceHeight - 1, this.gridHeight - 1 - startY);

        if (minSourceX > maxSourceX || minSourceY > maxSourceY) {
            return {
                version: 2,
                format: 'cells',
                name: fallbackName || 'Imported Macrocell',
                width: sourceWidth,
                height: sourceHeight,
                cells: []
            };
        }

        const cells = [];

        const visit = (id, originX, originY) => {
            if (id === 0) {
                return;
            }

            const node = nodes[id];
            if (!node) {
                return;
            }

            const nodeMinX = originX;
            const nodeMinY = originY;
            const nodeMaxX = originX + node.size - 1;
            const nodeMaxY = originY + node.size - 1;
            if (nodeMaxX < minSourceX || nodeMaxY < minSourceY || nodeMinX > maxSourceX || nodeMinY > maxSourceY) {
                return;
            }

            if (node.type === 'leaf') {
                for (const pair of node.cells) {
                    const x = originX + pair[0];
                    const y = originY + pair[1];
                    if (x >= minSourceX && x <= maxSourceX && y >= minSourceY && y <= maxSourceY) {
                        cells.push([x, y]);
                    }
                }
                return;
            }

            const half = node.size / 2;
            visit(node.nw, originX, originY);
            visit(node.ne, originX + half, originY);
            visit(node.sw, originX, originY + half);
            visit(node.se, originX + half, originY + half);
        };

        visit(rootId, 0, 0);

        return {
            version: 2,
            format: 'cells',
            name: fallbackName || 'Imported Macrocell',
            width: sourceWidth,
            height: sourceHeight,
            cells
        };
    }

    parseRleToState(rleText, fallbackName) {
        const lines = rleText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'));

        if (lines.length === 0) {
            throw new Error('RLE is empty');
        }

        let sourceWidth = null;
        let sourceHeight = null;
        const bodyParts = [];

        for (const line of lines) {
            if (/^x\s*=/.test(line.toLowerCase())) {
                const widthMatch = line.match(/x\s*=\s*(\d+)/i);
                const heightMatch = line.match(/y\s*=\s*(\d+)/i);
                if (widthMatch) {
                    sourceWidth = parseInt(widthMatch[1], 10);
                }
                if (heightMatch) {
                    sourceHeight = parseInt(heightMatch[1], 10);
                }
            } else {
                bodyParts.push(line);
            }
        }

        const body = bodyParts.join('');
        if (!body.includes('!')) {
            throw new Error('Invalid RLE: missing terminator (!)');
        }

        const cells = [];
        let x = 0;
        let y = 0;
        let maxX = 0;
        let maxY = 1;
        let countBuffer = '';

        for (let i = 0; i < body.length; i++) {
            const token = body[i];
            if (token >= '0' && token <= '9') {
                countBuffer += token;
                continue;
            }

            const count = countBuffer.length > 0 ? parseInt(countBuffer, 10) : 1;
            countBuffer = '';

            if (token === 'b') {
                x += count;
                maxX = Math.max(maxX, x);
                continue;
            }

            if (token === 'o') {
                for (let j = 0; j < count; j++) {
                    cells.push([x + j, y]);
                }
                x += count;
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y + 1);
                continue;
            }

            if (token === '$') {
                y += count;
                x = 0;
                maxY = Math.max(maxY, y + 1);
                continue;
            }

            if (token === '!') {
                break;
            }

            if (token === ',' || token === ' ' || token === '\t' || token === '\r' || token === '\n') {
                continue;
            }

            throw new Error('Invalid RLE token: ' + token);
        }

        return {
            version: 2,
            format: 'cells',
            name: fallbackName || 'Imported Pattern',
            width: Number.isInteger(sourceWidth) && sourceWidth > 0 ? sourceWidth : Math.max(1, maxX),
            height: Number.isInteger(sourceHeight) && sourceHeight > 0 ? sourceHeight : Math.max(1, maxY),
            cells
        };
    }

    normalizeImportedGrid(gridData) {
        if (!Array.isArray(gridData) || gridData.length === 0 || !Array.isArray(gridData[0])) {
            throw new Error('Invalid grid data');
        }

        const sourceHeight = gridData.length;
        const sourceWidth = gridData[0].length;
        if (sourceWidth === 0) {
            throw new Error('Grid cannot be empty');
        }

        if (!gridData.every((row) => Array.isArray(row) && row.length === sourceWidth)) {
            throw new Error('Grid rows must have the same length');
        }

        const nextGrid = this.createEmptyGrid();
        const startY = Math.floor((this.gridHeight - sourceHeight) / 2);
        const startX = Math.floor((this.gridWidth - sourceWidth) / 2);

        for (let y = 0; y < sourceHeight; y++) {
            for (let x = 0; x < sourceWidth; x++) {
                const cell = gridData[y][x] ? 1 : 0;
                const targetY = startY + y;
                const targetX = startX + x;
                if (targetY >= 0 && targetY < this.gridHeight && targetX >= 0 && targetX < this.gridWidth) {
                    nextGrid[targetY][targetX] = cell;
                }
            }
        }

        return nextGrid;
    }

    normalizeImportedCells(cellsData, sourceWidth, sourceHeight) {
        if (!Array.isArray(cellsData)) {
            throw new Error('Invalid cells data');
        }

        if (!Number.isInteger(sourceWidth) || sourceWidth <= 0) {
            sourceWidth = this.gridWidth;
        }
        if (!Number.isInteger(sourceHeight) || sourceHeight <= 0) {
            sourceHeight = this.gridHeight;
        }

        const nextGrid = this.createEmptyGrid();
        const startY = Math.floor((this.gridHeight - sourceHeight) / 2);
        const startX = Math.floor((this.gridWidth - sourceWidth) / 2);

        for (const pair of cellsData) {
            if (!Array.isArray(pair) || pair.length < 2) {
                continue;
            }
            const rawX = Number(pair[0]);
            const rawY = Number(pair[1]);
            if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
                continue;
            }

            const x = Math.floor(rawX);
            const y = Math.floor(rawY);
            const targetX = startX + x;
            const targetY = startY + y;
            if (targetY >= 0 && targetY < this.gridHeight && targetX >= 0 && targetX < this.gridWidth) {
                nextGrid[targetY][targetX] = 1;
            }
        }

        return nextGrid;
    }

    applyState(state) {
        if (!state || typeof state !== 'object') {
            throw new Error('Invalid save format');
        }

        if (Array.isArray(state.grid)) {
            this.grid = this.normalizeImportedGrid(state.grid);
        } else {
            const cellsData = Array.isArray(state.cells)
                ? state.cells
                : (state.pattern && Array.isArray(state.pattern.cells) ? state.pattern.cells : null);
            if (!cellsData) {
                throw new Error('Save file must contain grid or cells');
            }
            const sourceWidth = state.width ?? (state.pattern ? state.pattern.width : undefined);
            const sourceHeight = state.height ?? (state.pattern ? state.pattern.height : undefined);
            this.grid = this.normalizeImportedCells(cellsData, sourceWidth, sourceHeight);
        }

        if (state.camera && Number.isFinite(state.camera.x) && Number.isFinite(state.camera.y) && Number.isFinite(state.camera.zoom)) {
            this.camera.x = state.camera.x;
            this.camera.y = state.camera.y;
            this.camera.zoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, state.camera.zoom));
            this.targetCamera = { x: this.camera.x, y: this.camera.y };
            this.targetZoom = this.camera.zoom;
        }

        const total = this.recomputeActiveBounds();
        this.isRunning = false;
        this.stats = { born: 0, died: 0, lasting: 0, total };
        this.history = [];
        this.ensureGridVisibleOnScreen();
        if (this.webglAvailable) {
            this.uploadGridToGPU();
            this.resetGpuStatsSampling();
        }
        this.syncControlButtons();
        this.updateStats();
    }

    screenToGrid(x, y) {
        const gridX = Math.floor((x - this.camera.x) / (this.cellSize * this.camera.zoom));
        const gridY = Math.floor((y - this.camera.y) / (this.cellSize * this.camera.zoom));
        return { x: gridX, y: gridY };
    }

    gridToScreen(x, y) {
        const screenX = x * this.cellSize * this.camera.zoom + this.camera.x;
        const screenY = y * this.cellSize * this.camera.zoom + this.camera.y;
        return { x: screenX, y: screenY };
    }

    countNeighbors(x, y) {
        let count = 0;
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                const row = y + i;
                const col = x + j;
                if (row >= 0 && row < this.gridHeight && col >= 0 && col < this.gridWidth) {
                    count += this.grid[row][col];
                }
            }
        }
        return count;
    }

    updateGrid() {
        if (this.boundsMayNeedRecalc) {
            this.recomputeActiveBounds();
        }

        if (!this.activeBounds) {
            this.stats = { born: 0, died: 0, lasting: 0, total: 0 };
            this.history.push(0);
            if (this.history.length > this.MAX_HISTORY) {
                this.history.shift();
            }
            return;
        }

        const startX = Math.max(1, this.activeBounds.minX - 1);
        const endX = Math.min(this.gridWidth - 2, this.activeBounds.maxX + 1);
        const startY = Math.max(1, this.activeBounds.minY - 1);
        const endY = Math.min(this.gridHeight - 2, this.activeBounds.maxY + 1);

        if (startX > endX || startY > endY) {
            this.stats = { born: 0, died: 0, lasting: 0, total: 0 };
            this.activeBounds = null;
            this.boundsMayNeedRecalc = false;
            this.history.push(0);
            if (this.history.length > this.MAX_HISTORY) {
                this.history.shift();
            }
            return;
        }

        this.stats = { born: 0, died: 0, lasting: 0, total: 0 };

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                const current = this.grid[y][x];
                const alive = current === 1 || current === 3;

                let neighbors = 0;
                const n00 = this.grid[y - 1][x - 1];
                const n01 = this.grid[y - 1][x];
                const n02 = this.grid[y - 1][x + 1];
                const n10 = this.grid[y][x - 1];
                const n12 = this.grid[y][x + 1];
                const n20 = this.grid[y + 1][x - 1];
                const n21 = this.grid[y + 1][x];
                const n22 = this.grid[y + 1][x + 1];

                if (n00 === 1 || n00 === 3) neighbors += 1;
                if (n01 === 1 || n01 === 3) neighbors += 1;
                if (n02 === 1 || n02 === 3) neighbors += 1;
                if (n10 === 1 || n10 === 3) neighbors += 1;
                if (n12 === 1 || n12 === 3) neighbors += 1;
                if (n20 === 1 || n20 === 3) neighbors += 1;
                if (n21 === 1 || n21 === 3) neighbors += 1;
                if (n22 === 1 || n22 === 3) neighbors += 1;

                let willLive = false;
                if (alive) {
                    willLive = neighbors === 2 || neighbors === 3;
                } else {
                    willLive = neighbors === 3 || (this.birthOnSix && neighbors === 6);
                }

                if (alive) {
                    if (willLive) {
                        this.stats.lasting += 1;
                    } else {
                        this.grid[y][x] = 3;
                        this.stats.died += 1;
                    }
                } else if (willLive) {
                    this.grid[y][x] = 2;
                    this.stats.born += 1;
                }
            }
        }

        let total = 0;
        let minX = this.gridWidth;
        let maxX = -1;
        let minY = this.gridHeight;
        let maxY = -1;

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                if (this.grid[y][x] === 2) {
                    this.grid[y][x] = 1;
                } else if (this.grid[y][x] === 3) {
                    this.grid[y][x] = 0;
                }

                if (this.grid[y][x] === 1) {
                    total += 1;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        const includeEdgeCell = (x, y) => {
            if (this.grid[y][x] !== 1) {
                return;
            }
            total += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        };

        for (let x = 0; x < this.gridWidth; x++) {
            includeEdgeCell(x, 0);
            includeEdgeCell(x, this.gridHeight - 1);
        }
        for (let y = 1; y < this.gridHeight - 1; y++) {
            includeEdgeCell(0, y);
            includeEdgeCell(this.gridWidth - 1, y);
        }

        this.stats.total = total;
        this.activeBounds = total > 0 ? { minX, maxX, minY, maxY } : null;
        this.boundsMayNeedRecalc = false;
        this.history.push(total);
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }
    }

    handleMouseDown(e) {
        e.preventDefault();

        if (this.isRunning) {
            this.isDragging = false;
            this.dragPaintValue = null;
            this.lastCell = null;
            return;
        }

        this.ensureCpuGridSynced();

        const rect = this.canvas.getBoundingClientRect();
        const pos = this.screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        
        if (pos.x > 0 && pos.x < this.gridWidth - 1 && 
            pos.y > 0 && pos.y < this.gridHeight - 1) {
            this.isDragging = true;
            this.lastCell = `${pos.x},${pos.y}`;
            if (e.button === 0) {
                const previousValue = this.grid[pos.y][pos.x];
                const nextValue = 1 - previousValue;
                this.grid[pos.y][pos.x] = nextValue;
                this.dragPaintValue = nextValue;
                this.updateActiveBoundsForCellChange(pos.x, pos.y, previousValue, nextValue);
                if (this.webglAvailable) {
                    this.setCellGPU(pos.x, pos.y, nextValue);
                }
            } else if (e.button === 1) {
                const previousValue = this.grid[pos.y][pos.x];
                this.grid[pos.y][pos.x] = 0;
                this.dragPaintValue = 0;
                this.updateActiveBoundsForCellChange(pos.x, pos.y, previousValue, 0);
                if (this.webglAvailable) {
                    this.setCellGPU(pos.x, pos.y, 0);
                }
            }
        }
    }

    handleMouseMove(e) {
        if (this.isRunning) {
            this.isDragging = false;
            this.dragPaintValue = null;
            this.lastCell = null;
            return;
        }

        if (!this.isDragging) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const pos = this.screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        
        if (pos.x > 0 && pos.x < this.gridWidth - 1 && 
            pos.y > 0 && pos.y < this.gridHeight - 1) {
            const cellKey = `${pos.x},${pos.y}`;
            if (cellKey === this.lastCell) {
                return;
            }
            this.lastCell = cellKey;

            if (e.buttons === 1) {
                const value = this.dragPaintValue === null ? 1 : this.dragPaintValue;
                const previousValue = this.grid[pos.y][pos.x];
                if (previousValue !== value) {
                    this.grid[pos.y][pos.x] = value;
                    this.updateActiveBoundsForCellChange(pos.x, pos.y, previousValue, value);
                    if (this.webglAvailable) {
                        this.setCellGPU(pos.x, pos.y, value);
                    }
                }
            } else if (e.buttons === 4) {
                const previousValue = this.grid[pos.y][pos.x];
                if (previousValue !== 0) {
                    this.grid[pos.y][pos.x] = 0;
                    this.updateActiveBoundsForCellChange(pos.x, pos.y, previousValue, 0);
                    if (this.webglAvailable) {
                        this.setCellGPU(pos.x, pos.y, 0);
                    }
                }
            }
        }
    }

    drawGrid() {
        const ctx = this.ctx;
        ctx.strokeStyle = '#323232';

        // Calculate visible range
        const startX = Math.max(0, Math.floor(-this.camera.x / (this.cellSize * this.camera.zoom)));
        const startY = Math.max(0, Math.floor(-this.camera.y / (this.cellSize * this.camera.zoom)));
        const endX = Math.min(this.gridWidth, Math.ceil((this.canvas.width - this.camera.x) / (this.cellSize * this.camera.zoom)));
        const endY = Math.min(this.gridHeight, Math.ceil((this.canvas.height - this.camera.y) / (this.cellSize * this.camera.zoom)));

        const topLeft = this.gridToScreen(0, 0);
        const bottomRight = this.gridToScreen(this.gridWidth, this.gridHeight);
        const bgX = Math.max(0, topLeft.x);
        const bgY = Math.max(0, topLeft.y);
        const bgW = Math.max(0, Math.min(this.canvas.width, bottomRight.x) - bgX);
        const bgH = Math.max(0, Math.min(this.canvas.height, bottomRight.y) - bgY);
        if (bgW > 0 && bgH > 0) {
            ctx.fillStyle = '#050505';
            ctx.fillRect(bgX, bgY, bgW, bgH);
        }

        // Draw grid lines
        ctx.beginPath();
        for (let x = startX; x <= endX; x++) {
            const screenX = this.gridToScreen(x, 0).x;
            const startPos = this.gridToScreen(0, startY).y;
            const endPos = this.gridToScreen(0, endY).y;
            ctx.moveTo(screenX, startPos);
            ctx.lineTo(screenX, endPos);
        }

        for (let y = startY; y <= endY; y++) {
            const screenY = this.gridToScreen(0, y).y;
            const startPos = this.gridToScreen(startX, 0).x;
            const endPos = this.gridToScreen(endX, 0).x;
            ctx.moveTo(startPos, screenY);
            ctx.lineTo(endPos, screenY);
        }
        ctx.stroke();

        // Draw cells
        ctx.fillStyle = '#ffffff';
        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                if (this.grid[y][x]) {
                    const pos = this.gridToScreen(x, y);
                    ctx.fillRect(
                        pos.x + 1,
                        pos.y + 1,
                        Math.max(1, this.cellSize * this.camera.zoom - 1),
                        Math.max(1, this.cellSize * this.camera.zoom - 1)
                    );
                }
            }
        }
    }

    updateStats() {
        const info = document.getElementById('statsInfo');
        let gpuStatsIntervalText = '';
        if (this.webglAvailable && this.useGpuSimulation) {
            const area = this.gridWidth * this.gridHeight;
            if (area >= this.GPU_STATS_DISABLE_DURING_RUN_AREA) {
                gpuStatsIntervalText = '<br>GPU Stats: disabled for large grid';
            } else {
                gpuStatsIntervalText = `<br>GPU Stats: 1/${this.getGpuStatsSampleInterval()} ticks`;
            }
        }
        info.innerHTML = `
            Rule: ${this.ruleLabel}<br>
            Born: ${this.stats.born}<br>
            Died: ${this.stats.died}<br>
            Lasting: ${this.stats.lasting}<br>
            Total: ${this.stats.total}<br>
            Ticks: ${this.tickCount}${gpuStatsIntervalText}
        `;

        const cameraInfo = document.getElementById('cameraInfo');
        cameraInfo.textContent = `Zoom: ${this.camera.zoom.toFixed(1)}x | Pos: (${-this.camera.x.toFixed(0)}, ${-this.camera.y.toFixed(0)})`;

        // Update population graph
        const graphCanvas = document.getElementById('populationGraph');
        const ctx = graphCanvas.getContext('2d');
        ctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);

        if (this.history.length > 1) {
            const maxPop = Math.max(...this.history, 1);
            ctx.beginPath();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;

            this.history.forEach((pop, i) => {
                const x = (i * graphCanvas.width) / this.MAX_HISTORY;
                const y = graphCanvas.height - (pop * graphCanvas.height / maxPop);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });

            ctx.stroke();
        }
    }

    setupTickControl() {
        const tickControl = document.createElement('div');
        tickControl.style.position = 'fixed';
        tickControl.style.bottom = '10px';
        tickControl.style.right = '10px';
        tickControl.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        tickControl.style.padding = '10px';
        tickControl.style.borderRadius = '5px';
        tickControl.style.color = 'white';

        const label = document.createElement('label');
        label.textContent = 'Tick Rate (ms): ';
        label.style.marginRight = '10px';

        const tickNumberInput = document.createElement('input');
        tickNumberInput.type = 'number';
        tickNumberInput.min = String(this.MIN_UPDATE_INTERVAL);
        tickNumberInput.max = String(this.MAX_UPDATE_INTERVAL);
        tickNumberInput.step = '1';
        tickNumberInput.value = this.UPDATE_INTERVAL;
        tickNumberInput.style.width = '70px';
        tickNumberInput.style.marginLeft = '6px';

        const applyTickRateButton = document.createElement('button');
        applyTickRateButton.textContent = 'Apply';
        applyTickRateButton.style.marginLeft = '8px';
        applyTickRateButton.style.cursor = 'pointer';

        const applyTickRate = (rawValue) => {
            const parsed = parseInt(rawValue, 10);
            if (!Number.isFinite(parsed)) {
                tickNumberInput.value = this.UPDATE_INTERVAL;
                return;
            }
            const minTickForCurrentGrid = (this.gridWidth >= this.LARGE_GRID_THRESHOLD || this.gridHeight >= this.LARGE_GRID_THRESHOLD)
                ? this.LARGE_GRID_MIN_UPDATE_INTERVAL
                : this.MIN_UPDATE_INTERVAL;
            const clamped = Math.max(minTickForCurrentGrid, Math.min(this.MAX_UPDATE_INTERVAL, parsed));
            this.UPDATE_INTERVAL = clamped;
            tickNumberInput.value = clamped;
        };

        const syncTickRateConstraintForGrid = (gridSize) => {
            const minTickForGrid = gridSize >= this.LARGE_GRID_THRESHOLD
                ? this.LARGE_GRID_MIN_UPDATE_INTERVAL
                : this.MIN_UPDATE_INTERVAL;
            tickNumberInput.min = String(minTickForGrid);
            if (this.UPDATE_INTERVAL < minTickForGrid) {
                this.UPDATE_INTERVAL = minTickForGrid;
                tickNumberInput.value = minTickForGrid;
            }
        };

        applyTickRateButton.addEventListener('click', () => {
            applyTickRate(tickNumberInput.value);
            tickNumberInput.blur();
        });

        tickNumberInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                applyTickRate(tickNumberInput.value);
                tickNumberInput.blur();
            } else if (e.key === 'Escape') {
                tickNumberInput.value = this.UPDATE_INTERVAL;
                tickNumberInput.blur();
            }
        });

        tickNumberInput.addEventListener('blur', () => {
            applyTickRate(tickNumberInput.value);
        });

        tickControl.appendChild(label);
        tickControl.appendChild(tickNumberInput);
        tickControl.appendChild(applyTickRateButton);

        const gridSizeRow = document.createElement('div');
        gridSizeRow.style.marginTop = '10px';

        const gridSizeLabel = document.createElement('label');
        gridSizeLabel.textContent = 'Grid Size: ';

        const gridSizeInput = document.createElement('input');
        gridSizeInput.type = 'number';
        gridSizeInput.min = '50';
        gridSizeInput.step = '10';
        gridSizeInput.value = this.gridWidth;
        gridSizeInput.style.width = '70px';
        gridSizeInput.style.marginLeft = '6px';

        const applyGridSizeButton = document.createElement('button');
        applyGridSizeButton.textContent = 'Apply';
        applyGridSizeButton.style.marginLeft = '8px';
        applyGridSizeButton.style.cursor = 'pointer';

        const applyGridSize = () => {
            const parsed = parseInt(gridSizeInput.value, 10);
            if (!Number.isFinite(parsed)) {
                return;
            }
            const requestedSize = Math.max(50, parsed);
            const maxAllowed = this.getMaxAllowedGridSize();
            if (requestedSize > maxAllowed) {
                gridSizeInput.value = maxAllowed;
                alert(`Requested size ${requestedSize} is too large. Max safe size on this device is ${maxAllowed}.`);
                return;
            }
            const nextSize = requestedSize;
            gridSizeInput.value = nextSize;
            if (nextSize !== this.gridWidth || nextSize !== this.gridHeight) {
                const resized = this.resizeGrid(nextSize, nextSize);
                if (!resized) {
                    gridSizeInput.value = this.gridWidth;
                    return;
                }
            }
            syncTickRateConstraintForGrid(nextSize);
        };

        applyGridSizeButton.addEventListener('click', applyGridSize);
        gridSizeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                applyGridSize();
                gridSizeInput.blur();
            } else if (e.key === 'Escape') {
                gridSizeInput.value = this.gridWidth;
                gridSizeInput.blur();
            }
        });

        gridSizeRow.appendChild(gridSizeLabel);
        gridSizeRow.appendChild(gridSizeInput);
        gridSizeRow.appendChild(applyGridSizeButton);
        tickControl.appendChild(gridSizeRow);
        syncTickRateConstraintForGrid(this.gridWidth);
        document.body.appendChild(tickControl);
    }

    animate() {
        const gameLoop = () => {
            const currentTime = Date.now();

            // Update target camera based on held keys
            if (this.moveKeys.w) this.targetCamera.y += this.MOVE_SPEED;
            if (this.moveKeys.s) this.targetCamera.y -= this.MOVE_SPEED;
            if (this.moveKeys.a) this.targetCamera.x += this.MOVE_SPEED;
            if (this.moveKeys.d) this.targetCamera.x -= this.MOVE_SPEED;

            // Smooth camera and zoom movement
            this.camera.x += (this.targetCamera.x - this.camera.x) * this.CAMERA_SMOOTHING;
            this.camera.y += (this.targetCamera.y - this.camera.y) * this.CAMERA_SMOOTHING;
            this.camera.zoom += (this.targetZoom - this.camera.zoom) * this.ZOOM_SMOOTHING;

            // Update grid based on speed setting
            if (this.isRunning) {
                let steps = 0;
                while (currentTime - this.lastUpdateTime >= this.UPDATE_INTERVAL && steps < this.MAX_STEPS_PER_FRAME) {
                    if (this.webglAvailable && this.useGpuSimulation) {
                        this.runGpuStep();
                        this.tickCount += 1;
                        this.updateGpuStats();
                    } else {
                        this.updateGrid();
                        if (this.webglAvailable) {
                            this.uploadGridToGPU();
                        }
                        this.tickCount += 1;
                    }
                    this.lastUpdateTime += this.UPDATE_INTERVAL;
                    steps += 1;
                }
                if (steps === this.MAX_STEPS_PER_FRAME) {
                    this.lastUpdateTime = currentTime;
                }
            }

            if (this.webglAvailable) {
                this.drawWebGL();
            } else {
                this.ctx.fillStyle = '#000000';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.drawGrid();
            }

            this.updateStats();

            requestAnimationFrame(gameLoop);
        };

        gameLoop();
    }
}

// Start the game when the page loads
window.onload = () => new ConwaysGame();
