import { useState, ChangeEvent, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import Tesseract from 'tesseract.js';
import './index.css';

interface WordBox {
  id: string;
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  selected: boolean;
  generatedKey?: string;
  originalWords?: WordBox[];
}

interface ImageState {
  id: string;
  url: string;
  size: { w: number; h: number } | null;
  words: WordBox[];
  isProcessing: boolean;
  isLoaded: boolean;
  progress: string;
}

// Local fallback when the key-generation backend is unavailable:
// "Please enter your email address" -> "labelEnterEmailAddress"
const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'be', 'your', 'you', 'we', 'our', 'my', 'it', 'this', 'that', 'please']);
const localKeyFromText = (text: string): string => {
  const allWords = text.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (allWords.length === 0) return 'labelUnknown';
  // Drop filler words and cap length so long phrases produce short keys
  const meaningful = allWords.filter(w => !STOP_WORDS.has(w.toLowerCase()));
  const words = (meaningful.length > 0 ? meaningful : allWords).slice(0, 4);
  // Hard cap at 30 chars, trimming whole words
  let key = 'label';
  for (const w of words) {
    const part = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    if (key.length > 5 && key.length + part.length > 30) break;
    key += part;
  }
  return key.slice(0, 30);
};

// Reading order: top-to-bottom, left-to-right within the same line
const sortReadingOrder = (words: WordBox[]): WordBox[] =>
  [...words].sort((a, b) => {
    const aMid = (a.bbox.y0 + a.bbox.y1) / 2;
    const bMid = (b.bbox.y0 + b.bbox.y1) / 2;
    const lineTolerance = Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) / 2;
    if (Math.abs(aMid - bMid) > lineTolerance) return aMid - bMid;
    return a.bbox.x0 - b.bbox.x0;
  });

const unionBbox = (words: WordBox[]) => ({
  x0: Math.min(...words.map(w => w.bbox.x0)),
  y0: Math.min(...words.map(w => w.bbox.y0)),
  x1: Math.max(...words.map(w => w.bbox.x1)),
  y1: Math.max(...words.map(w => w.bbox.y1))
});

