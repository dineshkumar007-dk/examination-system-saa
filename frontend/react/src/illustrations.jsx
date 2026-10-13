import React from "react";

export function Icon({ name = "file", size = 22 }) {
  const paths = {
    person: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2Z" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" />
      </>
    ),
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-8h6v8" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6Z" />
        <path d="M14 3v5h4M9 12h6M9 16h6" />
      </>
    ),
    ticket: (
      <>
        <path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Z" />
        <path d="M9 7v12" strokeDasharray="2 2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20h16M6 17v-6h3v6M12 17V7h3v10M18 17V3h3v14" />
      </>
    ),
    bell: (
      <>
        <path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4ZM10 21h4M12 2v2" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1v4l-2 1 2 1v4l3 1 1 3h6l1-3 3-1v-4l2-1-2-1V7l-3-1-1-3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 18h2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6l4 2" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    monitor: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    cap: (
      <>
        <path d="m2 9 10-5 10 5-10 5ZM6 11v6c4 3 8 3 12 0v-6M22 9v8" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}

// Original vector illustrations; no remote images or personal photos are used.
export function Avatar({ gender, scene = false, className = "" }) {
  const female = gender === "female",
    male = gender === "male";
  const label = female
    ? "Female profile illustration"
    : male
      ? "Male profile illustration"
      : "Profile illustration";
  return (
    <svg
      className={`profile-illustration ${className}`}
      viewBox={scene ? "0 0 240 180" : "0 0 160 160"}
      role="img"
      aria-label={label}
    >
      {scene && (
        <>
          <path
            d="M0 158c30-45 42-105 107-87s65-8 133-49v158H0Z"
            fill="#f4e8fa"
          />
          <path d="M18 159c-4-40 15-63 20-78 15 39 6 64-20 78" fill="#dbe6fa" />
          <path d="M27 164c0-34 30-43 42-52-2 30-22 47-42 52" fill="#d9d5f4" />
          <circle cx="194" cy="64" r="22" fill="#e6d6f6" />
          <circle cx="185" cy="64" r="3" fill="white" />
          <circle cx="194" cy="64" r="3" fill="white" />
          <circle cx="203" cy="64" r="3" fill="white" />
        </>
      )}
      <g transform={scene ? "translate(43 17) scale(.92)" : undefined}>
        <circle
          cx="80"
          cy="80"
          r="76"
          fill={female ? "#f0dcf4" : male ? "#e2e9fa" : "#ece6f7"}
        />
        {!female && !male ? (
          <>
            <circle cx="80" cy="65" r="25" fill="#b7a5d4" />
            <path d="M30 145v-13a50 50 0 0 1 100 0v13" fill="#9980c0" />
          </>
        ) : (
          <>
            {female && (
              <path
                d="M37 74C33 16 118 7 126 72l7 57-21 15H45l-18-18Z"
                fill="#382436"
              />
            )}
            <path
              d="M31 149c2-34 25-46 49-46s48 12 50 46Z"
              fill={female ? "#a579ce" : "#7695cf"}
            />
            <path d="M68 91h24v25c-5 10-18 10-24 0Z" fill="#efb2a4" />
            <ellipse cx="50" cy="73" rx="6" ry="9" fill="#f6c4b4" />
            <ellipse cx="110" cy="73" rx="6" ry="9" fill="#f6c4b4" />
            <path
              d="M51 50q29-25 58 0v29c-2 30-24 34-29 34S53 102 51 79Z"
              fill="#ffd2bf"
            />
            {female ? (
              <path
                d="M46 66c-7-28 6-48 31-47 25-5 42 19 38 50-21-2-33-17-36-28-5 13-17 21-33 25"
                fill="#382436"
              />
            ) : (
              <path
                d="M48 65c-9-23 2-46 31-46 33-4 40 18 34 47l-9-15c-15 8-28-1-34-7l-15 19Z"
                fill="#34354c"
              />
            )}
            <ellipse cx="66" cy="75" rx="3" ry="4" fill="#40303d" />
            <ellipse cx="94" cy="75" rx="3" ry="4" fill="#40303d" />
            <path
              d="m79 80-2 7h5"
              fill="none"
              stroke="#da9789"
              strokeLinecap="round"
            />
            <path
              d="M71 94q9 7 18 0"
              fill="none"
              stroke="#b86476"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <ellipse
              cx="60"
              cy="88"
              rx="7"
              ry="3"
              fill="#f0abac"
              opacity=".6"
            />
            <ellipse
              cx="100"
              cy="88"
              rx="7"
              ry="3"
              fill="#f0abac"
              opacity=".6"
            />
            <path
              d="m54 130-4 19M106 130l4 19"
              stroke={female ? "#8861b3" : "#587eb7"}
              strokeWidth="2"
            />
          </>
        )}
      </g>
      {scene && (
        <>
          <path d="M125 132h72l-14 42h-72Z" fill="#7785bd" />
          <path
            d="M94 174h91"
            stroke="#586ba9"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="157" cy="153" r="5" fill="#dce3fa" />
        </>
      )}
    </svg>
  );
}
