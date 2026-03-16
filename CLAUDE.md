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
| `GOOGLE_MAPS_API_KEY` | Google Cloud Console → APIs & Services → Credentials (enable Maps JS API + Places API New + Street View Static API) |
| `GOOGLE_CLOUD_PROJECT` | Your GCP project ID |
| `CLOUD_RUN_REGION` | Default: `us-central1` |

## Architecture

```
Browser (React + Vite)
  ├── Google Maps Street View Panorama
  ├── Web Audio API (mic capture)
  ├── Web Speech API (user transcript)
  ├── Canvas screenshot capture (for vision)
  └── WebSocket → backend

Backend (FastAPI, Cloud Run)
  ├── WebSocket relay (/ws/session)
  ├── Places API (nearby search on movement >30m + text search for nav)
  ├── Context builder (injects location + heading direction into Gemini session)
  ├── Transcript matcher (accent-normalized scored matching for place labels)
  ├── Vision locator (Static Street View + Gemini Flash for label placement)
  ├── Vision identify (screenshot + Gemini Flash for unknown places)
  └── Gemini Live WebSocket client

Gemini Live API (gemini-2.5-flash-native-audio-preview-12-2025, v1alpha)
Gemini Flash (gemini-3-flash-preview — vision locate, gemini-2.5-flash-lite — screenshot identify)
```

## Key Design Decisions

- **No video streaming to Gemini** — 1 FPS cap + 2 min session limit makes it unusable. We inject location text context instead.
- **30m movement threshold** — prevents Places API spam while user walks/clicks through Street View.
- **System prompt language lock** — Gemini will comply ~95% of the time; we can't hard-block at model level.
- **Verified data only** — agent only speaks to Places API data + landmark knowledge, says "I'm not certain" otherwise.
- **Two registered tools** — `navigate_to_place` resolves place queries via Text Search API and teleports the user. `identify_current_view` captures a screenshot and sends it to Gemini Flash to identify what the user is looking at (stores, statues, signs, etc. not in Places API).
- **Two-phase label placement** — When the agent mentions a place, a label appears immediately using bearing math (lat/lng → heading). Then a background Gemini Flash vision call refines the position with pixel-accurate placement. This eliminates the 2-3s delay that previously blocked labels.
- **Screenshot-based identification** — When the user asks "what is that?", the backend requests a canvas screenshot from the frontend (actual user view), sends it to Gemini Flash for identification, then injects the answer back into the live session. Falls back to Street View Static API if canvas capture fails (tainted canvas).
- **Heading context updates** — When the user pans >60°, direction tags ([ahead], [behind], etc.) are re-injected into the Gemini session so the agent always knows what the user is currently looking at. Throttled to once per 5s.
- **Scored transcript matching** — Place names in agent speech are matched against cached Places API results using accent-normalized, scored matching. Long Google Places names (e.g. "Café X - Restaurante Y") are split on separators so the short name matches properly. Partial word matches require majority coverage to prevent false positives (e.g. "Plaza de Oriente" no longer falsely matches "Café de Oriente").
- **END_SENSITIVITY_LOW** — Must stay enabled in VAD config. Removing it causes echo-loop garbled language detection.
- **Affective dialog + proactive audio** — Both enabled via v1alpha API. Makes the guide more emotionally expressive and able to initiate conversation when it has something relevant.
- **One highlight per agent turn** — Prevents label-jumping when the agent casually lists multiple places. Resets on user speech so follow-ups re-trigger.

## Frontend Design

**Design philosophy:** Minimal, dark, modern SaaS aesthetic. Monochrome zinc palette with white accents.

- **Color palette:** Zinc scale on near-black (#09090b) background. White for primary text and interactive accents.
- **Typography:** Inter. Large bold headings with tight tracking, light secondary text in zinc-500.
- **Styling:** Tailwind CSS.
- **Landing page layout:**
  1. Hero section — centered headline ("Walk any street. Speak any language.") with a 3D interactive globe (Three.js / @react-three/fiber) behind the text showing city markers.
  2. Language selection — flag buttons at bottom of hero, scrolls to city picker on click.
  3. City selection — bordered cards with white highlight on selection, full-width start button.
  4. Footer — subtle, minimal.
- **Globe component:** Uses `@react-three/fiber` + `@react-three/drei`. Country outlines via d3-geo/world-atlas with FIFA flags overlaid. City markers with interactive hover/click. Located in `Globe.tsx`.
- **Session view:** Dark top bar with connection status pill, Street View fills viewport, white mic button, Jarvis HUD for floating transcript overlay, optional sidebar conversation log.
- **Jarvis HUD:** Floating message bubbles in bottom-left corner with enter/fade lifecycle. Shows last 2 messages. Auto-fades after 6s.
- **Key components:** `LandingPage.tsx` (landing + selection), `Globe.tsx` (3D globe), `StreetView.tsx` (maps + label overlay), `MicButton.tsx`, `ConversationLog.tsx` (sidebar), `JarvisHUD.tsx` (floating HUD).

## Audio Pipeline

- Capture: `getUserMedia` at device rate (44.1/48kHz)
- AudioContext created at 16kHz (browser handles high-quality resampling)
- Send: base64 PCM chunks (4096 frames = 256ms) via WebSocket
- Response: 24kHz PCM from Gemini → gapless playback via AudioContext
- Echo cancellation via browser's built-in `echoCancellation` constraint

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
