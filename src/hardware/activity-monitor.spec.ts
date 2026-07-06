import { describe, it, expect } from 'vitest';
import {
  parseProcStat,
  parseProcStatCpu,
  parseMemInfo,
  takeSnapshot,
  deriveActivity,
  assessCapacity,
  type IActivityReaders,
} from './activity-monitor';

describe('parseProcStat', () => {
  it('parses pid, ppid, cpu jiffies, and rss even when comm has spaces/parens', () => {
    // comm = "go (2) rtc" exercises the last-')' split. Fields after comm: [0]=state, [1]=ppid(4),
    // [11]=utime(14), [12]=stime(15), [21]=rss-pages(24).
    const f = Array.from({ length: 22 }, () => '0');
    f[1] = '1'; // ppid
    f[11] = '100'; // utime
    f[12] = '50'; // stime
    f[21] = '200'; // rss pages
    const line = `4242 (go (2) rtc) ${f.join(' ')}`;
    const p = parseProcStat(line);
    expect(p).not.toBeNull();
    expect(p!.pid).toBe(4242);
    expect(p!.ppid).toBe(1);
    expect(p!.comm).toBe('go (2) rtc');
    expect(p!.cpuJiffies).toBe(150);
    expect(p!.rssBytes).toBe(200); // still in pages here; the caller multiplies by page size
  });

  it('returns null for a malformed line', () => {
    expect(parseProcStat('garbage')).toBeNull();
    expect(parseProcStat('123 (short) S 1')).toBeNull();
  });
});

describe('parseProcStatCpu', () => {
  it('sums the aggregate cpu line and treats idle+iowait as idle', () => {
    const r = parseProcStatCpu('cpu  100 0 50 800 40 0 10 0 0 0\ncpu0 ...');
    expect(r).toEqual({ busy: 100 + 50 + 10, total: 1000 }); // total 1000, idle=800+40 → busy 160
  });
  it('returns null without a cpu line', () => {
    expect(parseProcStatCpu('intr 1 2 3')).toBeNull();
  });
});

describe('parseMemInfo', () => {
  it('uses MemAvailable (not MemFree) so reclaimable cache is not counted as used', () => {
    const text = [
      'MemTotal:        8000000 kB',
      'MemFree:          200000 kB', // low — page cache fills it on a device doing video I/O
      'MemAvailable:    6000000 kB', // the honest "free for new work" figure
      'Buffers:          100000 kB',
    ].join('\n');
    expect(parseMemInfo(text)).toEqual({
      totalBytes: 8000000 * 1024,
      availableBytes: 6000000 * 1024,
    });
  });
  it('returns null when the fields are missing', () => {
    expect(parseMemInfo('MemTotal: 8000000 kB')).toBeNull(); // no MemAvailable
    expect(parseMemInfo('garbage')).toBeNull();
  });
});

// A tiny fake /proc: signalk-server (pid 10) spawned go2rtc (20) which spawned ffmpeg (30); pid 99 is
// an unrelated process that must NOT appear in the plugin's tree.
function fakeReaders(
  over: Partial<IActivityReaders> & { files: Record<string, string> },
): IActivityReaders {
  return {
    now: () => 1_000,
    cores: () => 4,
    loadAvg1: () => 1.0,
    memInfo: () => ({ totalBytes: 8_000, freeBytes: 2_000 }),
    pageSize: 1, // keep rss numbers readable in the fixtures
    listPids: () =>
      Object.keys(over.files)
        .map((p) => /^\/proc\/(\d+)\/stat$/.exec(p)?.[1])
        .filter((x): x is string => !!x)
        .map(Number),
    readText: (p: string) => over.files[p] ?? null,
    ...over,
  };
}

const statLine = (
  pid: number,
  ppid: number,
  comm: string,
  jiffies: number,
  rssPages: number,
): string => {
  const f = Array.from({ length: 22 }, () => '0');
  f[1] = String(ppid); // field 4
  f[11] = String(jiffies); // utime (field 14); stime left 0
  f[21] = String(rssPages); // rss (field 24)
  return `${pid} (${comm}) ${f.join(' ')}`;
};

