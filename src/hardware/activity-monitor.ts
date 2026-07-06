import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * A live activity sample: whole-host CPU / memory / temperature (the "am I approaching capacity?"
 * signals) plus a per-process breakdown of the plugin's process tree (signalk-server + the go2rtc and
 * ffmpeg children it spawned). GPU load isn't queryable on the target hardware (a Pi has no usable GPU
 * counter), so the third axis is TEMPERATURE — the honest proxy for a fanless SBC nearing its limit,
 * where the real failure mode is thermal throttling, not a saturated GPU.
 *
 * CPU% needs two reads over time, so the shape is: take a cheap {@link ActivitySnapshot} on each poll
 * and {@link deriveActivity} against the previous one. The first poll (no previous) reports host load
 * from the load average and 0% per-process until the next tick establishes a delta.
 */

export interface IProcessActivity {
  pid: number;
  /** The process's `comm` (e.g. `node`, `go2rtc`, `ffmpeg`). */
  name: string;
  /** CPU use over the sample window, as a percentage of ONE core (top-style; can exceed 100). */
  cpuPercent: number;
  /** Resident set size in bytes. */
  rssBytes: number;
}

export interface IActivitySample {
  cpu: {
    cores: number;
    /** Whole-host CPU busy fraction 0..1 (from /proc/stat delta, or the load average on the first
     *  poll / a host without /proc). */
    utilization: number;
    /** 1-minute load average — the sustained-pressure signal, distinct from the instantaneous %. */
    loadAvg1: number;
  };
  memory: { totalBytes: number; usedBytes: number; utilization: number };
  /** SoC temperature in °C, or null where the host doesn't expose one. */
  temperatureC: number | null;
  /** The plugin's process tree, largest CPU first (capped). */
  processes: IProcessActivity[];
}

export interface IActivityVerdict {
  /** Coarse headroom: ok → busy → high → critical. */
  level: 'ok' | 'busy' | 'high' | 'critical';
  /** One-line plain-language summary for the operator. */
  headline: string;
  /** The specific pressure(s) driving the level, for the detail line. */
  reasons: string[];
}

/** Injectable host readers (default to node:os + /proc + /sys), so the sampler is unit-testable. */
export interface IActivityReaders {
  now?: () => number;
  /** Read a small text file (a /proc or /sys entry), or null if it's absent/unreadable. */
  readText?: (path: string) => string | null;
  /** The numeric pids under /proc. */
  listPids?: () => number[];
  loadAvg1?: () => number;
  cores?: () => number;
  memInfo?: () => { totalBytes: number; freeBytes: number };
  /** Linux clock ticks per second (SC_CLK_TCK); 100 on essentially all Linux builds. */
  clockTicks?: number;
  /** Memory page size in bytes; 4096 on the target hardware. */
  pageSize?: number;
}

/** One raw process line parsed from /proc/<pid>/stat. */
interface IRawProc {
  pid: number;
  ppid: number;
  comm: string;
  cpuJiffies: number;
  rssBytes: number;
}

export interface IActivitySnapshot {
  atMs: number;
  /** Aggregate /proc/stat counters, or null on a host without it. */
  cpuTotal: { busy: number; total: number } | null;
  loadAvg1: number;
  cores: number;
  memTotalBytes: number;
  memUsedBytes: number;
  temperatureC: number | null;
  procs: IRawProc[];
}

const TEMP_ZONES = [
  '/sys/class/thermal/thermal_zone0/temp',
  '/sys/class/thermal/thermal_zone1/temp',
];
const MAX_PROCESSES = 8; // the biggest few contributors — the wall doesn't need the whole table
// Minimum wall-clock between two snapshots for a CPU delta to be meaningful (guards concurrent polls).
const MIN_DELTA_SEC = 0.2;

const defaultReadText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const defaultListPids = (): number[] => {
  try {
    return readdirSync('/proc')
      .filter((n) => /^\d+$/.test(n))
      .map((n) => Number(n));
  } catch {
    return [];
  }
};

/** Parse one /proc/<pid>/stat line. `comm` may contain spaces/parens, so split on the LAST ')'. */
export function parseProcStat(line: string): IRawProc | null {
  const open = line.indexOf('(');
  const close = line.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const pid = Number(line.slice(0, open).trim());
  const comm = line.slice(open + 1, close);
  // Fields from the one after comm: rest[0]=state(3), rest[1]=ppid(4), rest[11]=utime(14),
  // rest[12]=stime(15), rest[21]=rss-in-pages(24).
  const rest = line
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  if (rest.length < 22) return null;
  const ppid = Number(rest[1]);
  const cpuJiffies = Number(rest[11]) + Number(rest[12]);
  const rssPages = Number(rest[21]);
  if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;
  return { pid, ppid, comm, cpuJiffies, rssBytes: rssPages }; // pages → bytes applied by caller
}

