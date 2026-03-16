import { useState, useRef } from "react";
import { LANGUAGES, type Language, type City } from "../lib/cities";
import { Globe } from "./Globe";

interface Props {
  onStart: (languageCode: string, cityId: string, guideName: string) => void;
}

export function LandingPage({ onStart }: Props) {
  const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null);
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [guideName, setGuideName] = useState<string>("");
  const [zoomTarget, setZoomTarget] = useState<{ lat: number; lng: number } | null>(null);
  const selectionRef = useRef<HTMLDivElement>(null);

  function handleLanguageClick(code: string) {
    const lang = LANGUAGES.find((l) => l.code === code);
    if (!lang) return;
    const name = lang.guideNames[Math.floor(Math.random() * lang.guideNames.length)];
    setSelectedLanguage(lang);
    setSelectedCity(null);
    setGuideName(name);
    setTimeout(() => {
      selectionRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  function handleStart() {
    if (!selectedLanguage || !selectedCity) return;
    // Lock scroll before state update so layout reflow can't move the viewport
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    setZoomTarget({ lat: selectedCity.lat, lng: selectedCity.lng });
    setTimeout(() => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      onStart(selectedLanguage.code, selectedCity.id, guideName);
    }, 2000);
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white overflow-x-hidden overflow-y-auto">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#09090b]/80 backdrop-blur-sm">
        <span className="text-sm font-semibold tracking-[0.15em] uppercase text-white">
          PathGlot
        </span>
        <span className="text-[10px] tracking-[0.12em] uppercase text-zinc-600 hidden sm:block">
          Gemini Live Agent Challenge
        </span>
      </nav>

      {/* Hero */}
      <section className="relative h-screen flex flex-col items-center">
        {/* Title */}
        <div className="relative z-10 text-center mt-16 sm:mt-20 px-6">
          <h1 className="text-[clamp(1.7rem,4.8vw,3.2rem)] font-bold tracking-[-0.04em] leading-[1.05]">
            Walk any street.<br className="hidden sm:block" />{" "}
            <span className="sm:hidden"> </span>Speak any language.
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-3 max-w-[26rem] mx-auto leading-relaxed">
            An AI voice guide explores real city streets with you<br className="hidden sm:block" /> speaking only your target language.
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
          <div className="flex items-center justify-center gap-1.5 sm:gap-2 flex-wrap max-w-sm sm:max-w-none">
            {LANGUAGES.map((lang) => {
              const isActive = selectedLanguage?.code === lang.code;
              return (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageClick(lang.code)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-white/10 ring-1 ring-white/20"
                      : "hover:bg-white/5"
                  }`}
                >
                  <span className={`leading-none transition-all duration-200 ${isActive ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"}`}>
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
      {selectedLanguage && (
        <section ref={selectionRef} className={`px-6 pb-20 pt-8 animate-fade-in ${zoomTarget ? "invisible" : ""}`}>
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <span className="text-base">{selectedLanguage.flag}</span>
              <div>
                <p className="text-[11px] tracking-[0.2em] uppercase text-zinc-500">
                  {selectedLanguage.nativeName}
                </p>
                {guideName && (
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    Guide: <span className="text-zinc-400">{guideName}</span>
                  </p>
                )}
              </div>
            </div>

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
                      <span className="block text-[11px] text-zinc-500 mt-0.5">
                        {city.country}{city.description && ` · ${city.description}`}
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
                  className="w-full py-4 bg-white text-black font-semibold text-sm rounded-full hover:bg-zinc-100 active:scale-[0.98] transition-all duration-200 tracking-wide"
                >
                  Start in {selectedCity.name} with {guideName} →
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
        <footer className="border-t border-zinc-900 py-8 px-6 text-center space-y-1">
          <p className="text-[11px] text-zinc-700">
            Gemini Live API · Google Maps Street View · Places API
          </p>
          <p className="text-[10px] text-zinc-800">
            Built for the Gemini Live Agent Challenge · 2026
          </p>
        </footer>
      )}
    </div>
  );
}
