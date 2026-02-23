import { motion, useMotionValue, useSpring, useInView, animate } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode, type MouseEvent, type KeyboardEvent, type PointerEvent } from "react";

/* ── CurvedLoop ── */

export function CurvedLoop({
  text,
  className = "",
  speed = 10,
  radius = 50,
  fontSize = "12px",
  color = "currentColor",
}: {
  text: string;
  className?: string;
  speed?: number;
  radius?: number;
  fontSize?: string;
  color?: string;
}) {
  const repeatedText = `${text} • `.repeat(8);

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ width: radius * 2, height: radius * 2 }}>
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        animate={{ rotate: 360 }}
        transition={{ duration: speed, repeat: Infinity, ease: "linear" }}
      >
        <svg width={radius * 2} height={radius * 2} viewBox={`0 0 ${radius * 2} ${radius * 2}`}>
          <defs>
            <path
              id="curved-path"
              d={`M ${radius}, ${radius} m -${radius * 0.8}, 0 a ${radius * 0.8},${radius * 0.8} 0 1,1 ${radius * 1.6},0 a ${radius * 0.8},${radius * 0.8} 0 1,1 -${radius * 1.6},0`}
            />
          </defs>
          <text fill={color} style={{ fontSize, fontWeight: 500, letterSpacing: "0.1em" }}>
            <textPath xlinkHref="#curved-path">
              {repeatedText}
            </textPath>
          </text>
        </svg>
      </motion.div>
    </div>
  );
}

/* ── FallingText ── */

export { FallingText } from "./reactbits/FallingText";

/* ── SplitText ── */

export function SplitText({ text, className, delay = 30 }: { text: string; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  return (
    <span ref={ref} className={className}>
      {text.split("").map((char, i) => (
        <motion.span
          key={`${char}-${i}`}
          initial={{ opacity: 0, y: 8 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.3, delay: i * (delay / 1000) }}
          style={{ display: "inline-block" }}
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </span>
  );
}

/* ── CountUp ── */

export function CountUp({ from = 0, to, duration = 0.6 }: { from?: number; to: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [display, setDisplay] = useState(from);

  useEffect(() => {
    if (!isInView) return;
    const controls = animate(from, to, {
      duration,
      onUpdate: (v) => setDisplay(Math.round(v))
    });
    return () => controls.stop();
  }, [isInView, from, to, duration]);

  return <span ref={ref}>{display}</span>;
}

/* ── FadeContent ── */

export function FadeContent({ children, blur = false, duration = 0.3, delay = 0, className }: { children: ReactNode; blur?: boolean; duration?: number; delay?: number; className?: string }) {
  const durationSeconds = duration > 10 ? duration / 1000 : duration;
  const delaySeconds = delay > 10 ? delay / 1000 : delay;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, filter: blur ? "blur(4px)" : "none", y: 10 }}
      animate={{ opacity: 1, filter: blur ? "blur(0px)" : "none", y: 0 }}
      transition={{ duration: durationSeconds, delay: delaySeconds }}
    >
      {children}
    </motion.div>
  );
}

/* ── SpotlightCard ── */

export function SpotlightCard({
  children,
  className,
  spotlightColor = "rgba(47, 111, 179, 0.12)"
}: {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const smoothX = useSpring(x, { stiffness: 300, damping: 30 });
  const smoothY = useSpring(y, { stiffness: 300, damping: 30 });
  const [hovering, setHovering] = useState(false);

  function handleMouse(e: MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      onMouseMove={handleMouse}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: "relative",
        overflow: "hidden"
      }}
    >
      <motion.div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: hovering
            ? `radial-gradient(300px circle at ${smoothX.get()}px ${smoothY.get()}px, ${spotlightColor}, transparent 70%)`
            : "none",
          opacity: hovering ? 1 : 0,
          transition: "opacity 0.2s"
        }}
        // Re-render on spring change
        animate={{ x: smoothX.get(), y: smoothY.get() }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </motion.div>
  );
}

