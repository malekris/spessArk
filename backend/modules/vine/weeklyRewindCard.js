const XML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const escapeXml = (value) =>
  String(value || "").replace(/[&<>"']/g, (character) => XML_ENTITIES[character]);

const clampStat = (value) => Math.max(0, Math.round(Number(value || 0)));

export const getWeeklyRewindPeriod = (now = new Date()) => {
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 6);

  const weekStart = new Date(now);
  const day = weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() - (day === 0 ? 6 : day - 1));
  const weekKey = weekStart.toISOString().slice(0, 10);

  return { start, end, weekKey, periodKey: weekKey, available: true };
};

export const getMonthlyRewindPeriod = (now = new Date()) => {
  const current = new Date(now);
  const year = current.getFullYear();
  const month = current.getMonth();
  const start = new Date(year, month, 1);
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const available = current.getDate() >= 28 && current.getDate() <= lastDay;
  return {
    start,
    end: current,
    monthKey,
    periodKey: monthKey,
    available,
  };
};

export const getYearlyRewindPeriod = (now = new Date()) => {
  const current = new Date(now);
  const month = current.getMonth();
  const day = current.getDate();
  const isJanuaryWindow = month === 0 && day <= 5;
  const isDecemberWindow = month === 11 && day >= 25;
  const targetYear = isJanuaryWindow ? current.getFullYear() - 1 : current.getFullYear();
  const start = new Date(targetYear, 0, 1);
  const end = targetYear === current.getFullYear()
    ? current
    : new Date(targetYear, 11, 31, 23, 59, 59, 999);
  return {
    start,
    end,
    yearKey: String(targetYear),
    periodKey: String(targetYear),
    available: isJanuaryWindow || isDecemberWindow,
  };
};

const addCalendarDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const getAnniversaryPeriod = (joinedAt, now = new Date()) => {
  const joined = new Date(joinedAt);
  const current = new Date(now);
  if (Number.isNaN(joined.getTime()) || Number.isNaN(current.getTime())) {
    return { available: false, years: 0, periodKey: null, anniversaryDate: null, joinedDate: null };
  }

  const anniversaryDate = new Date(current.getFullYear(), joined.getMonth(), joined.getDate());
  // Celebrate leap-day signups on February 28 during non-leap years.
  if (anniversaryDate.getMonth() !== joined.getMonth()) anniversaryDate.setDate(0);
  const anniversaryYear = current.getFullYear();
  let years = anniversaryYear - joined.getFullYear();
  if (current < anniversaryDate) years -= 1;
  const available = years >= 1 && current >= anniversaryDate && current <= addCalendarDays(anniversaryDate, 6);
  return {
    available,
    years: Math.max(0, years),
    periodKey: String(anniversaryYear),
    anniversaryDate,
    joinedDate: joined,
    windowEndsAt: addCalendarDays(anniversaryDate, 6),
  };
};

