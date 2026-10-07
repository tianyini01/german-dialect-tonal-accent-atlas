import { languageColor } from "./map-palette.mjs";
import { contrastBasisClass, contrastSymbol } from "./typology-map.mjs?v=22";
import { boundaryColor, publishedBoundaries } from "./boundary-map.mjs?v=22";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 720;
const HEIGHT = 580;
const WEST = 0;
const EAST = 19;
const SOUTH = 46;
const NORTH = 56;
const PAD_X = 30;
const PAD_Y = 28;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const viewport = { scale: 1, centerX: .5, centerY: .5 };
const controllers = new WeakMap();
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function project(longitude, latitude) {
  return [
    PAD_X + (longitude - WEST) / (EAST - WEST) * (WIDTH - PAD_X * 2),
    PAD_Y + (NORTH - latitude) / (NORTH - SOUTH) * (HEIGHT - PAD_Y * 2)
  ];
}

function svg(name, attributes = {}, label = "") {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (label) node.textContent = label;
  return node;
}

function ringsFor(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function pathFor(geometry) {
  return ringsFor(geometry).map(ring => ring.map((coordinate, index) => {
    const [x, y] = project(coordinate[0], coordinate[1]);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z").join(" ");
}

export function renderAtlasMap(container, entries, visibleIds, basemap, onSelect, boundaries = null) {
  controllers.get(container)?.abort();
  container.replaceChildren();
  container.tabIndex = 0;
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Interactive map of study localities. Drag to pan; scroll, pinch, or use the buttons to zoom.");
  const map = svg("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img", "aria-label": "Map of study localities in and around Germany" });
  map.append(svg("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: "#e9f2f5" }));
  [48, 50, 52, 54].forEach(latitude => {
    const [, y] = project(0, latitude);
    map.append(svg("line", { x1: PAD_X, x2: WIDTH - PAD_X, y1: y, y2: y, stroke: "#d1e1e7", "stroke-width": 1 }));
    map.append(svg("text", { x: 7, y: y - 4, fill: "#8ca8b4", "font-size": 11 }, `${latitude}°N`));
  });
  [4, 8, 12, 16].forEach(longitude => {
    const [x] = project(longitude, 50);
    map.append(svg("line", { x1: x, x2: x, y1: PAD_Y, y2: HEIGHT - PAD_Y, stroke: "#d1e1e7", "stroke-width": 1 }));
    map.append(svg("text", { x: x + 4, y: HEIGHT - 9, fill: "#8ca8b4", "font-size": 11 }, `${longitude}°E`));
  });
  if (basemap?.features) {
    basemap.features.forEach(feature => {
      const name = feature.properties?.name || feature.properties?.ADMIN || feature.properties?.NAME || "";
      map.append(svg("path", {
        d: pathFor(feature.geometry),
        fill: name === "Germany" ? "#d3e3e8" : "#edf3f4",
        stroke: "#a9c1c9",
        "stroke-width": name === "Germany" ? 1.8 : 1.1,
        "fill-rule": "evenodd",
        "vector-effect": "non-scaling-stroke"
      }));
    });
  }
  entries.forEach(entry => {
    if (!entry.map?.distributionGeometry || !entry.map?.distributionSource) return;
    const color = languageColor(entry.family);
    map.append(svg("path", {
      d: pathFor(entry.map.distributionGeometry),
      fill: color,
      "fill-opacity": visibleIds.has(entry.id) ? .28 : .08,
      stroke: color,
      "stroke-opacity": visibleIds.has(entry.id) ? .85 : .2,
      "stroke-width": 1.5,
      "fill-rule": "evenodd",
      "vector-effect": "non-scaling-stroke"
    }));
  });
  publishedBoundaries(boundaries).forEach(feature => {
    const d = feature.geometry.coordinates.map(([longitude, latitude], index) => {
      const [x, y] = project(longitude, latitude);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const line = svg("path", { d, fill: "none", stroke: boundaryColor, "stroke-width": 2.5,
      "stroke-dasharray": "7 6", "vector-effect": "non-scaling-stroke" });
    line.append(svg("title", {}, `${feature.properties.name}. ${feature.properties.description}`));
    map.append(line);
  });
  const labels = [
    ["GERMANY", 11.3, 50.7], ["NETHERLANDS", 4.7, 52.5],
    ["BELGIUM", 4.3, 50.0], ["FRANCE", 2.6, 47.8],
    ["POLAND", 16.6, 52.2], ["DENMARK", 9.8, 55.0]
  ];
  labels.forEach(([name, longitude, latitude]) => {
    const [x, y] = project(longitude, latitude);
    map.append(svg("text", { x, y, fill: "#91aab3", "font-size": 12, "font-weight": 700, "letter-spacing": 1.5, "text-anchor": "middle", "pointer-events": "none" }, name));
  });
  container.append(map);
  const markers = document.createElement("div");
  markers.className = "map-markers";
  const suppressedMarkerClicks = new WeakMap();
  const points = entries.flatMap(entry => {
    const { latitude, longitude } = entry.map || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const [x, y] = project(longitude, latitude);
    return [{ entry, x, y }];
  });
  const markerPositions = [];
  points.forEach(({ entry, x, y }, index) => {
    const crowded = points.some((other, otherIndex) => otherIndex !== index && Math.abs(other.x - x) < 145 && Math.abs(other.y - y) < 28);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `map-marker${visibleIds.has(entry.id) ? "" : " muted"}${crowded ? " compact" : ""}`;
    button.style.setProperty("--marker-color", languageColor(entry.family));
    button.setAttribute("aria-label", `${entry.title}, ${entry.family || "unspecified language group"}, ${entry.place}; ${entry.typology?.contrast || "classification pending"}; ${entry.measurementSets?.length ? "view measurements" : "view published profile"}`);
    button.title = `${entry.title} · ${entry.typology?.contrast || "classification pending"}`;
    const dot = document.createElement("span");
    dot.className = `map-dot ${contrastBasisClass(entry)}`;
    dot.textContent = contrastSymbol(entry);
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "map-label";
    label.textContent = entry.title;
    button.append(dot, label);
    button.addEventListener("click", event => {
      if (event.detail > 0 && performance.now() < (suppressedMarkerClicks.get(button) || 0)) {
        event.preventDefault();
        return;
      }
      onSelect(entry);
    });
    markers.append(button);
    markerPositions.push({ button, x, y });
  });
  container.append(markers);

  const controls = document.createElement("div");
  controls.className = "map-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Map zoom controls");
  const control = (label, text, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", action);
    controls.append(button);
    return button;
  };
  const zoomIn = control("Zoom in map", "+", zoomTowardLocality);
  const zoomOut = control("Zoom out map", "−", () => zoomAt(1 / 1.5));
  const reset = control("Reset map view", "Reset", () => setView(1, 0, 0));
  container.append(controls);

  function dimensions() {
    return { width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight) };
  }
  function currentTransform() {
    const { width, height } = dimensions();
    const scale = viewport.scale;
    return {
      scale,
      x: clamp(width / 2 - viewport.centerX * width * scale, width * (1 - scale), 0),
      y: clamp(height / 2 - viewport.centerY * height * scale, height * (1 - scale), 0)
    };
  }
  function setView(scale, proposedX, proposedY) {
    const { width, height } = dimensions();
    scale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    const x = clamp(proposedX, width * (1 - scale), 0);
    const y = clamp(proposedY, height * (1 - scale), 0);
    viewport.scale = scale;
    viewport.centerX = (width / 2 - x) / (width * scale);
    viewport.centerY = (height / 2 - y) / (height * scale);
    map.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    markerPositions.forEach(marker => {
      const markerX = x + marker.x / WIDTH * width * scale;
      const markerY = y + marker.y / HEIGHT * height * scale;
      marker.button.style.left = `${markerX}px`;
      marker.button.style.top = `${markerY}px`;
      const inView = markerX >= 0 && markerX <= width && markerY >= 0 && markerY <= height;
      marker.button.style.visibility = inView ? "visible" : "hidden";
      marker.button.tabIndex = inView ? 0 : -1;
    });
    zoomIn.disabled = scale >= MAX_ZOOM - .001;
    zoomOut.disabled = scale <= MIN_ZOOM + .001;
    reset.disabled = scale <= MIN_ZOOM + .001;
  }
  function zoomAt(factor, x = container.clientWidth / 2, y = container.clientHeight / 2) {
    const previous = currentTransform();
    const scale = clamp(previous.scale * factor, MIN_ZOOM, MAX_ZOOM);
    const worldX = (x - previous.x) / previous.scale;
    const worldY = (y - previous.y) / previous.scale;
    setView(scale, x - worldX * scale, y - worldY * scale);
  }
  function zoomTowardLocality() {
    const { width, height } = dimensions();
    const transform = currentTransform();
    const visible = markerPositions.map(marker => ({
      x: transform.x + marker.x / WIDTH * width * transform.scale,
      y: transform.y + marker.y / HEIGHT * height * transform.scale
    })).filter(point => point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height);
    visible.sort((a, b) => Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2));
    if (visible.length) zoomAt(1.5, visible[0].x, visible[0].y);
    else zoomAt(1.5);
  }
  const initial = currentTransform();
  setView(initial.scale, initial.x, initial.y);

  const lifecycle = new AbortController();
  const pointers = new Map();
  let gesture = null;
  const relative = event => {
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function beginGesture() {
    const active = [...pointers.values()];
    const transform = currentTransform();
    if (active.length === 1) {
      gesture = { mode: "pan", point: active[0], x: transform.x, y: transform.y, scale: transform.scale };
    } else if (active.length >= 2) {
      const [a, b] = active;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture = {
        mode: "pinch",
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        scale: transform.scale,
        worldX: (midpoint.x - transform.x) / transform.scale,
        worldY: (midpoint.y - transform.y) / transform.scale
      };
    } else {
      gesture = null;
    }
  }
  container.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest(".map-controls")) return;
    const marker = event.target.closest(".map-marker");
    if (marker && event.pointerType !== "touch") return;
    const point = relative(event);
    const captureTarget = marker || container;
    pointers.set(event.pointerId, { ...point, marker, captureTarget });
    captureTarget.setPointerCapture(event.pointerId);
    container.classList.add("dragging");
    if (!marker) container.focus({ preventScroll: true });
    beginGesture();
    if (pointers.size > 1) {
      pointers.forEach(pointer => {
        if (pointer.marker) suppressedMarkerClicks.set(pointer.marker, performance.now() + 600);
      });
    }
    if (!marker) event.preventDefault();
  }, { signal: lifecycle.signal });
  container.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { ...previous, ...relative(event) });
    const active = [...pointers.values()];
    if (gesture?.mode === "pan" && active.length === 1) {
      if (Math.hypot(active[0].x - gesture.point.x, active[0].y - gesture.point.y) < 4) return;
      if (active[0].marker) suppressedMarkerClicks.set(active[0].marker, performance.now() + 600);
      setView(gesture.scale, gesture.x + active[0].x - gesture.point.x, gesture.y + active[0].y - gesture.point.y);
    } else if (gesture?.mode === "pinch" && active.length >= 2) {
      active.forEach(pointer => {
        if (pointer.marker) suppressedMarkerClicks.set(pointer.marker, performance.now() + 600);
      });
      const [a, b] = active;
      const scale = clamp(gesture.scale * Math.hypot(b.x - a.x, b.y - a.y) / gesture.distance, MIN_ZOOM, MAX_ZOOM);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setView(scale, midpoint.x - gesture.worldX * scale, midpoint.y - gesture.worldY * scale);
    }
  }, { signal: lifecycle.signal });
  const endPointer = event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointers.delete(event.pointerId)) return;
    if (pointer.captureTarget.hasPointerCapture(event.pointerId)) pointer.captureTarget.releasePointerCapture(event.pointerId);
    if (!pointers.size) container.classList.remove("dragging");
    beginGesture();
  };
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => container.addEventListener(type, endPointer, { signal: lifecycle.signal }));
  container.addEventListener("wheel", event => {
    if (event.target.closest(".map-controls")) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1);
    const factor = clamp(Math.exp(-pixels * .0014), .5, 2);
    const point = relative(event);
    zoomAt(factor, point.x, point.y);
  }, { passive: false, signal: lifecycle.signal });
  container.addEventListener("dblclick", event => {
    if (event.target.closest(".map-marker, .map-controls")) return;
    event.preventDefault();
    const point = relative(event);
    zoomAt(1.5, point.x, point.y);
  }, { signal: lifecycle.signal });
  container.addEventListener("keydown", event => {
    if (event.target !== container) return;
    const transform = currentTransform();
    if (event.key === "+" || event.key === "=") zoomAt(1.5);
    else if (event.key === "-" || event.key === "_") zoomAt(1 / 1.5);
    else if (event.key === "0") setView(1, 0, 0);
    else if (event.key === "ArrowLeft") setView(transform.scale, transform.x + 45, transform.y);
    else if (event.key === "ArrowRight") setView(transform.scale, transform.x - 45, transform.y);
    else if (event.key === "ArrowUp") setView(transform.scale, transform.x, transform.y + 45);
    else if (event.key === "ArrowDown") setView(transform.scale, transform.x, transform.y - 45);
    else return;
    event.preventDefault();
  }, { signal: lifecycle.signal });
  const observer = new ResizeObserver(() => {
    const transform = currentTransform();
    setView(transform.scale, transform.x, transform.y);
  });
  observer.observe(container);
  controllers.set(container, { abort: () => { lifecycle.abort(); observer.disconnect(); } });
}
