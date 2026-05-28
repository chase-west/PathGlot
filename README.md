# PathGlot

**Walk the streets of a foreign city. Your AI guide speaks only in the local language.**

PathGlot drops you into Google Street View with a Gemini Live voice agent acting as your tour guide. It narrates landmarks, answers your questions, and navigates the city for you, all in the language you're trying to learn. As you move around, the guide keeps up and talks about the actual places near you in real time.

> Built for the **[Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/)** · Category: **Live Agents**
> `#GeminiLiveAgentChallenge`

---

## Demo

**[▶ Watch Demo Video](https://www.youtube.com/watch?v=x8xgqN6Dw-4)**

---

## Architecture

![PathGlot Architecture](assets/architecture.svg)

**How it works:**

1. You walk through a foreign city in Google Street View.
2. Your mic audio streams to the backend at 16 kHz.
3. The backend passes that audio to the **Gemini Live API** (native audio, v1alpha) along with location context pulled from the **Google Places API**.
4. Gemini talks back in the target language, narrating the real places around you.
5. When it mentions a place, a label pops up on screen right away using bearing math, then a background **Gemini Flash** vision call nudges it to the pixel-accurate spot.
6. Ask "what is that?" and the `identify_current_view` tool grabs a screenshot from your browser, sends it to **Gemini Flash** to figure out what you're looking at, and feeds the answer back into the live session.
7. Turn your head more than 60° and the agent gets fresh context, so it always knows which way you're facing.

---

## Features

- **Real-time voice conversation.** Full-duplex audio over the Gemini Live API. Cut it off any time.
- **Grounded in real data.** The agent sticks to verified Google Places data and says "I'm not certain" instead of making things up.
- **Two tools.** `navigate_to_place` teleports you somewhere, `identify_current_view` figures out what's on screen from a screenshot.
- **Two-phase place labels.** Instant bearing-based labels first, then Gemini Flash vision tightens up the position.
- **Screenshot-based identification.** Captures the actual browser canvas when you ask what something is.
- **Dynamic context.** Location and heading get re-sent automatically as you move and pan around.
- **6 languages, 14 cities.** Spanish, French, German, Japanese, Italian, and Portuguese.
- **No video streaming.** Sending structured text context turned out to be more reliable than Gemini's 1 FPS video cap.
- **3D interactive globe.** A Three.js city picker on the landing page with country outlines and flags.
- **Affective dialog.** Emotion-aware responses through the v1alpha API, so the guide sounds less robotic.
- **Jarvis HUD.** A floating transcript overlay that fades itself out.

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
| 3D Globe | Three.js + React Three Fiber + d3-geo |
| Maps | Google Maps JavaScript API |
| Audio | Web Audio API (16 kHz capture, 24 kHz playback) |
| User Transcription | Web Speech API (language-aware) |
| Backend | Python 3.12 + FastAPI |
| AI (voice) | Gemini Live API, `gemini-2.5-flash-native-audio-preview-12-2025` (v1alpha) |
| AI (vision locate) | `gemini-3-flash-preview`, place locating in Street View images |
| AI (vision identify) | `gemini-2.5-flash-lite`, screenshot identification |
| Places | Google Places API (New), nearby search + text search |
| Hosting | Google Cloud Run (backend + frontend) |
| CI/CD | Cloud Build + Artifact Registry + Secret Manager |
| Containers | Docker + Docker Compose |

---

## Local Development

### Prerequisites

- Docker + Docker Compose
- A Gemini API key from [Google AI Studio](https://aistudio.google.com) (API Keys)
- A Google Maps API key from [Google Cloud Console](https://console.cloud.google.com) (APIs & Services, Credentials)

### Required Google Cloud APIs

Turn these on in your GCP project:

- Maps JavaScript API
- Places API (New)
- Street View Static API

### Setup

```bash
git clone https://github.com/chase-west/PathGlot
cd PathGlot
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

> **Note:** `GEMINI_API_KEY` is optional for local dev. The app still works with bearing-based place labels without it. You only need it for vision-refined labels and the "what is that?" identification.

---

## Deploy to Google Cloud Run

```bash
chmod +x backend/deploy/deploy.sh
./backend/deploy/deploy.sh
```

The script:
1. Creates an Artifact Registry repository.
2. Builds and pushes Docker images for the backend and frontend.
3. Deploys both services to Cloud Run (us-central1).
4. Passes API keys in as environment variables.

If you'd rather run it through Cloud Build for CI/CD (it reads API keys from Secret Manager):

```bash
gcloud builds submit --config=backend/deploy/cloudbuild.yaml \
  --substitutions="_REGION=us-central1"
```

---

## Testing Checklist

| Test | Expected |
|---|---|
| Select Spanish + Madrid, allow mic, walk Street View | Hear AI narrating in Spanish |
| Speak English to the guide | Agent steers the conversation back to Spanish |
| Move >30m | Agent references the new neighborhood in its next response |
| 10+ minute session | No drops or degradation |
| Agent mentions a place | Label shows up right away, then the position refines |
| Ask "what is that?" while looking at something | `identify_current_view` fires, agent identifies and labels it |
| Agent mentions something not in Places API (statue, plaza) | Vision fallback labels it |
| Pan camera >60° | Agent's direction references catch up to the new view |
| No `GEMINI_API_KEY` set | App works with bearing-based labels, no vision errors |

---

## Project Structure

```
pathglot/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket handler, session logic
│   ├── gemini_client.py     # Gemini Live API client (audio relay, tool calls)
│   ├── places_client.py     # Google Places API (New): nearby + text search
│   ├── context_builder.py   # Location/heading context injection
│   ├── vision_locate.py     # Gemini Flash vision: place locating + identification
│   ├── language_config.py   # Per-language voices, prompts, guide names
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile           # Backend container
│   └── deploy/
│       ├── deploy.sh        # Cloud Run deploy script
│       └── cloudbuild.yaml  # Cloud Build CI/CD pipeline
├── frontend/
│   ├── index.html           # Entry HTML (Inter font, meta tags)
│   ├── Dockerfile           # Frontend container
│   ├── nginx.conf           # Production nginx config
│   ├── package.json         # Node dependencies
│   ├── tailwind.config.js   # Tailwind configuration
│   ├── vite.config.ts       # Vite build config
│   └── src/
│       ├── App.tsx           # Root: session management, routing
│       ├── main.tsx          # React entry point
│       ├── index.css         # Global styles (HUD, animations, transitions)
│       ├── components/
│       │   ├── LandingPage.tsx   # Hero + language/city selection
│       │   ├── Globe.tsx         # 3D interactive globe (Three.js + d3-geo)
│       │   ├── StreetView.tsx    # Maps + place label overlay + screenshot
│       │   ├── MicButton.tsx     # Mic toggle UI
│       │   ├── ConversationLog.tsx  # Sidebar transcript
│       │   └── JarvisHUD.tsx     # Floating transcript HUD
│       ├── hooks/
│       │   ├── useGeminiSession.ts  # WebSocket + audio pipeline
│       │   └── useStreetView.ts     # Maps SDK wrapper + canvas screenshot
│       ├── lib/
│       │   ├── audio.ts    # PCM encode/decode, AudioPlayer
│       │   └── cities.ts   # Language/city/coordinate config
│       └── types/
│           └── world-atlas.d.ts  # Type declarations
├── assets/
│   └── architecture.svg    # System architecture diagram
├── docker-compose.yml
├── .env.example
└── CLAUDE.md               # Developer reference
```

---

## Key Design Decisions

**No video streaming to Gemini.** The Live API's 1 FPS video cap and roughly 2 minute session limit made it a non-starter for Street View. We inject structured location and heading context instead, which gets the same result and holds up way better.

**Two tools.** `navigate_to_place` teleports you in Street View using Places Text Search. `identify_current_view` grabs your actual browser canvas and hands it to Gemini Flash to identify. Both return structured responses the agent works into the conversation.

**Two-phase label placement.** A label shows up the moment the agent names a place, positioned with bearing math (lat/lng to heading). A background Gemini Flash vision call then refines it to pixel accuracy. This got rid of the 2 to 3 second delay that used to keep labels from showing at all.

**Screenshot-based vision.** When you ask "what is that?", the backend asks the frontend for a canvas capture over WebSocket, preserving the WebGL drawing buffers. If the canvas is tainted by cross-origin tiles, it falls back to the Street View Static API.

**END_SENSITIVITY_LOW.** Leave this on in the VAD config. Take it out and you get an echo-loop that wrecks language detection.

**Verified data only.** The agent only talks about Places API data and landmarks it actually knows. Otherwise it says "I'm not certain" rather than guessing.

**Affective dialog + proactive audio.** Both on via the v1alpha API. The guide gets more expressive and can speak up on its own when there's something worth pointing out.
