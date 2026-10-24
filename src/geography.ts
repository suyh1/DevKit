import DMS from 'geographiclib-dms';
import type { Options } from './tools';
import { geoSignature, validateGeoOptions } from './geo-config';
import type { GeoMode } from './geo-config';

export type GeoPoint = { lon: number; lat: number; source?: string; line?: number; direction?: string };
export type GeoIssue = { source: string; line: number; reason: string };
export type GeoResult = { mode: GeoMode; signature: string; points: GeoPoint[]; issues: GeoIssue[]; removed: number };
type Angle = { value: number; axis?: 'lon' | 'lat' };
// Accept the complete finite Number representation used by internal point transfers.
// The anchored grammar excludes angle expressions; length and geographic ranges are checked separately.
const numeric = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const dmsBody = '[+-]?\\d{1,9}\\s*[°度]\\s*\\d{1,9}\\s*[\'′分]\\s*\\d{1,9}(?:\\.\\d{1,12})?\\s*(?:["″秒]|\'{2}|′{2})';
const direction = '(?:东经|西经|北纬|南纬|[NSEW](?![A-Za-z]))';
const labels = '(?:经度|纬度)';
const role = `${direction}|${labels}`;
// A direction followed by another angle is its prefix, not the previous angle's suffix.
const suffixDirection = `(?:${direction})(?![ \\t]*[:：]?[ \\t]*[+-]?\\d)`;
const angleToken = `(?:(?:${role})\\s*[:：]?\\s*${dmsBody}(?:[ \\t]*${suffixDirection})?|${dmsBody}(?:[ \\t]*${direction})?)`;
const hemisphere: Record<string, string> = { 东经: 'E', 西经: 'W', 北纬: 'N', 南纬: 'S' };
const normal = (text: string) => text.replace(/[０-９＋－．，：]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
  .replace(/[º˚]/g, '°').replace(/[‘’ʹ]/g, '′').replace(/[“”ʺ]/g, '″').replace(/\u2212/g, '-');
function decodeAngle(raw: string): Angle {
  if (raw.length > 200 || !raw.trim()) throw new Error('请输入经度和纬度。');
  let text = normal(raw).trim(), axis: Angle['axis'];
  const indicators: string[] = [];
  const take = (token: string) => {
    if (token === '经度' || token === '纬度') {
      const hint = token === '经度' ? 'lon' : 'lat';
      if (axis && axis !== hint) throw new Error('经纬标签冲突。');
      axis = hint;
    } else indicators.push(hemisphere[token] ?? token.toUpperCase());
  };
  const prefix = new RegExp(`^(${role})\\s*[:：]?\\s*`, 'i').exec(text);
  if (prefix) { take(prefix[1]); text = text.slice(prefix[0].length); }
  const suffix = new RegExp(`\\s*(${role})$`, 'i').exec(text);
  if (suffix) { take(suffix[1]); text = text.slice(0, suffix.index).trim(); }
  if (indicators.length > 1 && indicators[0] !== indicators[1]) throw new Error('方向标识冲突。');
  const h = indicators[0];
  if (h) {
    const hint = /[EW]/.test(h) ? 'lon' : 'lat';
    if (axis && axis !== hint) throw new Error('方向与经纬标签冲突。');
    axis = hint;
    if ((text.startsWith('-') && /[NE]/.test(h)) || (text.startsWith('+') && /[SW]/.test(h))) throw new Error('正负号与方向冲突。');
    // GeographicLib multiplies hemisphere and leading signs; remove a redundant consistent sign.
    text = text.replace(/^[+-]/, '');
  }
  const decimal = new RegExp(`^${numeric}\\s*[°度]?$`).test(text);
  const parts = /^([+-]?\d{1,9})\s*[°度:]\s*(\d{1,9})\s*['′分:]\s*(\d{1,9}(?:\.\d{1,12})?)\s*(?:["″秒]|'{2}|′{2})?$/.exec(text);
  if (!decimal && !parts) throw new Error('格式无效，请输入十进制度或完整的度分秒。');
  if (parts && (Number(parts[2]) >= 60 || Number(parts[3]) >= 60)) throw new Error('分和秒必须小于 60。');
  const standard = parts ? `${parts[1]}d${parts[2]}'${parts[3]}"` : text.replace(/[°度]/g, '').trim();
  const value = decimal ? Number(standard) * (h && /[SW]/.test(h) ? -1 : 1) : DMS.Decode(standard + (h ?? '')).val;
  if (!Number.isFinite(value)) throw new Error('坐标必须是有限数。');
  return { value: Object.is(value, -0) ? 0 : value, axis };
}
export function parseCoordinate(raw: string, axis: 'lon' | 'lat'): number {
  const angle = decodeAngle(raw);
  if (angle.axis && angle.axis !== axis) throw new Error(`${axis === 'lon' ? '经度' : '纬度'}方向标识不匹配。`);
  if (Math.abs(angle.value) > (axis === 'lon' ? 180 : 90)) throw new Error(`${axis === 'lon' ? '经度须在 -180～180°' : '纬度须在 -90～90°'}。`);
  return angle.value;
}
function pair(first: string, second: string, order: string): GeoPoint {
  const a = decodeAngle(first), b = decodeAngle(second);
  if (a.axis && b.axis && a.axis === b.axis) throw new Error('同组中缺少另一种经纬坐标。');
  const firstAxis = a.axis ?? (b.axis ? b.axis === 'lon' ? 'lat' : 'lon' : order === 'lat-lon' ? 'lat' : 'lon');
  return firstAxis === 'lon' ? { lon: parseCoordinate(first, 'lon'), lat: parseCoordinate(second, 'lat') }
    : { lon: parseCoordinate(second, 'lon'), lat: parseCoordinate(first, 'lat') };
}
export function parseCoordinatePair(text: string, order = 'lon-lat'): GeoPoint {
  const input = normal(text).trim().replace(/^[（(\[]|[）)\]]$/g, '');
  const separated = input.split(/[,，;；\t\r\n]+/).map(s => s.trim()).filter(Boolean);
  if (separated.length === 2) return pair(separated[0], separated[1], order);
  const matches = [...input.matchAll(new RegExp(angleToken, 'gi'))];
  if (matches.length === 2 && !input.slice(0, matches[0].index).trim() && !input.slice(matches[0].index! + matches[0][0].length, matches[1].index).trim() && !input.slice(matches[1].index! + matches[1][0].length).trim()) return pair(matches[0][0], matches[1][0], order);
  throw new Error('请输入一对坐标，用逗号分隔；度分秒可带方向标识。');
}
export function decimalText(value: number, places: number): string {
  const text = value.toFixed(places);
  return Number(text) === 0 ? Math.abs(Number(text)).toFixed(places) : text;
}
export function dmsText(value: number, axis: 'lon' | 'lat', places: number, style: string): string {
  // Encode handles carry into minutes/degrees. Canonical zero has N/E hemisphere.
  let text = DMS.Encode(Object.is(value, -0) ? 0 : value, DMS.SECOND, places, axis === 'lon' ? DMS.LONGITUDE : DMS.LATITUDE);
  if (style === 'chinese') {
    const suffix = text.slice(-1), names: Record<string, string> = { E: '东经', W: '西经', N: '北纬', S: '南纬' };
    text = names[suffix] + text.slice(0, -1).replace('°', '度').replace("'", '分').replace('"', '秒');
  } else text = text.replace("'", '′').replace('"', '″');
  return text;
}
export function coordinateCells(point: GeoPoint, options: Options): [string, string] {
  const format = (axis: 'lon' | 'lat') => options.representation === 'dms' ? dmsText(point[axis], axis, Number(options.seconds), options.style) : decimalText(point[axis], Number(options.decimals));
  return options.order === 'lat-lon' ? [format('lat'), format('lon')] : [format('lon'), format('lat')];
}
export function coordinatesText(points: GeoPoint[], options: Options, column?: 'lon' | 'lat'): string {
  const delimiter = options.delimiter === 'tab' ? '\t' : ',';
  const escape = (value: string) => /[",\r\n\t]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const rows = points.map(p => column ? [coordinateCells(p, { ...options, order: column === 'lon' ? 'lon-lat' : 'lat-lon' })[0]] : coordinateCells(p, options));
  if (options.headers === 'on') rows.unshift(column ? [column === 'lon' ? '经度' : '纬度'] : options.order === 'lat-lon' ? ['纬度', '经度'] : ['经度', '纬度']);
  return rows.map(row => row.map(value => delimiter === '\t' ? value : escape(value)).join(delimiter)).join('\n');
}
export function extractCoordinates(input: string, options: Options): { points: GeoPoint[]; issues: GeoIssue[]; removed: number } {
  if (input.length > 300_000) throw new Error('文本提取最多支持 300,000 字符。');
  const text = normal(input);
  const pattern = new RegExp(`(?<![0-9A-Za-z.+-])${angleToken}`, 'gi');
  const tokens = [...text.matchAll(pattern)];
  if (tokens.length > 10_000) throw new Error('坐标候选过多，最多处理 10,000 个角度 / 5,000 对。');
  const lines = [0]; for (let i = 0; i < input.length; i++) if (input[i] === '\n') lines.push(i + 1);
  const lineAt = (index: number) => { let lo = 0, hi = lines.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (lines[mid] <= index) lo = mid + 1; else hi = mid; } return lo; };
  const points: GeoPoint[] = [], issues: GeoIssue[] = [], seen = new Set<string>(); let removed = 0;
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i], b = tokens[i + 1], start = a.index!;
    const addIssue = (reason: string) => issues.push({ source: input.slice(start, start + a[0].length), line: lineAt(start), reason });
    const orphanReason = (fallback: string) => { try { const angle = decodeAngle(a[0]); if (angle.axis) parseCoordinate(a[0], angle.axis); return fallback; } catch (error) { return (error as Error).message; } };
    if (!b) { addIssue(orphanReason('缺少可配对的经度或纬度。')); continue; }
    const gap = text.slice(start + a[0].length, b.index);
    if (!/^[\s,，;；、()（）[\]]*$/.test(gap) || /\n\s*\n/.test(gap)) { addIssue(orphanReason('与下一坐标不属于同一坐标组。')); continue; }
    try {
      const point = pair(a[0], b[0], options.inputOrder);
      point.source = input.slice(start, b.index! + b[0].length); point.line = lineAt(start);
      const key = `${point.lon},${point.lat}`;
      if (options.dedupe === 'on' && seen.has(key)) removed++;
      else { points.push(point); seen.add(key); }
      i++;
    } catch (error) {
      // Consume a recognized pair even when invalid: do not shift its latitude into the next record.
      issues.push({ source: input.slice(start, b.index! + b[0].length), line: lineAt(start), reason: (error as Error).message });
      i++;
    }
  }
  return { points, issues, removed };
}
export const SPHERE_RADIUS = 6_371_008.8;
export async function circlePoint(center: GeoPoint, distance: number, bearing: number, algorithm: string): Promise<GeoPoint> {
  if (!Number.isFinite(distance) || distance < 0 || distance > 10_000_000) throw new Error('半径须在 0～10,000 km 之间。');
  if (!['ellipsoid', 'sphere'].includes(algorithm)) throw new Error('圆周算法无效。');
  if (!Number.isFinite(bearing) || !Number.isFinite(center.lon) || !Number.isFinite(center.lat) || Math.abs(center.lon) > 180 || Math.abs(center.lat) > 90) throw new Error('圆心或方位角无效。');
  if (distance === 0) return { ...center };
  if (Math.abs(center.lat) === 90) throw new Error('圆心恰在极点时四方向参考不唯一，请调整圆心。');
  if (algorithm === 'ellipsoid') {
    const { default: geographic } = await import('geographiclib-geodesic');
    const result = geographic.Geodesic.WGS84.Direct(center.lat, center.lon, bearing, distance);
    return { lon: result.lon2!, lat: result.lat2! };
  }
  // Spherical destination formula, as documented by Movable Type / Turf; all angles in radians.
  const rad = Math.PI / 180, phi = center.lat * rad, lambda = center.lon * rad, theta = bearing * rad, delta = distance / SPHERE_RADIUS;
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(theta))));
  const lon = lambda + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(lat));
  return { lon: ((lon / rad + 540) % 360) - 180, lat: lat / rad };
}
export async function geographyTransform(input: string, incoming: Options): Promise<string> {
  const o = validateGeoOptions(incoming), result: GeoResult = { mode: o.mode as GeoMode, signature: geoSignature(input, o), points: [], issues: [], removed: 0 };
  if (o.mode === 'convert') result.points = [!o.lon && !o.lat && input.trim() ? parseCoordinatePair(input, o.inputOrder) : { lon: parseCoordinate(o.lon, 'lon'), lat: parseCoordinate(o.lat, 'lat') }];
  else if (o.mode === 'extract') Object.assign(result, extractCoordinates(input, o));
  else {
    const center = { lon: parseCoordinate(o.centerLon, 'lon'), lat: parseCoordinate(o.centerLat, 'lat') };
    if (!/^\d+(?:\.\d+)?$/.test(o.radius)) throw new Error('请输入非负半径数字。');
    const directions: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
    for (const name of o.direction === 'all' ? Object.keys(directions) : [o.direction]) result.points.push({ ...await circlePoint(center, Number(o.radius) * (o.unit === 'km' ? 1000 : 1), directions[name], o.algorithm), direction: name });
  }
  return JSON.stringify(result);
}
export function readGeoCache(output: string): Partial<Record<GeoMode, GeoResult>> {
  try {
    const value = JSON.parse(output), cache: Partial<Record<GeoMode, GeoResult>> = {};
    for (const mode of ['convert', 'circle', 'extract'] as const) {
      const r = value?.[mode];
      if (r?.mode !== mode || typeof r.signature !== 'string' || r.signature.length > 2_000_000 || !Number.isInteger(r.removed) || r.removed < 0 || !Array.isArray(r.points) || r.points.length > 5000 || !Array.isArray(r.issues) || r.issues.length > 10000) continue;
      if (!r.points.every((p: GeoPoint) => p && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && (p.source === undefined || typeof p.source === 'string') && (p.line === undefined || Number.isInteger(p.line)) && (p.direction === undefined || typeof p.direction === 'string'))) continue;
      if (!r.issues.every((p: GeoIssue) => p && typeof p.source === 'string' && typeof p.reason === 'string' && Number.isInteger(p.line))) continue;
      cache[mode] = r;
    }
    return cache;
  } catch { return {}; }
}
export function mergeGeoOutput(previous: string, fresh: string): string {
  const result = JSON.parse(fresh) as GeoResult;
  return JSON.stringify({ ...readGeoCache(previous), [result.mode]: result });
}
