export const STATIONS: Record<string, readonly [number, number]> = {
  Amsterdam: [52.315, 4.79],
  Ankara: [40.128, 32.995],
  Atlanta: [33.62972, -84.44223],
  Austin: [30.1831, -97.68063],
  Beijing: [40.082, 116.603],
  "Buenos Aires": [-34.822, -58.536],
  Busan: [35.179, 128.938],
  "Cape Town": [-33.965, 18.602],
  Chengdu: [30.576, 103.95],
  Chicago: [41.96017, -87.93161],
  Chongqing: [29.718, 106.639],
  Dallas: [32.83836, -96.83584],
  Denver: [39.713, -104.758],
  Guangzhou: [23.392, 113.307],
  Helsinki: [60.327, 24.957],
  "Hong Kong": [22.302, 114.174],
  Houston: [29.64582, -95.28214],
  Istanbul: [41.262, 28.74],
  Jeddah: [21.685, 39.166],
  Karachi: [24.902, 67.139],
  "Kuala Lumpur": [2.747, 101.714],
  London: [51.505, 0.055],
  "Los Angeles": [33.93817, -118.3866],
  Lucknow: [26.761, 80.889],
  Madrid: [40.466, -3.555],
  Manila: [14.507, 121.004],
  "Mexico City": [19.436, -99.072],
  Miami: [25.78806, -80.31692],
  Milan: [45.631, 8.728],
  Moscow: [55.592, 37.261],
  Munich: [48.348, 11.813],
  NYC: [40.77945, -73.88027],
  "Panama City": [8.967, -79.555],
  Paris: [48.967, 2.428],
  Qingdao: [36.362, 120.087],
  "San Francisco": [37.61961, -122.36561],
  "Sao Paulo": [-23.432, -46.469],
  Seattle: [47.44467, -122.31442],
  "Seoul (Incheon)": [37.469, 126.451],
  Shanghai: [31.146, 121.8],
  Shenzhen: [22.639, 113.803],
  Singapore: [1.368, 103.982],
  Taipei: [25.069, 121.552],
  "Tel Aviv": [32.011, 34.887],
  Tokyo: [35.553, 139.781],
  Toronto: [43.679, -79.629],
  Warsaw: [52.163, 20.961],
  Wellington: [-41.331, 174.806],
  Wuhan: [30.783, 114.205],
};

export const WEATHER_TAG_ID = "84";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function marketDayOf(slug: string | null | undefined): string | null {
  const m = slug?.match(/-on-([a-z]+)-(\d{1,2})-(\d{4})$/);
  const month = m ? MONTHS.indexOf(m[1]!) : -1;
  if (!m || month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

export function eventSlug(city: string, marketDay: string): string {
  const [year, month, day] = marketDay.split("-").map(Number);
  const name = city.toLowerCase().replace(" (incheon)", "").replace(/ /g, "-");
  return `highest-temperature-in-${name}-on-${MONTHS[month! - 1]}-${day}-${year}`;
}

const TITLE_REGEX = /^Highest temperature in (.+) on [A-Za-z]+ \d+\?$/;

export function cityOf(title: string | null | undefined): string | null {
  const city = title?.match(TITLE_REGEX)?.[1];
  return city && city in STATIONS ? city : null;
}

export function bucketRange(title: string): [number, number] {
  const m = title.match(/(-?\d+)(?:\s*-\s*(\d+))?/);
  if (!m) return [NaN, NaN];
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  if (/or below/i.test(title)) return [-Infinity, hi + 0.5];
  if (/or (higher|above)/i.test(title)) return [lo - 0.5, Infinity];
  return [lo - 0.5, hi + 0.5];
}

export function isFahrenheit(title: string): boolean {
  return /°\s*F/i.test(title);
}
