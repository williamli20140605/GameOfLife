class ConwaysGame {
    constructor() {
        // Canvas setup
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Grid properties
        this.cellSize = 20;
        this.gridWidth = 500;
        this.gridHeight = 500;
        this.grid = this.createEmptyGrid();

        // Camera properties
        const centeredCamera = this.getCenteredCamera();
        this.camera = {
            x: centeredCamera.x,
            y: centeredCamera.y,
            zoom: 1.0
        };
        this.MIN_ZOOM = 0.05;
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
        this.isFrozen = false;
        this.isDragging = false;
        this.lastCell = null;

        // Statistics
        this.stats = { born: 0, died: 0, lasting: 0, total: 0 };
        this.history = [];
        this.MAX_HISTORY = 100;
        this.SAVE_KEY = 'conways-game-save-v1';
        this.AUTOSAVE_INTERVAL = 5000;
        this.lastAutosaveTime = 0;
        this.MIN_UPDATE_INTERVAL = 10;
        this.MAX_UPDATE_INTERVAL = 1000;

        // Add movement state tracking
        this.moveKeys = { w: false, s: false, a: false, d: false };

        // Add target zoom property
        this.targetZoom = 1.0;
        this.ZOOM_SMOOTHING = 0.1; // Adjust this value to change zoom smoothness

        // Setup
        this.setupEventListeners();
        this.setupButtons();
        this.setupPersistenceControls();
        this.lastUpdateTime = 0;
        this.UPDATE_INTERVAL = 100; // default tick rate in milliseconds
        this.setupTickControl();
        this.loadFromLocalStorage(false);
        this.animate();
    }

    createEmptyGrid() {
        return Array(this.gridHeight).fill().map(() => Array(this.gridWidth).fill(0));
    }

    getCenteredCamera() {
        return {
            x: this.canvas.width / 2 - (this.gridWidth * this.cellSize) / 2,
            y: this.canvas.height / 2 - (this.gridHeight * this.cellSize) / 2
        };
    }

    resizeGrid(newWidth, newHeight) {
        const nextGrid = Array(newHeight).fill().map(() => Array(newWidth).fill(0));
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
        this.stats.total = this.grid.flat().reduce((a, b) => a + b, 0);
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
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
        this.canvas.addEventListener('mouseup', () => this.isDragging = false);
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
            const zoomDelta = (delta / 300) * this.ZOOM_SPEED;
            const newZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.targetZoom + zoomDelta));

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
            switch(e.key) {
                case 'w': 
                case 's': 
                case 'a': 
                case 'd': 
                    this.moveKeys[e.key] = true;
                    break;
                case 'ArrowLeft': // Zoom out
                    const centerX = this.canvas.width / 2;
                    const centerY = this.canvas.height / 2;
                    const newZoomOut = Math.max(this.MIN_ZOOM, this.targetZoom - this.ZOOM_SPEED);
                    if (newZoomOut !== this.targetZoom) {
                        const zoomFactorOut = newZoomOut / this.targetZoom;
                        this.targetCamera.x = centerX - (centerX - this.targetCamera.x) * zoomFactorOut;
                        this.targetCamera.y = centerY - (centerY - this.targetCamera.y) * zoomFactorOut;
                        this.targetZoom = newZoomOut;
                    }
                    break;
                case 'ArrowRight': // Zoom in
                    const centerX2 = this.canvas.width / 2;
                    const centerY2 = this.canvas.height / 2;
                    const newZoomIn = Math.min(this.MAX_ZOOM, this.targetZoom + this.ZOOM_SPEED);
                    if (newZoomIn !== this.targetZoom) {
                        const zoomFactorIn = newZoomIn / this.targetZoom;
                        this.targetCamera.x = centerX2 - (centerX2 - this.targetCamera.x) * zoomFactorIn;
                        this.targetCamera.y = centerY2 - (centerY2 - this.targetCamera.y) * zoomFactorIn;
                        this.targetZoom = newZoomIn;
                    }
                    break;
                case 'p': // Reset camera position and zoom
                    this.targetCamera = this.getCenteredCamera();
                    this.targetZoom = 1.0;
                    break;
                case ' ': 
                    if (!this.isRunning || this.isFrozen) {
                        this.updateGrid();
                    }
                    break;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (['w', 's', 'a', 'd'].includes(e.key)) {
                this.moveKeys[e.key] = false;
            }
        });

        // Prevent context menu on right-click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        window.addEventListener('beforeunload', () => this.saveToLocalStorage(false));
    }

    setupButtons() {
        this.startButton = document.getElementById('startButton');
        this.freezeButton = document.getElementById('freezeButton');

        this.startButton.onclick = (e) => {
            this.isRunning = !this.isRunning;
            this.syncControlButtons();
            e.target.blur();
        };

        document.getElementById('clearButton').onclick = (e) => {
            this.grid = this.createEmptyGrid();
            this.isRunning = false;
            this.isFrozen = false;
            this.stats = { born: 0, died: 0, lasting: 0, total: 0 };
            this.history = [];
            this.syncControlButtons();
            e.target.blur();
        };

        this.freezeButton.onclick = (e) => {
            this.isFrozen = !this.isFrozen;
            this.syncControlButtons();
            e.target.blur();
        };

        document.getElementById('randomButton').onclick = (e) => {
            for (let y = 1; y < this.gridHeight - 1; y++) {
                for (let x = 1; x < this.gridWidth - 1; x++) {
                    this.grid[y][x] = Math.random() < 0.15 ? 1 : 0;
                }
            }
            e.target.blur();
        };

        this.syncControlButtons();
    }

    syncControlButtons() {
        if (this.startButton) {
            this.startButton.textContent = this.isRunning ? 'Running' : 'Start';
        }
        if (this.freezeButton) {
            this.freezeButton.style.backgroundColor = this.isFrozen ? '#6495ED' : '#ffffff';
        }
    }

    setupPersistenceControls() {
        const saveButton = document.getElementById('saveButton');
        const loadButton = document.getElementById('loadButton');
        const exportButton = document.getElementById('exportButton');
        const importButton = document.getElementById('importButton');
        const importFileInput = document.getElementById('importFileInput');

        saveButton.onclick = (e) => {
            this.saveToLocalStorage(true);
            e.target.blur();
        };

        loadButton.onclick = (e) => {
            this.loadFromLocalStorage(true);
            e.target.blur();
        };

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

    saveToLocalStorage(showMessage) {
        localStorage.setItem(this.SAVE_KEY, JSON.stringify(this.getSerializableState()));
        if (showMessage) {
            alert('Saved to browser storage.');
        }
    }

    loadFromLocalStorage(showMessage) {
        const raw = localStorage.getItem(this.SAVE_KEY);
        if (!raw) {
            if (showMessage) {
                alert('No saved state found in browser storage.');
            }
            return;
        }

        try {
            const state = JSON.parse(raw);
            this.applyState(state);
            if (showMessage) {
                alert('Loaded from browser storage.');
            }
        } catch (error) {
            if (showMessage) {
                alert('Failed to load saved state: ' + error.message);
            }
        }
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
            const state = JSON.parse(text);
            this.applyState(state);
            alert('Imported world successfully.');
        } catch (error) {
            alert('Failed to import file: ' + error.message);
        }
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

        this.isRunning = false;
        this.isFrozen = false;
        this.stats = { born: 0, died: 0, lasting: 0, total: 0 };
        this.history = [];
        this.syncControlButtons();
        this.updateStats();
    }

    autosaveIfNeeded(currentTime) {
        if (currentTime - this.lastAutosaveTime >= this.AUTOSAVE_INTERVAL) {
            this.saveToLocalStorage(false);
            this.lastAutosaveTime = currentTime;
        }
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
        const newGrid = this.grid.map(row => [...row]);
        this.stats = { born: 0, died: 0, lasting: 0, total: 0 };

        for (let y = 1; y < this.gridHeight - 1; y++) {
            for (let x = 1; x < this.gridWidth - 1; x++) {
                const neighbors = this.countNeighbors(x, y);
                if (this.grid[y][x] === 1) {
                    if (neighbors < 2 || neighbors > 3) {
                        newGrid[y][x] = 0;
                        this.stats.died++;
                    } else {
                        this.stats.lasting++;
                    }
                } else if (neighbors === 3) {
                    newGrid[y][x] = 1;
                    this.stats.born++;
                }
            }
        }

        this.grid = newGrid;
        this.stats.total = this.grid.flat().reduce((a, b) => a + b, 0);
        this.history.push(this.stats.total);
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }
    }

    handleMouseDown(e) {
        e.preventDefault();
        // Only allow editing if simulation is not running or is frozen
        if (this.isRunning && !this.isFrozen) return;

        const rect = this.canvas.getBoundingClientRect();
        const pos = this.screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        
        if (pos.x > 0 && pos.x < this.gridWidth - 1 && 
            pos.y > 0 && pos.y < this.gridHeight - 1) {
            this.isDragging = true;
            if (e.button === 0) {
                this.grid[pos.y][pos.x] = 1 - this.grid[pos.y][pos.x];
            } else if (e.button === 1) {
                this.grid[pos.y][pos.x] = 0;
            }
        }
    }

    handleMouseMove(e) {
        // Only allow editing if simulation is not running or is frozen
        if (this.isRunning && !this.isFrozen) return;
        if (!this.isDragging) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const pos = this.screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
        
        if (pos.x > 0 && pos.x < this.gridWidth - 1 && 
            pos.y > 0 && pos.y < this.gridHeight - 1) {
            if (e.buttons === 1) {
                this.grid[pos.y][pos.x] = 1;
            } else if (e.buttons === 4) {
                this.grid[pos.y][pos.x] = 0;
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
        info.innerHTML = `
            Born: ${this.stats.born}<br>
            Died: ${this.stats.died}<br>
            Lasting: ${this.stats.lasting}<br>
            Total: ${this.stats.total}
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

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(this.MIN_UPDATE_INTERVAL);
        input.max = String(this.MAX_UPDATE_INTERVAL);
        input.value = this.UPDATE_INTERVAL;
        input.style.width = '100px';

        const valueDisplay = document.createElement('span');
        valueDisplay.textContent = this.UPDATE_INTERVAL;
        valueDisplay.style.marginLeft = '10px';

        const tickNumberInput = document.createElement('input');
        tickNumberInput.type = 'number';
        tickNumberInput.min = String(this.MIN_UPDATE_INTERVAL);
        tickNumberInput.max = String(this.MAX_UPDATE_INTERVAL);
        tickNumberInput.step = '1';
        tickNumberInput.value = this.UPDATE_INTERVAL;
        tickNumberInput.style.width = '70px';
        tickNumberInput.style.marginLeft = '10px';

        const applyTickRate = (rawValue) => {
            const parsed = parseInt(rawValue, 10);
            if (!Number.isFinite(parsed)) {
                tickNumberInput.value = this.UPDATE_INTERVAL;
                return;
            }
            const clamped = Math.max(this.MIN_UPDATE_INTERVAL, Math.min(this.MAX_UPDATE_INTERVAL, parsed));
            this.UPDATE_INTERVAL = clamped;
            input.value = clamped;
            valueDisplay.textContent = clamped;
            tickNumberInput.value = clamped;
        };

        input.addEventListener('input', (e) => {
            applyTickRate(e.target.value);
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
        tickControl.appendChild(input);
        tickControl.appendChild(valueDisplay);
        tickControl.appendChild(tickNumberInput);

        const gridSizeRow = document.createElement('div');
        gridSizeRow.style.marginTop = '10px';

        const gridSizeLabel = document.createElement('label');
        gridSizeLabel.textContent = 'Grid Size: ';

        const gridSizeInput = document.createElement('input');
        gridSizeInput.type = 'number';
        gridSizeInput.min = '50';
        gridSizeInput.max = '2000';
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
            const nextSize = Math.max(50, Math.min(2000, parsed));
            gridSizeInput.value = nextSize;
            if (nextSize !== this.gridWidth || nextSize !== this.gridHeight) {
                this.resizeGrid(nextSize, nextSize);
            }
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
            if (this.isRunning && !this.isFrozen) {
                if (currentTime - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
                    this.updateGrid();
                    this.lastUpdateTime = currentTime;
                }
            }

            this.ctx.fillStyle = '#000000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            this.drawGrid();
            this.updateStats();
            this.autosaveIfNeeded(currentTime);

            requestAnimationFrame(gameLoop);
        };

        gameLoop();
    }
}

// Start the game when the page loads
window.onload = () => new ConwaysGame();