describe('takeSnapshot + deriveActivity', () => {
  const files = (procCpuBusyTotal: [number, number], jiffies: Record<number, number>) => ({
    '/proc/stat': `cpu  ${procCpuBusyTotal[0]} 0 0 ${procCpuBusyTotal[1] - procCpuBusyTotal[0]} 0 0 0`,
    '/proc/10/stat': statLine(10, 1, 'signalk-server', jiffies[10], 500),
    '/proc/20/stat': statLine(20, 10, 'go2rtc', jiffies[20], 300),
    '/proc/30/stat': statLine(30, 20, 'ffmpeg', jiffies[30], 800),
    '/proc/99/stat': statLine(99, 1, 'unrelated', jiffies[99], 100),
    '/sys/class/thermal/thermal_zone0/temp': '61234',
  });

  it('reports only the plugin process tree, largest CPU first, with per-process CPU% from the delta', () => {
    const prev = takeSnapshot(
      fakeReaders({ files: files([100, 1000], { 10: 10, 20: 20, 30: 30, 99: 5 }) }),
    );
    // 1 second later: total cpu +1000 jiffies; ffmpeg burned 200 jiffies, go2rtc 50, server 10.
    const nextReaders = fakeReaders({
      files: files([700, 2000], { 10: 20, 20: 70, 30: 230, 99: 500 }),
    });
    nextReaders.now = () => 2_000; // +1s
    const next = takeSnapshot(nextReaders);

    const sample = deriveActivity(prev, next, { rootPid: 10, clockTicks: 100 });
    const pids = sample.processes.map((p) => p.pid);
    expect(pids).toContain(10);
    expect(pids).toContain(20);
    expect(pids).toContain(30);
    expect(pids).not.toContain(99); // unrelated sibling excluded from the tree

    // ffmpeg burned the most: 200 jiffies / 100 ticks / 1s = 200% of one core; it sorts first.
    expect(sample.processes[0].name).toBe('ffmpeg');
    expect(sample.processes[0].cpuPercent).toBeCloseTo(200, 0);

    // Host CPU from the /proc/stat delta: busy +600 of total +1000 → 60%.
    expect(sample.cpu.utilization).toBeCloseTo(0.6, 2);
    expect(sample.memory.utilization).toBeCloseTo(0.75, 2); // (8000-2000)/8000
    expect(sample.temperatureC).toBeCloseTo(61.2, 1);
  });

  it('falls back to load-average/cores for host CPU on the first poll (no previous snapshot)', () => {
    const readers = fakeReaders({ files: files([100, 1000], { 10: 10, 20: 20, 30: 30, 99: 5 }) });
    readers.loadAvg1 = () => 2.0; // 2.0 / 4 cores = 0.5
    const next = takeSnapshot(readers);
    const sample = deriveActivity(null, next, { rootPid: 10 });
    expect(sample.cpu.utilization).toBeCloseTo(0.5, 2);
    expect(sample.processes.every((p) => p.cpuPercent === 0)).toBe(true); // no delta yet
  });

  it('handles a host without /proc or a thermal zone (macOS dev): no procs, temp null, load fallback', () => {
    const readers: IActivityReaders = {
      now: () => 1,
      cores: () => 8,
      loadAvg1: () => 4.0,
      memInfo: () => ({ totalBytes: 16_000, freeBytes: 8_000 }),
      listPids: () => [],
      readText: () => null, // nothing readable
    };
    const sample = deriveActivity(null, takeSnapshot(readers), { rootPid: 1 });
    expect(sample.processes).toEqual([]);
    expect(sample.temperatureC).toBeNull();
    expect(sample.cpu.utilization).toBeCloseTo(0.5, 2); // 4/8
  });

  it('computes memory from /proc/meminfo MemAvailable when memInfo is not injected', () => {
    // No memInfo override → the default reads the injected /proc/meminfo. MemFree is low (cache), but
    // MemAvailable says 6 GB free of 8 GB, so used = 2 GB → 25%, not the 95% MemFree would imply.
    const readers: IActivityReaders = {
      now: () => 1,
      cores: () => 4,
      loadAvg1: () => 1,
      listPids: () => [],
      readText: (p) =>
        p === '/proc/meminfo'
          ? 'MemTotal: 8000000 kB\nMemFree: 400000 kB\nMemAvailable: 6000000 kB'
          : null,
    };
    const sample = deriveActivity(null, takeSnapshot(readers), { rootPid: 1 });
    expect(sample.memory.utilization).toBeCloseTo(0.25, 2);
  });

  it('does not amplify a nonsense CPU% when two polls land within the delta floor', () => {
    // Shared prevSnapshot: two overlapping polls ~1 ms apart. A 1-jiffie delta over 1 ms must NOT
    // become 1000% — below MIN_DELTA_SEC we report 0% and fall back to the load-average proxy.
    const prev = takeSnapshot(
      fakeReaders({ files: files([100, 1000], { 10: 10, 20: 20, 30: 30 }) }),
    );
    const nextReaders = fakeReaders({ files: files([101, 1001], { 10: 11, 20: 21, 30: 31 }) });
    nextReaders.now = () => 1_001; // +1 ms
    const sample = deriveActivity(prev, takeSnapshot(nextReaders), {
      rootPid: 10,
      clockTicks: 100,
    });
    expect(sample.processes.every((p) => p.cpuPercent === 0)).toBe(true);
    expect(sample.cpu.utilization).toBeCloseTo(0.25, 2); // loadAvg1 1.0 / 4 cores, not the 1 ms delta
  });
});

