import { describe, expect, it } from "vitest";
import {
  androidPolicyLabel,
  formatCpuPercent,
  formatUptimeSeconds,
  iosProcessEventsFromRows,
  iosProcessEventsQuery,
  iosProcessEventsTimelineBuckets,
  iosProcessEventsTimelinePoints,
  IOS_PROCESS_EVENT_KIND_LANE,
  iosServiceHint,
  isIosRegisteredService,
  parseProcessRow,
  parseUptimeSeconds,
  processRows,
  processSummary,
} from "./processSnapshot";

describe("parseProcessRow (android top)", () => {
  it("extracts CPU, RSS, virt, and policy", () => {
    const row = parseProcessRow({
      process_name: "system_server",
      process_id: 1486,
      user: "system",
      parser: "Process",
      ext: JSON.stringify({
        pid: 1486,
        user: "system",
        virt: "1.2G",
        res: "180M",
        pcy: "fg",
        cmd: "system_server",
        threads: [
          { tid: 1486, cpu_percent: 12.5, status: "S", name: "system_server" },
          { tid: 1490, cpu_percent: 3.0, status: "R", name: "binder" },
        ],
      }),
    });
    expect(row).not.toBeNull();
    expect(row!.cpuPercent).toBeCloseTo(15.5);
    expect(row!.rss).toBe("180M");
    expect(row!.virt).toBe("1.2G");
    expect(row!.policy).toBe("fg");
    expect(row!.policyLabel).toBe("foreground");
    expect(row!.threads).toBe(2);
    expect(row!.status).toBe("S");
  });

  it("cleans legacy quoted taskinfo identity names", () => {
    const row = parseProcessRow({
      process_name: `"sshd" [298] [unique ID: 298]`,
      process_id: 298,
      ext: JSON.stringify({ name: "sshd", pid: 298 }),
    });
    expect(row!.name).toBe("sshd");
  });

  it("strips leading scheduler junk from Android kernel thread names", () => {
    const row = parseProcessRow({
      process_name: "22 tz_worker_thread/8",
      process_id: 354,
      user: "root",
      parser: "Process",
      message: "Process pid=354 user=root cmd=22 tz_worker_thread/8",
      ext: JSON.stringify({
        pid: 354,
        user: "root",
        ppid: 2,
        parent: "[kthreadd]",
        pcy: "fg",
        threads: [{ tid: 354, status: "R", name: "22 tz_worker_thread/8", cpu_percent: 13 }],
      }),
    });
    expect(row!.name).toBe("[tz_worker_thread/8]");
    expect(row!.pid).toBe(354);
    expect(row!.status).toBe("R");
    expect(row!.policyLabel).toBe("foreground");
  });

  it("keeps Android kernel names that contain slashes", () => {
    const row = parseProcessRow({
      process_name: "[ksoftirqd/0]",
      process_id: 9,
      user: "root",
      parser: "Process",
      ext: JSON.stringify({
        pid: 9,
        cmd: "[ksoftirqd/0]",
        threads: [{ tid: 9, status: "S", name: "ksoftirqd/0" }],
      }),
    });
    expect(row!.name).toBe("[ksoftirqd/0]");
  });

  it("keeps Android kernel names that contain colons", () => {
    const row = parseProcessRow({
      process_name: "[sugov:0]",
      process_id: 1244,
      user: "root",
      parser: "Process",
      message: "pid=1244 user=root cmd=[sugov:0]",
      ext: JSON.stringify({
        pid: 1244,
        user: "root",
        cmd: "[sugov:0]",
        ppid: 2,
        parent: "[kthreadd]",
        pcy: "fg",
        threads: [{ tid: 1244, status: "S", name: "sugov:0" }],
      }),
    });
    expect(row!.name).toBe("[sugov:0]");
    expect(row!.pid).toBe(1244);
  });

  it("still basenames absolute iOS paths", () => {
    const row = parseProcessRow({
      process_name: "/usr/libexec/sharingd",
      process_id: 100,
      parser: "ps_everywhere",
      ext: JSON.stringify({ name: "/usr/libexec/sharingd", pid: 100 }),
    });
    expect(row!.name).toBe("sharingd");
  });

  it("extracts argv from command_line / args", () => {
    const row = parseProcessRow({
      process_name: "mussel",
      process_id: 461,
      parser: "ps",
      ext: {
        path: "/var/containers/Bundle/Application/X/Signal.app/mussel",
        args: "dGNwOi8vOTguNjYuMTU0LjIzNToyOTU1Mg==",
        command_line:
          "/var/containers/Bundle/Application/X/Signal.app/mussel dGNwOi8vOTguNjYuMTU0LjIzNToyOTU1Mg==",
      },
    });
    expect(row!.name).toBe("mussel");
    expect(row!.args).toBe("dGNwOi8vOTguNjYuMTU0LjIzNToyOTU1Mg==");
  });

  it("backfills args onto same-path taskinfo rows from ps", () => {
    const rows = processRows(
      [
        {
          process_name: "mussel",
          process_id: 279,
          parser: "taskinfo",
          ext: {
            path: "/private/var/containers/Bundle/Application/X/Signal.app/mussel",
            parent: "launchd",
          },
        },
        {
          process_name: "mussel",
          process_id: 461,
          parser: "ps",
          message:
            "/var/containers/Bundle/Application/X/Signal.app/mussel dGNwOi8vOTguNjYuMTU0LjIzNToyOTU1Mg==",
          ext: {
            command:
              "/var/containers/Bundle/Application/X/Signal.app/mussel dGNwOi8vOTguNjYuMTU0LjIzNToyOTU1Mg==",
            args: "dGNwOi8vOTguNjYuMTU0LjIzNToyOTU1Mg==",
            path: "/var/containers/Bundle/Application/X/Signal.app/mussel",
          },
        },
      ],
      0,
      "pid"
    );
    const taskinfo = rows.find((r) => r.pid === 279);
    expect(taskinfo?.args).toBe("dGNwOi8vOTguNjYuMTU0LjIzNToyOTU1Mg==");
  });
});