/** Parse the aggregate `cpu ...` line of /proc/stat into {busy,total}. */
export function parseProcStatCpu(procStat: string): { busy: number; total: number } | null {
  const line = procStat.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const nums = line.trim().split(/\s+/).slice(1).map(Number);
  if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) return null;
  const total = nums.reduce((a, b) => a + b, 0);
  const idle = nums[3] + (nums[4] ?? 0); // idle + iowait
  return { busy: total - idle, total };
}

/**
 * Parse /proc/meminfo into {totalBytes, availableBytes}. `MemAvailable` (not `MemFree`) is the kernel's
 * own estimate of memory available for new work WITHOUT swapping — it counts reclaimable page cache and
 * buffers as available. Using MemFree instead would read chronically high on a device doing video I/O
 * (go2rtc/ffmpeg fill the page cache), so the meter would cry "memory full" when gigabytes are
 * reclaimable. Values in /proc/meminfo are kB. Returns null if the fields aren't present.
 */
export function parseMemInfo(text: string): { totalBytes: number; availableBytes: number } | null {
  const kb = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm').exec(text);
    return m ? Number(m[1]) * 1024 : null;
  };
  const totalBytes = kb('MemTotal');
  const availableBytes = kb('MemAvailable');
  if (totalBytes === null || availableBytes === null) return null;
  return { totalBytes, availableBytes };
}

/** Read a thermal-zone file (millidegrees C) into °C, trying the common zones. */
function readTemperature(readText: (p: string) => string | null): number | null {
  for (const zone of TEMP_ZONES) {
    const raw = readText(zone);
    if (raw) {
      const milli = Number(raw.trim());
      if (Number.isFinite(milli) && milli > 0) return Math.round(milli / 100) / 10;
    }
  }
  return null;
}

/** Take one instantaneous activity snapshot. Cheap; call it on each poll and derive against the last. */
export function takeSnapshot(readers: IActivityReaders = {}): IActivitySnapshot {
  const now = readers.now ?? Date.now;
  const readText = readers.readText ?? defaultReadText;
  const listPids = readers.listPids ?? defaultListPids;
  const loadAvg1 = readers.loadAvg1 ?? (() => loadavg()[0]);
  const cores = readers.cores ?? (() => cpus().length);
  const pageSize = readers.pageSize ?? 4096;
  // Prefer /proc/meminfo MemAvailable (reclaimable cache counted as free); fall back to node:os on a
  // host without /proc (macOS dev), where os.freemem() is the best available signal.
  const memInfo =
    readers.memInfo ??
    (() => {
      const raw = readText('/proc/meminfo');
      const parsed = raw ? parseMemInfo(raw) : null;
      return parsed
        ? { totalBytes: parsed.totalBytes, freeBytes: parsed.availableBytes }
        : { totalBytes: totalmem(), freeBytes: freemem() };
    });

  const procStat = readText('/proc/stat');
  const cpuTotal = procStat ? parseProcStatCpu(procStat) : null;
  const mem = memInfo();

  const procs: IRawProc[] = [];
  for (const pid of listPids()) {
    const raw = readText(`/proc/${pid}/stat`);
    if (!raw) continue;
    const parsed = parseProcStat(raw);
    if (parsed) procs.push({ ...parsed, rssBytes: parsed.rssBytes * pageSize });
  }

  return {
    atMs: now(),
    cpuTotal,
    loadAvg1: loadAvg1(),
    cores: cores(),
    memTotalBytes: mem.totalBytes,
    memUsedBytes: Math.max(0, mem.totalBytes - mem.freeBytes),
    temperatureC: readTemperature(readText),
    procs,
  };
}

/** Collect the pids of `rootPid` and all its descendants from a snapshot's process list. */
function processTree(procs: IRawProc[], rootPid: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const p of procs) {
    const list = childrenOf.get(p.ppid) ?? [];
    list.push(p.pid);
    childrenOf.set(p.ppid, list);
  }
  const tree = new Set<number>();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    if (tree.has(pid)) continue;
    tree.add(pid);
    for (const child of childrenOf.get(pid) ?? []) stack.push(child);
  }
  return tree;
}

/**
 * Derive a usable sample by comparing the current snapshot to the previous one. Host CPU% comes from
 * the /proc/stat delta (falling back to load-average/cores on the first poll or a host without /proc);
 * per-process CPU% comes from each pid's jiffie delta over the elapsed wall-clock. Only the plugin's
 * process tree (rootPid + descendants) is reported, largest CPU first.
 */
