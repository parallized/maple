import { motion, useMotionValue, useSpring, useInView, animate } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";

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

export function FadeContent({ children, blur = false, duration = 0.3 }: { children: ReactNode; blur?: boolean; duration?: number }) {
  const durationSeconds = duration > 10 ? duration / 1000 : duration;
  return (
    <motion.div
      initial={{ opacity: 0, filter: blur ? "blur(4px)" : "none" }}
      animate={{ opacity: 1, filter: blur ? "blur(0px)" : "none" }}
      transition={{ duration: durationSeconds }}
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