describe('assessCapacity', () => {
  const base = {
    cpu: { cores: 4, utilization: 0.2, loadAvg1: 0.8 },
    memory: { totalBytes: 8_000, usedBytes: 2_000, utilization: 0.25 },
    temperatureC: 50,
    processes: [],
  };

  it('is OK with plenty of headroom', () => {
    expect(assessCapacity(base).level).toBe('ok');
  });

  it('flags busy on moderate CPU', () => {
    const v = assessCapacity({ ...base, cpu: { ...base.cpu, utilization: 0.75 } });
    expect(v.level).toBe('busy');
    expect(v.reasons.join()).toMatch(/CPU 75%/);
  });

  it('flags high on heavy memory', () => {
    const v = assessCapacity({ ...base, memory: { ...base.memory, utilization: 0.95 } });
    expect(v.level).toBe('high');
    expect(v.reasons.join()).toMatch(/memory 95%/);
  });

  it('escalates to critical at the thermal throttle point regardless of CPU', () => {
    const v = assessCapacity({ ...base, temperatureC: 82 });
    expect(v.level).toBe('critical');
    expect(v.headline).toMatch(/throttling/i);
    expect(v.reasons.join()).toMatch(/82°C/);
  });

  it('takes the worst of several pressures', () => {
    const v = assessCapacity({
      ...base,
      cpu: { ...base.cpu, utilization: 0.72 }, // busy
      memory: { ...base.memory, utilization: 0.92 }, // high
    });
    expect(v.level).toBe('high');
    expect(v.reasons.length).toBe(2);
  });

  it('ignores temperature when the host does not report one', () => {
    expect(assessCapacity({ ...base, temperatureC: null }).level).toBe('ok');
  });
});

describe('takeSnapshot (real host)', () => {
  it('reads node:os + /proc//sys defaults without throwing', () => {
    const snap = takeSnapshot();
    expect(snap.cores).toBeGreaterThan(0);
    expect(snap.memTotalBytes).toBeGreaterThan(0);
    expect(Array.isArray(snap.procs)).toBe(true);
  });
});
