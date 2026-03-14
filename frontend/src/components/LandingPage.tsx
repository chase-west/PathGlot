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
  const selectionRef = useRef<HTMLElement>(null);

  function handleLanguageSelect(lang: Language) {
    if (selectedLanguage?.code === lang.code) {
      setSelectedLanguage(null);
      setSelectedCity(null);
    } else {
      setSelectedLanguage(lang);
      setSelectedCity(null);
    }
  }

  function handleCitySelect(city: City, lang?: Language) {
    if (lang && selectedLanguage?.code !== lang.code) {
      setSelectedLanguage(lang);
    }
    setSelectedCity(city);
  }

  function handleGlobeCityClick(languageCode: string, cityId: string) {
    const lang = LANGUAGES.find((l) => l.code === languageCode);
    if (!lang) return;
    setSelectedLanguage(lang);
    const city = lang.cities.find((c) => c.id === cityId);
    if (city) setSelectedCity(city);
    selectionRef.current?.scrollIntoView({ behavior: "smooth" });
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
    <div className="min-h-screen bg-[#09090b] text-white overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-[0.15em] uppercase text-white">
          PathGlot
        </span>
        <a
          href="#start"
          className="text-[11px] tracking-[0.1em] uppercase text-zinc-500 hover:text-white transition-colors border border-zinc-800 px-4 py-2 rounded-full"
        >
          Get Started
        </a>
      </nav>

      {/* Hero — globe dominant */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20 pb-8">
        {/* Floating language phrases — scattered behind globe */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
          {[
            { text: "Hola", x: "8%", y: "18%", size: "text-lg", opacity: "opacity-[0.07]" },
            { text: "Bonjour", x: "78%", y: "12%", size: "text-2xl", opacity: "opacity-[0.06]" },
            { text: "こんにちは", x: "85%", y: "65%", size: "text-xl", opacity: "opacity-[0.08]" },
            { text: "Guten Tag", x: "5%", y: "72%", size: "text-base", opacity: "opacity-[0.06]" },
            { text: "Ciao", x: "72%", y: "82%", size: "text-lg", opacity: "opacity-[0.07]" },
            { text: "Olá", x: "15%", y: "45%", size: "text-xl", opacity: "opacity-[0.05]" },
            { text: "你好", x: "90%", y: "38%", size: "text-base", opacity: "opacity-[0.06]" },
            { text: "Привет", x: "3%", y: "88%", size: "text-sm", opacity: "opacity-[0.05]" },
          ].map((phrase, i) => (
            <span
              key={i}
              className={`absolute font-light ${phrase.size} ${phrase.opacity} text-white`}
              style={{ left: phrase.x, top: phrase.y }}
            >
              {phrase.text}
            </span>
          ))}
        </div>

        {/* Title — above globe */}
        <div className="relative z-10 text-center mb-4">
          <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-[-0.03em] leading-[1.1]">
            Walk any street. Speak any language.
          </h1>
        </div>

        {/* Globe — large and central */}
        <div className="relative z-10 w-full max-w-[700px] aspect-square">
          <Globe
            selectedLanguageCode={selectedLanguage?.code ?? null}
            selectedCityId={selectedCity?.id ?? null}
            onCityClick={handleGlobeCityClick}
            className="w-full h-full"
          />
        </div>

        {/* Flag row under globe */}
        <div className="relative z-10 flex items-center gap-5 mt-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                handleLanguageSelect(lang);
                selectionRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className={`text-2xl sm:text-3xl transition-all duration-200 hover:scale-110 ${
                selectedLanguage?.code === lang.code
                  ? "scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                  : "opacity-50 hover:opacity-100"
              }`}
              title={lang.name}
            >
              {lang.flag}
            </button>
          ))}
        </div>

        {/* Scroll indicator */}
        <div className="mt-auto pt-8 flex flex-col items-center gap-2">
          <p className="text-[10px] tracking-[0.25em] uppercase text-zinc-600">
            Scroll to explore
          </p>
          <div className="scroll-indicator w-px h-6 bg-zinc-700" />
        </div>
      </section>

      {/* Phrase ribbon */}
      <div className="border-y border-zinc-900 py-4 overflow-hidden">
        <div className="phrase-ribbon flex whitespace-nowrap">
          {[
            "Hola, ¿cómo estás?",
            "Bonjour, comment allez-vous?",
            "こんにちは、お元気ですか？",
            "Guten Tag, wie geht es Ihnen?",
            "Ciao, come stai?",
            "Olá, como vai?",
            "¿Dónde está la biblioteca?",
            "Je voudrais un café, s'il vous plaît",
            "すみません、駅はどこですか？",
            "Ich möchte das bitte bestellen",
            "Mi può indicare la strada?",
            "Onde fica o mercado?",
          ]
            .flatMap((p) => [p, p, p])
            .map((phrase, i) => (
              <span
                key={i}
                className="text-[13px] text-zinc-700 font-light mx-8"
              >
                {phrase}
              </span>
            ))}
        </div>
      </div>

      {/* Language selection */}
      <section
        ref={selectionRef}
        id="start"
        className="py-20 lg:py-28 px-6 md:px-10"
      >
        <div className="max-w-5xl mx-auto">
          <p className="text-[11px] tracking-[0.25em] uppercase text-zinc-600 mb-4">
            Choose your destination
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.02em] mb-16">
            Where will you walk?
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8 lg:gap-6">
            {LANGUAGES.map((lang) => {
              const isSelected = selectedLanguage?.code === lang.code;
              return (
                <div key={lang.code}>
                  <button
                    onClick={() => handleLanguageSelect(lang)}
                    className="group w-full text-left"
                  >
                    <span className="text-4xl block mb-2">{lang.flag}</span>
                    <span
                      className={`block text-lg font-bold tracking-tight transition-colors duration-200 ${
                        isSelected
                          ? "text-white"
                          : "text-zinc-400 group-hover:text-white"
                      }`}
                    >
                      {lang.nativeName}
                    </span>
                    <span className="block text-[10px] tracking-[0.1em] uppercase text-zinc-600 mt-0.5">
                      {lang.name}
                    </span>
                  </button>

                  {/* Cities */}
                  <div
                    className={`mt-3 space-y-0.5 border-t border-zinc-800/50 pt-3 transition-opacity duration-300 ${
                      isSelected ? "opacity-100" : "opacity-20"
                    }`}
                  >
                    {lang.cities.map((city) => {
                      const isCitySelected =
                        isSelected && selectedCity?.id === city.id;
                      return (
                        <button
                          key={city.id}
                          onClick={() => handleCitySelect(city, lang)}
                          className={`flex items-center gap-1.5 w-full text-left py-1 text-xs transition-colors duration-200 ${
                            isCitySelected
                              ? "text-white font-medium"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          <span
                            className={`w-1 h-1 rounded-full shrink-0 transition-colors duration-200 ${
                              isCitySelected ? "bg-white" : "bg-zinc-700"
                            }`}
                          />
                          {city.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Start button */}
          {selectedLanguage && selectedCity && (
            <div className="mt-16 animate-fade-in text-center">
              <button
                onClick={handleStart}
                className="px-14 py-4 bg-white text-black font-medium text-sm tracking-wide rounded-full hover:bg-zinc-200 active:scale-[0.98] transition-all duration-200"
              >
                Begin in {selectedCity.name} →
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-10 px-6 md:px-10">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-[11px] tracking-[0.15em] uppercase text-zinc-600">
            PathGlot
          </span>
          <span className="text-[11px] text-zinc-700">
            Gemini Live API · Google Maps · Places API
          </span>
        </div>
      </footer>
    </div>
  );
}
