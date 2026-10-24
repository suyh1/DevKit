import { describe, expect, it } from 'vitest';
import { circlePoint, coordinatesText, decimalText, dmsText, extractCoordinates, geographyTransform, mergeGeoOutput, parseCoordinate, parseCoordinatePair, readGeoCache, SPHERE_RADIUS } from './geography';
import { geoDefaults, geoSample, geoSignature } from './geo-config';
import { createTask, editTask, importWorkspace, workspaceSnapshot } from './workbench';
import { transform } from './tools';

describe('geographic coordinates', () => {
  it('parses decimal, Chinese, Unicode, ASCII and hemisphere prefix/suffix forms', () => {
    for (const text of ['116.3913', '116°23′28.68″E', '东经116度23分28.68秒', 'E116°23\'28.68"', '１１６°２３′２８．６８″E', '116:23:28.68']) expect(parseCoordinate(text, 'lon')).toBeCloseTo(116.3913, 10);
    for (const text of ['-116.3913', '西经116度23分28.68秒', '-116°23′28.68″W']) expect(parseCoordinate(text, 'lon')).toBeCloseTo(-116.3913, 10);
    expect(parseCoordinate('39°54′27″N', 'lat')).toBeCloseTo(39.9075, 10);
    expect(parseCoordinate('S0°30′0″', 'lat')).toBe(-0.5);
    expect(parseCoordinate('-0', 'lat')).toBe(0);
  });
  it('rejects range, minutes/seconds, expressions, hemisphere/sign conflicts and wrong axis', () => {
    for (const text of ['', 'Infinity', 'NaN', '181', '180°00′0.01″', '116°60′0″', '116°0′60″', '-116E', '+116W', 'N116°0′0″', '1d+2d', '12°-2′3″', '1e2', '1/2', 'true']) expect(() => parseCoordinate(text, 'lon'), text).toThrow();
    expect(() => parseCoordinate('90°0′0.01″N', 'lat')).toThrow();
    expect(parseCoordinate('180°0′0″W', 'lon')).toBe(-180);
    expect(parseCoordinate('90°0′0″S', 'lat')).toBe(-90);
  });
  it('identifies axis and preserves explicit unlabelled order when pasting pairs', () => {
    expect(parseCoordinatePair('N39°54′27″ E116°23′28.68″')).toEqual({ lon: 116.3913, lat: 39.9075 });
    expect(parseCoordinatePair('39.9075,116.3913', 'lat-lon')).toEqual({ lon: 116.3913, lat: 39.9075 });
    expect(parseCoordinatePair('(116.3913,39.9075)')).toEqual({ lon: 116.3913, lat: 39.9075 });
    expect(() => parseCoordinatePair('E116°0′0″,W117°0′0″')).toThrow();
    expect(() => parseCoordinatePair('1,2,3')).toThrow();
  });
  it('formats carries, signed fractional degrees and stable zero with configurable precision', () => {
    expect(dmsText(116.3913, 'lon', 2, 'symbols')).toBe('116°23′28.68″E');
    expect(dmsText(-0.5, 'lat', 2, 'chinese')).toBe('南纬00度30分00.00秒');
    expect(dmsText(12 + 59 / 60 + 59.9999 / 3600, 'lon', 2, 'symbols')).toBe('013°00′00.00″E');
    expect(decimalText(-0.00000001, 6)).toBe('0.000000');
    for (const axis of ['lat', 'lon'] as const) for (const n of [-45.1234567, 0, 23.456789, 89.999999]) expect(parseCoordinate(dmsText(n, axis, 6, 'symbols'), axis)).toBeCloseTo(n, 9);
  });
  it('extracts all four standard forms, including hemisphere prefix order', () => {
    const result = extractCoordinates(geoSample, geoDefaults);
    expect(result.points).toHaveLength(3);
    expect(result.points.map(p => p.line)).toEqual([1, 2, 3]);
    expect(result.points[0]).toMatchObject({ lon: 116.3913, lat: 39.9075 });
    expect(result.points[2]).toMatchObject({ lon: 116.3913, lat: 39.9075 });
    expect(result.issues.some(p => p.reason.includes('180'))).toBe(true);
    expect(result.points[0].source).toContain('东经');
    expect(extractCoordinates('116°0′0″E 39°0′0″N', geoDefaults).points).toHaveLength(1);
    expect(extractCoordinates('116°0′0″ E 39°0′0″ N', geoDefaults).points[0]).toMatchObject({ lon: 116, lat: 39 });
    expect(extractCoordinates("116°0'0'' E 39°0'0'' N", geoDefaults).points[0]).toMatchObject({ lon: 116, lat: 39 });
  });
  it('handles labelled Chinese fields, unlabelled order, multiline groups and source positions', () => {
    const text = '记录😀\r\n经度：１２１度３０分０秒，\r\n纬度：３１度１５分０秒\n下一组：39°0′0″，116°0′0″';
    const result = extractCoordinates(text, { ...geoDefaults, inputOrder: 'lat-lon' });
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({ lon: 121.5, lat: 31.25, line: 2 });
    expect(result.points[0].source).toBe('经度：１２１度３０分０秒，\r\n纬度：３１度１５分０秒');
    expect(result.points[1]).toMatchObject({ lon: 116, lat: 39, line: 4 });
  });
  it('does not pair across prose/paragraphs, same-axis angles or unrelated numeric values', () => {
    for (const text of ['116°0′0″E\n\n39°0′0″N', '116°0′0″E 其他记录 39°0′0″N', '116°0′0″E, 117°0′0″E', '订单 116.3,39.9 电话 12345678', '会议 12:30:00 至 13:30:00']) expect(extractCoordinates(text, geoDefaults).points, text).toHaveLength(0);
    expect(extractCoordinates('记录 116°60′0″E,39°0′0″N', geoDefaults).issues.length).toBeGreaterThan(0);
    const invalidThenValid = extractCoordinates('181°0′0″E,39°0′0″N\n116°0′0″E,40°0′0″N', geoDefaults);
    expect(invalidThenValid.points).toHaveLength(1);
    expect(invalidThenValid.points[0]).toMatchObject({ lon: 116, lat: 40, line: 2 });
    const badMinuteThenValid = extractCoordinates('116°60′0″E,39°0′0″N\n117°0′0″E,40°0′0″N', geoDefaults);
    expect(badMinuteThenValid.points).toHaveLength(1);
    expect(badMinuteThenValid.points[0]).toMatchObject({ lon: 117, lat: 40 });
  });
  it('keeps repeats unless opted in and never merges nearby rounded values', () => {
    const line = '116°0′0″E,39°0′0″N';
    const text = `${line}\n${line}\n116°0′0.00001″E,39°0′0″N`;
    expect(extractCoordinates(text, geoDefaults).points).toHaveLength(3);
    const deduped = extractCoordinates(text, { ...geoDefaults, dedupe: 'on' });
    expect(deduped.points).toHaveLength(2); expect(deduped.removed).toBe(1);
    expect(() => extractCoordinates('x'.repeat(300001), geoDefaults)).toThrow('300,000');
    expect(() => extractCoordinates((line + '\n').repeat(5001), geoDefaults)).toThrow('10,000');
  });
  it('copies clean columns, chosen order, DMS, CSV/TSV and headers without source data', () => {
    const points = [{ lon: 116.3913, lat: 39.9075, source: '秘密原文', line: 5 }, { lon: -0.5, lat: 0 }];
    expect(coordinatesText(points, geoDefaults)).toBe('116.391300,39.907500\n-0.500000,0.000000');
    expect(coordinatesText(points, geoDefaults, 'lon')).toBe('116.391300\n-0.500000');
    expect(coordinatesText(points, { ...geoDefaults, order: 'lat-lon', headers: 'on', delimiter: 'tab' })).toBe('纬度\t经度\n39.907500\t116.391300\n0.000000\t-0.500000');
    expect(coordinatesText(points.slice(0, 1), { ...geoDefaults, representation: 'dms' })).toBe('116°23′28.68″E,39°54′27.00″N');
    expect(coordinatesText(points, geoDefaults)).not.toContain('秘密');
  });
  it('matches the WGS84 equatorial analytic solution and a published spherical destination example', async () => {
    const ellipsoid = await circlePoint({ lon: 0, lat: 0 }, 1000, 90, 'ellipsoid');
    expect(ellipsoid.lat).toBe(0); expect(ellipsoid.lon).toBeCloseTo(1000 / 6378137 * 180 / Math.PI, 12);
    const sphere = await circlePoint({ lon: 0, lat: 0 }, SPHERE_RADIUS * Math.PI / 6, 90, 'sphere');
    expect(sphere.lat).toBeCloseTo(0, 12); expect(sphere.lon).toBeCloseTo(30, 10);
    // Turf documentation: [-75.343,39.984], 50 miles, bearing 90. Independent formula implementation.
    const p = await circlePoint({ lon: -75.343, lat: 39.984 }, 50 * 1609.344, 90, 'sphere');
    expect(p.lat).toBeLessThan(39.984); expect(p.lon).toBeGreaterThan(-75.343);
    expect(ellipsoid.lon).not.toBeCloseTo((await circlePoint({ lon: 0, lat: 0 }, 1000, 90, 'sphere')).lon, 6);
    // GeographicLib published test vector #1 (lat1,lon1,azi1,s12 -> lat2,lon2).
    const benchmark = await circlePoint({ lat: 35.60777, lon: -139.44815 }, 8935244.5604818305, 111.098748429560326, 'ellipsoid');
    expect(benchmark.lat).toBeCloseTo(-11.17491, 10); expect(benchmark.lon).toBeCloseTo(-69.95921, 10);
  });
  it('handles cardinal directions, crossing the date line, zero, invalid radii and poles', async () => {
    for (const model of ['ellipsoid', 'sphere']) {
      const c = { lon: 116, lat: 39 };
      expect((await circlePoint(c, 1000, 0, model)).lat).toBeGreaterThan(c.lat);
      expect((await circlePoint(c, 1000, 180, model)).lat).toBeLessThan(c.lat);
      expect((await circlePoint(c, 1000, 90, model)).lon).toBeGreaterThan(c.lon);
      expect((await circlePoint(c, 1000, 270, model)).lon).toBeLessThan(c.lon);
      expect((await circlePoint({ lon: 179.999, lat: 0 }, 1000, 90, model)).lon).toBeLessThan(-179);
      const polar = await circlePoint({ lon: 179, lat: 89.9 }, 1000, 90, model);
      expect(Number.isFinite(polar.lon) && Number.isFinite(polar.lat)).toBe(true);
      expect(polar.lat).toBeLessThan(89.9);
      const acrossPole = await circlePoint({ lon: 179, lat: 89.9 }, 50_000, 0, model);
      expect(acrossPole.lon).toBeCloseTo(-1, 7);
      expect(Math.abs(acrossPole.lat)).toBeLessThan(90);
      expect(await circlePoint(c, 0, 90, model)).toEqual(c);
      for (const r of [-1, Infinity, NaN, 10_000_001]) await expect(circlePoint(c, r, 90, model)).rejects.toThrow();
      await expect(circlePoint({ lon: 0, lat: 90 }, 1, 90, model)).rejects.toThrow('极点');
    }
  });
  it('routes Worker transforms, validates restored options and keeps per-mode results independent', async () => {
    const options = { ...geoDefaults, lon: '116.3913', lat: '39.9075' };
    const converted = await transform('geo-coordinates', '', options);
    const circle = await geographyTransform('', { ...geoDefaults, mode: 'circle', centerLon: '116', centerLat: '39', direction: 'all' });
    const merged = mergeGeoOutput(mergeGeoOutput('', converted), circle);
    expect(readGeoCache(merged).circle?.points).toHaveLength(4);
    expect(readGeoCache(merged).convert?.signature).toBe(geoSignature('', options));
    const original = { ...createTask('geo-coordinates'), options, output: merged, elapsed: 1, status: 'success' as const };
    const restored = importWorkspace(workspaceSnapshot([original], original.id)).tasks[0];
    expect(restored.options).toEqual(options); expect(restored.elapsed).toBeNull(); expect(restored.status).toBe('stale');
    const changed = editTask(original, { options: { ...options, lon: '115' } });
    expect(geoSignature('', changed.options)).not.toBe(readGeoCache(merged).convert!.signature);
    await expect(geographyTransform('', { ...options, algorithm: 'bad' })).rejects.toThrow();
    await expect(geographyTransform('', { ...options, decimals: '11' })).rejects.toThrow();
    const corrupt = JSON.parse(workspaceSnapshot([original], original.id)); corrupt.tasks[0].options.mode = 'script';
    expect(() => importWorkspace(JSON.stringify(corrupt))).toThrow();
    expect(readGeoCache('{"convert":{"mode":"convert","signature":"x","points":[null],"issues":[]}}')).toEqual({});
    const escapedInput = '"'.repeat(200_000) + '\n116°0′0″E,39°0′0″N';
    expect(readGeoCache(mergeGeoOutput('', await geographyTransform(escapedInput, { ...geoDefaults, mode: 'extract' }))).extract?.points).toHaveLength(1);
  });
});
