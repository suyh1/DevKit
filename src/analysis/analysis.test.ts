import { describe, it, expect } from 'vitest';
import { runAnalysis } from './run';
import { byAnalysis } from './catalog';
import { parseCsv } from '../practical';
import { upgrade, clampValues } from './upgrades';
import { analyzeFile, archiveEntries } from './file-analysis';
import { parquetWriteBuffer } from 'hyparquet-writer';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { rootCertificates } from 'node:tls';

async function run(id: string, input?: string, options: Record<string, string> = {}) {
  const s = byAnalysis.get(id)!;
  return runAnalysis(id, input ?? s.sample, { ...s.options, ...options });
}
describe('本地数据与开发诊断', () => {
  it('按组合键而非顺序匹配，保留重复键和带换行的字段', async () => {
    const report = parseCsv(
      await run('reconcile', 'id,sku,note\n001,A,"a,b"\n1,A,x\n1,A,y\n3,Z,ok', {
        keys: 'id,sku',
        target: 'sku,note,id\nZ,ok,3\nA,"a\nb",001\nX,new,4',
      }),
      ',',
    );
    expect(report.slice(1)).toEqual([
      ['变更', '001', 'A', 'note', 'a,b', 'a\nb'],
      ['重复键', '1', 'A', '记录数', '2', '0'],
      ['仅右表', '4', 'X', '整行', '', '["X","new","4"]'],
    ]);
    expect(await run('csv-health')).toContain('重复');
    expect(await run('pivot')).toContain('杭州,28');
  });
  it('映射数组及嵌套字段，稳定替名，仅改指定字段', async () => {
    expect(JSON.parse(await run('json-map'))[0]).toEqual({ id: '001', detail: { skus: ['A', 'B'] } });
    const rows = parseCsv(await run('pseudonym'), ',');
    expect(rows[1][1]).toBe(rows[3][1]);
    expect(rows[1][2]).toBe('广州');
    await expect(run('json-map', undefined, { mapping: '{"__proto__.x":"order.no"}' })).rejects.toThrow();
  });
  it('SQL 保留引号中的问号，按类型转义，缺少绑定时保留原文', async () => {
    expect(
      await run(
        'mybatis-sql',
        "==> Preparing: SELECT '?', ?, ?, ? /* ? */\n==> Parameters: O'Brien(String), null, 4(Integer)",
      ),
    ).toContain("'?', 'O''Brien', NULL, 4 /* ? */");
    expect(await run('mybatis-sql', 'Preparing: select ? , ?\nParameters: 1(Integer)')).toContain(
      '占位符 2 个',
    );
  });
  it('检查日志与映射中的实际位置、时长和锁归属', async () => {
    expect(await run('thread-dump')).toContain('0x01 → worker-2');
    expect(await run('gc-pauses')).toContain('17.2');
    expect(await run('maven-path')).toContain('demo:app:jar:1.0 → org.demo:api:jar:2.0:compile');
    expect(await run('pg-plan')).toContain('25.00');
    expect(await run('source-map')).toMatch(/src\/main.ts[\s\S]*未匹配/);
    expect(await run('cpu-profile', undefined, { mode: 'timeline' })).toContain('1.5,main');
    expect(await run('har-waterfall', undefined, { sort: 'domain' })).toContain('example.org,1,256,100');
    expect(await run('bundle-size')).toContain('100,120,20');
  });
  it('校对契约、Profile、构建依赖及 Git 忽略规则', async () => {
    const spec = (after: boolean) =>
      JSON.stringify({
        openapi: '3.0.0',
        paths: {
          '/v': {
            get: {
              parameters: [
                { name: 'key', in: 'query', required: after, schema: { enum: after ? [1] : [1, 2] } },
              ],
              responses: {
                200: {
                  content: {
                    'application/json': {
                      schema: { type: 'object', properties: after ? {} : { code: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      });
    const diff = await run('openapi-diff', spec(false), { target: spec(true) });
    for (const s of ['必填参数', '枚举收窄', '移除字段']) expect(diff).toContain(s);
    expect(await run('spring-config')).toContain('server.port,8082,环境变量,8080,8081,8082');
    expect(await run('git-ignore', 'cache/\n!cache/keep', { target: 'cache/keep' })).toContain('忽略,1');
    expect(await run('npm-lock-diff')).toContain('升级');
    expect(await run('sbom-diff')).toMatch(/MIT.*ISC/);
    expect(await run('proto-diff')).toMatch(/类型变化[\s\S]*已保留编号/);
    expect(await run('changelog')).toContain('## 破坏性变更');
  });
  it('缓存、Cookie、区间及月末工作日有可复核的边界', async () => {
    expect(await run('http-cache')).toContain('剩余秒数,270');
    expect(await run('cookie-context', undefined, { page: 'https://other.org', method: 'POST' })).toContain(
      '不发送',
    );
    expect(await run('rrule')).toContain('2026-02-27T09:00:00');
    expect(await run('intervals')).toContain('空档,2026-01-01T13:00:00.000Z,2026-01-01T15:00:00.000Z');
    expect(await run('geojson-map', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1]]]}')).toContain(
      '环未闭合',
    );
  });
  it('识别模板结构、文档问题及视觉输出中的保留项', async () => {
    expect(parseCsv(await run('ast-search'), ',')).toHaveLength(2);
    expect(await run('i18n-diff')).toContain('ICU 参数不一致');
    expect(await run('markdown-lint')).toContain('无效页内锚点');
    expect(await run('invisible')).toMatch(/零宽空格[\s\S]*CRLF/);
    expect(await run('tokens')).toContain('--space-md: 16px');
    expect(await run('css-grid')).toContain('grid-template-areas');
    await expect(run('css-grid', 'a b\nb a')).rejects.toThrow('矩形');
    const svg = await run('svg-optimize');
    for (const s of ['id="dot"', 'viewBox', '<title>']) expect(svg).toContain(s);
  });
});
describe('文件检查与无损导出', () => {
  it('大文件入口读取超过文本编辑器上限的 HAR 并导出完整记录', async () => {
    const entry = JSON.parse(byAnalysis.get('har-waterfall')!.sample).log.entries[0];
    const file = new File(
      [
        JSON.stringify({
          comment: 'x'.repeat(2_100_000),
          log: { entries: Array.from({ length: 720 }, () => entry) },
        }),
      ],
      'recording.har',
    );
    const report = await analyzeFile('har-waterfall', file, { sort: 'time' });
    expect(parseCsv(report.rows, ',')).toHaveLength(501);
    expect(parseCsv(report.data!, ',')).toHaveLength(721);
  });
  it('导入隐藏工作表、公式缓存及合并区域', async () => {
    const book = new ExcelJS.Workbook(),
      s = book.addWorksheet('金额');
    s.getCell('A1').value = { formula: '1+2', result: 3 };
    s.mergeCells('A2:B2');
    book.addWorksheet('隐藏').state = 'hidden';
    const file = new File([new Uint8Array(await book.xlsx.writeBuffer())], 'a.xlsx'),
      r = await analyzeFile('excel-inspect', file, {});
    expect(r.summary).toMatch(/hidden[\s\S]*A2:B2/);
    expect(r.rows).toContain('A1,1+2,3');
    expect(r.data).toMatch(/^3,/);
  });
  it('读取 Parquet 选列、类型和空值数', async () => {
    const file = new File(
      [
        parquetWriteBuffer({
          columnData: [
            { name: 'id', data: ['001', '002'] },
            { name: 'amount', type: 'INT32', data: [null, 4] },
          ],
        }),
      ],
      'a.parquet',
    );
    const r = await analyzeFile('parquet-view', file, { columns: 'amount' });
    expect(r.data).toBe('amount\r\n\r\n4');
    expect(r.rows).toContain('amount,INT32,1');
  });
  it('比较 ZIP 真正字节与清单、在 JAR 中读取入口', async () => {
    const a = new JSZip();
    a.file('META-INF/MANIFEST.MF', 'Main-Class: demo.App');
    a.file('a/x', 'hello');
    a.file('b/x', 'a');
    const file = new File([await a.generateAsync({ type: 'arraybuffer' })], 'demo.jar');
    a.file('a/x', 'HELLO');
    a.remove('b/x');
    a.file('lib/b.jar', 'new');
    const next = new File([await a.generateAsync({ type: 'arraybuffer' })], 'b.zip');
    expect((await analyzeFile('jar-inspect', file, {})).summary).toContain('demo.App');
    expect((await analyzeFile('zip-inventory', file, {}, next)).rows).toMatch(
      /变更,a\/x,5,5,0[\s\S]*删除,b\/x[\s\S]*新增,lib\/b.jar/,
    );
    expect(() => archiveEntries(new ArrayBuffer(8))).toThrow();
  });
  it('GB18030 解码、BOM 与 UTF-16 字节复读一致', async () => {
    const r = await analyzeFile(
      'encoding-repair',
      new File([new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])], 'a.txt'),
      { dest: 'utf-16le' },
    );
    expect(r.summary).toContain('GB18030');
    expect(new TextDecoder('utf-16le').decode(await r.blob!.arrayBuffer())).toBe('中文');
    const patch = await analyzeFile('encoding-repair', new File(['FranÃ§ais'], 's.txt'), {
      repair: 'latin1',
    });
    expect(patch.sourceText).toBe('Français');
  });
  it('读取真实 X.509 PEM 与 DER、报告签名冲突与未知字节', async () => {
    const pem = rootCertificates[0];
    const der = Uint8Array.from(Buffer.from(pem.replace(/-----.*?-----|\s+/g, ''), 'base64'));
    const a = await analyzeFile('cert-inspect', new File([pem], 'a.pem'), { host: 'unrelated.invalid' }),
      b = await analyzeFile('cert-inspect', new File([der], 'a.der'), { host: 'unrelated.invalid' });
    expect(a.rows).toBe(b.rows);
    expect(a.rows).toContain('不匹配');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOkHA/cAAAAASUVORK5CYII=',
      'base64',
    );
    expect((await analyzeFile('file-signature', new File([png], 'x.jpg'), {})).summary).toContain('不符');
  });
});
describe('现有工具扩展', () => {
  it('三方合并保留双方独立编辑，冲突保留三种选择', async () => {
    expect(
      JSON.parse(await upgrade('diff', 'a\nB\nc\nd', { base: 'a\nb\nc\nd', target: 'a\nb\nc\nD' })),
    ).toEqual([{ ok: ['a', 'B', 'c', 'D'] }]);
    expect(JSON.parse(await upgrade('diff', 'A', { base: 'O', target: 'B' }))[0].conflict).toMatchObject({
      a: ['A'],
      o: ['O'],
      b: ['B'],
    });
  });
  it('补丁转义路径并能应用到另一记录，TOML 不丢弃 null', async () => {
    const r = JSON.parse(
      await upgrade('json', '{"a/b":1}', { target: '{"a/b":2}', third: '{"a/b":8,"id":9}' }),
    );
    expect(r.patch[0].path).toBe('/a~1b');
    expect(r.result.id).toBe(9);
    expect(JSON.parse(await upgrade('json', 'null', { target: '3', third: 'null' })).result).toBe(3);
    await expect(upgrade('yaml', 'a: null', { direction: 'yaml-toml' })).rejects.toThrow('null');
    expect(await upgrade('yaml', '[app]\nports=[80,81]', { direction: 'toml-yaml' })).toContain('ports');
  });
  it('SQL 方言引号与 NULL，cURL 参数和危险 shell 语法', async () => {
    const sql = await upgrade(
      'sql',
      JSON.stringify([
        { s: "O'Brien", n: null },
        { s: '', n: 2 },
      ]),
      { table: 'schema.orders', columns: 's,n', batch: '1', dialect: 'postgresql' },
    );
    expect(
      await upgrade('sql', '[{"id":9007199254740993,"amount":1.2300}]', { table: 'orders', batch: '1' }),
    ).toContain('(9007199254740993, 1.2300)');
    expect(sql).toMatch(/O''Brien', NULL[\s\S]*INSERT INTO[\s\S]*\('', 2\)/);
    expect(
      await upgrade('http-code', "curl 'https://x.test' -H 'X-A: a b' --data-raw 'k=2'", { style: 'fetch' }),
    ).toContain('fetch(');
    await expect(upgrade('http-code', 'curl https://x.test --mystery', { style: 'fetch' })).rejects.toThrow(
      '未支持',
    );
  });
  it('UTC 时间计算、DST 折叠和跳过', async () => {
    expect(await upgrade('timestamp', '1000\n-1000', { unit: 'ms' })).toContain('-2000,-2000');
    const opt = { zone: 'America/New_York', count: '3', start: '2026-11-01T00:00Z' };
    const fold = await upgrade('cron', '30 1 * * *', opt);
    expect(fold).toContain('2026-11-01T05:30:00');
    expect(fold).toContain('2026-11-01T06:30:00');
    const gap = await upgrade('cron', '30 2 * * *', { ...opt, start: '2026-03-08T00:00Z' });
    expect(gap).not.toContain('2026-03-08T');
  });
  it('UUID v7 时间往返、clamp 两端和 WGS84 反解', async () => {
    const id = await upgrade('uuid', '1', {});
    expect(await upgrade('uuid', id, {})).toContain(new Date().toISOString().slice(0, 10));
    const c = clampValues({ fromWidth: '320', toWidth: '1280', fromSize: '14', toSize: '22' });
    expect(c.intercept + 1280 * c.slope).toBeCloseTo(22);
    expect(await upgrade('geo-coordinates', '0,0', { target: '1,0' })).toContain(
      '111319.491,111.319491,90.000000',
    );
  });
});
