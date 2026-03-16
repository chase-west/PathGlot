import { useStreetView, type StreetViewPosition, type StreetViewPov } from "../hooks/useStreetView";
import type { City } from "../lib/cities";
import { useImperativeHandle, forwardRef, useRef, useEffect, useCallback } from "react";

export interface StreetViewHandle {
  moveTo: (lat: number, lng: number) => void;
  lookAt: (lat: number, lng: number) => void;
  captureScreenshot: () => string | null;
  getInfo: () => { lat: number; lng: number; pano: string; heading: number; pitch: number; zoom: number } | null;
}

export interface HighlightInfo {
  name: string;
  description: string;
  lat?: number;
  lng?: number;
  target_heading?: number; // vision-refined horizontal angle (absolute degrees)
  target_pitch?: number;   // vision-refined vertical angle (absolute degrees)
}

interface Props {
  city: City;
  onPositionChange?: (position: StreetViewPosition) => void;
  onPovChange?: (pov: StreetViewPov) => void;
  onLoad?: () => void;
  highlight?: HighlightInfo | null;
}

export const StreetView = forwardRef<StreetViewHandle, Props>(function StreetView({ city, onPositionChange, onPovChange, onLoad, highlight }, ref) {
  const { containerRef, isLoaded, error, moveTo, lookAt, panorama } = useStreetView({
    city,
    onPositionChange,
    onPovChange,
  });

  const onLoadRef = useRef(onLoad);
  useEffect(() => { onLoadRef.current = onLoad; }, [onLoad]);

  useEffect(() => {
    if (isLoaded) onLoadRef.current?.();
  }, [isLoaded]);
  const labelRef = useRef<HTMLDivElement>(null);

  // Capture a screenshot of the Street View canvas (what the user actually sees)
  // Resized to 640x480 for fast vision processing
  const captureScreenshot = useCallback((): string | null => {
    const container = containerRef.current;
    if (!container) return null;
    // Google Maps renders SV as WebGL canvases — grab the largest one
    const canvases = container.querySelectorAll("canvas");
    let mainCanvas: HTMLCanvasElement | null = null;
    let maxArea = 0;
    canvases.forEach((c) => {
      const area = c.width * c.height;
      if (area > maxArea) { maxArea = area; mainCanvas = c; }
    });
    if (!mainCanvas) return null;
    try {
      // Resize to 640x480 — smaller image = faster model inference
      const resized = document.createElement("canvas");
      resized.width = 640;
      resized.height = 480;
      const ctx = resized.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(mainCanvas as HTMLCanvasElement, 0, 0, 640, 480);
      return resized.toDataURL("image/jpeg", 0.7).split(",")[1] || null;
    } catch {
      // Canvas is tainted by cross-origin tiles — can't capture
      return null;
    }
  }, []);

  // Get current panorama info (position, pano ID, POV)
  const getInfo = useCallback(() => {
    const pano = panorama.current;
    if (!pano) return null;
    const pos = pano.getPosition();
    if (!pos) return null;
    const pov = pano.getPov();
    const zoom = pano.getZoom() ?? 1;
    return {
      lat: pos.lat(),
      lng: pos.lng(),
      pano: pano.getPano(),
      heading: pov.heading,
      pitch: pov.pitch,
      zoom,
    };
  }, [panorama]);

  useImperativeHandle(ref, () => ({ moveTo, lookAt, captureScreenshot, getInfo }), [moveTo, lookAt, captureScreenshot, getInfo]);

  // Pan camera toward highlighted place ONCE per unique place name.
  // Skip if it's just a pitch refinement for the same place.
  const lastPannedNameRef = useRef<string | null>(null);
  useEffect(() => {
    if (highlight?.lat != null && highlight?.lng != null) {
      // Only pan for a genuinely new place
      if (highlight.name === lastPannedNameRef.current) return;
      lastPannedNameRef.current = highlight.name;

      const pano = panorama.current;
      const pos = pano?.getPosition();
      if (pos) {
        const R = 6371000;
        const dLat = ((highlight.lat - pos.lat()) * Math.PI) / 180;
        const dLng = ((highlight.lng - pos.lng()) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos((pos.lat() * Math.PI) / 180) * Math.cos((highlight.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        // Only pan if the place is within 200m — otherwise navigation will bring us there
        if (dist < 200) {
          lookAt(highlight.lat, highlight.lng);
        }
      }
    } else {
      lastPannedNameRef.current = null;
    }
  }, [highlight, lookAt, panorama]);

  // Project highlight label into 3D space — repositions on every POV/position change
  useEffect(() => {
    const pano = panorama.current;
    if (!isLoaded || !pano) return;

    const targetLat = highlight?.lat;
    const targetLng = highlight?.lng;
    // Vision-refined angles (absolute heading/pitch from Gemini Flash)
    const visionHeading = highlight?.target_heading;
    const visionPitch = highlight?.target_pitch;
    const hasVision = visionHeading != null && visionPitch != null;

    const update = () => {
      const label = labelRef.current;
      if (!label) return;

      const container = containerRef.current;
      if (!container) { label.style.opacity = "0"; return; }
      const { width, height } = container.getBoundingClientRect();

      if (!hasVision && (targetLat == null || targetLng == null)) {
        // No coordinates and no vision — center on screen
        label.style.left = `${width / 2}px`;
        label.style.top = `${height * 0.5}px`;
        label.style.opacity = "1";
        return;
      }

      const pov = pano.getPov();
      const zoom = pano.getZoom() ?? 1;

      // FOV from zoom level (zoom 0 = 180°, zoom 1 = 90°, etc.)
      const hFov = 180 / Math.pow(2, zoom);
      const vFov = hFov * (height / width);

      let placeHeading: number;
      let placePitch: number;

      if (hasVision) {
        // Vision-refined: use exact heading/pitch from Gemini Flash
        placeHeading = visionHeading;
        placePitch = visionPitch;
      } else {
        // Fallback: bearing from user position to target lat/lng
        const pos = pano.getPosition();
        if (!pos) { label.style.opacity = "0"; return; }
        const lat1 = pos.lat() * Math.PI / 180;
        const lat2 = targetLat! * Math.PI / 180;
        const dLng = (targetLng! - pos.lng()) * Math.PI / 180;
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        placeHeading = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
        placePitch = 8; // default above horizon
      }

      // Angular offset from current heading
      let deltaH = placeHeading - pov.heading;
      if (deltaH > 180) deltaH -= 360;
      if (deltaH < -180) deltaH += 360;

      // Screen position
      const screenX = (deltaH / hFov + 0.5) * width;
      const deltaV = placePitch - pov.pitch;
      const screenY = (-deltaV / vFov + 0.5) * height;

      // Only show if in front of camera (within horizontal FOV)
      const inView = Math.abs(deltaH) < hFov / 2;

      const labelHeight = label.offsetHeight || 50;
      const clampedY = Math.max(labelHeight + 8, Math.min(height - 8, screenY));

      label.style.left = `${screenX}px`;
      label.style.top = `${clampedY}px`;
      label.style.opacity = inView ? "1" : "0";
    };

    const povListener = pano.addListener("pov_changed", update);
    const posListener = pano.addListener("position_changed", update);
    update();

    return () => {
      google.maps.event.removeListener(povListener);
      google.maps.event.removeListener(posListener);
    };
  }, [isLoaded, highlight, panorama, containerRef]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 text-red-400">
        <div className="text-center p-8">
          <div className="text-4xl mb-4">⚠️</div>
          <div className="font-semibold">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {/* 3D-anchored highlight label */}
      <div
        ref={labelRef}
        className="absolute z-20 pointer-events-none"
        style={{
          opacity: 0,
          transition: "opacity 200ms ease",
          transform: "translate(-50%, -100%)",
          willChange: "left, top, opacity",
        }}
      >
        {highlight && (
          <div className="flex flex-col items-center">
            <div className="bg-black/80 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-2 max-w-[220px] text-center shadow-lg shadow-black/40">
              <div className="flex items-center justify-center gap-1.5">
                <svg className="w-3 h-3 text-white/90 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
                <span className="text-white font-semibold text-xs">{highlight.name}</span>
              </div>
              {highlight.description && (
                <p className="text-zinc-400 text-[10px] leading-tight mt-1">{highlight.description}</p>
              )}
            </div>
            {/* Arrow pointing down to the spot */}
            <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-black/80" />
            {/* Dot at the exact point */}
            <div className="w-1.5 h-1.5 rounded-full bg-white/80" />
          </div>
        )}
      </div>

      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <div className="text-slate-400 text-sm">Loading Street View…</div>
          </div>
        </div>
      )}
    </div>
  );
});
