import { motion } from "framer-motion";

interface CurvedLoopProps {
  text: string;
  className?: string;
  speed?: number;
  radius?: number;
  fontSize?: string;
  color?: string;
}

export function CurvedLoop({
  text,
  className = "",
  speed = 10,
  radius = 50,
  fontSize = "12px",
  color = "currentColor",
}: CurvedLoopProps) {
  // 增加文本长度以确保循环平滑
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