describe("ios start / uptime", () => {
  it("parses taskinfo run time + estimated start datetime", () => {
    const row = parseProcessRow({
      process_name: "sshd",
      process_id: 298,
      parser: "taskinfo",
      timestamp_desc: "process start time",
      datetime: "2024-06-01T10:00:00.000Z",
      ext: JSON.stringify({
        name: "sshd",
        pid: 298,
        "run time": "3661 secs",
      }),
    });
    expect(row!.startedAt).toContain("2024-06-01");
    expect(row!.uptimeSeconds).toBe(3661);
    expect(row!.uptime).toBe("1h 1m");
    expect(row!.startedEstimated).toBe(true);
  });

  it("parses spindump time_since_fork", () => {
    const row = parseProcessRow({
      process_name: "launchd",
      process_id: 1,
      parser: "spindumpnosymbols",
      timestamp_desc: "process running during spindump",
      datetime: "2024-06-01T12:00:00.000Z",
      ext: JSON.stringify({
        process: "launchd",
        pid: 1,
        time_since_fork: "90s",
      }),
    });
    expect(row!.uptimeSeconds).toBe(90);
    expect(row!.uptime).toBe("1m 30s");
    expect(row!.startedEstimated).toBe(true);
  });

  it("formats uptime helpers", () => {
    expect(parseUptimeSeconds("10s")).toBe(10);
    expect(parseUptimeSeconds("45 secs")).toBe(45);
    expect(formatUptimeSeconds(90)).toBe("1m 30s");
    expect(formatUptimeSeconds(90000)).toBe("25h");
    expect(formatUptimeSeconds(90000 * 2)).toBe("2d 2h");
  });
});

