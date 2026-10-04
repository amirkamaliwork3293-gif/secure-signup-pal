import { useId } from "react";

/** The KAMIX app mark (same artwork as the app icon), unique gradient ids per instance. */
export function KamixMark({ className = "" }: { className?: string }) {
  const uid = `kx${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient
          id={`${uid}-bg`}
          x1="10"
          y1="4"
          x2="40"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#9ec4ff" />
          <stop offset="38%" stopColor="#4f8cff" />
          <stop offset="72%" stopColor="#5a5bff" />
          <stop offset="100%" stopColor="#7a4dff" />
        </linearGradient>
        <radialGradient id={`${uid}-shine`} cx="0.28" cy="0.2" r="0.78">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${uid}-cut`}>
          <rect width="48" height="48" fill="black" />
          <rect x="8.5" y="5.5" width="32" height="37" rx="11.5" fill="white" />
          <circle cx="8.5" cy="17.4" r="3.55" fill="black" />
          <circle cx="8.5" cy="30.6" r="3.55" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${uid}-cut)`}>
        <rect x="8.5" y="5.5" width="32" height="37" rx="11.5" fill={`url(#${uid}-bg)`} />
        <rect x="8.5" y="5.5" width="32" height="37" rx="11.5" fill={`url(#${uid}-shine)`} />
        <path
          d="M19.1 14.1h3.7v6.35L31.15 14.1h4.35L25.2 23.05 35.85 33.7h-4.55L22.8 25.05v8.65h-3.7Z"
          fill="#1a2744"
          opacity="0.22"
          transform="translate(0 0.65)"
        />
        <path
          d="M19.1 14.1h3.7v6.35L31.15 14.1h4.35L25.2 23.05 35.85 33.7h-4.55L22.8 25.05v8.65h-3.7Z"
          fill="#ffffff"
        />
      </g>
    </svg>
  );
}