function App() {
  const [images, setImages] = useState<ImageState[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [jsonOutput, setJsonOutput] = useState<string>('{\n\n}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  
  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number, y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  // Most recent selection, used as the merge target for shift+click
  const lastSelectedRef = useRef<{ img: string; word: string } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);

  // Update JSON output whenever selections or keys change globally
  useEffect(() => {
    const obj: Record<string, string> = {};
    images.forEach(img => {
      const selectedWords = img.words.filter(w => w.selected);
      selectedWords.forEach(w => {
        let key = w.generatedKey || 'pendingKey...';
        // Avoid collisions overwriting earlier entries
        if (key in obj && obj[key] !== w.text) {
          let n = 2;
          while (`${key}${n}` in obj) n++;
          key = `${key}${n}`;
        }
        obj[key] = w.text;
      });
    });
    setJsonOutput(JSON.stringify(obj, null, 2));
    setJsonError(null);
  }, [images]);

  const handleFile = (file: File) => {
    // Single-image mode: replace any existing image
    images.forEach(img => URL.revokeObjectURL(img.url));
    lastSelectedRef.current = null;

    const newImage: ImageState = {
      id: `img-${Date.now()}`,
      url: URL.createObjectURL(file),
      size: null,
      words: [],
      isProcessing: true, // Start processing immediately
      isLoaded: false,
      progress: 'Loading image...'
    };

    setImages([newImage]);
    setActiveImageId(newImage.id);

    const imageElement = new Image();
    imageElement.onload = () => {
      updateImageState(newImage.id, { size: { w: imageElement.width, h: imageElement.height }, isLoaded: true, progress: 'Initializing Tesseract...' });
      processImage(newImage.id, newImage.url);
    };
    imageElement.onerror = () => {
      updateImageState(newImage.id, { isProcessing: false, progress: 'Failed to load image.' });
      alert('Failed to read uploaded image file.');
    };
    imageElement.src = newImage.url;
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ''; // Allow re-selecting the same file
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  };

  const updateImageState = (id: string, updates: Partial<ImageState>) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
  };

  const processImage = async (id: string, url: string) => {
    try {
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m && m.status) {
            const pct = m.progress ? ` (${Math.round(m.progress * 100)}%)` : '';
            updateImageState(id, { progress: `${m.status}${pct}` });
          }
        }
      });
      
      updateImageState(id, { progress: 'Recognizing text...' });
      const { data } = await worker.recognize(url, undefined, { blocks: true, words: true });
      
      const allWords: any[] = [];
      if (data && data.blocks) {
        data.blocks.forEach((block: any) => {
          block.paragraphs?.forEach((para: any) => {
            para.lines?.forEach((line: any) => {
              line.words?.forEach((word: any) => {
                // Filter out icons and noise
                if (/[a-zA-Z0-9]/.test(word.text)) {
                  allWords.push(word);
                }
              });
            });
          });
        });
      }
      
      const newWords: WordBox[] = allWords.map((w: any, i: number) => ({
        id: `word-${id}-${i}`,
        text: w.text,
        bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
        selected: false,
      }));
      
      updateImageState(id, { words: newWords, isProcessing: false, progress: 'Done' });
      await worker.terminate();
    } catch (err: any) {
      console.error(err);
      updateImageState(id, { isProcessing: false, progress: 'Error processing' });
      alert(`Failed to process image: ${err.message || String(err)}`);
    }
  };

  const fetchKeyFor = async (imageId: string, wordId: string, text: string) => {
    let key: string;
    try {
      const res = await fetch('http://localhost:3001/generate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      key = data.key || localKeyFromText(text);
    } catch (err) {
      console.error('Failed to generate key', err);
      key = localKeyFromText(text);
    }
    setImages(prev => prev.map(img => {
      if (img.id !== imageId) return img;
      return { ...img, words: img.words.map(w => w.id === wordId ? { ...w, generatedKey: key } : w) };
    }));
  };

  // Merge source words (plain or already-grouped) into a single selected group
  const createGroup = (imageId: string, sourceWords: WordBox[], currentWords: WordBox[]) => {
    const members = sortReadingOrder(
      sourceWords
        .flatMap(w => w.originalWords ?? [w])
        .map(m => ({ ...m, selected: false, generatedKey: undefined, originalWords: undefined }))
    );
    const mergedId = `merged-${Date.now()}`;
    const merged: WordBox = {
      id: mergedId,
      text: members.map(m => m.text).join(' '),
      bbox: unionBbox(members),
      selected: true,
      generatedKey: 'loading...',
      originalWords: members
    };
    const sourceIds = new Set(sourceWords.map(w => w.id));
    updateImageState(imageId, { words: [...currentWords.filter(w => !sourceIds.has(w.id)), merged] });
    lastSelectedRef.current = { img: imageId, word: mergedId };
    fetchKeyFor(imageId, mergedId, merged.text);
  };

  // Shift+click on a group member takes it back out of the group
  const removeFromGroup = (imageId: string, groupId: string, memberId: string) => {
    const image = images.find(img => img.id === imageId);
    const group = image?.words.find(w => w.id === groupId);
    if (!image || !group || !group.originalWords) return;

    const removed = group.originalWords.find(m => m.id === memberId);
    if (!removed) return;
    const remaining = group.originalWords.filter(m => m.id !== memberId);
    const others = image.words.filter(w => w.id !== groupId);

    if (remaining.length >= 2) {
      createGroup(imageId, remaining, [...others, removed]);
    } else {
      // Group dissolves into a single selected word
      const single = { ...remaining[0], selected: true, generatedKey: 'loading...' };
      updateImageState(imageId, { words: [...others, removed, single] });
      lastSelectedRef.current = { img: imageId, word: single.id };
      fetchKeyFor(imageId, single.id, single.text);
    }
  };

  const toggleWordSelection = (imageId: string, wordId: string, shiftKey = false) => {
    const image = images.find(img => img.id === imageId);
    if (!image) return;

    const word = image.words.find(w => w.id === wordId);
    if (!word) return;

    if (word.selected) {
      // Deselect
      if (lastSelectedRef.current?.word === wordId) lastSelectedRef.current = null;
      if (word.originalWords) {
        // Restore original words (which are naturally unselected)
        const otherWords = image.words.filter(w => w.id !== wordId);
        updateImageState(imageId, { words: [...otherWords, ...word.originalWords] });
      } else {
        const newWords = image.words.map(w => w.id === wordId ? { ...w, selected: false, generatedKey: undefined } : w);
        updateImageState(imageId, { words: newWords });
      }
      return;
    }

    // Shift+click combines with the most recent selection on the same image
    if (shiftKey && lastSelectedRef.current?.img === imageId) {
      const target = image.words.find(w => w.id === lastSelectedRef.current!.word && w.selected);
      if (target) {
        createGroup(imageId, [target, word], image.words);
        return;
      }
    }

    // Plain select and fetch key
    const newWordsLoading = image.words.map(w => w.id === wordId ? { ...w, selected: true, generatedKey: 'loading...' } : w);
    updateImageState(imageId, { words: newWordsLoading });
    lastSelectedRef.current = { img: imageId, word: wordId };
    fetchKeyFor(imageId, wordId, word.text);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); // Prevent native image/text selection while dragging
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    setIsDragging(true);
    setDragStart({ x, y });
    setDragEnd({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min((e.clientX - rect.left) / zoom, rect.width / zoom));
    const y = Math.max(0, Math.min((e.clientY - rect.top) / zoom, rect.height / zoom));
    setDragEnd({ x, y });
  };

  // Reset view when switching images so the new image starts fitted and in view
  useEffect(() => {
    setZoom(1);
    const workspace = workspaceRef.current;
    if (workspace) {
      workspace.scrollTop = 0;
      workspace.scrollLeft = 0;
    }
  }, [activeImageId]);

  // Compute the base (zoom = 1) display size so the image fits the workspace
  useEffect(() => {
    const computeBaseSize = () => {
      const workspace = workspaceRef.current;
      const image = images.find(img => img.id === activeImageId);
      if (!workspace || !image || !image.size) {
        setBaseSize(null);
        return;
      }
      const maxW = workspace.clientWidth - 64; // workspace padding
      const maxH = window.innerHeight - 260;
      const scale = Math.min(1, maxW / image.size.w, maxH / image.size.h);
      setBaseSize({ w: image.size.w * scale, h: image.size.h * scale });
    };
    computeBaseSize();
    window.addEventListener('resize', computeBaseSize);
    return () => window.removeEventListener('resize', computeBaseSize);
  }, [images, activeImageId]);

  // Ctrl/Cmd + wheel (or trackpad pinch) zooms, centered on the cursor.
  // Plain wheel falls through to native workspace scrolling.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); // Prevent native browser pinch-to-zoom
      const oldZoom = zoomRef.current;
      const zoomChange = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(1, Math.min(5, Math.round((oldZoom + zoomChange) * 10) / 10));
      if (newZoom === oldZoom) return;

      // Keep the point under the cursor stable while zooming
      const rect = workspace.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const ratio = newZoom / oldZoom;
      flushSync(() => setZoom(newZoom));
      workspace.scrollLeft = (workspace.scrollLeft + cursorX) * ratio - cursorX;
      workspace.scrollTop = (workspace.scrollTop + cursorY) * ratio - cursorY;
    };

    workspace.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => workspace.removeEventListener('wheel', handleNativeWheel);
  }, [activeImageId]);

  const handleMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || !dragEnd || !activeImageId) {
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
      return;
    }
    
    setIsDragging(false);
    
    // Calculate bounding box of the drag area
    const dragBox = {
      x0: Math.min(dragStart.x, dragEnd.x),
      y0: Math.min(dragStart.y, dragEnd.y),
      x1: Math.max(dragStart.x, dragEnd.x),
      y1: Math.max(dragStart.y, dragEnd.y)
    };
    
    // Ignore tiny drags (e.g. standard clicks)
    if (dragBox.x1 - dragBox.x0 < 5 || dragBox.y1 - dragBox.y0 < 5) {
      setDragStart(null);
      setDragEnd(null);
      return;
    }

    const image = images.find(img => img.id === activeImageId);
    if (!image || !image.size) return;
    
    // Image element actual rendered size vs intrinsic size mapping
    const rect = e.currentTarget.getBoundingClientRect();
    const unzoomedWidth = rect.width / zoom;
    const unzoomedHeight = rect.height / zoom;
    const scaleX = image.size.w / unzoomedWidth;
    const scaleY = image.size.h / unzoomedHeight;
    
    // Convert dragBox to intrinsic image coordinates
    const intrinsicDragBox = {
      x0: dragBox.x0 * scaleX,
      y0: dragBox.y0 * scaleY,
      x1: dragBox.x1 * scaleX,
      y1: dragBox.y1 * scaleY
    };

    // Find all intersecting words
    const intersectingWords = image.words.filter(w => {
      return !(w.bbox.x1 < intrinsicDragBox.x0 || 
               w.bbox.x0 > intrinsicDragBox.x1 || 
               w.bbox.y1 < intrinsicDragBox.y0 || 
               w.bbox.y0 > intrinsicDragBox.y1);
    });

    if (intersectingWords.length > 1) {
      createGroup(activeImageId, intersectingWords, image.words);
    } else if (intersectingWords.length === 1) {
      // Single word drag selection
      if (!intersectingWords[0].selected) {
        toggleWordSelection(activeImageId, intersectingWords[0].id);
      }
    }

    setDragStart(null);
    setDragEnd(null);
  };

  const handleJsonChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setJsonOutput(val);
    try {
      JSON.parse(val);
      setJsonError(null);
    } catch (err: any) {
      setJsonError(err.message);
    }
  };

  const downloadJson = () => {
    const blob = new Blob([jsonOutput], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'localization.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeImage = images.find(img => img.id === activeImageId);

  return (
    <div className="App" onDragOver={handleDragOver} onDrop={handleDrop}>
      <header className="header">
        <h1>Localize Extractor</h1>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden-input"
            id="file-upload-header"
          />
          <label htmlFor="file-upload-header" className="button header-button">
            {images.length > 0 ? 'Replace Image' : '+ Add Image'}
          </label>
        </div>
      </header>
      
      <div className="main-layout">
        <main className="workspace" ref={workspaceRef}>
          {!activeImage && (
            <div className="upload-zone">
              <h3>Upload Figma Screenshot</h3>
              <p className="upload-subtitle">Drag & drop or click to select an image</p>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden-input"
                id="file-upload-main"
              />
              <label htmlFor="file-upload-main" className="button main-upload-button">
                Select Image
              </label>
            </div>
          )}

          {activeImage && (
            <div style={{ display: 'inline-block', textAlign: 'center', minWidth: '100%' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center', background: 'var(--panel-bg)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', width: 'fit-content', margin: '0 auto 1rem auto' }}>
                <button className="button" style={{ width: 'auto', margin: 0, padding: '0.25rem 0.75rem' }} onClick={() => setZoom(z => Math.max(1, z - 0.1))}>-</button>
                <span style={{ minWidth: '4rem', textAlign: 'center', fontSize: '0.9rem' }}>{Math.round(zoom * 100)}%</span>
                <button className="button" style={{ width: 'auto', margin: 0, padding: '0.25rem 0.75rem' }} onClick={() => setZoom(z => Math.min(5, z + 0.1))}>+</button>
              </div>

              {/* Sizer reserves the scaled footprint so the workspace can scroll when zoomed */}
              <div style={{
                width: baseSize ? baseSize.w * zoom : undefined,
                height: baseSize ? baseSize.h * zoom : undefined,
                margin: '0 auto',
                display: 'block',
                textAlign: 'left'
              }}>
              <div
                ref={canvasRef}
                className="canvas-container"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                  userSelect: 'none',
                  width: baseSize ? baseSize.w : undefined,
                  height: baseSize ? baseSize.h : undefined,
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0'
                }}
              >
                <img src={activeImage.url} alt="Uploaded UI" draggable="false" />
              
              {activeImage.isProcessing && (
                <div className="loading-overlay">
                  <div className="loading-text">Processing Image with AI...</div>
                  <div className="loading-subtext">{activeImage.progress}</div>
                </div>
              )}

              <div className="canvas-overlay">
                {activeImage.size && activeImage.words.flatMap(w => {
                  const boxStyle = (bbox: WordBox['bbox']) => ({
                    left: `${(bbox.x0 / activeImage.size!.w) * 100}%`,
                    top: `${(bbox.y0 / activeImage.size!.h) * 100}%`,
                    width: `${((bbox.x1 - bbox.x0) / activeImage.size!.w) * 100}%`,
                    height: `${((bbox.y1 - bbox.y0) / activeImage.size!.h) * 100}%`,
                  });
                  // Groups highlight each member word; shift+click removes a member
                  if (w.selected && w.originalWords) {
                    return w.originalWords.map(m => (
                      <div
                        key={m.id}
                        className="word-box selected grouped"
                        style={boxStyle(m.bbox)}
                        onClick={(e) => e.shiftKey
                          ? removeFromGroup(activeImage.id, w.id, m.id)
                          : toggleWordSelection(activeImage.id, w.id)}
                        title={w.text}
                      />
                    ));
                  }
                  return [
                    <div
                      key={w.id}
                      className={`word-box ${w.selected ? 'selected' : ''}`}
                      style={boxStyle(w.bbox)}
                      onClick={(e) => toggleWordSelection(activeImage.id, w.id, e.shiftKey)}
                      title={w.text}
                    />
                  ];
                })}
                
                {isDragging && dragStart && dragEnd && (
                  <div 
                    className="drag-selection-box"
                    style={{
                      left: `${Math.min(dragStart.x, dragEnd.x)}px`,
                      top: `${Math.min(dragStart.y, dragEnd.y)}px`,
                      width: `${Math.abs(dragEnd.x - dragStart.x)}px`,
                      height: `${Math.abs(dragEnd.y - dragStart.y)}px`,
                    }}
                  />
                )}
              </div>
            </div>
            </div>
            </div>
          )}
        </main>

        <aside className="sidebar">
          <h2 className="section-title">Extraction Results</h2>
          
          <div className="json-editor-container">
            <label className="json-editor-label">
              Editable JSON Output
            </label>
            <textarea 
              className={`json-editor ${jsonError ? 'invalid' : ''}`}
              value={jsonOutput}
              onChange={handleJsonChange}
            />
            {jsonError && <div className="json-error-text">Invalid Content</div>}
          </div>

          <button 
            className="button" 
            onClick={downloadJson}
            disabled={!!jsonError || images.every(img => img.words.filter(w => w.selected).length === 0)}
          >
            Download JSON
          </button>
        </aside>
      </div>
    </div>
  );
}

export default App;