describe("helpers", () => {
  it("labels policies and formats CPU", () => {
    expect(androidPolicyLabel("ta")).toBe("top-app");
    expect(formatCpuPercent(1.25)).toBe("1.3%");
    expect(formatCpuPercent(42)).toBe("42%");
  });

  it("sorts by CPU descending", () => {
    const rows = processRows(
      [
        {
          process_name: "idle",
          process_id: 1,
          ext: JSON.stringify({ threads: [{ tid: 1, cpu_percent: 0.1 }] }),
        },
        {
          process_name: "busy",
          process_id: 2,
          ext: JSON.stringify({ threads: [{ tid: 2, cpu_percent: 40 }] }),
        },
      ],
      10,
      "cpu"
    );
    expect(rows.map((r) => r.name)).toEqual(["busy", "idle"]);
    expect(processSummary(rows).topCpu).toBe(40);
  });

  it("sorts by PID ascending when requested", () => {
    const rows = processRows(
      [
        { process_name: "zebra", process_id: 900 },
        { process_name: "alpha", process_id: 42 },
        { process_name: "launchd", process_id: 1 },
      ],
      0,
      "pid"
    );
    expect(rows.map((r) => r.pid)).toEqual([1, 42, 900]);
  });

  it("backfills Android parent name from ppid", () => {
    const rows = processRows(
      [
        {
          process_name: "zygote",
          process_id: 878,
          parser: "Process",
          ext: JSON.stringify({ pid: 878, cmd: "zygote", ppid: 1 }),
        },
        {
          process_name: "system_server",
          process_id: 1486,
          parser: "Process",
          ext: JSON.stringify({
            pid: 1486,
            cmd: "system_server",
            ppid: 878,
            parent_pid: 878,
          }),
        },
      ],
      0,
      "pid"
    );
    expect(rows.map((r) => r.pid)).toEqual([878, 1486]);
    expect(rows[1].ppid).toBe(878);
    expect(rows[1].parent).toBe("zygote");
  });

  it("merges UID/user from ps/spindump into richer taskinfo row", () => {
    const rows = processRows(
      [
        {
          process_name: "sshd",
          process_id: 298,
          parser: "taskinfo",
          datetime: "2023-05-24T20:27:46.000Z",
          timestamp_desc: "process start time",
          message: "sshd started",
          ext: JSON.stringify({ "run time": "92 s", pid: 298 }),
        },
        {
          process_name: "sshd",
          process_id: 298,
          user: "root",
          parser: "ps",
          message: "sshd: root@ttys000",
          ext: JSON.stringify({ uid: 0, pid: 298 }),
        },
        {
          process_name: "sshd",
          process_id: 298,
          parser: "spindumpnosymbols",
          message: "/usr/sbin/sshd [298] as 0 parent=launchd",
          ext: JSON.stringify({
            uid: 0,
            footprint: "1840 KB",
            file_path: "/usr/sbin/sshd",
            time_since_fork: "89s",
          }),
        },
      ],
      0,
      "pid"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].parser).toBe("taskinfo");
    expect(rows[0].uid).toBe("0");
    expect(rows[0].user).toBe("root");
    expect(rows[0].parent).toBe("launchd");
    expect(rows[0].path).toBe("/usr/sbin/sshd");
    expect(rows[0].footprint).toBe("1840 KB");
    expect(rows[0].uptime).toBe("1m 32s");
  });
});

describe("ios uid / as-token", () => {
  it("prefers numeric uid over username", () => {
    const row = parseProcessRow({
      process_name: "sshd",
      process_id: 298,
      user: "root",
      parser: "ps",
      ext: JSON.stringify({ uid: 0 }),
    });
    expect(row!.uid).toBe("0");
    expect(row!.user).toBe("root");
  });

  it("parses spindump as-uid and parent=", () => {
    const row = parseProcessRow({
      process_name: "sshd",
      process_id: 298,
      parser: "spindumpnosymbols",
      message: "/usr/sbin/sshd [298] as 0 parent=launchd",
      ext: JSON.stringify({ file_path: "/usr/sbin/sshd" }),
    });
    expect(row!.uid).toBe("0");
    expect(row!.parent).toBe("launchd");
    expect(row!.path).toBe("/usr/sbin/sshd");
  });

  it("flags ps_everywhere service-style names without live process fields", () => {
    const row = parseProcessRow({
      process_name: "com.apple.companion_proxy.shim.remote",
      parser: "ps_everywhere",
      message: "com.apple.companion_proxy.shim.remote",
    });
    expect(row).not.toBeNull();
    expect(iosServiceHint(row!)).toContain("only found in remotectl_dumpstate");
    expect(row!.serviceHint).toContain("registered service list");
    expect(isIosRegisteredService(row!)).toBe(true);
  });

  it("keeps live processes out of the registered-service set", () => {
    const row = parseProcessRow({
      process_name: "SpringBoard",
      process_id: 33,
      parser: "ps",
      user: "mobile",
      ext: JSON.stringify({ uid: 501, ppid: 1 }),
    });
    expect(isIosRegisteredService(row!)).toBe(false);
  });

  it("preserves the service hint after merging duplicate rows", () => {
    const rows = processRows(
      [
        {
          process_name: "com.apple.companion_proxy.shim.remote",
          parser: "taskinfo",
          datetime: "2023-05-24T20:27:46.000Z",
          timestamp_desc: "process start time",
          message: "com.apple.companion_proxy.shim.remote",
          ext: JSON.stringify({ "run time": "" }),
        },
        {
          process_name: "com.apple.companion_proxy.shim.remote",
          parser: "ps_everywhere",
          message: "com.apple.companion_proxy.shim.remote",
        },
      ],
      0,
      "pid"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].serviceHint).toContain("registered service list");
    expect(rows[0].parser).toBe("taskinfo");
  });
});

