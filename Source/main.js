document.addEventListener("DOMContentLoaded", function() {
  // CONSTANTE PARA LIMITE DEL HISTORIAL
  const MAX_HISTORY = 20;

  // VARIABLES GLOBALES
  let layers = [];
  let activeLayerIndex = 0;
  let canvasWidth = 800, canvasHeight = 600;
  let undoStack = [];
  let redoStack = [];
  let currentTool = document.getElementById('tool').value;
  let currentBrush = document.getElementById('brushType').value;
  let zoomFactor = 1;
  // Variables para selección
  let selectionActive = false;
  let selectionMode = "";
  let selectionStart = null;
  let selectionPoints = [];
  let activeSelection = null;
  let isDraggingSelection = false;
  let selectionDragOffset = { x: 0, y: 0 };
  let selectionSource = "";
  let originalSelectionPosition = null;
  let originalSelectionData = null;
  let isNewSelection = false;
  // Variables para panning
  let isPanning = false, panStart = { x: 0, y: 0 }, scrollStart = { left: 0, top: 0 };
  // Variables para pincel sólido
  let lastSolidX = null, lastSolidY = null;

  // Obtener referencias a elementos críticos
  const canvasArea = document.getElementById('canvasArea');
  const canvasWrapper = document.getElementById('canvasWrapper');
  const selectionOverlay = document.getElementById('selectionOverlay');
  const selectionCanvas = document.getElementById('selectionCanvas');
  // Se obtiene el contexto con opción alpha para preservar transparencia
  const selectionCtx = selectionCanvas.getContext('2d', { alpha: true });
  const selectionButtons = document.getElementById('selectionButtons');

  // Forzar que el overlay aparezca sobre todo
  selectionOverlay.style.zIndex = "10000";

  // Canvas temporal para dibujar el contorno de la selección libre
  let tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvasWidth;
  tempCanvas.height = canvasHeight;
  tempCanvas.style.position = 'absolute';
  tempCanvas.style.top = '0';
  tempCanvas.style.left = '0';
  // Se establece un z-index alto para que el trazo se muestre por encima
  tempCanvas.style.zIndex = "11000";
  // Se desactivan los eventos para que no interfiera con la interacción
  tempCanvas.style.pointerEvents = "none";
  canvasArea.appendChild(tempCanvas);
  let tempCtx = tempCanvas.getContext('2d');

  // ACTUALIZAR CONTROLES
  const brushSizeInput = document.getElementById('brushSize');
  const brushSizeValue = document.getElementById('brushSizeValue');
  brushSizeInput.addEventListener('input', () => {
    brushSizeValue.textContent = brushSizeInput.value + "px";
  });
  const bucketToleranceInput = document.getElementById('bucketTolerance');
  const toleranceValue = document.getElementById('toleranceValue');
  bucketToleranceInput.addEventListener('input', () => {
    toleranceValue.textContent = bucketToleranceInput.value + "%";
  });
  const spillToleranceInput = document.getElementById('spillTolerance');
  const spillValue = document.getElementById('spillValue');
  spillToleranceInput.addEventListener('input', () => {
    spillValue.textContent = spillToleranceInput.value + "px";
  });
  const colorAlphaInput = document.getElementById('colorAlpha');
  const alphaValue = document.getElementById('alphaValue');
  colorAlphaInput.addEventListener('input', () => {
    alphaValue.textContent = Math.round(colorAlphaInput.value * 100) + "%";
  });

  // ZOOM Y FONDO
  function updateZoom() {
    canvasArea.style.transform = `scale(${zoomFactor})`;
  }
  document.getElementById('zoomRange').addEventListener('input', function(e) {
    zoomFactor = parseInt(e.target.value) / 100;
    document.getElementById('zoomValue').textContent = e.target.value + "%";
    updateZoom();
  });
  updateZoom();

  function updateBackgroundPattern() {
    const bgSelect = document.getElementById('bgPattern').value;
    if (bgSelect === "none") {
      canvasArea.style.background = "transparent";
    } else if (bgSelect === "light") {
      canvasArea.style.background = "repeating-conic-gradient(#eee 0% 25%, #ccc 0% 50%)";
      canvasArea.style.backgroundSize = "20px 20px";
    } else if (bgSelect === "dark") {
      canvasArea.style.background = "repeating-conic-gradient(#555 0% 25%, #333 0% 50%)";
      canvasArea.style.backgroundSize = "20px 20px";
    }
  }
  document.getElementById('bgPattern').addEventListener('change', updateBackgroundPattern);
  updateBackgroundPattern();

  // Agregar control de zoom con ctrl+ruedita del mouse en el canvasWrapper
  canvasWrapper.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      let zoomInput = document.getElementById('zoomRange');
      let currentValue = parseInt(zoomInput.value);
      // Ajustar en incrementos de 5%
      if (e.deltaY < 0) {
        currentValue += 5;
      } else {
        currentValue -= 5;
      }
      currentValue = Math.max(parseInt(zoomInput.min), Math.min(parseInt(zoomInput.max), currentValue));
      zoomInput.value = currentValue;
      zoomFactor = currentValue / 100;
      document.getElementById('zoomValue').textContent = currentValue + "%";
      updateZoom();
    }
  }, { passive: false });

  // FUNCION PARA CREAR LA SELECCIÓN  
  // Si se pasa customImageData o selectionSource es "paste", no se borra el área de la capa activa
  function createSelectionOverlay(x, y, width, height, capture = true, customImageData = null) {
    activeSelection = { x, y, width, height };
    originalSelectionPosition = { x, y };
    selectionOverlay.style.left = x + "px";
    selectionOverlay.style.top = y + "px";
    selectionOverlay.style.width = width + "px";
    selectionOverlay.style.height = height + "px";
    selectionCanvas.width = width;
    selectionCanvas.height = height;
    if (capture) {
      if (customImageData || selectionSource === "paste") {
        originalSelectionData = customImageData;
        selectionCtx.clearRect(0, 0, width, height);
        selectionCtx.putImageData(customImageData, 0, 0);
      } else {
        let dataToUse = getActiveCtx().getImageData(x, y, width, height);
        originalSelectionData = dataToUse;
        if (selectionMode !== "free") {
          getActiveCtx().clearRect(x, y, width, height);
        }
        selectionCtx.putImageData(dataToUse, 0, 0);
      }
    }
    selectionOverlay.style.display = "block";
    selectionOverlay.style.zIndex = "10000";
    updateSelectionOverlayPosition();
    showSelectionButtons();
    selectionOverlay.removeEventListener('mousedown', startDragSelection);
    selectionOverlay.addEventListener('mousedown', startDragSelection);
  }

  // MANEJO DE CAPAS
  function createLayer(name) {
    name = name || "Capa " + (layers.length + 1);
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.className = 'layerCanvas';
    canvas.style.zIndex = layers.length;
    canvas.style.pointerEvents = 'none';
    canvasArea.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    layers.push({ name, canvas, ctx, visible: true });
    setActiveLayer(layers.length - 1);
    updateLayersUI();
    saveState();
  }

  function setActiveLayer(index) {
    activeLayerIndex = index;
    layers.forEach((layer, i) => {
      layer.canvas.style.pointerEvents = (i === activeLayerIndex) ? 'auto' : 'none';
      layer.canvas.style.border = (i === activeLayerIndex) ? '1px dashed red' : 'none';
    });
    updateLayersUI();
  }

  function updateLayersUI() {
    const layersList = document.getElementById('layersList');
    layersList.innerHTML = "";
    layers.slice().reverse().forEach((layer, i) => {
      const actualIndex = layers.length - 1 - i;
      const li = document.createElement('li');
      li.textContent = layer.name;
      if (actualIndex === activeLayerIndex) li.classList.add('active');
      li.addEventListener('dblclick', () => {
        const newName = prompt("Renombrar capa:", layer.name);
        if (newName) {
          layer.name = newName;
          updateLayersUI();
        }
      });
      const controls = document.createElement('div');
      controls.className = 'layer-item-controls';
      const visBtn = document.createElement('button');
      visBtn.textContent = layer.visible ? "👁️" : "🚫";
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        layer.canvas.style.display = layer.visible ? "block" : "none";
        visBtn.textContent = layer.visible ? "👁️" : "🚫";
        saveState();
      });
      const upBtn = document.createElement('button');
      upBtn.textContent = "↑";
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (actualIndex < layers.length - 1) {
          [layers[actualIndex], layers[actualIndex + 1]] = [layers[actualIndex + 1], layers[actualIndex]];
          updateLayerZIndices();
          updateLayersUI();
          saveState();
        }
      });
      const downBtn = document.createElement('button');
      downBtn.textContent = "↓";
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (actualIndex > 0) {
          [layers[actualIndex], layers[actualIndex - 1]] = [layers[actualIndex - 1], layers[actualIndex]];
          updateLayerZIndices();
          updateLayersUI();
          saveState();
        }
      });
      controls.appendChild(visBtn);
      controls.appendChild(upBtn);
      controls.appendChild(downBtn);
      li.appendChild(controls);
      li.addEventListener('click', () => {
        setActiveLayer(actualIndex);
      });
      layersList.appendChild(li);
    });
  }

  function updateLayerZIndices() {
    layers.forEach((layer, i) => {
      layer.canvas.style.zIndex = i;
    });
  }

  document.getElementById('addLayer').addEventListener('click', () => {
    createLayer();
  });

  document.getElementById('deleteLayer').addEventListener('click', () => {
    if (layers.length > 1) {
      const layer = layers[activeLayerIndex];
      canvasArea.removeChild(layer.canvas);
      layers.splice(activeLayerIndex, 1);
      setActiveLayer(layers.length - 1);
      updateLayersUI();
      saveState();
    } else {
      alert("No se puede eliminar la única capa.");
    }
  });

  // REDIMENSIONAR LIENZO
  document.getElementById('resizeCanvas').addEventListener('click', () => {
    const newWidth = parseInt(prompt("Nuevo ancho del lienzo:", canvasWidth));
    const newHeight = parseInt(prompt("Nuevo alto del lienzo:", canvasHeight));
    if (newWidth > 0 && newHeight > 0) {
      layers.forEach(layer => {
        layer.canvas.style.border = 'none';
        let temp = document.createElement('canvas');
        temp.width = newWidth;
        temp.height = newHeight;
        const tctx = temp.getContext('2d');
        tctx.drawImage(layer.canvas, 0, 0, newWidth, newHeight);
        layer.canvas.width = newWidth;
        layer.canvas.height = newHeight;
        layer.ctx.clearRect(0, 0, newWidth, newHeight);
        layer.ctx.drawImage(temp, 0, 0);
      });
      canvasWidth = newWidth;
      canvasHeight = newHeight;
      canvasArea.style.width = canvasWidth + "px";
      canvasArea.style.height = canvasHeight + "px";
      tempCanvas.width = newWidth;
      tempCanvas.height = newHeight;
      saveState();
      setActiveLayer(activeLayerIndex);
    }
  });

  // GUARDAR IMAGEN
  document.getElementById('saveImage').addEventListener('click', async () => {
    const mergedCanvas = document.createElement('canvas');
    mergedCanvas.width = canvasWidth;
    mergedCanvas.height = canvasHeight;
    const mCtx = mergedCanvas.getContext('2d');
    layers.forEach(layer => {
      mCtx.drawImage(layer.canvas, 0, 0);
    });
    const dataURL = mergedCanvas.toDataURL("image/png");
    if (window.showSaveFilePicker) {
      try {
        const opts = {
          types: [{
            description: 'PNG Image',
            accept: { 'image/png': ['.png'] }
          }]
        };
        const handle = await window.showSaveFilePicker(opts);
        const writable = await handle.createWritable();
        const res = await fetch(dataURL);
        const blob = await res.blob();
        await writable.write(blob);
        await writable.close();
      } catch (err) {
        console.error("Error al guardar la imagen:", err);
      }
    } else {
      const link = document.createElement('a');
      link.download = 'mi_dibujo.png';
      link.href = dataURL;
      link.click();
    }
  });

  // LIMPIAR LIENZO
  document.getElementById('clearCanvas').addEventListener('click', () => {
    if (confirm("¿Estás seguro de limpiar el lienzo? Se perderá el dibujo actual.")) {
      layers.forEach(layer => {
        layer.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      });
      saveState();
    }
  });

  // DESHACER / REHACER
  function saveState() {
    const state = {
      layers: layers.map(layer => ({
        name: layer.name,
        visible: layer.visible,
        data: layer.canvas.toDataURL()
      })),
      activeLayerIndex,
      canvasWidth,
      canvasHeight
    };
    undoStack.push(state);
    if (undoStack.length > MAX_HISTORY) {
      undoStack.shift();
    }
    redoStack = [];
  }

  function restoreState(state) {
    layers.forEach(layer => canvasArea.removeChild(layer.canvas));
    layers = [];
    canvasWidth = state.canvasWidth;
    canvasHeight = state.canvasHeight;
    canvasArea.style.width = canvasWidth + "px";
    canvasArea.style.height = canvasHeight + "px";
    state.layers.forEach((savedLayer, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.className = 'layerCanvas';
      canvas.style.zIndex = index;
      canvas.style.pointerEvents = 'none';
      canvasArea.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      let img = new Image();
      img.src = savedLayer.data;
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      layers.push({ name: savedLayer.name, visible: savedLayer.visible, canvas, ctx });
    });
    activeLayerIndex = state.activeLayerIndex;
    setActiveLayer(activeLayerIndex);
    updateLayersUI();
  }

  function undo() {
    if (undoStack.length > 1) {
      const currentState = undoStack.pop();
      redoStack.push(currentState);
      const prevState = undoStack[undoStack.length - 1];
      restoreState(prevState);
    }
  }

  function redo() {
    if (redoStack.length > 0) {
      const state = redoStack.pop();
      undoStack.push(state);
      restoreState(state);
    }
  }

  document.getElementById('undo').addEventListener('click', undo);
  document.getElementById('redo').addEventListener('click', redo);

  // FUNCIONES DE RELLENO (CUBETA)
  function bucketFill(x, y, fillColor, ctx) {
    let canvas = ctx.canvas;
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imageData.data;
    let width = canvas.width, height = canvas.height;
    let tol = parseInt(bucketToleranceInput.value);
    let startIdx = (y * width + x) * 4;
    let startColor = [data[startIdx], data[startIdx+1], data[startIdx+2], data[startIdx+3]];

    function pixelMatches(x, y) {
      let idx = (y * width + x) * 4;
      return Math.abs(data[idx] - startColor[0]) <= tol &&
             Math.abs(data[idx+1] - startColor[1]) <= tol &&
             Math.abs(data[idx+2] - startColor[2]) <= tol &&
             Math.abs(data[idx+3] - startColor[3]) <= tol;
    }
    
    function setPixel(x, y) {
      let idx = (y * width + x) * 4;
      data[idx] = fillColor.r;
      data[idx+1] = fillColor.g;
      data[idx+2] = fillColor.b;
      data[idx+3] = fillColor.a;
    }
    
    if (Math.abs(startColor[0] - fillColor.r) <= tol &&
        Math.abs(startColor[1] - fillColor.g) <= tol &&
        Math.abs(startColor[2] - fillColor.b) <= tol &&
        Math.abs(startColor[3] - fillColor.a) <= tol) {
      return;
    }
    
    let stack = [];
    stack.push([x, y]);
    
    while (stack.length) {
      let [curX, curY] = stack.pop();
      let x1 = curX;
      while (x1 >= 0 && pixelMatches(x1, curY)) {
        x1--;
      }
      x1++;
      let x2 = curX;
      while (x2 < width && pixelMatches(x2, curY)) {
        x2++;
      }
      for (let i = x1; i < x2; i++) {
        setPixel(i, curY);
        if (curY > 0 && pixelMatches(i, curY - 1)) {
          stack.push([i, curY - 1]);
        }
        if (curY < height - 1 && pixelMatches(i, curY + 1)) {
          stack.push([i, curY + 1]);
        }
      }
    }
    
    let spill = parseInt(spillToleranceInput.value);
    for (let iter = 0; iter < spill; iter++){
      let changed = false;
      let newData = new Uint8ClampedArray(data);
      for (let j = 0; j < height; j++){
        for (let i = 0; i < width; i++){
          let idx = (j * width + i) * 4;
          if (!(data[idx] === fillColor.r &&
                data[idx+1] === fillColor.g &&
                data[idx+2] === fillColor.b &&
                data[idx+3] === fillColor.a)) {
            let neighborFilled = false;
            if (i > 0) {
              let idxLeft = (j * width + (i - 1)) * 4;
              if (data[idxLeft] === fillColor.r &&
                  data[idxLeft+1] === fillColor.g &&
                  data[idxLeft+2] === fillColor.b &&
                  data[idxLeft+3] === fillColor.a) neighborFilled = true;
            }
            if (!neighborFilled && i < width - 1) {
              let idxRight = (j * width + (i + 1)) * 4;
              if (data[idxRight] === fillColor.r &&
                  data[idxRight+1] === fillColor.g &&
                  data[idxRight+2] === fillColor.b &&
                  data[idxRight+3] === fillColor.a) neighborFilled = true;
            }
            if (!neighborFilled && j > 0) {
              let idxTop = ((j - 1) * width + i) * 4;
              if (data[idxTop] === fillColor.r &&
                  data[idxTop+1] === fillColor.g &&
                  data[idxTop+2] === fillColor.b &&
                  data[idxTop+3] === fillColor.a) neighborFilled = true;
            }
            if (!neighborFilled && j < height - 1) {
              let idxBottom = ((j + 1) * width + i) * 4;
              if (data[idxBottom] === fillColor.r &&
                  data[idxBottom+1] === fillColor.g &&
                  data[idxBottom+2] === fillColor.b &&
                  data[idxBottom+3] === fillColor.a) neighborFilled = true;
            }
            if (neighborFilled) {
              newData[idx] = fillColor.r;
              newData[idx+1] = fillColor.g;
              newData[idx+2] = fillColor.b;
              newData[idx+3] = fillColor.a;
              changed = true;
            }
          }
        }
      }
      if (!changed) break;
      data = newData;
    }
    
    imageData.data.set(data);
    ctx.putImageData(imageData, 0, 0);
  }

  // FUNCIONES DE SELECCIÓN Y PORTAPAPELES
  function showSelectionButtons() {
    selectionButtons.style.display = "flex";
    updateSelectionButtonsPosition();
  }

  function hideSelectionButtons() {
    selectionButtons.style.display = "none";
  }

  function updateSelectionButtonsPosition() {
    if (activeSelection) {
      selectionButtons.style.left = (activeSelection.x + activeSelection.width / 2) + "px";
      selectionButtons.style.top = (activeSelection.y + activeSelection.height + 5) + "px";
    }
  }

  function startDragSelection(e) {
    e.stopPropagation();
    isDraggingSelection = true;
    const pos = getMousePos(e);
    selectionDragOffset.x = pos.x - activeSelection.x;
    selectionDragOffset.y = pos.y - activeSelection.y;
    document.addEventListener('mousemove', dragSelection);
    document.addEventListener('mouseup', endDragSelection);
  }

  function dragSelection(e) {
    if (!isDraggingSelection) return;
    const pos = getMousePos(e);
    activeSelection.x = pos.x - selectionDragOffset.x;
    activeSelection.y = pos.y - selectionDragOffset.y;
    updateSelectionOverlayPosition();
    updateSelectionButtonsPosition();
  }

  function endDragSelection(e) {
    isDraggingSelection = false;
    document.removeEventListener('mousemove', dragSelection);
    document.removeEventListener('mouseup', endDragSelection);
  }

  function updateSelectionOverlayPosition() {
    selectionOverlay.style.left = activeSelection.x + "px";
    selectionOverlay.style.top = activeSelection.y + "px";
    selectionOverlay.style.width = activeSelection.width + "px";
    selectionOverlay.style.height = activeSelection.height + "px";
  }

  function removeSelectionOverlay() {
    selectionOverlay.style.display = "none";
    hideSelectionButtons();
    activeSelection = null;
    selectionActive = false;
    selectionSource = "";
  }

  document.getElementById('confirmSelection').addEventListener('click', () => {
    const ctx = getActiveCtx();
    ctx.drawImage(selectionCanvas, activeSelection.x, activeSelection.y);
    removeSelectionOverlay();
    saveState();
  });

  document.getElementById('cancelSelection').addEventListener('click', () => {
    removeSelectionOverlay();
    saveState();
  });

  // CORRECCIÓN: La función de cortar ahora borra el área seleccionada
  document.getElementById('cutBtn').addEventListener('click', () => {
    if (activeSelection) {
      const ctx = getActiveCtx();
      selectionCanvas.toBlob(blob => {
        let item = new ClipboardItem({ "image/png": blob });
        navigator.clipboard.write([item]).then(() => {
          // Se borra el área seleccionada en todos los casos
          ctx.clearRect(activeSelection.x, activeSelection.y, activeSelection.width, activeSelection.height);
          removeSelectionOverlay();
          saveState();
        }).catch(err => {
          console.error("Error cortando al portapapeles: " + err);
        });
      });
    }
  });

  document.getElementById('copyBtn').addEventListener('click', () => {
    if (activeSelection) {
      selectionCanvas.toBlob(blob => {
        let item = new ClipboardItem({ "image/png": blob });
        navigator.clipboard.write([item]).catch(err => {
          console.error("Error copiando al portapapeles: " + err);
        });
      });
    }
  });

  document.getElementById('pasteBtn').addEventListener('click', () => {
    if (!activeSelection) {
      pasteFromClipboard();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      if (activeSelection) {
        selectionCanvas.toBlob(blob => {
          let item = new ClipboardItem({ "image/png": blob });
          navigator.clipboard.write([item]).catch(err => {
            console.error("Error copiando al portapapeles: " + err);
          });
        });
      }
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'x') {
      // También se maneja el corte vía atajo, aplicando la misma lógica que en el botón
      e.preventDefault();
      if (activeSelection) {
        selectionSource = "cut";
        const ctx = getActiveCtx();
        selectionCanvas.toBlob(blob => {
          let item = new ClipboardItem({ "image/png": blob });
          navigator.clipboard.write([item]).then(() => {
            if (selectionMode === "free") {
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(selectionPoints[0].x, selectionPoints[0].y);
              for (let i = 1; i < selectionPoints.length; i++) {
                ctx.lineTo(selectionPoints[i].x, selectionPoints[i].y);
              }
              ctx.closePath();
              ctx.clip();
              ctx.clearRect(activeSelection.x, activeSelection.y, activeSelection.width, activeSelection.height);
              ctx.restore();
            } else {
              ctx.clearRect(activeSelection.x, activeSelection.y, activeSelection.width, activeSelection.height);
            }
            removeSelectionOverlay();
            saveState();
          }).catch(err => {
            console.error("Error cortando al portapapeles: " + err);
          });
        });
      }
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (!activeSelection) {
        pasteFromClipboard();
      }
    }
    if (e.key.toLowerCase() === 'q') {
      document.getElementById('tool').value = 'pencil';
      currentTool = 'pencil';
      getActiveCtx().globalCompositeOperation = "source-over";
    }
    if (e.key.toLowerCase() === 'w') {
      document.getElementById('tool').value = 'line';
      currentTool = 'line';
      removeSelectionOverlay();
    }
    if (e.key.toLowerCase() === 'e') {
      document.getElementById('tool').value = 'rect';
      currentTool = 'rect';
      removeSelectionOverlay();
    }
    if (e.key.toLowerCase() === 'r') {
      document.getElementById('tool').value = 'circle';
      currentTool = 'circle';
      removeSelectionOverlay();
    }
    if (e.key.toLowerCase() === 't') {
      document.getElementById('tool').value = 'eraser';
      currentTool = 'eraser';
    }
    if (e.key.toLowerCase() === 'y') {
      document.getElementById('tool').value = 'fill';
      currentTool = 'fill';
      removeSelectionOverlay();
    }
    if (e.key.toLowerCase() === 'u') {
      document.getElementById('tool').value = 'selectRect';
      currentTool = 'selectRect';
    }
    if (e.key.toLowerCase() === 'i') {
      document.getElementById('tool').value = 'selectFree';
      currentTool = 'selectFree';
    }
    if (activeSelection && e.key === "Enter") {
      document.getElementById('confirmSelection').click();
      e.preventDefault();
    }
    if (activeSelection && e.key === "Delete") {
      document.getElementById('cancelSelection').click();
      e.preventDefault();
    }
    if (activeSelection && !isDraggingSelection) {
      let moved = false;
      if (e.key === "ArrowUp") { activeSelection.y -= 1; moved = true; }
      if (e.key === "ArrowDown") { activeSelection.y += 1; moved = true; }
      if (e.key === "ArrowLeft") { activeSelection.x -= 1; moved = true; }
      if (e.key === "ArrowRight") { activeSelection.x += 1; moved = true; }
      if (moved) {
        updateSelectionOverlayPosition();
        updateSelectionButtonsPosition();
        e.preventDefault();
      }
    }
  });

  document.getElementById('tool').addEventListener('change', (e) => {
    currentTool = e.target.value;
    if (currentTool !== "eraser") {
      getActiveCtx().globalCompositeOperation = "source-over";
    }
    if (currentTool !== "selectRect" && currentTool !== "selectFree") {
      removeSelectionOverlay();
    }
  });

  document.getElementById('brushType').addEventListener('change', (e) => {
    currentBrush = e.target.value;
  });

  // PANEO (Herramienta de Mano con Ctrl)
  canvasWrapper.addEventListener('mousedown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      scrollStart = { left: canvasWrapper.scrollLeft, top: canvasWrapper.scrollTop };
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (isPanning) {
      canvasWrapper.scrollLeft = scrollStart.left - (e.clientX - panStart.x);
      canvasWrapper.scrollTop = scrollStart.top - (e.clientY - panStart.y);
    }
  });

  document.addEventListener('mouseup', () => {
    isPanning = false;
  });

  // DIBUJO SOBRE EL LIENZO
  function getActiveCanvas() {
    return layers[activeLayerIndex].canvas;
  }

  function getActiveCtx() {
    return layers[activeLayerIndex].ctx;
  }

  function getMousePos(e) {
    const rect = canvasArea.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoomFactor, y: (e.clientY - rect.top) / zoomFactor };
  }

  let isDrawing = false, startX = 0, startY = 0, snapshot;
  canvasArea.addEventListener('mousedown', (e) => {
    const pos = getMousePos(e);
    startX = pos.x;
    startY = pos.y;
    if (e.ctrlKey) return;
    if (currentTool === "selectRect" || currentTool === "selectFree") {
      if (!activeSelection) {
        selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
      }
      if (activeSelection) return;
      isNewSelection = true;
      selectionActive = true;
      selectionMode = currentTool === "selectRect" ? "rect" : "free";
      selectionStart = { x: pos.x, y: pos.y };
      selectionPoints = [{ x: pos.x, y: pos.y }];
      selectionOverlay.style.display = "block";
      selectionOverlay.style.left = pos.x + "px";
      selectionOverlay.style.top = pos.y + "px";
      selectionOverlay.style.width = "0px";
      selectionOverlay.style.height = "0px";
    } else if (currentTool === "fill") {
      const color = hexToRgb(document.getElementById('color').value);
      const alpha = parseFloat(colorAlphaInput.value);
      bucketFill(Math.floor(startX), Math.floor(startY), { r: color.r, g: color.g, b: color.b, a: Math.floor(alpha * 255) }, getActiveCtx());
      saveState();
      isDrawing = false;
    } else if (currentTool === "eraser") {
      const ctx = getActiveCtx();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = brushSizeInput.value;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      snapshot = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    } else {
      const ctx = getActiveCtx();
      ctx.lineWidth = brushSizeInput.value;
      ctx.lineCap = 'round';
      const color = hexToRgb(document.getElementById('color').value);
      const alpha = parseFloat(colorAlphaInput.value);
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      if (currentTool === "pencil") {
        if (currentBrush === "solid") {
          lastSolidX = startX;
          lastSolidY = startY;
        } else {
          ctx.beginPath();
          ctx.moveTo(startX, startY);
        }
      }
      snapshot = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    }
    isDrawing = true;
  });

  canvasArea.addEventListener('mousemove', (e) => {
    const pos = getMousePos(e);
    if (!isDrawing) return;
    clearTempCanvas();
    if (currentTool === "pencil") {
      const ctx = getActiveCtx();
      if (currentBrush === "solid") {
        ctx.fillStyle = document.getElementById('color').value;
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = false;
        let dx = pos.x - lastSolidX, dy = pos.y - lastSolidY;
        let steps = Math.max(Math.abs(dx), Math.abs(dy));
        for (let i = 0; i <= steps; i++) {
          let x = lastSolidX + dx * (i / steps);
          let y = lastSolidY + dy * (i / steps);
          ctx.fillRect(Math.round(x), Math.round(y), parseInt(brushSizeInput.value), parseInt(brushSizeInput.value));
        }
        lastSolidX = pos.x;
        lastSolidY = pos.y;
      } else if (currentBrush === "normal") {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (currentBrush === "spray") {
        spray(ctx, pos.x, pos.y, brushSizeInput.value);
      } else if (currentBrush === "calligraphy") {
        ctx.lineWidth = brushSizeInput.value * (Math.random() * 0.5 + 0.75);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (currentBrush === "marker") {
        ctx.globalAlpha = 0.5;
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else if (currentTool === "eraser") {
      const ctx = getActiveCtx();
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (currentTool === "line" || currentTool === "rect" || currentTool === "circle") {
      tempCtx.lineWidth = brushSizeInput.value;
      tempCtx.lineCap = 'round';
      const color = hexToRgb(document.getElementById('color').value);
      const alpha = parseFloat(colorAlphaInput.value);
      tempCtx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      if (currentTool === "line") {
        tempCtx.beginPath();
        tempCtx.moveTo(startX, startY);
        tempCtx.lineTo(pos.x, pos.y);
        tempCtx.stroke();
      } else if (currentTool === "rect") {
        tempCtx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
      } else if (currentTool === "circle") {
        tempCtx.beginPath();
        let radius = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
        tempCtx.arc(startX, startY, radius, 0, Math.PI * 2);
        tempCtx.stroke();
      }
    } else if (selectionActive) {
      if (selectionMode === "rect") {
        const width = pos.x - selectionStart.x, height = pos.y - selectionStart.y;
        selectionOverlay.style.left = (width < 0 ? pos.x : selectionStart.x) + "px";
        selectionOverlay.style.top = (height < 0 ? pos.y : selectionStart.y) + "px";
        selectionOverlay.style.width = Math.abs(width) + "px";
        selectionOverlay.style.height = Math.abs(height) + "px";
      } else if (selectionMode === "free") {
        selectionPoints.push({ x: pos.x, y: pos.y });
        clearTempCanvas();
        tempCtx.setLineDash([5, 3]);
        tempCtx.strokeStyle = "blue";
        tempCtx.beginPath();
        tempCtx.moveTo(selectionPoints[0].x, selectionPoints[0].y);
        selectionPoints.forEach(pt => {
          tempCtx.lineTo(pt.x, pt.y);
        });
        tempCtx.stroke();
        tempCtx.setLineDash([]);
      }
    }
  });

  canvasArea.addEventListener('mouseup', (e) => {
    const pos = getMousePos(e);
    isDrawing = false;
    clearTempCanvas();
    const ctx = getActiveCtx();
    if (currentTool === "line") {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (currentTool === "rect") {
      ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
    } else if (currentTool === "circle") {
      ctx.beginPath();
      let radius = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
      ctx.arc(startX, startY, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (isNewSelection && selectionActive) {
      if (selectionMode === "free") {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectionPoints.forEach(pt => {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        });
        let width = maxX - minX;
        let height = maxY - minY;
        if (width && height) {
          let tempCanvasFree = document.createElement('canvas');
          tempCanvasFree.width = width;
          tempCanvasFree.height = height;
          let tempCtxFree = tempCanvasFree.getContext('2d');
          tempCtxFree.save();
          tempCtxFree.beginPath();
          tempCtxFree.moveTo(selectionPoints[0].x - minX, selectionPoints[0].y - minY);
          for (let i = 1; i < selectionPoints.length; i++) {
            tempCtxFree.lineTo(selectionPoints[i].x - minX, selectionPoints[i].y - minY);
          }
          tempCtxFree.closePath();
          tempCtxFree.clip();
          tempCtxFree.drawImage(ctx.canvas, -minX, -minY);
          tempCtxFree.restore();
          let clippedImageData = tempCtxFree.getImageData(0, 0, width, height);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(selectionPoints[0].x, selectionPoints[0].y);
          for (let i = 1; i < selectionPoints.length; i++) {
            ctx.lineTo(selectionPoints[i].x, selectionPoints[i].y);
          }
          ctx.closePath();
          ctx.clip();
          ctx.clearRect(minX, minY, width, height);
          ctx.restore();
          selectionCanvas.width = width;
          selectionCanvas.height = height;
          selectionCtx.clearRect(0, 0, width, height);
          selectionCtx.putImageData(clippedImageData, 0, 0);
          createSelectionOverlay(minX, minY, width, height, true, clippedImageData);
        }
        isNewSelection = false;
        selectionPoints = [];
      } else if (selectionMode === "rect") {
        let rect = selectionOverlay.getBoundingClientRect();
        let areaRect = canvasArea.getBoundingClientRect();
        let x = (rect.left - areaRect.left) / zoomFactor;
        let y = (rect.top - areaRect.top) / zoomFactor;
        let width = rect.width / zoomFactor;
        let height = rect.height / zoomFactor;
        if (width && height) {
          createSelectionOverlay(x, y, width, height, true);
        }
        isNewSelection = false;
      }
    }
    saveState();
  });

  function clearTempCanvas() {
    tempCtx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  function spray(ctx, x, y, size) {
    const density = size * 2;
    for (let i = 0; i < density; i++) {
      const offsetX = getRandomInt(-size, size);
      const offsetY = getRandomInt(-size, size);
      ctx.fillRect(x + offsetX, y + offsetY, 1, 1);
    }
  }

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function hexToRgb(hex) {
    hex = hex.replace(/^#/,"");
    let bigint = parseInt(hex, 16);
    if (hex.length === 6) {
      return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    } else if (hex.length === 3) {
      return { r: ((bigint >> 8) & 15) * 17, g: ((bigint >> 4) & 15) * 17, b: (bigint & 15) * 17 };
    }
    return { r: 0, g: 0, b: 0 };
  }

  // FUNCIONES PARA CARGAR Y PEGAR IMÁGENES
  // --- Función de cargar imagen modificada para crear selección sin borrar el lienzo ---
  document.getElementById('loadImage').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
      let img = new Image();
      img.src = evt.target.result;
      img.onload = function() {
        let scale = Math.min(1, canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
        let newW = img.naturalWidth * scale;
        let newH = img.naturalHeight * scale;
        let dx = (canvasWidth - newW) / 2, dy = (canvasHeight - newH) / 2;
        let offCanvas = document.createElement('canvas');
        offCanvas.width = newW;
        offCanvas.height = newH;
        let offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0, newW, newH);
        let imageData = offCtx.getImageData(0, 0, newW, newH);
        createSelectionOverlay(dx, dy, newW, newH, true, imageData);
        selectionActive = true;
        selectionSource = "paste";
        document.getElementById('tool').value = 'selectRect';
        currentTool = 'selectRect';
        saveState();
      }
    }
    reader.readAsDataURL(file);
    // Limpiar el valor para permitir cargar la misma imagen nuevamente
    e.target.value = "";
  });

  // --- Función de pegar imagen modificada para crear selección sin borrar el lienzo ---
  document.addEventListener('paste', (e) => {
    pasteFromClipboard();
  });
  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("image/png")) {
          const blob = await item.getType("image/png");
          let img = new Image();
          img.src = URL.createObjectURL(blob);
          img.onload = function() {
            let scale = Math.min(1, canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
            let newW = img.naturalWidth * scale;
            let newH = img.naturalHeight * scale;
            let dx = (canvasWidth - newW) / 2, dy = (canvasHeight - newH) / 2;
            let offCanvas = document.createElement('canvas');
            offCanvas.width = newW;
            offCanvas.height = newH;
            let offCtx = offCanvas.getContext('2d');
            offCtx.drawImage(img, 0, 0, newW, newH);
            let imageData = offCtx.getImageData(0, 0, newW, newH);
            createSelectionOverlay(dx, dy, newW, newH, true, imageData);
            selectionActive = true;
            selectionSource = "paste";
            document.getElementById('tool').value = 'selectRect';
            currentTool = 'selectRect';
            saveState();
          }
          break;
        }
      }
    } catch (err) {
      alert("Error leyendo del portapapeles: " + err);
    }
  }

  // MODAL DE AYUDA
  const helpModal = document.getElementById('helpModal');
  document.getElementById('helpBtn').addEventListener('click', () => {
    helpModal.style.display = "flex";
  });
  document.getElementById('closeHelp').addEventListener('click', () => {
    helpModal.style.display = "none";
  });
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.style.display = "none";
    }
  });

  // ADVERTENCIA AL CERRAR / RESETEAR LA PÁGINA
  window.onbeforeunload = function(e) {
    return "¿Estás seguro que deseas salir? Se perderá el dibujo sin guardar.";
  };

  // INICIALIZACIÓN
  createLayer();
  saveState();
});
