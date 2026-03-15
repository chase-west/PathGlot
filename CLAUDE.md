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
| `GEMINI_API_KEY` | Google AI Studio → API Keys (must be linked to a billing-enabled GCP project for production use; free tier has 20 req/day limit on 2.5 Flash). Optional — if unset, vision-based labeling is disabled but the app still works with bearing-based labels. |
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
  ├── Places API (nearby search on position change >30m)
  ├── Context manager (injects location + heading direction into Gemini session)
  ├── Vision locator (Static Street View + Gemini Flash for label placement)
  ├── Vision identify fallback (screenshot + transcript → Gemini Flash for unlisted places)
  └── Gemini Live WebSocket client

Gemini Live API (gemini-2.5-flash-native-audio-preview-12-2025, v1alpha)
```

## Key Design Decisions

- **No video streaming to Gemini** — 1 FPS cap + 2 min session limit makes it unusable. We inject location text context instead.
- **30m movement threshold** — prevents Places API spam while user pans Street View.
- **System prompt language lock** — Gemini will comply ~95% of the time; we can't hard-block at model level.
- **Verified data only** — agent only speaks to Places API data + landmark knowledge, says "I'm not certain" otherwise.
- **Single tool only** — Only `navigate_to_place` is registered as a Gemini tool. `highlight_place` was removed because a second tool destabilizes the preview audio model (1008 errors). Place highlighting is now detected from output transcription text via substring matching against cached Places API results.
- **Two-phase label placement** — When the agent mentions a place, a label appears immediately using bearing math (lat/lng → heading). Then a background Gemini Flash vision call refines the position with pixel-accurate placement. This eliminates the 2-3s delay that previously blocked labels.
- **Vision identify fallback** — When the agent talks about something not in the Places API (statues, plazas, architectural features), the backend screenshots the user's current view and asks Gemini Flash to identify and locate what the agent is referring to. Throttled to once per 10s. Requires `GEMINI_API_KEY` to be set.
- **Heading context updates** — When the user pans >60°, direction tags ([ahead], [behind], etc.) are re-injected into the Gemini session so the agent always knows what the user is currently looking at. Throttled to once per 5s.
- **Scored transcript matching** — Place names in agent speech are matched against cached Places API results using accent-normalized, scored matching. Long Google Places names (e.g. "Café X - Restaurante Y") are split on separators so the short name matches properly. Partial word matches require majority coverage to prevent false positives (e.g. "Plaza de Oriente" no longer falsely matches "Café de Oriente").
- **END_SENSITIVITY_LOW** — Must stay enabled in VAD config. Removing it causes echo-loop garbled language detection.

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
3. Move >30m → AI references new neighborhood within next response
4. 10+ minute session → should not drop or degrade
5. Agent mentions a place → label appears immediately (bearing), then refines position (vision)
6. Ask "what is that?" while looking at something → agent identifies from [ahead] places + label appears
7. Agent talks about something NOT in Places API (statue, plaza) → vision fallback labels it
8. Pan camera >60° → agent's direction references update to match new view
9. No `GEMINI_API_KEY` set → app works with bearing-based labels only, no vision errors
