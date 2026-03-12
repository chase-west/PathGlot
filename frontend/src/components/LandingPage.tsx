import { useState } from "react";
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

  function handleLanguageSelect(lang: Language) {
    setSelectedLanguage(lang);
    setSelectedCity(null);
  }

  function handleCitySelect(city: City) {
    setSelectedCity(city);
  }

  function handleGlobeCityClick(languageCode: string, cityId: string) {
    const lang = LANGUAGES.find((l) => l.code === languageCode);
    if (!lang) return;
    setSelectedLanguage(lang);
    const city = lang.cities.find((c) => c.id === cityId);
    if (city) setSelectedCity(city);
  }

  function handleStart() {
    if (!selectedLanguage || !selectedCity) return;
    const guideName =
      selectedLanguage.guideNames[
        Math.floor(Math.random() * selectedLanguage.guideNames.length)
      ];
    onStart(selectedLanguage.code, selectedCity.id, guideName);
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-5 flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight text-white">
          PathGlot
        </span>
        <a
          href="#start"
          className="text-sm text-zinc-400 hover:text-white transition-colors"
        >
          Get started
        </a>
      </nav>

      {/* Hero */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Globe - positioned as background element */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Globe
            selectedLanguageCode={selectedLanguage?.code ?? null}
            selectedCityId={selectedCity?.id ?? null}
            onCityClick={handleGlobeCityClick}
            className="w-full h-full max-w-[800px] max-h-[800px] opacity-40 pointer-events-auto"
          />
        </div>

        {/* Hero text */}
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <p className="text-sm tracking-[0.2em] uppercase text-zinc-500 mb-6">
            Language through exploration
          </p>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight leading-[1.1] mb-8">
            Walk the streets.
            <br />
            <span className="text-zinc-500">Speak the language.</span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-lg mx-auto mb-12 leading-relaxed">
            Drop into a foreign city through Street View. An AI guide walks with
            you, speaking only in your target language — pointing out landmarks,
            narrating the culture, and helping you listen your way to fluency.
          </p>
          <a
            href="#start"
            className="inline-block text-sm font-medium text-zinc-300 border border-zinc-700 px-8 py-3 rounded-full hover:bg-white hover:text-black transition-all duration-300"
          >
            Start exploring
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="py-32 px-6 border-t border-zinc-900">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm tracking-[0.2em] uppercase text-zinc-600 mb-4">
            How it works
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-20">
            Three steps to immersion
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-16">
            <div>
              <div className="text-5xl font-extralight text-zinc-700 mb-4">
                01
              </div>
              <h3 className="text-lg font-semibold mb-3">Choose a language</h3>
              <p className="text-zinc-500 leading-relaxed">
                Pick from Spanish, French, German, Japanese, Italian, or
                Portuguese. Your AI guide adapts to your choice.
              </p>
            </div>
            <div>
              <div className="text-5xl font-extralight text-zinc-700 mb-4">
                02
              </div>
              <h3 className="text-lg font-semibold mb-3">Drop into a city</h3>
              <p className="text-zinc-500 leading-relaxed">
                Walk real streets in Madrid, Paris, Tokyo, and more through
                Google Street View. Move freely at your own pace.
              </p>
            </div>
            <div>
              <div className="text-5xl font-extralight text-zinc-700 mb-4">
                03
              </div>
              <h3 className="text-lg font-semibold mb-3">Listen and learn</h3>
              <p className="text-zinc-500 leading-relaxed">
                Your AI guide narrates what&apos;s around you — landmarks,
                street names, local culture — entirely in your target language.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Selection */}
      <section id="start" className="py-32 px-6 border-t border-zinc-900">
        <div className="max-w-3xl mx-auto">
          {/* Language selection */}
          <div className="mb-16">
            <p className="text-sm tracking-[0.2em] uppercase text-zinc-600 mb-4">
              Step 1
            </p>
            <h2 className="text-2xl font-bold tracking-tight mb-8">
              Choose a language
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageSelect(lang)}
                  className={`group text-left p-5 rounded-xl border transition-all duration-200 ${
                    selectedLanguage?.code === lang.code
                      ? "border-white bg-white/[0.03]"
                      : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <span className="text-2xl block mb-3">{lang.flag}</span>
                  <span className="block font-medium text-sm text-white">
                    {lang.name}
                  </span>
                  <span className="block text-xs text-zinc-500 mt-0.5">
                    {lang.nativeName}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* City selection */}
          {selectedLanguage && (
            <div className="mb-16 animate-fade-in">
              <p className="text-sm tracking-[0.2em] uppercase text-zinc-600 mb-4">
                Step 2
              </p>
              <h2 className="text-2xl font-bold tracking-tight mb-8">
                Pick your city
              </h2>
              <div className="space-y-2">
                {selectedLanguage.cities.map((city) => (
                  <button
                    key={city.id}
                    onClick={() => handleCitySelect(city)}
                    className={`w-full text-left px-6 py-4 rounded-xl border transition-all duration-200 flex items-center justify-between group ${
                      selectedCity?.id === city.id
                        ? "border-white bg-white/[0.03]"
                        : "border-zinc-800 hover:border-zinc-600"
                    }`}
                  >
                    <div>
                      <span className="font-medium text-white">
                        {city.name}
                      </span>
                      <span className="text-zinc-500 text-sm ml-3">
                        {city.country}
                      </span>
                    </div>
                    <span className="text-zinc-700 group-hover:text-zinc-400 transition-colors">
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Start button */}
          {selectedLanguage && selectedCity && (
            <div className="animate-fade-in">
              <button
                onClick={handleStart}
                className="w-full py-4 rounded-xl bg-white text-black font-semibold text-sm hover:bg-zinc-200 transition-colors duration-200"
              >
                Start in {selectedCity.name} →
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-12 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm text-zinc-600">
            PathGlot — AI-powered language immersion
          </span>
          <span className="text-xs text-zinc-700">
            Built with Gemini Live API · Google Maps · Places API
          </span>
        </div>
      </footer>
    </div>
  );
}
