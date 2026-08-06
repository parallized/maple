import { useEffect, useId, useMemo, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import {
  MAX_SCROLL_CURL_STRENGTH,
  type ScrollCurlFrame,
  type ScrollCurlMotion
} from "./scroll-curl-motion";

interface ScrollCurlSurfaceProps {
  children: ReactNode;
  motion: ScrollCurlMotion;
  viewportRef: RefObject<HTMLElement>;
  className?: string;
}

const DISPLACEMENT_MAP_SIZE = 256;
const FILTER_IDLE_EPSILON = 0.000002;
// 卷曲只落在视口上下各 12% 的边缘带内,中间 76% 完全平整。
// 带内沿用圆形剖面(1 - √(1 - t²)),起点导数为 0,与平整区无缝衔接。
const CURL_EDGE_BAND = 0.12;
let displacementMapUrl: string | null = null;

function getDisplacementMapUrl(): string {
  if (displacementMapUrl) return displacementMapUrl;

  const canvas = document.createElement("canvas");
  canvas.width = DISPLACEMENT_MAP_SIZE;
  canvas.height = DISPLACEMENT_MAP_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return "";

  const image = context.createImageData(DISPLACEMENT_MAP_SIZE, DISPLACEMENT_MAP_SIZE);
  for (let y = 0; y < DISPLACEMENT_MAP_SIZE; y += 1) {
    const screenY = (y + 0.5) / DISPLACEMENT_MAP_SIZE;
    const centeredY = 2 * screenY - 1;
    // 把 |centeredY| 从 [1-2*band, 1] 重映射到 [0, 1],带外恒为 0(不平移)
    const edgeT = Math.max(
      0,
      Math.min((Math.abs(centeredY) - (1 - CURL_EDGE_BAND * 2)) / (CURL_EDGE_BAND * 2), 1)
    );
    const profile = 1 - Math.sqrt(Math.max(0, 1 - edgeT * edgeT));

    for (let x = 0; x < DISPLACEMENT_MAP_SIZE; x += 1) {
      const screenX = (x + 0.5) / DISPLACEMENT_MAP_SIZE;
      const displacement = 0.5 + (0.5 - screenX) * profile;
      const offset = (y * DISPLACEMENT_MAP_SIZE + x) * 4;
      image.data[offset] = Math.round(Math.max(0, Math.min(displacement, 1)) * 255);
      image.data[offset + 1] = 128;
      image.data[offset + 2] = 128;
      image.data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  displacementMapUrl = canvas.toDataURL("image/png");
  return displacementMapUrl;
}

export function ScrollCurlSurface({
  children,
  motion,
  viewportRef,
  className = ""
}: ScrollCurlSurfaceProps) {
  const generatedId = useId();
  const filterId = useMemo(
    () => `maple-scroll-curl-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [generatedId]
  );
  const mapUrl = useMemo(() => getDisplacementMapUrl(), []);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<SVGFilterElement>(null);
  const mapRef = useRef<SVGFEImageElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    const filter = filterRef.current;
    const map = mapRef.current;
    const displacement = displacementRef.current;
    const viewport = viewportRef.current;
    if (!surface || !filter || !map || !displacement || !viewport || !mapUrl) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let filterActive = false;

    const disableFilter = () => {
      displacement.setAttribute("scale", "0");
      surface.dataset.scrollCurlStrength = "0";
      if (!filterActive) return;
      surface.style.filter = "none";
      filterActive = false;
    };

    const syncGeometry = (frame: ScrollCurlFrame) => {
      if (motionPreference.matches || frame.strength <= FILTER_IDLE_EPSILON) {
        disableFilter();
        return;
      }

      const surfaceRect = surface.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const viewportWidth = Math.max(1, viewport.clientWidth || viewportRect.width);
      const viewportHeight = Math.max(1, viewport.clientHeight || viewportRect.height);
      const surfaceLeft = surfaceRect.left - viewportRect.left;
      const surfaceTop = surfaceRect.top - viewportRect.top;
      const padding = Math.ceil(Math.max(48, viewportWidth * MAX_SCROLL_CURL_STRENGTH));

      filter.setAttribute("x", String(-padding));
      filter.setAttribute("y", String(-padding));
      filter.setAttribute("width", String(surfaceRect.width + padding * 2));
      filter.setAttribute("height", String(surfaceRect.height + padding * 2));

      // Position the same displacement map over the viewport for every surface.
      // This keeps the curve continuous in screen space instead of bending each card locally.
      map.setAttribute("x", String(-surfaceLeft));
      map.setAttribute("y", String(-surfaceTop));
      map.setAttribute("width", String(viewportWidth));
      map.setAttribute("height", String(viewportHeight));
      displacement.setAttribute("x", String(-padding));
      displacement.setAttribute("y", String(-padding));
      displacement.setAttribute("width", String(surfaceRect.width + padding * 2));
      displacement.setAttribute("height", String(surfaceRect.height + padding * 2));
      displacement.setAttribute("scale", String(viewportWidth * frame.strength));

      surface.dataset.scrollCurlStrength = frame.strength.toFixed(5);
      if (!filterActive) {
        surface.style.filter = `url(#${filterId})`;
        filterActive = true;
      }
    };

    const unsubscribe = motion.subscribe(syncGeometry);
    const onMotionPreferenceChange = () => {
      if (motionPreference.matches) disableFilter();
    };
    motionPreference.addEventListener("change", onMotionPreferenceChange);

    return () => {
      unsubscribe();
      motionPreference.removeEventListener("change", onMotionPreferenceChange);
      disableFilter();
    };
  }, [filterId, mapUrl, motion, viewportRef]);

  return (
    <div className={`relative ${className}`}>
      <svg
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      >
        <defs>
          <filter
            ref={filterRef}
            id={filterId}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              ref={mapRef}
              href={mapUrl}
              preserveAspectRatio="none"
              result="curl-map"
            />
            <feDisplacementMap
              ref={displacementRef}
              in="SourceGraphic"
              in2="curl-map"
              scale="0"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div
        ref={surfaceRef}
        data-scroll-curl-surface="true"
        data-scroll-curl-strength="0"
        className="relative"
        style={{ filter: "none", willChange: "filter" }}
      >
        {children}
      </div>
    </div>
  );
}
