// Approximate country centroids [lat, lon] keyed by ISO alpha-2, plus helpers
// to guess a config's country from its name (flag emoji, code or English name).

export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AE: [24, 54], AF: [33, 65], AL: [41, 20], AM: [40, 45], AR: [-34, -64], AT: [47.3, 13.3],
  AU: [-25, 134], AZ: [40.5, 47.5], BA: [44, 18], BD: [24, 90], BE: [50.8, 4.5], BG: [43, 25],
  BH: [26, 50.5], BR: [-10, -55], BY: [53, 28], CA: [56, -106], CH: [46.8, 8.2], CL: [-30, -71],
  CN: [35, 103], CO: [4, -72], CY: [35, 33], CZ: [49.8, 15.5], DE: [51, 10], DK: [56, 10],
  DZ: [28, 3], EE: [59, 26], EG: [27, 30], ES: [40, -4], FI: [64, 26], FR: [46.5, 2.5],
  GB: [54, -2], GE: [42, 43.5], GR: [39, 22], HK: [22.3, 114.2], HR: [45.1, 15.2], HU: [47, 19.5],
  ID: [-2, 118], IE: [53, -8], IL: [31, 35], IN: [21, 78], IQ: [33, 44], IR: [32, 53], IS: [65, -18],
  IT: [42.8, 12.8], JO: [31, 36], JP: [36, 138], KE: [0, 38], KG: [41, 75], KR: [36.5, 128],
  KW: [29.5, 47.7], KZ: [48, 68], LB: [33.8, 35.8], LT: [55.5, 24], LU: [49.8, 6.1], LV: [57, 25],
  MA: [32, -6], MD: [47, 29], MK: [41.6, 21.7], MN: [46, 105], MX: [23, -102], MY: [4, 102],
  NG: [9, 8], NL: [52.2, 5.5], NO: [61, 9], NZ: [-41, 174], OM: [21, 57], PA: [9, -80],
  PE: [-10, -76], PH: [13, 122], PK: [30, 70], PL: [52, 19.5], PT: [39.5, -8], QA: [25.3, 51.2],
  RO: [46, 25], RS: [44, 21], RU: [60, 90], SA: [24, 45], SE: [62, 15], SG: [1.35, 103.8],
  SI: [46.1, 14.8], SK: [48.7, 19.5], TH: [15, 101], TJ: [39, 71], TM: [39, 59.5], TR: [39, 35],
  TW: [23.7, 121], UA: [49, 32], US: [39, -98], UY: [-33, -56], UZ: [41, 64], VN: [16, 107],
  ZA: [-29, 24], AD: [42.5, 1.5], ME: [42.7, 19.3], MT: [35.9, 14.4], LI: [47.1, 9.5],
  MO: [22.2, 113.5], CR: [10, -84], EC: [-1.5, -78], VE: [7, -66], BO: [-17, -65], PY: [-23, -58],
  TN: [34, 9], LY: [27, 17], SD: [15, 30], ET: [9, 39], TZ: [-6, 35], GH: [8, -1], CI: [7.5, -5.5],
  SN: [14.5, -14.5], AO: [-12, 18], NP: [28, 84], LK: [7.8, 80.7], MM: [21, 96], KH: [12.5, 105],
  LA: [18, 103], SY: [35, 38], YE: [15.5, 47.5], SC: [-4.6, 55.5], MU: [-20.3, 57.6], CU: [21.5, -79],
  DO: [19, -70.5], JM: [18.1, -77.3], GT: [15.5, -90.3], HN: [15, -86.5], SV: [13.8, -88.9],
  NI: [12.9, -85], BZ: [17.2, -88.7], GL: [72, -40], BS: [24.7, -77.8],
};

const NAME_ALIASES: Record<string, string> = {
  "united states": "US", usa: "US", america: "US", "united kingdom": "GB", uk: "GB", england: "GB",
  britain: "GB", germany: "DE", deutschland: "DE", netherlands: "NL", holland: "NL", france: "FR",
  finland: "FI", sweden: "SE", norway: "NO", denmark: "DK", poland: "PL", turkey: "TR", "türkiye": "TR",
  turkiye: "TR", russia: "RU", canada: "CA", japan: "JP", singapore: "SG", "hong kong": "HK",
  hongkong: "HK", korea: "KR", "south korea": "KR", india: "IN", australia: "AU", brazil: "BR",
  spain: "ES", italy: "IT", switzerland: "CH", austria: "AT", belgium: "BE", ireland: "IE",
  iran: "IR", uae: "AE", emirates: "AE", dubai: "AE", armenia: "AM", georgia: "GE", ukraine: "UA",
  romania: "RO", bulgaria: "BG", hungary: "HU", czech: "CZ", lithuania: "LT", latvia: "LV",
  estonia: "EE", israel: "IL", taiwan: "TW", china: "CN", vietnam: "VN", thailand: "TH",
  malaysia: "MY", indonesia: "ID", mexico: "MX", argentina: "AR", chile: "CL", kazakhstan: "KZ",
  portugal: "PT", greece: "GR", serbia: "RS", luxembourg: "LU", iceland: "IS", moldova: "MD",
  cyprus: "CY", bahrain: "BH", qatar: "QA", "saudi": "SA", oman: "OM", iraq: "IQ", azerbaijan: "AZ",
  frankfurt: "DE", amsterdam: "NL", london: "GB", paris: "FR", helsinki: "FI", stockholm: "SE",
  tokyo: "JP", istanbul: "TR", moscow: "RU", toronto: "CA", "new york": "US", "los angeles": "US",
  miami: "US", chicago: "US", dallas: "US", seattle: "US", warsaw: "PL", vienna: "AT", zurich: "CH",
};

/** Converts a regional-indicator flag emoji (🇩🇪) at any position into "DE". */
function fromFlagEmoji(s: string): string | undefined {
  const cps = Array.from(s).map((c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < cps.length - 1; i++) {
    const a = cps[i];
    const b = cps[i + 1];
    if (a >= 0x1f1e6 && a <= 0x1f1ff && b >= 0x1f1e6 && b <= 0x1f1ff) {
      return String.fromCharCode(a - 0x1f1e6 + 65, b - 0x1f1e6 + 65);
    }
  }
  return undefined;
}

export function guessCountry(name: string): string | undefined {
  if (!name) return undefined;
  const flag = fromFlagEmoji(name);
  if (flag) return flag === "UK" ? "GB" : flag;
  const lower = name.toLowerCase();
  const aliases = Object.keys(NAME_ALIASES).sort((a, b) => b.length - a.length);
  for (const a of aliases) {
    if (new RegExp(`(^|[^a-z])${a}([^a-z]|$)`).test(lower)) return NAME_ALIASES[a];
  }
  // Standalone upper-case 2-letter code, e.g. "DE-01", "[NL] Server"
  const codes = name.match(/(?:^|[^A-Za-z])([A-Z]{2})(?=[^A-Za-z]|$)/g);
  if (codes) {
    for (const c of codes) {
      const code = c.replace(/[^A-Z]/g, "");
      if (COUNTRY_CENTROIDS[code]) return code;
    }
  }
  return undefined;
}

export function countryName(code?: string): string {
  if (!code) return "Unknown location";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
