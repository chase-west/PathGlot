export interface City {
  id: string;
  name: string;
  country: string;
  description: string; // starting neighborhood / street
  lat: number;
  lng: number;
  heading: number; // initial Street View camera heading (0–360)
  pitch: number;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  guideNames: string[];
  cities: City[];
}

// ─── Coordinate guidelines ────────────────────────────────────────────────────
// Coordinates MUST land on a drivable road or a footpath Google has driven.
// The hook uses status_changed to detect "ZERO_RESULTS" and show an error, so
// a bad coordinate will give users a clear message instead of a black screen.
//
// Rules:
//  ✓ Use named boulevards, avenues, or main streets
//  ✗ Avoid plazas / pedestrian squares / park interiors / ZTL zones
//  ✗ Avoid the exact centre of monuments / tourist attractions
//
// To verify a coordinate: paste "lat,lng" into Google Maps → click Street View
// pegman → if imagery appears you're good.
// ─────────────────────────────────────────────────────────────────────────────

export const LANGUAGES: Language[] = [
  {
    code: "es",
    name: "Spanish",
    nativeName: "Español",
    flag: "🇪🇸",
    guideNames: ["Sofia"],
    cities: [
      {
        id: "madrid",
        name: "Madrid",
        country: "Spain",
        description: "Gran Vía",
        lat: 40.4200,
        lng: -3.7027,
        heading: 90,
        pitch: 0,
      },
      {
        id: "barcelona",
        name: "Barcelona",
        country: "Spain",
        description: "Passeig de Gràcia",
        lat: 41.3917,
        lng: 2.1649,
        heading: 180,
        pitch: 0,
      },
      {
        id: "buenos-aires",
        name: "Buenos Aires",
        country: "Argentina",
        description: "Avenida de Mayo",
        lat: -34.6083,
        lng: -58.3712,
        heading: 90,
        pitch: 0,
      },
    ],
  },
  {
    code: "fr",
    name: "French",
    nativeName: "Français",
    flag: "🇫🇷",
    guideNames: ["Amélie"],
    cities: [
      {
        id: "paris",
        name: "Paris",
        country: "France",
        description: "Champs-Élysées",
        lat: 48.8698,
        lng: 2.3082,
        heading: 270,
        pitch: 0,
      },
      {
        id: "montmartre",
        name: "Montmartre",
        country: "France",
        description: "Rue Lepic",
        lat: 48.8843,
        lng: 2.3369,
        heading: 150,
        pitch: 5,
      },
      {
        id: "montreal",
        name: "Montréal",
        country: "Canada",
        description: "Rue Sainte-Catherine",
        lat: 45.5080,
        lng: -73.5690,
        heading: 90,
        pitch: 0,
      },
    ],
  },
  {
    code: "de",
    name: "German",
    nativeName: "Deutsch",
    flag: "🇩🇪",
    guideNames: ["Greta"],
    cities: [
      {
        id: "berlin",
        name: "Berlin",
        country: "Germany",
        description: "Unter den Linden",
        lat: 52.5163,
        lng: 13.3777,
        heading: 270,
        pitch: 0,
      },
      {
        id: "vienna",
        name: "Vienna",
        country: "Austria",
        description: "Ringstrasse",
        lat: 48.2036,
        lng: 16.3695,
        heading: 90,
        pitch: 0,
      },
    ],
  },
  {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    flag: "🇯🇵",
    guideNames: ["Yuki", "Hana"],
    cities: [
      {
        id: "tokyo-shibuya",
        name: "Tokyo (Shibuya)",
        country: "Japan",
        description: "Shibuya Crossing",
        lat: 35.6596,
        lng: 139.7006,
        heading: 0,
        pitch: 0,
      },
      {
        id: "osaka",
        name: "Osaka",
        country: "Japan",
        description: "Midosuji Avenue",
        lat: 34.6789,
        lng: 135.5054,
        heading: 180,
        pitch: 0,
      },
    ],
  },
  {
    code: "it",
    name: "Italian",
    nativeName: "Italiano",
    flag: "🇮🇹",
    guideNames: ["Giulia"],
    cities: [
      {
        id: "rome",
        name: "Rome",
        country: "Italy",
        description: "Near the Colosseum",
        lat: 41.8895,
        lng: 12.4968,
        heading: 270,
        pitch: 0,
      },
      {
        id: "florence",
        name: "Florence",
        country: "Italy",
        description: "Arno riverside",
        lat: 43.7678,
        lng: 11.2584,
        heading: 90,
        pitch: 0,
      },
    ],
  },
  {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
    flag: "🇵🇹",
    guideNames: ["Ana"],
    cities: [
      {
        id: "lisbon",
        name: "Lisbon",
        country: "Portugal",
        description: "Av. da Liberdade",
        lat: 38.7165,
        lng: -9.1427,
        heading: 0,
        pitch: 0,
      },
      {
        id: "sao-paulo",
        name: "São Paulo",
        country: "Brazil",
        description: "Avenida Paulista",
        lat: -23.5613,
        lng: -46.6565,
        heading: 90,
        pitch: 0,
      },
    ],
  },
  {
    code: "en",
    name: "English",
    nativeName: "English",
    flag: "🇺🇸",
    guideNames: ["Jake", "Emily"],
    cities: [
      {
        id: "new-york",
        name: "New York City",
        country: "United States",
        description: "Broadway, Times Square",
        lat: 40.7580,
        lng: -73.9855,
        heading: 180,
        pitch: 0,
      },
      {
        id: "los-angeles",
        name: "Los Angeles",
        country: "United States",
        description: "Hollywood Boulevard",
        lat: 34.1016,
        lng: -118.3267,
        heading: 90,
        pitch: 0,
      },
      {
        id: "chicago",
        name: "Chicago",
        country: "United States",
        description: "Michigan Avenue, the Magnificent Mile",
        lat: 41.8943,
        lng: -87.6249,
        heading: 180,
        pitch: 0,
      },
    ],
  },
];

export function getLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function getCity(
  languageCode: string,
  cityId: string
): City | undefined {
  return getLanguage(languageCode)?.cities.find((c) => c.id === cityId);
}
