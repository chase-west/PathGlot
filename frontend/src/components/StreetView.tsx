import { useStreetView, type StreetViewPosition } from "../hooks/useStreetView";
import type { City } from "../lib/cities";
import { useImperativeHandle, forwardRef } from "react";

export interface StreetViewHandle {
  moveTo: (lat: number, lng: number) => void;
}

interface Props {
  city: City;
  onPositionChange?: (position: StreetViewPosition) => void;
}

export const StreetView = forwardRef<StreetViewHandle, Props>(function StreetView({ city, onPositionChange }, ref) {
  const { containerRef, isLoaded, error, moveTo } = useStreetView({
    city,
    onPositionChange,
  });

  useImperativeHandle(ref, () => ({ moveTo }), [moveTo]);

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
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
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
