import type { Options } from './tools';

export type GeoMode = 'convert' | 'circle' | 'extract';
export const geoDefaults: Options = {
  mode: 'convert', lon: '', lat: '', centerLon: '', centerLat: '', radius: '1000', unit: 'm',
  algorithm: 'ellipsoid', direction: 'north', decimals: '6', seconds: '2', order: 'lon-lat',
  inputOrder: 'lon-lat', style: 'symbols', dedupe: 'off', representation: 'decimal', delimiter: 'comma', headers: 'off',
};
export const geoSample = '点位 A：东经116度23分28.68秒，北纬39度54分27秒。\n点位 B：(121°28\'25.2"E, 31°13\'49.8"N)\n点位 C：N39°54′27″ E116°23′28.68″\n待核对：东经181度0分0秒，北纬39度0分0秒';
export const geoChoices: Record<string, readonly string[]> = {
  mode: ['convert', 'circle', 'extract'], unit: ['m', 'km'], algorithm: ['ellipsoid', 'sphere'],
  direction: ['north', 'east', 'south', 'west', 'all'], order: ['lon-lat', 'lat-lon'], inputOrder: ['lon-lat', 'lat-lon'],
  style: ['symbols', 'chinese'], dedupe: ['off', 'on'], representation: ['decimal', 'dms'], delimiter: ['comma', 'tab'], headers: ['off', 'on'],
};
export function validateGeoOptions(options: Options): Options {
  const value = { ...geoDefaults, ...options };
  for (const [key, allowed] of Object.entries(geoChoices)) if (!allowed.includes(value[key])) throw new Error(`经纬度选项 ${key} 无效。`);
  for (const [key, max] of [['decimals', 10], ['seconds', 6]] as const) {
    if (!/^\d+$/.test(value[key]) || Number(value[key]) > max) throw new Error(`精度 ${key} 超出范围。`);
  }
  for (const key of ['lon', 'lat', 'centerLon', 'centerLat', 'radius']) if (typeof value[key] !== 'string' || value[key].length > 200) throw new Error('坐标或半径输入过长。');
  return value;
}
// Only computational inputs participate; display changes can reformat the same precise result.
export function geoSignature(input: string, options: Options): string {
  const o = { ...geoDefaults, ...options };
  return JSON.stringify(o.mode === 'convert' ? [o.mode, o.lon, o.lat] : o.mode === 'circle'
    ? [o.mode, o.centerLon, o.centerLat, o.radius, o.unit, o.algorithm, o.direction]
    : [o.mode, input, o.inputOrder, o.dedupe]);
}