describe("iosProcessEventsQuery / shutdownlogs", () => {
  it("includes shutdownlogs in the process-events query", () => {
    const q = iosProcessEventsQuery("case-ios-1");
    expect(q).toContain('parser="shutdownlogs"');
    expect(q).toContain('parser="psthread"');
    expect(q).toContain("args");
    expect(q).toContain("command_line");
    expect(q).toContain("path");
    expect(q).toContain("head 10000");
  });

  it("maps shutdownlogs rows with uuid client paths", () => {
    const events = iosProcessEventsFromRows(
      [
        {
          process_name: "filecoordinationd",
          process_id: 4242,
          parser: "shutdownlogs",
          datetime: "2026-04-07T15:01:20Z",
          timestamp_desc: "process running at shutdown",
          message: "filecoordinationd is still there during shutdown after 3s",
          ext: JSON.stringify({
            pid: 4242,
            command: "filecoordinationd",
            path: "/usr/sbin/filecoordinationd/550e8400-e29b-41d4-a716-446655440000",
            executable_path: "/usr/sbin/filecoordinationd",
            uuid: "550e8400-e29b-41d4-a716-446655440000",
            source_path: "private/var/db/diagnostics/shutdown.0.log",
            time_waiting: 3.0,
          }),
        },
      ],
      10
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("shutdown");
    expect(events[0].name).toBe("filecoordinationd");
    expect(events[0].waitSeconds).toBe(3);
    expect(events[0].uuid).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(events[0].executablePath).toBe("/usr/sbin/filecoordinationd");
    expect(events[0].path).toBe("/usr/sbin/filecoordinationd");
    expect(events[0].sourcePath).toContain("shutdown.0.log");
  });

  it("builds timeline points colored by kind lanes", () => {
    const events = iosProcessEventsFromRows([
      {
        process_name: "sshd",
        process_id: 298,
        parser: "taskinfo",
        datetime: "2026-04-07T10:00:00Z",
        timestamp_desc: "process start time",
        message: "sshd started",
        ext: JSON.stringify({ pid: 298 }),
      },
      {
        process_name: "SpringBoard",
        process_id: 50,
        parser: "ps",
        datetime: "2026-04-07T12:00:00Z",
        message: "SpringBoard",
        ext: JSON.stringify({ pid: 50 }),
      },
      {
        process_name: "filecoordinationd",
        process_id: 4242,
        parser: "shutdownlogs",
        datetime: "2026-04-07T15:01:20Z",
        timestamp_desc: "process running at shutdown",
        message: "filecoordinationd is still there during shutdown after 3s",
        ext: JSON.stringify({ pid: 4242, time_waiting: 3 }),
      },
    ]);
    const points = iosProcessEventsTimelinePoints(events);
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.kind)).toEqual(["start", "snapshot", "shutdown"]);
    expect(Math.round(points[0]!.kindY)).toBe(IOS_PROCESS_EVENT_KIND_LANE.start);
    expect(Math.round(points[1]!.kindY)).toBe(IOS_PROCESS_EVENT_KIND_LANE.snapshot);
    expect(Math.round(points[2]!.kindY)).toBe(IOS_PROCESS_EVENT_KIND_LANE.shutdown);

    const buckets = iosProcessEventsTimelineBuckets(events);
    expect(buckets.some((b) => b.start >= 1)).toBe(true);
    expect(buckets.some((b) => b.snapshot >= 1)).toBe(true);
    expect(buckets.some((b) => b.shutdown >= 1)).toBe(true);
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(3);
  });

  it("ignores epoch ps timestamps so the timeline span stays usable", () => {
    const events = iosProcessEventsFromRows([
      {
        process_name: "suggestd",
        process_id: 501,
        parser: "ps",
        timestamp: "1970-01-01 00:00:00.000000",
        datetime: "",
        message: "/System/Library/PrivateFrameworks/CoreSuggestions.framework/suggestd",
        ext: JSON.stringify({ pid: 501, started: "7:47AM" }),
      },
      {
        process_name: "mediaanalysisd",
        process_id: 420,
        parser: "spindumpnosymbols",
        timestamp: "2025-04-07 15:06:18.638000",
        datetime: "",
        timestamp_desc: "process running during spindump",
        message: "/System/Library/PrivateFrameworks/MediaAnalysis.framework/mediaanalysisd [420]",
        ext: JSON.stringify({ pid: 420 }),
      },
      {
        process_name: "vm_stat",
        process_id: 429,
        parser: "taskinfo",
        timestamp: "2025-04-07 15:06:18.000000",
        datetime: "",
        timestamp_desc: "process start time",
        message: "vm_stat started",
        ext: JSON.stringify({ pid: 429 }),
      },
    ]);
    expect(events).toHaveLength(3);
    const buckets = iosProcessEventsTimelineBuckets(events);
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.length).toBeLessThan(100);
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(2);
    expect(buckets.some((b) => b.running >= 1)).toBe(true);
    expect(buckets.some((b) => b.start >= 1)).toBe(true);
  });
});
