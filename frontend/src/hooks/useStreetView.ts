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

        // Find the nearest outdoor panorama before setting position.
        // This prevents spawning inside buildings/photospheres.
        const sv = new google.maps.StreetViewService();
        sv.getPanorama(
          {
            location: { lat: city.lat, lng: city.lng },
            radius: 200,
            preference: google.maps.StreetViewPreference.NEAREST,
            source: google.maps.StreetViewSource.OUTDOOR,
          } as google.maps.StreetViewLocationRequest,
          (data, status) => {
            if (cancelled) return;
            if (status === google.maps.StreetViewStatus.OK && data?.location?.pano) {
              panorama.setPano(data.location.pano);
            } else {
              // Fallback to raw coordinates if no outdoor panorama found
              panorama.setPosition({ lat: city.lat, lng: city.lng });
            }
          }
        );

        // Only reveal the panorama once Street View confirms imagery loaded.
        panorama.addListener("status_changed", () => {
          if (cancelled) return;
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
    const pano = panoramaRef.current;
    if (!pano) return;

    const sv = new google.maps.StreetViewService();
    // Try outdoor first within 200m
    sv.getPanorama(
      {
        location: { lat, lng },
        radius: 200,
        preference: google.maps.StreetViewPreference.NEAREST,
        source: google.maps.StreetViewSource.OUTDOOR,
      } as google.maps.StreetViewLocationRequest,
      (data, status) => {
        if (status === google.maps.StreetViewStatus.OK && data?.location?.latLng) {
          pano.setPano(data.location.pano);
        } else {
          // Fallback: any panorama (including indoor) within 200m
          sv.getPanorama(
            {
              location: { lat, lng },
              radius: 200,
              preference: google.maps.StreetViewPreference.NEAREST,
            },
            (data2, status2) => {
              if (status2 === google.maps.StreetViewStatus.OK && data2?.location?.latLng) {
                pano.setPano(data2.location.pano);
              }
              // If nothing found, don't move at all — better than breaking the view
            }
          );
        }
      }
    );
  }, []);

  return { containerRef, isLoaded, error, panorama: panoramaRef, moveTo };
}
