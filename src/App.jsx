import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Copy,
  Download,
  Focus,
  ImageDown,
  Loader2,
  Menu,
  MousePointer2,
  Save,
  Trash2,
} from 'lucide-react';

const TARGET_PALETTE_SIZE = 8;
const ANALYSIS_INTERVAL = 1000;
const DEDUPE_DISTANCE = 42;

const RESOLUTION_PRESETS = {
  '480p': { width: 640, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4K': { width: 3840, height: 2160 },
};

const defaultPalette = [
  { hex: '#f8f5ef', rgb: '248, 245, 239', count: 120, source: 'ambient' },
  { hex: '#92b7ff', rgb: '146, 183, 255', count: 92, source: 'ambient' },
  { hex: '#55d6a7', rgb: '85, 214, 167', count: 84, source: 'ambient' },
  { hex: '#f4b66b', rgb: '244, 182, 107', count: 76, source: 'ambient' },
  { hex: '#d77cf2', rgb: '215, 124, 242', count: 64, source: 'ambient' },
  { hex: '#14141c', rgb: '20, 20, 28', count: 58, source: 'ambient' },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function colorDistance(a, b) {
  const redMean = (a.r + b.r) / 2;
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;
  return Math.sqrt((2 + redMean / 256) * red * red + 4 * green * green + (2 + (255 - redMean) / 256) * blue * blue);
}

function getLuminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function toDisplayColor(color) {
  const rounded = {
    r: Math.round(color.r),
    g: Math.round(color.g),
    b: Math.round(color.b),
  };

  return {
    ...rounded,
    hex: rgbToHex(rounded.r, rounded.g, rounded.b),
    rgb: `${rounded.r}, ${rounded.g}, ${rounded.b}`,
    count: color.count ?? 1,
    source: color.source ?? 'frame',
  };
}

function quantize(value) {
  return Math.round(value / 18) * 18;
}

function extractPalette(video, canvas) {
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) return [];

  const maxWidth = 240;
  const scale = Math.min(1, maxWidth / width);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const gridStep = Math.max(4, Math.round(Math.min(canvas.width, canvas.height) / 30));
  const buckets = new Map();

  for (let y = 0; y < canvas.height; y += gridStep) {
    for (let x = 0; x < canvas.width; x += gridStep) {
      const index = (y * canvas.width + x) * 4;
      const alpha = imageData[index + 3];
      if (alpha < 180) continue;

      const r = imageData[index];
      const g = imageData[index + 1];
      const b = imageData[index + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const luminance = (r + g + b) / 3;

      if (luminance < 8 || luminance > 248) continue;

      const key = `${quantize(r)}-${quantize(g)}-${quantize(b)}`;
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, score: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
      bucket.score += 1 + saturation * 1.6 + (1 - Math.abs(0.54 - luminance / 255)) * 0.55;
      buckets.set(key, bucket);
    }
  }

  const candidates = [...buckets.values()]
    .filter((bucket) => bucket.count > 1)
    .map((bucket) => ({
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count,
      count: bucket.count,
      score: bucket.score,
    }))
    .sort((a, b) => b.score - a.score);

  const palette = [];
  for (const candidate of candidates) {
    if (palette.every((color) => colorDistance(candidate, color) > DEDUPE_DISTANCE)) {
      palette.push(candidate);
    }
    if (palette.length === TARGET_PALETTE_SIZE) break;
  }

  return palette.map(toDisplayColor);
}

function getVideoSamplePoint(event, video) {
  const rect = video.getBoundingClientRect();
  const clientX = event.clientX ?? event.touches?.[0]?.clientX;
  const clientY = event.clientY ?? event.touches?.[0]?.clientY;

  if (clientX == null || clientY == null) return null;

  const elementRatio = rect.width / rect.height;
  const videoRatio = video.videoWidth / video.videoHeight;
  let renderedWidth = rect.width;
  let renderedHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (videoRatio > elementRatio) {
    renderedHeight = rect.height;
    renderedWidth = rect.height * videoRatio;
    offsetX = (rect.width - renderedWidth) / 2;
  } else {
    renderedWidth = rect.width;
    renderedHeight = rect.width / videoRatio;
    offsetY = (rect.height - renderedHeight) / 2;
  }

  const x = clamp((clientX - rect.left - offsetX) / renderedWidth, 0, 1);
  const y = clamp((clientY - rect.top - offsetY) / renderedHeight, 0, 1);

  return {
    x: Math.round(x * video.videoWidth),
    y: Math.round(y * video.videoHeight),
    screenX: clientX - rect.left,
    screenY: clientY - rect.top,
  };
}

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const [cameraState, setCameraState] = useState('idle');
  const [palette, setPalette] = useState(defaultPalette);
  const [copiedHex, setCopiedHex] = useState('');
  const [message, setMessage] = useState('Ready to discover color');
  const [sampleMarker, setSampleMarker] = useState(null);
  const [capturedAt, setCapturedAt] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [savedPalettes, setSavedPalettes] = useState([]);
  const [showSavePopup, setShowSavePopup] = useState(false);
  const [selectedPalette, setSelectedPalette] = useState(null);
  const [resolution, setResolution] = useState('720p');
  const [isCameraControlsOpen, setIsCameraControlsOpen] = useState(false);
  const [actualResolution, setActualResolution] = useState(null);

  const isCameraActive = cameraState === 'active';
  const isStarting = cameraState === 'starting';

  const status = useMemo(() => {
    if (cameraState === 'active') return { label: 'Live analysis', tone: 'bg-emerald-300', pulse: true };
    if (cameraState === 'starting') return { label: 'Requesting camera', tone: 'bg-sky-300', pulse: true };
    if (cameraState === 'error') return { label: 'Camera unavailable', tone: 'bg-rose-300', pulse: false };
    return { label: 'Camera paused', tone: 'bg-white/50', pulse: false };
  }, [cameraState]);

  const stopCamera = useCallback(() => {
    window.clearInterval(intervalRef.current);
    intervalRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraState('idle');
    setMessage('Ready to discover color');
  }, []);

  const analyzeFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) return;
    const nextPalette = extractPalette(videoRef.current, canvasRef.current);
    if (nextPalette.length) {
      setPalette(nextPalette.slice(0, TARGET_PALETTE_SIZE));
      setMessage(`Palette refreshed from ${nextPalette.length} live colors`);
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setMessage('This browser does not expose camera access.');
      return;
    }

    setCameraState('starting');
    setMessage('Waiting for camera permission...');

    try {
      const preset = RESOLUTION_PRESETS[resolution];
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: preset.width },
          height: { ideal: preset.height },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      const actualWidth = video.videoWidth;
      const actualHeight = video.videoHeight;
      setActualResolution(`${actualWidth}x${actualHeight}`);

      setCameraState('active');
      setMessage(`Camera active at ${actualWidth}x${actualHeight}`);
      analyzeFrame();
      window.clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(analyzeFrame, ANALYSIS_INTERVAL);
    } catch (error) {
      setCameraState('error');
      setMessage(error?.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Could not start the camera.');
    }
  }, [analyzeFrame]);

  const toggleCamera = () => {
    if (isCameraActive || isStarting) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  const copyColor = async (color) => {
    try {
      await navigator.clipboard.writeText(color.hex);
      setCopiedHex(color.hex);
      setMessage(`${color.hex.toUpperCase()} copied`);
      window.setTimeout(() => setCopiedHex(''), 1300);
    } catch {
      setMessage('Copy failed. Select the HEX value manually.');
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setMessage('Start the camera before capturing a frame.');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `coloris-frame-${timestamp}.png`;
      link.click();
      URL.revokeObjectURL(url);
      setCapturedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setMessage('Frame captured as a PNG');
    }, 'image/png');
  };

  const sampleFromVideo = (event) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || cameraState !== 'active') return;

    const point = getVideoSamplePoint(event, video);
    if (!point) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const [r, g, b] = context.getImageData(point.x, point.y, 1, 1).data;
    const sampled = toDisplayColor({ r, g, b, count: 999, source: 'picked' });

    setPalette((current) => [sampled, ...current.filter((color) => color.hex !== sampled.hex)].slice(0, TARGET_PALETTE_SIZE));
    setSampleMarker({ x: point.screenX, y: point.screenY, hex: sampled.hex, id: Date.now() });
    setMessage(`${sampled.hex.toUpperCase()} sampled from the frame`);
    window.setTimeout(() => setSampleMarker(null), 1200);
  };

  const savePalette = () => {
    const newPalette = {
      id: Date.now(),
      name: `Palette ${savedPalettes.length + 1}`,
      colors: palette,
      createdAt: new Date().toISOString(),
    };
    const updatedPalettes = [newPalette, ...savedPalettes];
    setSavedPalettes(updatedPalettes);
    localStorage.setItem('coloris-saved-palettes', JSON.stringify(updatedPalettes));
    setMessage('Palette saved!');
    setShowSavePopup(true);
    window.setTimeout(() => setShowSavePopup(false), 2500);
  };

  const deletePalette = (id) => {
    const updatedPalettes = savedPalettes.filter((p) => p.id !== id);
    setSavedPalettes(updatedPalettes);
    localStorage.setItem('coloris-saved-palettes', JSON.stringify(updatedPalettes));
    setMessage('Palette deleted');
  };

  useEffect(() => {
    if (!streamRef.current) {
      setMessage('Ready to discover color');
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('coloris-saved-palettes');
    if (saved) {
      try {
        setSavedPalettes(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved palettes', e);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover transition duration-700 ${
          isCameraActive ? 'scale-100 opacity-100' : 'opacity-0'
        }`}
        playsInline
        muted
        onClick={sampleFromVideo}
        aria-label="Live camera feed"
      />

      {!isCameraActive && (
        <div className="absolute inset-0 bg-black" />
      )}

      <canvas ref={canvasRef} className="hidden" />

      {sampleMarker && (
        <div
          key={sampleMarker.id}
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 animate-rise"
          style={{ left: sampleMarker.x, top: sampleMarker.y }}
        >
          <div className="grid h-20 w-20 place-items-center rounded-full border border-white/45 bg-black/25 shadow-glow backdrop-blur-xl">
            <div className="h-9 w-9 rounded-full border border-white/70" style={{ backgroundColor: sampleMarker.hex }} />
          </div>
        </div>
      )}

      <section className="pointer-events-none relative z-10 min-h-dvh px-3 py-3 sm:px-6 sm:py-6 lg:px-8">
        <header className="pointer-events-auto mb-6 flex justify-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-4xl">Colōris</h1>
        </header>

        <button
          className="pointer-events-auto fixed left-3 top-3 z-30 glass-button inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/18 active:scale-[0.98] sm:left-6 sm:top-6 sm:h-12 sm:w-12"
          type="button"
          aria-label="Menu"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        >
          <Menu size={20} className="sm:w-[22px]" />
        </button>

        {isSidebarOpen && (
          <>
            <div
              className="pointer-events-auto fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
              onClick={() => setIsSidebarOpen(false)}
            />
            <aside className="pointer-events-auto fixed left-0 top-0 z-50 h-full w-72 transform border-r border-white/10 bg-black/80 backdrop-blur-3xl shadow-2xl transition-transform duration-300 ease-out sm:w-80">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-white/10 p-4 sm:p-6">
                  <h2 className="text-xl font-bold text-white">Menu</h2>
                  <button
                    className="glass-button inline-flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/18 hover:text-white"
                    type="button"
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>

                <nav className="flex-1 overflow-y-auto p-4 sm:p-6">
                  <div className="space-y-1">
                    <button
                      className="w-full rounded-xl bg-white/10 px-4 py-3 text-left text-white transition hover:bg-white/18"
                      onClick={() => setIsCameraControlsOpen(!isCameraControlsOpen)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Camera size={18} />
                          <span className="font-medium">Camera Controls</span>
                        </div>
                        <ChevronDown size={16} className={`transition-transform ${isCameraControlsOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                    {isCameraControlsOpen && (
                      <div className="px-4 py-2">
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">Resolution</label>
                        <div className="relative">
                          <select
                            value={resolution}
                            onChange={(e) => {
                              setResolution(e.target.value);
                              if (isCameraActive) {
                                stopCamera();
                                setTimeout(() => startCamera(), 100);
                              }
                            }}
                            className="glass-button w-full appearance-none rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none backdrop-blur-xl transition hover:bg-white/10 focus:border-white/30 focus:bg-white/15"
                          >
                            <option value="480p">480p (640x480)</option>
                            <option value="720p">720p (1280x720)</option>
                            <option value="1080p">1080p (1920x1080)</option>
                            <option value="4K">4K (3840x2160)</option>
                          </select>
                          <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/50" />
                        </div>
                        {actualResolution && (
                          <p className="mt-2 text-xs text-white/50">
                            Actual: <span className="font-medium text-white/70">{actualResolution}</span>
                          </p>
                        )}
                      </div>
                    )}
                    <button className="w-full rounded-xl px-4 py-3 text-left text-white/70 transition hover:bg-white/10 hover:text-white">
                      <div className="flex items-center gap-3">
                        <Focus size={18} />
                        <span className="font-medium">Palette Settings</span>
                      </div>
                    </button>
                    <button className="w-full rounded-xl px-4 py-3 text-left text-white/70 transition hover:bg-white/10 hover:text-white">
                      <div className="flex items-center gap-3">
                        <Download size={18} />
                        <span className="font-medium">Export Options</span>
                      </div>
                    </button>
                    <button className="w-full rounded-xl px-4 py-3 text-left text-white/70 transition hover:bg-white/10 hover:text-white">
                      <div className="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"></circle>
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        <span className="font-medium">Preferences</span>
                      </div>
                    </button>
                  </div>

                  <div className="mt-8 border-t border-white/10 pt-6">
                    <p className="mb-4 px-4 text-xs font-semibold uppercase tracking-wider text-white/40">Saved Palettes</p>
                    <div className="space-y-2">
                      {savedPalettes.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-white/40">No saved palettes yet</p>
                      ) : (
                        savedPalettes.map((savedPalette) => (
                          <div
                            key={savedPalette.id}
                            className="rounded-xl border border-white/10 bg-white/5 p-3 transition hover:bg-white/10 cursor-pointer"
                            onClick={() => setSelectedPalette(savedPalette)}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-sm font-medium text-white">{savedPalette.name}</span>
                              <button
                                className="text-white/40 transition hover:text-white/70"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deletePalette(savedPalette.id);
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <div className="flex gap-1">
                              {savedPalette.colors.slice(0, 6).map((color) => (
                                <div
                                  key={color.hex}
                                  className="h-6 w-6 rounded-full border border-white/20"
                                  style={{ backgroundColor: color.hex }}
                                  title={color.hex}
                                />
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="mt-8 border-t border-white/10 pt-6">
                    <p className="mb-4 px-4 text-xs font-semibold uppercase tracking-wider text-white/40">About</p>
                    <div className="space-y-1">
                      <button className="w-full rounded-xl px-4 py-3 text-left text-white/70 transition hover:bg-white/10 hover:text-white">
                        <span className="font-medium">Version 1.0.0</span>
                      </button>
                      <button className="w-full rounded-xl px-4 py-3 text-left text-white/70 transition hover:bg-white/10 hover:text-white">
                        <span className="font-medium">Privacy Policy</span>
                      </button>
                    </div>
                  </div>
                </nav>

                <div className="border-t border-white/10 p-4 sm:p-6">
                  <p className="text-center text-xs text-white/40">Coloris by Shubham</p>
                </div>
              </div>
            </aside>
          </>
        )}

        {selectedPalette && (
          <>
            <div
              className="pointer-events-auto fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
              onClick={() => setSelectedPalette(null)}
            />
            <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="glass-panel w-full max-w-md rounded-2xl p-6 shadow-2xl animate-rise">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">{selectedPalette.name}</h3>
                  <button
                    className="glass-button inline-flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/18 hover:text-white"
                    type="button"
                    onClick={() => setSelectedPalette(null)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {selectedPalette.colors.map((color) => {
                    const darkText = getLuminance(color) > 0.62;
                    return (
                      <button
                        key={color.hex}
                        className="group relative overflow-hidden rounded-xl border border-white/20 p-3 text-left transition hover:-translate-y-1 hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-white/70"
                        type="button"
                        onClick={() => copyColor(color)}
                        style={{ backgroundColor: color.hex }}
                      >
                        <div className={`relative z-10 ${darkText ? 'text-black' : 'text-white'}`}>
                          <p className="text-sm font-bold uppercase">{color.hex}</p>
                          <p className={`mt-1 text-xs ${darkText ? 'text-black/62' : 'text-white/68'}`}>RGB {color.rgb}</p>
                        </div>
                        <div className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full ${darkText ? 'bg-black/12' : 'bg-white/18'}`}>
                          {copiedHex === color.hex ? <Check size={12} /> : <Copy size={11} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="pointer-events-auto relative z-10 flex min-h-[calc(100dvh-160px)] w-full items-center justify-center sm:min-h-[calc(100dvh-200px)]"></div>

        <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-20 px-2 pb-[calc(8px+env(safe-area-inset-bottom))] sm:px-5 sm:pb-[calc(20px+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:gap-3">
            <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 rounded-full border border-white/12 bg-black/24 p-1.5 shadow-glass backdrop-blur-3xl md:hidden">
              <div className="flex min-w-0 items-center gap-1.5 px-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${status.tone} ${status.pulse ? 'animate-breathe' : ''}`} />
                <span className="truncate text-[11px] font-semibold text-white/78">{status.label}</span>
              </div>
              <span className="shrink-0 text-[10px] font-semibold text-white/44">{capturedAt ? `Saved ${capturedAt}` : 'Tap video to pick'}</span>
            </div>

            {showSavePopup && (
              <div className="mx-auto max-w-4xl animate-rise">
                <div className="glass-button mx-auto flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-glow">
                  <Check size={16} className="text-emerald-400" />
                  <span>Palette saved! Access it from the sidebar</span>
                </div>
              </div>
            )}

            <div className="glass-panel rounded-[24px] p-2.5 sm:rounded-[30px] sm:p-3">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/48">
                  <Focus size={12} />
                  <span>Live palette</span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    className="glass-button inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-white transition hover:bg-white/18 active:scale-[0.98] sm:h-11 sm:gap-2 sm:px-4 sm:text-sm"
                    type="button"
                    onClick={captureFrame}
                    disabled={!isCameraActive}
                  >
                    <ImageDown size={15} className="sm:w-[17px]" />
                    <span className="hidden sm:inline">Capture</span>
                  </button>

                  <button
                    className="glass-button inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-white transition hover:bg-white/18 active:scale-[0.98] sm:h-11 sm:gap-2 sm:px-4 sm:text-sm"
                    type="button"
                    onClick={savePalette}
                  >
                    <Save size={15} className="sm:w-[17px]" />
                    <span className="hidden sm:inline">Save</span>
                  </button>

                  <button
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-extrabold text-black shadow-glow transition active:scale-[0.98] sm:h-11 sm:gap-2 sm:px-5 sm:text-sm ${
                      isCameraActive || isStarting ? 'bg-white' : 'bg-[#f5f2e8]'
                    }`}
                    type="button"
                    onClick={toggleCamera}
                  >
                    {isStarting ? <Loader2 className="animate-spin" size={15} /> : isCameraActive ? <CameraOff size={15} /> : <Camera size={15} />}
                    <span className="hidden sm:inline">{isCameraActive || isStarting ? 'Stop Camera' : 'Start Camera'}</span>
                    <span className="sm:hidden">{isCameraActive || isStarting ? 'Stop' : 'Start'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 sm:gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {palette.map((color, index) => {
                  const darkText = getLuminance(color) > 0.62;
                  return (
                    <button
                      key={`${color.hex}-${index}`}
                      className="swatch-shine group relative min-h-[90px] overflow-hidden rounded-2xl border border-white/20 p-2.5 text-left shadow-glass transition duration-300 hover:-translate-y-1 hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-white/70 sm:min-h-[110px] sm:rounded-3xl sm:p-3"
                      type="button"
                      onClick={() => copyColor(color)}
                      style={{ backgroundColor: color.hex }}
                      aria-label={`Copy ${color.hex}`}
                    >
                      <div className={`relative z-10 flex h-full flex-col justify-between ${darkText ? 'text-black' : 'text-white'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em] ${
                              darkText ? 'bg-black/12 text-black/74' : 'bg-white/18 text-white/86'
                            }`}
                          >
                            {color.source === 'picked' ? 'Picked' : `0${index + 1}`}
                          </span>
                          <span className={`grid h-6 w-6 place-items-center rounded-full ${darkText ? 'bg-black/12' : 'bg-white/18'}`}>
                            {copiedHex === color.hex ? <Check size={12} /> : <Copy size={11} />}
                          </span>
                        </div>

                        <div>
                          <p className="text-sm font-extrabold uppercase tracking-normal sm:text-xl">{color.hex}</p>
                          <p className={`mt-0.5 text-[10px] font-bold sm:text-xs ${darkText ? 'text-black/62' : 'text-white/68'}`}>RGB {color.rgb}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 px-0.5 text-[10px] font-semibold text-white/46 sm:text-xs">
                <span className="inline-flex items-center gap-1">
                  <MousePointer2 size={11} />
                  Click or tap the camera feed to pin a color
                </span>
                <span className="hidden sm:inline-flex sm:items-center sm:gap-1.5">
                  <Download size={12} />
                  {capturedAt ? `Last capture ${capturedAt}` : 'PNG capture ready'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
