import { useEffect, useRef, useState, useCallback } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import type { City } from "../lib/cities";

export interface StreetViewPosition {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  pov: google.maps.StreetViewPov;
}

interface UseStreetViewOptions {
  city: City;
  onPositionChange?: (position: StreetViewPosition) => void;
}

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || "http://localhost:8000";

let loaderInstance: Loader | null = null;
let mapsKeyPromise: Promise<string> | null = null;

function getMapsApiKey(): Promise<string> {
  if (!mapsKeyPromise) {
    mapsKeyPromise = fetch(`${BACKEND_URL}/config`)
      .then((r) => r.json())
      .then((d) => d.mapsApiKey as string);
  }
  return mapsKeyPromise;
}

async function getMapsLoader(): Promise<Loader> {
  if (!loaderInstance) {
    const apiKey = await getMapsApiKey();
    loaderInstance = new Loader({
      apiKey,
      version: "weekly",
      libraries: ["maps", "streetView"],
    });
  }
  return loaderInstance;
}

export function useStreetView({ city, onPositionChange }: UseStreetViewOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onPositionChangeRef = useRef(onPositionChange);

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    getMapsLoader()
      .then((loader) => loader.importLibrary("streetView"))
      .then(() => {
        if (cancelled || !container) return;

        const panorama = new google.maps.StreetViewPanorama(container, {
          position: { lat: city.lat, lng: city.lng },
          pov: { heading: city.heading, pitch: city.pitch },
          zoom: 1,
          addressControl: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          showRoadLabels: true,
          clickToGo: true,
        });

        panoramaRef.current = panorama;

        // Only reveal the panorama once Street View confirms imagery loaded.
        // Calling setIsLoaded(true) immediately (before this event) causes a
        // black flash while tiles are still fetching, or a permanently black
        // screen if the location has no coverage at all.
        panorama.addListener("status_changed", () => {
          if (cancelled) return;
          // getStatus() returns "OK" | "ZERO_RESULTS" | "UNKNOWN_ERROR"
          if (panorama.getStatus() === "OK") {
            setIsLoaded(true);
          } else {
            setError(
              `No Street View imagery near ${city.name}. ` +
              `Check the coordinates in cities.ts are on a drivable street.`
            );
          }
        });

        panorama.addListener("position_changed", () => {
          const pos = panorama.getPosition();
          const pov = panorama.getPov();
          if (pos && onPositionChangeRef.current) {
            onPositionChangeRef.current({
              lat: pos.lat(),
              lng: pos.lng(),
              heading: pov.heading,
              pitch: pov.pitch,
              pov,
            });
          }
        });
      })
      .catch((err) => {
        console.error("Maps API failed to load:", err);
        setError("Failed to load Google Maps. Check your API key.");
      });

    return () => {
      cancelled = true;
    };
  }, [city.lat, city.lng, city.heading, city.pitch, city.name]);

  const moveTo = useCallback((lat: number, lng: number) => {
    panoramaRef.current?.setPosition({ lat, lng });
  }, []);

  return { containerRef, isLoaded, error, panorama: panoramaRef, moveTo };
}