/* ── TiltedCard ── */

export function TiltedCard({
  children,
  className,
  rotateAmplitude = 12,
  scaleOnHover = 1.02,
  spotlightColor = "rgba(255, 255, 255, 0.12)",
  onClick,
  style
}: {
  children: ReactNode;
  className?: string;
  rotateAmplitude?: number;
  scaleOnHover?: number;
  spotlightColor?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useMotionValue(0), { stiffness: 100, damping: 30 });
  const rotateY = useSpring(useMotionValue(0), { stiffness: 100, damping: 30 });
  const scale = useSpring(1, { stiffness: 100, damping: 30 });
  const opacity = useMotionValue(0);

  function handleMouseMove(e: MouseEvent) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const rX = (mouseY / height - 0.5) * -rotateAmplitude;
    const rY = (mouseX / width - 0.5) * rotateAmplitude;

    rotateX.set(rX);
    rotateY.set(rY);
    x.set(mouseX);
    y.set(mouseY);
  }

  function handleMouseEnter() {
    scale.set(scaleOnHover);
    opacity.set(1);
  }

  function handleMouseLeave() {
    scale.set(1);
    rotateX.set(0);
    rotateY.set(0);
    opacity.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        position: "relative",
        transformStyle: "preserve-3d",
        rotateX,
        rotateY,
        scale,
        cursor: onClick ? "pointer" : "default",
        ...style
      }}
    >
      {children}
    </motion.div>
  );
}

/* ── ClickSpark ── */

type ClickSparkPoint = {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
};

export function ClickSpark({
  children,
  className,
  disabled = false,
  sparkColor = "var(--color-primary)"
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  sparkColor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sparks, setSparks] = useState<ClickSparkPoint[]>([]);
  const nextIdRef = useRef(0);

  function emitSparkAt(x: number, y: number) {
    const count = 8;

    const created: ClickSparkPoint[] = Array.from({ length: count }, (_, idx) => {
      const angle = (Math.PI * 2 * idx) / count + Math.random() * 0.28;
      const distance = 16 + Math.random() * 16;
      const id = nextIdRef.current + idx + 1;
      return {
        id,
        x,
        y,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        size: 2 + Math.random() * 2
      };
    });
    nextIdRef.current += count;
    setSparks((prev) => [...prev, ...created]);
    window.setTimeout(() => {
      setSparks((prev) => prev.filter((spark) => !created.some((item) => item.id === spark.id)));
    }, 520);
  }

  function emitSpark(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    emitSparkAt(x, y);
  }

  function emitSparkFromFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key !== "Enter" && event.key !== "NumpadEnter") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.repeat) return;

    const hostRect = ref.current?.getBoundingClientRect();
    if (!hostRect) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !ref.current?.contains(focused)) return;
    const rect = focused.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - hostRect.left;
    const y = rect.top + rect.height / 2 - hostRect.top;
    emitSparkAt(x, y);
  }

  return (
    <div
      ref={ref}
      className={className}
      onPointerDownCapture={emitSpark}
      onKeyDownCapture={emitSparkFromFocus}
      style={{ position: "relative", width: "100%" }}
    >
      {children}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "visible"
        }}
      >
        {sparks.map((spark) => (
          <motion.span
            key={spark.id}
            initial={{ opacity: 0.9, scale: 1, x: spark.x, y: spark.y }}
            animate={{ opacity: 0, scale: 0.2, x: spark.x + spark.dx, y: spark.y + spark.dy }}
            transition={{ duration: 0.5, ease: [0.2, 0.8, 0.3, 1] }}
            style={{
              position: "absolute",
              width: spark.size,
              height: spark.size,
              borderRadius: "999px",
              background: sparkColor,
              boxShadow: `0 0 8px ${sparkColor}`,
              transform: "translate(-50%, -50%)"
            }}
          />
        ))}
      </div>
    </div>
  );
}