export function deriveActivity(
  prev: IActivitySnapshot | null,
  next: IActivitySnapshot,
  opts: { rootPid: number; clockTicks?: number },
): IActivitySample {
  const clockTicks = opts.clockTicks ?? 100;
  const cores = next.cores || 1;

  // Only trust a delta when enough wall-clock elapsed. `prevActivitySnapshot` is shared across all
  // callers, so two overlapping polls (two tabs, a helm + a phone) can land ~1 ms apart; a tiny
  // interval divides a 1-jiffie delta into a nonsense 1000% spike. Below the floor, fall back to the
  // load-average proxy / 0% per-process instead of amplifying noise.
  const elapsedSec = prev ? (next.atMs - prev.atMs) / 1000 : 0;
  const haveDelta = elapsedSec >= MIN_DELTA_SEC;

  let utilization: number;
  if (prev?.cpuTotal && next.cpuTotal && haveDelta && next.cpuTotal.total > prev.cpuTotal.total) {
    const busyDelta = next.cpuTotal.busy - prev.cpuTotal.busy;
    const totalDelta = next.cpuTotal.total - prev.cpuTotal.total;
    utilization = clamp01(busyDelta / totalDelta);
  } else {
    utilization = clamp01(next.loadAvg1 / cores); // first poll / no /proc: sustained-load proxy
  }

  const prevJiffies = new Map(prev?.procs.map((p) => [p.pid, p.cpuJiffies]) ?? []);
  const tree = processTree(next.procs, opts.rootPid);

  const processes: IProcessActivity[] = next.procs
    .filter((p) => tree.has(p.pid))
    .map((p) => {
      const before = prevJiffies.get(p.pid);
      const cpuPercent =
        haveDelta && before !== undefined
          ? Math.max(0, ((p.cpuJiffies - before) / clockTicks / elapsedSec) * 100)
          : 0;
      return { pid: p.pid, name: p.comm, cpuPercent: round1(cpuPercent), rssBytes: p.rssBytes };
    })
    .sort((a, b) => b.cpuPercent - a.cpuPercent || b.rssBytes - a.rssBytes)
    .slice(0, MAX_PROCESSES);

  return {
    cpu: { cores, utilization: round2(utilization), loadAvg1: round2(next.loadAvg1) },
    memory: {
      totalBytes: next.memTotalBytes,
      usedBytes: next.memUsedBytes,
      utilization: round2(next.memTotalBytes ? next.memUsedBytes / next.memTotalBytes : 0),
    },
    temperatureC: next.temperatureC,
    processes,
  };
}

// Pi throttling begins ~80–85°C; warn a little below so the operator sees it coming.
const TEMP_HIGH_C = 80;
const TEMP_WARN_C = 70;
const CPU_HIGH = 0.9;
const CPU_BUSY = 0.7;
const MEM_HIGH = 0.9;
const MEM_BUSY = 0.8;

/**
 * A coarse, honest capacity verdict from a sample: the worst of CPU, memory, and temperature. Kept
 * deliberately simple — it's a "you're approaching the limit" nudge, not a precise SLA.
 */
const LEVELS = ['ok', 'busy', 'high', 'critical'] as const;

export function assessCapacity(sample: IActivitySample): IActivityVerdict {
  const reasons: string[] = [];
  let rank = 0; // index into LEVELS

  const cpuPct = Math.round(sample.cpu.utilization * 100);
  if (sample.cpu.utilization >= CPU_HIGH) {
    rank = Math.max(rank, 2);
    reasons.push(`CPU ${cpuPct}%`);
  } else if (sample.cpu.utilization >= CPU_BUSY) {
    rank = Math.max(rank, 1);
    reasons.push(`CPU ${cpuPct}%`);
  }

  const memPct = Math.round(sample.memory.utilization * 100);
  if (sample.memory.utilization >= MEM_HIGH) {
    rank = Math.max(rank, 2);
    reasons.push(`memory ${memPct}%`);
  } else if (sample.memory.utilization >= MEM_BUSY) {
    rank = Math.max(rank, 1);
    reasons.push(`memory ${memPct}%`);
  }

  if (sample.temperatureC !== null) {
    if (sample.temperatureC >= TEMP_HIGH_C) {
      rank = Math.max(rank, 3); // at/above the throttle point the device is actively slowing itself
      reasons.push(`temperature ${Math.round(sample.temperatureC)}°C — throttling likely`);
    } else if (sample.temperatureC >= TEMP_WARN_C) {
      rank = Math.max(rank, 1);
      reasons.push(`temperature ${Math.round(sample.temperatureC)}°C`);
    }
  }

  const level = LEVELS[rank];
  const headline =
    level === 'critical'
      ? 'At capacity — the device is likely throttling.'
      : level === 'high'
        ? 'Running hot — near this device’s limit.'
        : level === 'busy'
          ? 'Working, with headroom to spare.'
          : 'Plenty of headroom.';
  return { level, headline, reasons };
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