export const renderRewindCardSvg = ({
  rewindType = "weekly",
  title = "Weekly Rewind",
  eyebrow = "YOUR WEEK IN BLOOM",
  periodLabel = "WEEKLY",
  periodKey = "",
  rangeLabel = "",
  statRows: customStatRows = null,
  displayName,
  username,
  avatarDataUri = "",
  stats = {},
  start,
  end,
  sharedAt = new Date(),
}) => {
  const safeName = escapeXml(displayName || username || "Vine learner");
  const safeUsername = escapeXml(username || "vine");
  const initial = escapeXml(String(displayName || username || "V").trim().charAt(0).toUpperCase());
  const range = rangeLabel || `${new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — ${new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const sharedDate = new Date(sharedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const defaultStatRows = [
    [clampStat(stats.active_days), "ACTIVE DAYS", "01"],
    [clampStat(stats.posts), "POSTS", "02"],
    [clampStat(stats.comments), "COMMENTS", "03"],
    [clampStat(stats.likes_received), "LIKES RECEIVED", "04"],
    [clampStat(stats.messages), "MESSAGES", "05"],
    [clampStat(stats.assignments), "ASSIGNMENTS", "06"],
  ];
  const statRows = Array.isArray(customStatRows) && customStatRows.length === 6
    ? customStatRows.map(([value, label, number], index) => [
      clampStat(value),
      String(label || "VINE ACTIVITY").toUpperCase(),
      String(number || String(index + 1).padStart(2, "0")),
    ])
    : defaultStatRows;
  const statMarkup = statRows.map(([value, label, number], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 92 + column * 458;
    const y = 650 + row * 190;
    const labelX = Math.min(245, 30 + String(value).length * 38 + 24);
    return `
      <g transform="translate(${x} ${y})">
        <rect width="420" height="154" rx="34" fill="rgba(255,255,255,0.105)" stroke="rgba(255,255,255,0.18)"/>
        <text x="30" y="42" class="stat-index">${number}</text>
        <text x="30" y="108" class="stat-value">${value}</text>
        <text x="${labelX}" y="105" class="stat-label">${label}</text>
      </g>
    `;
  }).join("");

  const avatarMarkup = avatarDataUri
    ? `<image href="${avatarDataUri}" x="92" y="368" width="154" height="154" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<circle cx="169" cy="445" r="77" fill="#d1fae5"/><text x="169" y="476" text-anchor="middle" class="avatar-initial">${initial}</text>`;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#021f17"/>
        <stop offset="0.5" stop-color="#064e3b"/>
        <stop offset="1" stop-color="#059669"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.78" cy="0.08" r="0.68">
        <stop offset="0" stop-color="#bef264" stop-opacity="0.52"/>
        <stop offset="0.46" stop-color="#34d399" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#064e3b" stop-opacity="0"/>
      </radialGradient>
      <clipPath id="avatarClip"><circle cx="169" cy="445" r="77"/></clipPath>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#001b13" flood-opacity="0.34"/>
      </filter>
      <style>
        text { font-family: Inter, Arial, Helvetica, sans-serif; }
        .brand { fill: #ecfdf5; font-size: 35px; font-weight: 900; letter-spacing: -1px; }
        .eyebrow { fill: #bef264; font-size: 22px; font-weight: 900; letter-spacing: 5px; }
        .title { fill: #ffffff; font-size: 78px; font-weight: 950; letter-spacing: -3px; }
        .range { fill: #a7f3d0; font-size: 25px; font-weight: 700; }
        .person { fill: #ffffff; font-size: 38px; font-weight: 900; }
        .handle { fill: #a7f3d0; font-size: 23px; font-weight: 700; }
        .stat-index { fill: #bef264; font-size: 18px; font-weight: 900; letter-spacing: 3px; }
        .stat-value { fill: #ffffff; font-size: 64px; font-weight: 950; letter-spacing: -2px; }
        .stat-label { fill: #d1fae5; font-size: 17px; font-weight: 900; letter-spacing: 1.5px; }
        .shared { fill: #a7f3d0; font-size: 20px; font-weight: 700; }
        .avatar-initial { fill: #047857; font-size: 82px; font-weight: 950; }
      </style>
    </defs>
    <rect width="1080" height="1350" rx="0" fill="url(#background)"/>
    <rect width="1080" height="1350" fill="url(#glow)"/>
    <circle cx="990" cy="176" r="250" fill="none" stroke="rgba(190,242,100,0.14)" stroke-width="70"/>
    <circle cx="72" cy="1280" r="225" fill="none" stroke="rgba(52,211,153,0.12)" stroke-width="60"/>

    <g opacity="0.88">
      <path d="M895 42 C870 122 810 138 776 209 C748 268 771 318 719 373" fill="none" stroke="#86efac" stroke-width="6" stroke-linecap="round"/>
      <ellipse cx="844" cy="134" rx="30" ry="14" transform="rotate(-32 844 134)" fill="#bef264"/>
      <ellipse cx="781" cy="226" rx="31" ry="14" transform="rotate(29 781 226)" fill="#6ee7b7"/>
      <ellipse cx="744" cy="320" rx="26" ry="12" transform="rotate(-28 744 320)" fill="#bef264"/>
    </g>

    <g transform="translate(70 58)">
      <circle cx="25" cy="25" r="25" fill="#bef264"/>
      <path d="M17 31 C20 17 31 12 40 12 C38 25 31 34 17 31 Z" fill="#047857"/>
      <text x="68" y="36" class="brand">Vine</text>
    </g>

    <text x="90" y="190" class="eyebrow">${escapeXml(eyebrow)}</text>
    <text x="88" y="285" class="title">${escapeXml(title)}</text>
    <text x="92" y="329" class="range">${escapeXml(range)}</text>

    <g filter="url(#shadow)">
      <circle cx="169" cy="445" r="86" fill="rgba(255,255,255,0.9)"/>
      ${avatarMarkup}
    </g>
    <text x="282" y="432" class="person">${safeName}</text>
    <text x="282" y="474" class="handle">@${safeUsername}</text>
    <text x="282" y="511" class="shared">Shared ${escapeXml(sharedDate)}</text>

    <line x1="92" y1="590" x2="988" y2="590" stroke="rgba(255,255,255,0.19)" stroke-width="2"/>
    ${statMarkup}

    <g transform="translate(92 1248)">
      <rect width="896" height="2" fill="rgba(255,255,255,0.17)"/>
      <text x="0" y="45" class="shared">Made on SPESS Vine · Keep growing together.</text>
      <text x="896" y="45" text-anchor="end" class="eyebrow">${escapeXml(periodLabel)} · ${escapeXml(periodKey || getWeeklyRewindPeriod(sharedAt).weekKey)}</text>
    </g>
  </svg>`;
};

export const renderWeeklyRewindCardSvg = (options = {}) => renderRewindCardSvg({
  ...options,
  rewindType: "weekly",
  title: "Weekly Rewind",
  eyebrow: "YOUR WEEK IN BLOOM",
  periodLabel: "WEEKLY",
  periodKey: options.periodKey || getWeeklyRewindPeriod(options.sharedAt || new Date()).weekKey,
});
