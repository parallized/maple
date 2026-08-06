import { useEffect, useRef, useState } from "react";

/**
 * FoldText（reactbits fold-text 风格）：大文字进入视口时逐字 3D 折起展开。
 * - 按字切分（Array.from 兼容 CJK），rotateX(-92deg) → 0 依次展开，
 *   transform-origin 底部、父级 700px 透视，纸张翻开感；
 * - IntersectionObserver 只触发一次；prefers-reduced-motion 直接呈现终态。
 * 纯 CSS transition，无依赖；用于落地页大标题与收尾陈述。
 */

export function FoldText({
  text,
  className = "",
  stagger = 42,
  startDelay = 0
}: {
  text: string;
  className?: string;
  /** 逐字间隔 ms */
  stagger?: number;
  /** 首字延迟 ms（多行接力时用） */
  startDelay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span ref={ref} aria-label={text} className={className} style={{ display: "inline-block", perspective: "700px" }}>
      {Array.from(text).map((ch, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block will-change-transform"
          style={{
            transform: shown ? "rotateX(0deg)" : "rotateX(-92deg)",
            opacity: shown ? 1 : 0,
            transformOrigin: "50% 100%",
            transition: `transform 0.7s cubic-bezier(0.2,0.7,0.3,1) ${startDelay + i * stagger}ms, opacity 0.45s ease ${startDelay + i * stagger}ms`,
            whiteSpace: ch === " " ? "pre" : undefined
          }}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
