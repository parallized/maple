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
  colors = ["#94a3b8", "#64748b", "#475569"],
}: FallingTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const [words, setWords] = useState<Array<{ text: string; body: Matter.Body; color: string }>>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const { Engine, Render, Runner, Bodies, Composite, Mouse, MouseConstraint } = Matter;

    const engine = Engine.create();
    engine.gravity.y = gravity;
    engineRef.current = engine;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const runner = Runner.create();
    runnerRef.current = runner;
    Runner.run(runner, engine);

    // Boundaries
    const ground = Bodies.rectangle(width / 2, height + 50, width, 100, { isStatic: true });
    const leftWall = Bodies.rectangle(-50, height / 2, 100, height, { isStatic: true });
    const rightWall = Bodies.rectangle(width + 50, height / 2, 100, height, { isStatic: true });
    Composite.add(engine.world, [ground, leftWall, rightWall]);

    // Create words
    const textArray = text.split(/\s+/);
    const wordBodies: Array<{ text: string; body: Matter.Body; color: string }> = [];

    textArray.forEach((word, i) => {
      const x = Math.random() * width;
      const y = -Math.random() * height;
      const body = Bodies.rectangle(x, y, word.length * 15, 30, {
        friction,
        restitution,
        label: word,
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
        stiffness: 0.2,
        render: { visible: false },
      },
    });
    Composite.add(engine.world, mouseConstraint);

    // Update positions
    const update = () => {
      setWords((prev) => [...prev]);
      requestAnimationFrame(update);
    };
    const animId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animId);
      Engine.clear(engine);
      if (runnerRef.current) Runner.stop(runnerRef.current);
    };
  }, [text, gravity, friction, restitution, colors]);

  return (
    <div ref={containerRef} className={`absolute inset-0 pointer-events-auto ${className}`} style={{ zIndex: 0 }}>
      {words.map((w, i) => {
        const { x, y } = w.body.position;
        const angle = w.body.angle;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%, -50%) rotate(${angle}rad)`,
              fontSize,
              fontFamily,
              color: w.color,
              whiteSpace: "nowrap",
              userSelect: "none",
              pointerEvents: "none",
            }}
          >
            {w.text}
          </div>
        );
      })}
    </div>
  );
}
