import { useState, useRef } from "react";
import { LANGUAGES, type Language, type City } from "../lib/cities";
import { Globe } from "./Globe";

interface Props {
  onStart: (languageCode: string, cityId: string, guideName: string) => void;
}

export function LandingPage({ onStart }: Props) {
  const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(
    null
  );
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [zoomTarget, setZoomTarget] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const selectionRef = useRef<HTMLDivElement>(null);

  function handleLanguageClick(code: string) {
    const lang = LANGUAGES.find((l) => l.code === code);
    if (!lang) return;
    setSelectedLanguage(lang);
    setSelectedCity(null);
    setTimeout(() => {
      selectionRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  function handleStart() {
    if (!selectedLanguage || !selectedCity) return;
    const guideName =
      selectedLanguage.guideNames[
        Math.floor(Math.random() * selectedLanguage.guideNames.length)
      ];

    // Trigger globe zoom
    setZoomTarget({ lat: selectedCity.lat, lng: selectedCity.lng });

    // Fire onStart after zoom + overlay
    setTimeout(() => {
      onStart(selectedLanguage.code, selectedCity.id, guideName);
    }, 1200);
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white overflow-x-hidden overflow-y-auto">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#09090b]/80 backdrop-blur-sm">
        <span className="text-sm font-semibold tracking-[0.15em] uppercase">
          PathGlot
        </span>
      </nav>

      {/* Hero */}
      <section className="relative h-screen flex flex-col items-center">
        {/* Title */}
        <div className="relative z-10 text-center mt-16 sm:mt-20 px-6">
          <h1 className="text-[clamp(1.6rem,4.5vw,3rem)] font-bold tracking-[-0.03em] leading-[1.1]">
            Walk any street. Speak any language.
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-3 max-w-sm mx-auto">
            Full immersion language learning through real city streets
          </p>
        </div>

        {/* Globe — fills available hero space */}
        <div className="flex-1 w-full min-h-0 flex items-center justify-center py-2 sm:py-4">
          <Globe
            selectedLanguageCode={selectedLanguage?.code ?? null}
            onLanguageClick={handleLanguageClick}
            zoomTarget={zoomTarget}
            className="h-full w-full max-w-[min(100%,80vh)]"
          />
        </div>

        {/* Language buttons — bottom of hero */}
        <div className="relative z-10 mb-6 flex flex-col items-center gap-3">
          <p className="text-[10px] tracking-[0.25em] uppercase text-zinc-600">
            Choose a language
          </p>
          <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap max-w-sm sm:max-w-none">
            {LANGUAGES.map((lang) => {
              const isActive = selectedLanguage?.code === lang.code;
              return (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageClick(lang.code)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-white/10"
                      : "hover:bg-white/5 opacity-50 hover:opacity-100"
                  }`}
                >
                  <span className="text-2xl sm:text-3xl leading-none">
                    {lang.flag}
                  </span>
                  <span
                    className={`text-[9px] sm:text-[10px] font-medium tracking-wide transition-colors ${
                      isActive ? "text-white" : "text-zinc-500"
                    }`}
                  >
                    {lang.nativeName}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* City selection — only when language picked */}
      {selectedLanguage && !zoomTarget && (
        <section ref={selectionRef} className="px-6 pb-20 pt-8 animate-fade-in">
          <div className="max-w-lg mx-auto">
            <p className="text-[11px] tracking-[0.2em] uppercase text-zinc-600 mb-6">
              {selectedLanguage.flag} {selectedLanguage.nativeName} — Pick a
              city
            </p>

            <div className="space-y-2">
              {selectedLanguage.cities.map((city) => {
                const isSelected = selectedCity?.id === city.id;
                return (
                  <button
                    key={city.id}
                    onClick={() => setSelectedCity(city)}
                    className={`w-full flex items-center justify-between px-5 py-4 rounded-xl border transition-all duration-150 ${
                      isSelected
                        ? "border-white/20 bg-white/[0.06]"
                        : "border-zinc-800/50 hover:border-zinc-700 hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="text-left">
                      <span
                        className={`block text-base font-medium ${
                          isSelected ? "text-white" : "text-zinc-300"
                        }`}
                      >
                        {city.name}
                      </span>
                      <span className="block text-[11px] text-zinc-600 mt-0.5">
                        {city.country}
                      </span>
                    </div>
                    <span
                      className={`text-sm transition-colors ${
                        isSelected ? "text-white" : "text-zinc-700"
                      }`}
                    >
                      →
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedCity && (
              <div className="mt-8 animate-fade-in">
                <button
                  onClick={handleStart}
                  className="w-full py-4 bg-white text-black font-semibold text-sm rounded-full hover:bg-zinc-200 active:scale-[0.98] transition-all duration-200"
                >
                  Drop into {selectedCity.name} →
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* GTA transition overlay */}
      {zoomTarget && <div className="gta-transition" />}

      {/* Footer */}
      {!zoomTarget && (
        <footer className="border-t border-zinc-900 py-8 px-6 text-center">
          <span className="text-[11px] text-zinc-700">
            Gemini Live API · Google Maps · Places API
          </span>
        </footer>
      )}
    </div>
  );
}
