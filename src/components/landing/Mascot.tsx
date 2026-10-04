/**
 * The KAMIX mascot: the app mark (a receipt with the two side notches) given a
 * friendly face. Pure SVG + CSS animation (blink, bob, wave), so it is part of
 * the server-rendered page and costs no JS. Decorative only.
 */
import { useId } from "react";

export function Mascot({
  className = "",
  wave = true,
}: {
  className?: string;
  /** Show the waving arm. */
  wave?: boolean;
}) {
  const uid = `km${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      viewBox="0 0 140 150"
      className={`kx-mascot ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-body`}
          x1="20"
          y1="8"
          x2="118"
          y2="124"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8fbaff" />
          <stop offset="40%" stopColor="#4f7dff" />
          <stop offset="75%" stopColor="#5a4fff" />
          <stop offset="100%" stopColor="#7c4dff" />
        </linearGradient>
        <radialGradient id={`${uid}-shine`} cx="0.3" cy="0.18" r="0.7">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="60%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${uid}-cut`}>
          <rect width="140" height="150" fill="#000" />
          <rect x="24" y="12" width="92" height="106" rx="32" fill="#fff" />
          <circle cx="24" cy="48" r="9" fill="#000" />
          <circle cx="24" cy="82" r="9" fill="#000" />
        </mask>
      </defs>

      <ellipse
        className="kx-mascot-shadow"
        cx="70"
        cy="140"
        rx="34"
        ry="5"
        fill="#1e1b4b"
        opacity="0.12"
      />

      <g className="kx-mascot-bob">
        {wave && (
          <g className="kx-mascot-arm">
            <path
              d="M112 74 C126 66 130 52 126 42"
              fill="none"
              stroke="#5a4fff"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <circle cx="126" cy="40" r="7.5" fill="#7c6bff" />
          </g>
        )}
        <g mask={`url(#${uid}-cut)`}>
          <rect x="24" y="12" width="92" height="106" rx="32" fill={`url(#${uid}-body)`} />
          <rect x="24" y="12" width="92" height="106" rx="32" fill={`url(#${uid}-shine)`} />
          {/* receipt lines on the belly */}
          <g stroke="#fff" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round">
            <path d="M52 94h36" />
            <path d="M58 104h24" />
          </g>
        </g>

        {/* face */}
        <g className="kx-mascot-eyes">
          <ellipse cx="56" cy="56" rx="9" ry="10.5" fill="#fff" />
          <ellipse cx="86" cy="56" rx="9" ry="10.5" fill="#fff" />
          <circle cx="58" cy="58" r="4.6" fill="#1b1846" />
          <circle cx="88" cy="58" r="4.6" fill="#1b1846" />
          <circle cx="59.6" cy="56" r="1.6" fill="#fff" />
          <circle cx="89.6" cy="56" r="1.6" fill="#fff" />
        </g>
        <circle cx="46" cy="72" r="5.5" fill="#ff8fb1" opacity="0.55" />
        <circle cx="96" cy="72" r="5.5" fill="#ff8fb1" opacity="0.55" />
        <path
          d="M61 73 Q71 82 81 73"
          fill="none"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
