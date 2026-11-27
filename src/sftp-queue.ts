import { lanRequest } from './lan-api';
import { downloadBlob } from './files';
import {
  BrowserSite,
  childPath,
  validName,
  webDownload,
  webUpload,
  type Entry,
  type Side,
  type Site,
} from './sftp-sites';

export type Decision = { action: 'skip' | 'overwrite' | 'rename'; name?: string; all?: boolean };
type State = 'held' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
export type Job = {
  id: number;
  side: Side;
  source: Entry;
  from: string;
  to: string;
  state: State;
  bytes: number;
  total: number;
  current: string;
  count: number;
  files: number;
  skipped: number;
  speed: number;
  fileBytes: number;
  fileSize: number;
  error: string;
};
type Part = { entry: Entry; parent: string; relative: string; parentRelative: string };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SftpQueue {
  jobs: Job[] = [];
  paused = false;
  private sequence = 0;
  private active?: { job: Job; controller: AbortController; transferId?: string };
  private disposed = false;
  private contexts = new Map<number, BrowserSite | undefined>();
  private completed = new Map<number, Set<string>>();
  private id = '';
  private sites!: Record<Side, Site>;
  constructor(
    private changed: () => void,
    private refresh: (side: Side) => void,
    private conflict: (name: string, signal: AbortSignal) => Promise<Decision>,
  ) {}

  add(side: Side, entries: Entry[], from: string, to: string, hold: boolean, browser?: BrowserSite) {
    const jobs = entries
      .filter((entry) => entry.kind !== 'other')
      .map((source) => ({
        id: ++this.sequence,
        side,
        source,
        from,
        to,
        state: (hold ? 'held' : 'waiting') as State,
        bytes: 0,
        total: source.size || 0,
        current: '',
        count: 0,
        files: 0,
        skipped: 0,
        speed: 0,
        fileBytes: 0,
        fileSize: 0,
        error: '',
      }));
    for (const job of jobs) this.contexts.set(job.id, browser);
    this.jobs.push(...jobs);
    if (!hold) this.paused = false;
    this.changed();
    void this.pump();
  }
  process() {
    this.paused = false;
    for (const job of this.jobs) if (job.state === 'held') job.state = 'waiting';
    this.changed();
    void this.pump();
  }
  pause() {
    this.paused = true;
    this.changed();
  }
  cancel(job: Job) {
    if (this.active?.job === job) {
      this.active.controller.abort();
      if (this.active.transferId)
        void lanRequest('file-cancel', { id: this.id, transferId: this.active.transferId }).catch(() => {});
    } else job.state = 'cancelled';
    this.changed();
  }
  retry(job: Job) {
    job.state = 'waiting';
    job.error = '';
    this.paused = false;
    this.changed();
    void this.pump();
  }
  clear(states: State[]) {
    for (const job of this.jobs.filter((job) => states.includes(job.state))) {
      this.completed.delete(job.id);
      this.contexts.delete(job.id);
    }
    this.jobs = this.jobs.filter((job) => !states.includes(job.state));
    this.changed();
  }
  attach(id: string, sites: Record<Side, Site>) {
    this.disposed = false;
    if (id !== this.id && this.jobs.some((job) => ['held', 'waiting', 'running'].includes(job.state)))
      this.paused = true;
    this.id = id;
    this.sites = sites;
  }
  dispose() {
    this.disposed = true;
    if (this.active) this.cancel(this.active.job);
  }
  private async pump() {
    if (!this.id || this.disposed || this.paused || this.active) return;
    const job = this.jobs.find((job) => job.state === 'waiting');
    if (!job) return;
    const controller = new AbortController();
    this.active = { job, controller };
    Object.assign(job, {
      state: 'running',
      current: '正在读取文件清单',
      bytes: 0,
      total: 0,
      count: 0,
      files: 0,
      skipped: 0,
      speed: 0,
      fileBytes: 0,
      fileSize: 0,
    });
    this.changed();
    try {
      await this.copy(job, controller.signal);
      job.state = 'done';
      this.completed.delete(job.id);
      this.contexts.delete(job.id);
    } catch (error) {
      job.state = controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = controller.signal.aborted ? '已取消' : (error as Error).message;
    } finally {
      this.active = undefined;
      if (!this.disposed) {
        this.changed();
        this.refresh(job.side === 'local' ? 'remote' : 'local');
        void this.pump();
      }
    }
  }
  private async copy(job: Job, signal: AbortSignal) {
    const browser = this.contexts.get(job.id),
      local = browser || this.sites.local;
    const uploading = job.side === 'local',
      source = uploading ? local : this.sites.remote,
      dest = uploading ? this.sites.remote : local;
    const systemDownload = !uploading && browser && !browser.root;
    const plan: Part[] = [];
    const visited = new Set<string>();
    async function scan(entry: Entry, parent: string, parentRelative: string) {
      signal.throwIfAborted();
      const relative = parentRelative ? childPath(parentRelative, entry.name) : validName(entry.name);
      if (entry.kind === 'other') {
        job.skipped++;
        return;
      }
      plan.push({ entry, parent, relative, parentRelative });
      if (entry.kind === 'directory') {
        const listing = await source.list(entry.path);
        if (visited.has(listing.directory)) throw new Error('目录出现循环：' + entry.path);
        visited.add(listing.directory);
        for (const child of listing.entries) await scan(child, listing.directory, relative);
      } else {
        job.files++;
        job.total += entry.size || 0;
      }
    }
    await scan(job.source, job.from, '');
    signal.throwIfAborted();
    const archive =
      systemDownload && job.source.kind === 'directory' ? new (await import('jszip')).default() : undefined;
    if (archive && job.total > 256 * 1024 * 1024)
      throw new Error('浏览器目录打包超过 256 MiB，请使用可写本机目录或桌面端。');
    const dirs = new Map([['', job.to]]);
    const completed = systemDownload ? new Set<string>() : this.completed.get(job.id) || new Set<string>();
    this.completed.set(job.id, completed);
    let policy: Decision | undefined;
    for (const { entry, parent, relative, parentRelative } of plan) {
      while (this.paused && !signal.aborted) {
        job.current = '队列已暂停';
        this.changed();
        await sleep(250);
      }
      signal.throwIfAborted();
      job.fileSize = entry.kind === 'file' ? entry.size || 0 : 0;
      job.fileBytes = 0;
      job.speed = 0;
      job.current = relative;
      this.changed();
      const target = dirs.get(parentRelative)!;
      if (entry.kind === 'directory') {
        if (archive) {
          archive.folder(relative);
          dirs.set(relative, relative);
        } else dirs.set(relative, await dest.mkdir(target, entry.name, true));
        continue;
      }
      const size = entry.size || 0,
        before = job.bytes,
        start = performance.now();
      if (completed.has(relative)) {
        job.count++;
        job.bytes += size;
        continue;
      }
      let lastUpdate = 0,
        name = entry.name,
        overwrite = false;
      const progress = (bytes: number) => {
        job.fileBytes = bytes;
        job.bytes = before + bytes;
        const now = performance.now();
        job.speed = (bytes * 1000) / Math.max(1, now - start);
        if (now - lastUpdate > 140) {
          lastUpdate = now;
          this.changed();
        }
      };
      for (;;) {
        signal.throwIfAborted();
        try {
          if (systemDownload) {
            const blob = await webDownload(this.id, entry.path, signal, progress);
            signal.throwIfAborted();
            if (archive) archive.file(relative, blob!);
            else downloadBlob(blob!, name);
          } else await this.transfer(job, entry, parent, target, name, overwrite, signal, progress);
          completed.add(relative);
          break;
        } catch (error) {
          signal.throwIfAborted();
          if (!/目标已有同名文件/.test((error as Error).message) && (error as { status?: number }).status !== 409)
            throw error;
          const decision = policy || (await this.conflict(name, signal));
          if (decision.all && decision.action !== 'rename') policy = decision;
          if (decision.action === 'skip') {
            job.skipped++;
            break;
          }
          if (decision.action === 'overwrite' && overwrite) throw error;
          overwrite = decision.action === 'overwrite';
          if (!overwrite) name = validName(decision.name || '');
        }
      }
      job.bytes = before + size;
      job.count++;
      this.changed();
    }
    if (archive) {
      job.current = '正在生成 ZIP';
      this.changed();
      const zip = await archive.generateAsync({ type: 'blob' }, () => signal.throwIfAborted());
      signal.throwIfAborted();
      downloadBlob(zip, job.source.name + '.zip');
    }
  }
  private async transfer(
    job: Job,
    entry: Entry,
    parent: string,
    target: string,
    name: string,
    overwrite: boolean,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ) {
    const uploading = job.side === 'local';
    const browser = this.contexts.get(job.id);
    if (browser && !uploading) {
      const dir = await browser.handle(target);
      const exists = await browser.exists(dir, name);
      if (exists && !overwrite) throw new Error('目标已有同名文件。');
      signal.throwIfAborted();
      const handle = await dir.getFileHandle(name, { create: true });
      const sink = await handle.createWritable();
      try {
        await webDownload(this.id, entry.path, signal, progress, sink);
      } catch (error) {
        await sink.abort().catch(() => {});
        if (!exists) await dir.removeEntry(name).catch(() => {});
        throw error;
      }
      return;
    }
    const transferId = String(job.id) + '-' + ++this.sequence;
    const active = this.active!;
    active.transferId = transferId;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await lanRequest<{ transfer?: { id: string; bytes: number } }>('file-status', { id: this.id });
        if (active.transferId === transferId && result.transfer?.id === transferId) progress(result.transfer.bytes);
      } catch {
        /* The copy request reports connection errors. */
      }
      if (active.transferId === transferId && !signal.aborted) timer = setTimeout(poll, 250);
    };
    timer = setTimeout(poll, 200);
    try {
      if (browser)
        await webUpload(this.id, target, name, await browser.file(parent, entry.name), transferId, overwrite, signal);
      else
        await lanRequest(uploading ? 'sftp-upload' : 'sftp-download', {
          id: this.id,
          transferId,
          overwrite,
          localDirectory: uploading ? parent : target,
          localName: uploading ? entry.name : name,
          path: uploading ? target : entry.path,
          name,
        });
    } finally {
      active.transferId = undefined;
      clearTimeout(timer);
    }
  }
}
