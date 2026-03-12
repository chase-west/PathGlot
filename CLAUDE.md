# PathGlot — Dev Guide

## What This Is
PathGlot is a language-learning app where users explore foreign cities via Google Street View while a Gemini Live AI voice agent acts as a tour guide speaking exclusively in the target language.

**Hackathon:** Gemini Live Agent Challenge — deadline Mar 16, 2026 @ 5pm PDT
**Category:** Live Agents (Real-time Interaction, Audio/Vision)

## Running Locally

```bash
# Copy env vars
cp .env.example .env
# Fill in GEMINI_API_KEY and GOOGLE_MAPS_API_KEY

# Start everything
docker-compose up

# Frontend: http://localhost:5173
# Backend: http://localhost:8000
```

## Environment Variables

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio → API Keys |
| `GOOGLE_MAPS_API_KEY` | Google Cloud Console → APIs & Services → Credentials (enable Maps JS API + Places API New) |
| `GOOGLE_CLOUD_PROJECT` | Your GCP project ID |
| `CLOUD_RUN_REGION` | Default: `us-central1` |

## Architecture

```
Browser (React + Vite)
  ├── Google Maps Street View Panorama
  ├── Web Audio API (mic capture)
  └── WebSocket → backend

Backend (FastAPI, Cloud Run)
  ├── WebSocket relay
  ├── Places API (nearby search on position change >50m)
  ├── Context manager (injects location into Gemini session)
  └── Gemini Live WebSocket client

Gemini Live API (gemini-2.5-flash-native-audio-preview-12-2025, v1alpha)
```

## Key Design Decisions

- **No video streaming to Gemini** — 1 FPS cap + 2 min session limit makes it unusable. We inject location text context instead.
- **50m movement threshold** — prevents Places API spam while user pans Street View.
- **System prompt language lock** — Gemini will comply ~95% of the time; we can't hard-block at model level.
- **Verified data only** — agent only speaks to Places API data + landmark knowledge, says "I'm not certain" otherwise.

## Frontend Design

**Design philosophy:** Minimal, dark, modern SaaS aesthetic. No gradients, no glass-morphism, no decorative SVGs.

- **Color palette:** Zinc scale on near-black (#09090b) background. White for primary text and interactive accents. No brand colors — monochrome only.
- **Typography:** Inter. Large bold headings with tight tracking, light secondary text in zinc-500.
- **Landing page layout:**
  1. Hero section — centered headline ("Walk the streets. Speak the language.") with a 3D interactive globe (Three.js / @react-three/fiber) behind the text showing city markers.
  2. How-it-works section — three numbered steps with generous whitespace.
  3. Language & city selection — bordered cards with white highlight on selection, full-width start button.
  4. Footer — subtle, minimal.
- **Globe component:** Uses `@react-three/fiber` + `@react-three/drei`. Fibonacci-distributed dots on a sphere, city markers with interactive hover/click, slow auto-rotation. Located in `Globe.tsx`.
- **Session view:** Dark top bar, Street View fills viewport, white mic button, zinc sidebar for transcript.
- **Key components:** `LandingPage.tsx` (landing + selection), `Globe.tsx` (3D globe), `StreetView.tsx`, `MicButton.tsx`, `ConversationLog.tsx`.

## Audio Pipeline

- Capture: `getUserMedia` at device rate (44.1/48kHz)
- Resample: downsample to 16kHz
- Send: base64 PCM chunks (20-40ms) via WebSocket
- Response: 24kHz PCM from Gemini → playback via AudioContext

## Deploy

```bash
# Build and deploy to Cloud Run
cd backend/deploy
./deploy.sh
```

## Testing Checklist

1. Select Spanish + Madrid → allow mic → walk Street View → hear AI in Spanish
2. Speak English → AI should redirect in Spanish
3. Move >50m → AI references new neighborhood within next response
4. 10+ minute session → should not drop or degrade
