# PathGlot

**Walk the streets of a foreign city. Your AI guide speaks only in the local language.**

PathGlot drops you into Google Street View while a Gemini Live voice agent acts as your personal tour guide — narrating landmarks, answering questions, and navigating the city, all in the language you're learning. Move through the streets and your guide dynamically references the real places around you in real time.

> Built for the **[Gemini Live Agent Challenge](https://googleai.devpost.com)** · Category: **Live Agents**
> `#GeminiLiveAgentChallenge`

---

## Demo

<!-- 🎬 Replace with your demo video link -->
**[▶ Watch Demo Video](#)**

---

## Architecture

![PathGlot Architecture](assets/architecture.svg)

**How it works:**

1. You walk through a foreign city in Google Street View
2. Your mic audio streams live to the backend at 16 kHz
3. The backend relays audio to **Gemini Live API** (native audio, v1alpha) with injected location context from the **Google Places API**
4. Gemini responds in the target language — narrating the real places around you
5. When Gemini mentions a place, a label appears on screen instantly (bearing math), then refines to pixel-accurate position via a background **Gemini Flash** vision call
6. If you ask "what is that?" — the backend screenshots your current view, sends it to Gemini Flash for identification, then injects the answer into the live session

---

## Features

- **Real-time voice conversation** — full-duplex audio via Gemini Live API, interruptible at any time
- **Grounded in real data** — agent only discusses verified Google Places data; says "I'm not certain" instead of hallucinating
- **Two-phase place labels** — instant bearing-based labels, refined to pixel accuracy by Gemini Flash vision
- **Vision fallback** — identifies statues, plazas, and architectural features not in Places API
- **Dynamic context** — location and heading re-injected automatically as you move and pan
- **6 languages × 14 cities** — Spanish, French, German, Japanese, Italian, Portuguese
- **No video streaming** — structured text context injection is more reliable than Gemini's 1 FPS video cap
- **3D interactive globe** — Three.js city selector on the landing page

---

## Supported Languages & Cities

| Language | Cities |
|---|---|
| 🇪🇸 Spanish | Madrid · Barcelona · Buenos Aires |
| 🇫🇷 French | Paris · Montmartre · Montréal |
| 🇩🇪 German | Berlin · Vienna |
| 🇯🇵 Japanese | Tokyo (Shibuya) · Osaka |
| 🇮🇹 Italian | Rome · Florence |
| 🇵🇹 Portuguese | Lisbon · São Paulo |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS |
| 3D Globe | Three.js + React Three Fiber |
| Maps | Google Maps JavaScript API |
| Audio | Web Audio API (16 kHz capture · 24 kHz playback) |
| Backend | Python 3.12 + FastAPI |
| AI (voice) | Gemini Live API — `gemini-2.5-flash-native-audio-preview-12-2025` |
| AI (vision) | Gemini 2.5 Flash — place locating + view identification |
| Places | Google Places API (New) |
| Hosting | Google Cloud Run (backend + frontend) |
| CI/CD | Cloud Build + Artifact Registry + Secret Manager |
| Containers | Docker + Docker Compose |

---

## Local Development

### Prerequisites

- Docker + Docker Compose
- A Gemini API key — [Google AI Studio](https://aistudio.google.com) → API Keys
- A Google Maps API key — [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials

### Required Google Cloud APIs

Enable these in your GCP project:

- Maps JavaScript API
- Places API (New)
- Street View Static API

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/pathglot
cd pathglot
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_MAPS_API_KEY=your_maps_api_key
GOOGLE_CLOUD_PROJECT=your_gcp_project_id   # optional, for Cloud Run deploy
CLOUD_RUN_REGION=us-central1               # optional
```

```bash
docker-compose up
```

Open **http://localhost:5173**

> **Note:** `GEMINI_API_KEY` is optional for local dev — the app works with bearing-based place labels even without it. Vision-refined labels and "what is that?" identification require it.

---

## Deploy to Google Cloud Run

```bash
chmod +x backend/deploy/deploy.sh
./backend/deploy/deploy.sh
```

This script:
1. Creates an Artifact Registry repository
2. Builds and pushes Docker images for backend + frontend
3. Deploys both services to Cloud Run (us-central1)
4. Configures secrets via Secret Manager

Alternatively, use Cloud Build for CI/CD:

```bash
gcloud builds submit --config=backend/deploy/cloudbuild.yaml \
  --substitutions="_REGION=us-central1"
```

---

## Testing Checklist

| Test | Expected |
|---|---|
| Select Spanish + Madrid → allow mic → walk Street View | Hear AI narrating in Spanish |
| Speak English to the guide | Agent redirects the conversation back in Spanish |
| Move >30m | Agent references new neighborhood within next response |
| 10+ minute session | No drops or degradation |
| Agent mentions a place | Label appears instantly, then refines position |
| Ask "what is that?" | Agent identifies from nearby places; label appears |
| Agent mentions something not in Places API (statue, plaza) | Vision fallback labels it |
| Pan camera >60° | Agent's direction references update to match new view |
| No `GEMINI_API_KEY` set | App works with bearing-based labels; no vision errors |

---

## Project Structure

```
pathglot/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket handler, session logic
│   ├── gemini_client.py     # Gemini Live API client (audio relay, tool calls)
│   ├── places_client.py     # Google Places API (New) wrapper
│   ├── context_builder.py   # Location/heading context injection
│   ├── vision_locate.py     # Gemini Flash vision — place locating + identification
│   ├── language_config.py   # Per-language voices, prompts, guide names
│   └── deploy/
│       ├── deploy.sh        # Cloud Run deploy script
│       └── cloudbuild.yaml  # Cloud Build CI/CD pipeline
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── LandingPage.tsx   # Hero + language/city selection
│       │   ├── Globe.tsx         # 3D interactive globe (Three.js)
│       │   ├── StreetView.tsx    # Maps + place label overlay
│       │   ├── MicButton.tsx     # Push-to-talk UI
│       │   ├── ConversationLog.tsx
│       │   └── JarvisHUD.tsx     # Floating transcript HUD
│       ├── hooks/
│       │   ├── useGeminiSession.ts  # WebSocket + audio pipeline
│       │   └── useStreetView.ts     # Maps SDK wrapper
│       └── lib/
│           ├── audio.ts    # PCM encode/decode, AudioPlayer
│           └── cities.ts   # Language/city/coordinate config
├── assets/
│   └── architecture.svg    # System architecture diagram
├── docker-compose.yml
└── .env.example
```

---

## Key Design Decisions

**No video streaming to Gemini** — The Live API's 1 FPS video cap and ~2 min session limit makes it unusable for Street View. We inject structured location + heading context instead, achieving the same result far more reliably.

**Single tool registration** — Only `navigate_to_place` is registered. A second tool (`highlight_place`) caused persistent 1008 errors on the native audio preview model. Place highlights are now triggered by substring matching against cached Places API results in the output transcript.

**Two-phase label placement** — A label appears immediately using bearing math (lat/lng → heading) when the agent first mentions a place. A background Gemini Flash vision call then refines the position to pixel accuracy. This eliminates the 2–3s delay that previously blocked labels from showing at all.

**END_SENSITIVITY_LOW** — Must stay enabled in the VAD config. Removing it causes an echo-loop that breaks language detection entirely.

**Verified data only** — The agent only speaks to Places API data and known landmark knowledge. It says "I'm not certain" rather than hallucinating.
