"""Google Places API (New) client for nearby place lookups."""

import os
import httpx
import math
from typing import Any

PLACES_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
PLACES_API_URL = "https://places.googleapis.com/v1/places:searchNearby"

# Place types we care about for a tour guide experience
# Must be valid Table A types from the Places API (New).
PLACE_TYPES = [
    "tourist_attraction",
    "museum",
    "restaurant",
    "cafe",
    "bar",
    "park",
    "church",
    "historical_landmark",
    "shopping_mall",
    "art_gallery",
    "library",
    "cultural_center",
    "performing_arts_theater",
    "market",
    "university",
]


async def nearby_search(
    lat: float,
    lng: float,
    language_code: str = "en",
    radius_meters: int = 200,
    max_results: int = 10,
) -> list[dict[str, Any]]:
    """
    Search for nearby places using the Places API (New).
    Returns a list of simplified place dicts.
    """
    if not PLACES_API_KEY:
        return []

    payload = {
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius_meters),
            }
        },
        "includedTypes": PLACE_TYPES,
        "maxResultCount": max_results,
        "languageCode": language_code,
        "rankPreference": "DISTANCE",
    }

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_API_KEY,
        "X-Goog-FieldMask": "places.displayName,places.types,places.formattedAddress,places.rating,places.editorialSummary,places.location",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(PLACES_API_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        print(f"[places_client] API error: {e}")
        return []

    places = []
    for p in data.get("places", []):
        loc = p.get("location", {})
        place = {
            "name": p.get("displayName", {}).get("text", ""),
            "address": p.get("formattedAddress", ""),
            "types": p.get("types", [])[:3],
            "rating": p.get("rating"),
            "summary": p.get("editorialSummary", {}).get("text", ""),
            "lat": loc.get("latitude"),
            "lng": loc.get("longitude"),
        }
        if place["name"]:
            places.append(place)

    return places


PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"


async def text_search(
    query: str,
    lat: float,
    lng: float,
    language_code: str = "en",
    radius_meters: int = 5000,
) -> dict[str, Any] | None:
    """
    Search for a specific place by name/query using Text Search (New).
    Biased toward the user's current location. Returns the top result or None.
    """
    if not PLACES_API_KEY:
        return None

    payload = {
        "textQuery": query,
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius_meters),
            }
        },
        "maxResultCount": 1,
        "languageCode": language_code,
    }

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_API_KEY,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.rating,places.editorialSummary",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(PLACES_TEXT_SEARCH_URL, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        print(f"[places_client] text_search error: {e}")
        return None

    places = data.get("places", [])
    if not places:
        return None

    p = places[0]
    loc = p.get("location", {})
    return {
        "name": p.get("displayName", {}).get("text", ""),
        "address": p.get("formattedAddress", ""),
        "rating": p.get("rating"),
        "summary": p.get("editorialSummary", {}).get("text", ""),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
    }


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance in meters between two lat/lng points."""
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
