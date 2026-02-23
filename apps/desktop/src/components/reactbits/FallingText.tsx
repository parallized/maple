import React, { useEffect, useRef, useState } from "react";
import Matter from "matter-js";

interface FallingTextProps {
  text: string;
  className?: string;
  fontSize?: string;
  fontFamily?: string;
  gravity?: number;
  friction?: number;
  restitution?: number;
  colors?: string[];
}

export function FallingText({
  text,
  className = "",
  fontSize = "1.5rem",
  fontFamily = "serif",
  gravity = 0.5,
  friction = 0.1,
  restitution = 0.5,
  colors = ["#f59e0b", "#d97706", "#b45309"], // 使用橙黄色系
}: FallingTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const [words, setWords] = useState<Array<{ text: string; body: Matter.Body; color: string }>>([]);
  const [, setFrame] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const { Engine, Runner, Bodies, Composite, Mouse, MouseConstraint } = Matter;

    const engine = Engine.create();
    engine.gravity.y = gravity;
    engineRef.current = engine;

    // 获取实际尺寸，带兜底
    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    const runner = Runner.create();
    runnerRef.current = runner;
    Runner.run(runner, engine);

    // Boundaries - 稍微加宽一点防止边缘切断
    const thickness = 100;
    const ground = Bodies.rectangle(width / 2, height + thickness / 2, width * 2, thickness, { isStatic: true });
    const leftWall = Bodies.rectangle(-thickness / 2, height / 2, thickness, height * 2, { isStatic: true });
    const rightWall = Bodies.rectangle(width + thickness / 2, height / 2, thickness, height * 2, { isStatic: true });
    Composite.add(engine.world, [ground, leftWall, rightWall]);

    // Create words
    const textArray = text.split(/\s+/);
    const wordBodies: Array<{ text: string; body: Matter.Body; color: string }> = [];

    textArray.forEach((word, i) => {
      // 随机化初始位置，让一部分文字已经在屏幕内，一部分在上方排队
      const x = Math.random() * width;
      const y = (Math.random() * height) - height; // 范围从 -height 到 0，确保立即有文字出现
      
      // 估计单词宽度进行碰撞检测
      const wordWidth = word.length * 12 + 15;
      const body = Bodies.rectangle(x, y, wordWidth, 28, {
        friction,
        restitution,
        label: word,
        angle: (Math.random() - 0.5) * 0.5,
      });
      const color = colors[Math.floor(Math.random() * colors.length)]!;
      wordBodies.push({ text: word, body, color });
    });

    Composite.add(engine.world, wordBodies.map((w) => w.body));
    setWords(wordBodies);

    // Mouse control
    const mouse = Mouse.create(containerRef.current);
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: {
        stiffness: 0.1,
        render: { visible: false },
      },
    });
    Composite.add(engine.world, mouseConstraint);

    // Update positions
    let rafId: number;
    const update = () => {
      setFrame((f) => f + 1);
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(rafId);
      Engine.clear(engine);
      if (runnerRef.current) Runner.stop(runnerRef.current);
    };
  }, [text, gravity, friction, restitution, colors]);

  return (
    <div ref={containerRef} className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} style={{ zIndex: 0 }}>
      {words.map((w, i) => {
        const { x, y } = w.body.position;
        const angle = w.body.angle;
        return (
          <div
            key={`${w.text}-${i}`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${angle}rad)`,
              fontSize,
              fontFamily,
              color: w.color,
              whiteSpace: "nowrap",
              userSelect: "none",
              pointerEvents: "none",
              willChange: "transform",
            }}
          >
            {w.text}
          </div>
        );
      })}
    </div>
  );
}
