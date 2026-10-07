import { languageColor } from "./map-palette.mjs";
import { contrastBasisClass, contrastSymbol } from "./typology-map.mjs?v=21";

const maps = new WeakMap();
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function coordinates(entry) {
  const latitude = entry?.map?.latitude;
  const longitude = entry?.map?.longitude;
  if (latitude == null || longitude == null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? [lat, lng]
    : null;
}

function markerIcon(entry) {
  // Only the fixed symbols returned by contrastSymbol enter the icon markup.
  const symbol = contrastSymbol(entry);
  const color = languageColor(entry.family);
  const basis = contrastBasisClass(entry);
  return window.L.divIcon({
    className: `atlas-pin-host ${basis}`,
    html: `<span class="atlas-pin" style="--marker-color:${color}">${symbol}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    tooltipAnchor: [0, -15]
  });
}

function tooltipContent(entry) {
  // Leaflet treats string tooltip content as HTML. Build nodes so catalog text stays text.
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = entry.title || entry.place || "Study locality";
  const detail = document.createElement("span");
  detail.textContent = [entry.family, entry.place || "Approximate locality"].filter(Boolean).join(" · ");
  const contrast = document.createElement("span");
  contrast.textContent = entry.typology?.contrast || "Prosodic classification pending";
  content.append(title, document.createElement("br"), detail, document.createElement("br"), contrast);
  return content;
}

function areaFeature(entry) {
  if (!entry?.map?.distributionSource) return null;
  const supplied = entry.map.distributionGeometry;
  const geometry = supplied?.type === "Feature" ? supplied.geometry : supplied;
  // Only sourced area geometries can support a dialect distribution surface.
  if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") return null;
  if (!Array.isArray(geometry.coordinates)) return null;
  return { type: "Feature", properties: {}, geometry };
}

function areaStyle(entry, visible) {
  const color = languageColor(entry.family);
  return {
    color,
    weight: 2,
    opacity: visible ? 0.85 : 0.16,
    fillColor: color,
    fillOpacity: visible ? 0.2 : 0.035,
    interactive: true
  };
}

function areaTooltipContent(entry) {
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${entry.title || "Study locality"} distribution area`;
  const source = document.createElement("span");
  source.textContent = `Source: ${entry.map.distributionSource}`;
  content.append(title, document.createElement("br"), source);
  return content;
}

function scheduleResize(state) {
  if (state.resizeFrame != null) return;
  state.resizeFrame = window.requestAnimationFrame(() => {
    state.resizeFrame = null;
    if (!state.destroyed) state.map.invalidateSize({ pan: false, debounceMoveend: true });
  });
}

function syncAreas(state, entries, visibleIds) {
  const nextIds = new Set();
  for (const entry of entries) {
    if (entry.id == null) continue;
    const feature = areaFeature(entry);
    if (!feature) continue;
    let geometryKey;
    try {
      geometryKey = JSON.stringify(feature.geometry);
    } catch {
      continue;
    }
    nextIds.add(entry.id);
    const visible = visibleIds?.has?.(entry.id) ?? true;
    let item = state.areas.get(entry.id);
    if (item && item.geometryKey !== geometryKey) {
      item.layer.remove();
      state.areas.delete(entry.id);
      item = null;
    }
    if (!item) {
      item = { entry, geometryKey, layer: null };
      let layer;
      try {
        layer = window.L.geoJSON(feature, {
          style: areaStyle(entry, visible),
          onEachFeature(_feature, polygon) {
            polygon.bindTooltip(areaTooltipContent(entry), { direction: "top", opacity: 0.97 });
            polygon.on("click", () => state.onSelect?.(item.entry));
          }
        });
      } catch {
        continue;
      }
      if (!layer.getLayers().length) continue;
      item.layer = layer.addTo(state.map);
      state.areas.set(entry.id, item);
    } else {
      item.entry = entry;
      item.layer.setStyle(areaStyle(entry, visible));
      item.layer.eachLayer(polygon => polygon.setTooltipContent(areaTooltipContent(entry)));
    }
  }
  for (const [id, item] of state.areas) {
    if (nextIds.has(id)) continue;
    item.layer.remove();
    state.areas.delete(id);
  }
}

function syncMarkers(state, entries, visibleIds) {
  const nextIds = new Set();
  for (const entry of entries) {
    const latLng = coordinates(entry);
    if (!latLng || entry.id == null) continue;
    nextIds.add(entry.id);
    const visible = visibleIds?.has?.(entry.id) ?? true;
    let item = state.markers.get(entry.id);
    if (!item) {
      const marker = window.L.marker(latLng, { icon: markerIcon(entry) }).addTo(state.map);
      item = { marker, entry };
      marker.bindTooltip(tooltipContent(entry), { direction: "top", offset: [0, -8], opacity: 0.97 });
      marker.on("click", () => state.onSelect?.(item.entry));
      const path = marker.getElement();
      if (path) {
        path.setAttribute("role", "button");
        path.setAttribute("tabindex", "0");
        path.setAttribute("aria-label", `${entry.title}: ${entry.typology?.contrast || "classification pending"}. ${entry.measurementSets?.length ? "View data" : "View published profile"}`);
        path.addEventListener("keydown", event => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          state.onSelect?.(item.entry);
        });
      }
      state.markers.set(entry.id, item);
    } else {
      item.entry = entry;
      item.marker.setLatLng(latLng);
      item.marker.setTooltipContent(tooltipContent(entry));
      item.marker.getElement()?.setAttribute("aria-label", `${entry.title}: ${entry.typology?.contrast || "classification pending"}. ${entry.measurementSets?.length ? "View data" : "View published profile"}`);
    }
    item.marker.setOpacity(visible ? 1 : 0.35);
    item.marker.setZIndexOffset(visible ? 1000 : 0);
  }
  for (const [id, item] of state.markers) {
    if (nextIds.has(id)) continue;
    item.marker.remove();
    state.markers.delete(id);
  }
}

function initialView(map, entries) {
  const points = entries.map(coordinates).filter(Boolean);
  if (points.length > 1) {
    map.fitBounds(window.L.latLngBounds(points), { padding: [35, 35], maxZoom: 8 });
  } else if (points.length === 1) {
    map.setView(points[0], 8);
  } else {
    map.setView([51, 10], 5);
  }
}

export function renderLiveAtlasMap(container, entries, visibleIds, onSelect, onUnavailable) {
  if (!container) throw new TypeError("A map container is required.");
  if (!window.L) throw new Error("Leaflet must be loaded before the live atlas map.");
  const catalog = Array.isArray(entries) ? entries : [];
  let state = maps.get(container);

  if (!state) {
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Interactive map of study localities. Drag to pan; scroll or pinch to zoom.");
    const map = window.L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      preferCanvas: false,
      zoomSnap: 0.25
    });
    state = {
      map,
      areas: new Map(),
      markers: new Map(),
      onSelect,
      onUnavailable,
      loadedTile: false,
      tileErrors: 0,
      unavailableSent: false,
      fallbackTimer: null,
      resizeFrame: null,
      resizeObserver: null,
      destroyed: false
    };
    maps.set(container, state);

    const tiles = window.L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19
    });
    tiles.on("tileload", () => {
      state.loadedTile = true;
      if (state.fallbackTimer != null) {
        window.clearTimeout(state.fallbackTimer);
        state.fallbackTimer = null;
      }
    });
    tiles.on("tileerror", () => {
      state.tileErrors += 1;
      if (state.loadedTile || state.unavailableSent || state.tileErrors < 3 || state.fallbackTimer != null) return;
      state.fallbackTimer = window.setTimeout(() => {
        state.fallbackTimer = null;
        if (state.destroyed || state.loadedTile || state.unavailableSent || state.tileErrors < 3) return;
        state.unavailableSent = true;
        state.onUnavailable?.();
      }, 1000);
    });
    tiles.addTo(map);
    initialView(map, catalog);
    if (typeof ResizeObserver !== "undefined") {
      state.resizeObserver = new ResizeObserver(() => scheduleResize(state));
      state.resizeObserver.observe(container);
    }
  } else {
    state.onSelect = onSelect;
    state.onUnavailable = onUnavailable;
  }

  syncAreas(state, catalog, visibleIds);
  syncMarkers(state, catalog, visibleIds);
  scheduleResize(state);
  return state.map;
}

export function destroyLiveAtlasMap(container) {
  const state = maps.get(container);
  if (!state) return;
  state.destroyed = true;
  state.resizeObserver?.disconnect();
  if (state.resizeFrame != null) window.cancelAnimationFrame(state.resizeFrame);
  if (state.fallbackTimer != null) window.clearTimeout(state.fallbackTimer);
  state.map.remove();
  maps.delete(container);
}
