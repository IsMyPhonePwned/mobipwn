import { describe, expect, it } from "vitest";
import {
  androidCrashAdvancedDetail,
  androidCrashDetail,
  androidCrashKey,
  androidRecentFrames,
  androidTombstoneFrames,
  caseCrashAdvancedHref,
  caseIosCrashAdvancedHref,
  iosAllThreads,
  iosCrashAdvancedDetail,
  iosCrashDetail,
  iosCrashKey,
  iosLastExceptionFrames,
  iosRecentFrames,
  iosStackFrames,
  iosUsedImages,
  topCrashSymbols,
} from "./crashTraces";

const sampleRow = {
  parser: "crashlogs",
  data_type: "crashlogs",
  process_name: "palera1nHelper",
  bundle_id: "com.example.app",
  action: "SIGABRT",
  function: "main",
  message: "Crashlog: abort() called",
  timestamp: "2023-05-24T13:08:25.000Z",
  ext: JSON.stringify({
    ips_format: "two_part_json",
    faulting_thread: 0,
    crash_source: "crashes_and_spins/palera1nHelper-2023-05-24-130825.ips",
    crash_structure: {
      threads_total: 3,
      threads_truncated: false,
      frames_truncated: false,
      images_total: 2,
      images_truncated: false,
    },
    exception: {
      type: "EXC_CRASH",
      signal: "SIGABRT",
      codes: "0x0000000000000000, 0x0000000000000000",
      subtype: "ABORT",
    },
    termination: { indicator: "abort", namespace: "SIGNAL", code: 6 },
    report: {
      procName: "palera1nHelper",
      reason: "abort() called",
      pid: 1234,
      osVersion: "iPhone OS 16.5 (20F66)",
      appVersion: "1.2.3",
      captureTime: "2023-05-24 13:08:25.000 -0700",
      procPath: "/private/var/containers/Bundle/Application/X/palera1nHelper.app/palera1nHelper",
      asi: { "libsystem_c.dylib": ["abort() called"] },
    },
    report_raw: '{"exception":{"type":"EXC_CRASH"}}',
    threads: [
      {
        id: 0,
        triggered: true,
        name: "main",
        queue: "com.apple.main-thread",
        frames: [
          { index: 0, symbol: "main", image: "palera1nHelper", image_offset: 4660, image_index: 0 },
          { index: 1, symbol: "start", image: "libdyld.dylib", address: "0x1", symbol_location: 12 },
        ],
      },
      {
        id: 1,
        triggered: false,
        name: "worker",
        queue: "com.example.worker",
        frames: [{ index: 0, symbol: "work", image: "palera1nHelper", image_offset: 99 }],
      },
    ],
    last_exception_backtrace: [
      { index: 0, symbol: "+[NSException raise:format:]", image: "CoreFoundation" },
    ],
    used_images: [
      { index: 0, name: "palera1nHelper", uuid: "ABCDEF12-3456-7890", arch: "arm64e", base: "0x100000000" },
      { index: 1, name: "libdyld.dylib", uuid: "11111111-2222-3333", arch: "arm64e", base: "0x180000000" },
    ],
  }),
};

describe("iosCrashDetail", () => {
  it("parses exception, stack, ASI, and images from ext", () => {
    const d = iosCrashDetail(sampleRow);
    expect(d.process).toBe("palera1nHelper");
    expect(d.exceptionType).toBe("EXC_CRASH");
    expect(d.exceptionCodes).toContain("0x0000000000000000");
    expect(d.signal).toBe("SIGABRT");
    expect(d.ipsFormat).toBe("two_part_json");
    expect(d.crashFile).toBe("palera1nHelper-2023-05-24-130825.ips");
    expect(d.reason).toBe("abort() called");
    expect(d.pid).toBe("1234");
    expect(d.osVersion).toContain("16.5");
    expect(d.appVersion).toBe("1.2.3");
    expect(d.threadName).toBe("main");
    expect(d.threadQueue).toBe("com.apple.main-thread");
    expect(d.threadsTotal).toBe(3);
    expect(d.asi).toContain("abort() called");
    expect(d.frames).toHaveLength(2);
    expect(d.frames[0].symbol).toBe("main");
    expect(d.frames[0].imageOffset).toBe("4660");
    expect(d.frames[0].imageIndex).toBe("0");
    expect(d.lastExceptionFrames[0].symbol).toContain("NSException");
    expect(d.images[0].name).toBe("palera1nHelper");
    expect(d.images[0].base).toBe("0x100000000");
  });
});

describe("iosCrashAdvancedDetail", () => {
  it("exposes all threads, images, metadata, and raw bodies", () => {
    const d = iosCrashAdvancedDetail(sampleRow);
    expect(d.key).toContain("palera1nHelper-2023-05-24-130825.ips");
    expect(iosCrashKey(sampleRow)).toBe(d.key);
    expect(d.threads).toHaveLength(2);
    expect(d.threads[0].triggered).toBe(true);
    expect(d.threads[1].name).toBe("worker");
    expect(d.threads[1].frames[0].symbol).toBe("work");
    expect(iosAllThreads(sampleRow)).toHaveLength(2);
    expect(iosUsedImages(sampleRow)).toHaveLength(2);
    expect(d.images[1].uuid).toBe("11111111-2222-3333");
    expect(d.structure?.imagesTotal).toBe(2);
    expect(d.reportRaw).toContain("EXC_CRASH");
    expect(d.reportFields.some((f) => f.key === "captureTime")).toBe(true);
    expect(d.exceptionFields.some((f) => f.key === "subtype")).toBe(true);
    expect(d.terminationFields.some((f) => f.key === "namespace")).toBe(true);
    expect(d.extJson).toContain("used_images");
    expect(d.frames[1].symbolLocation).toBe("12");
    expect(caseIosCrashAdvancedHref("case-1", d.key)).toContain("/cases/case-1/crashes?crash=");
    expect(caseCrashAdvancedHref("case-1", d.key)).toContain("/cases/case-1/crashes?crash=");
  });
});

describe("iosStackFrames / topCrashSymbols", () => {
  it("walks faulting-thread frames for symbol stats", () => {
    const frames = iosStackFrames(sampleRow);
    expect(frames.map((f) => f.symbol)).toEqual(["main", "start"]);
    expect(iosLastExceptionFrames(sampleRow)).toHaveLength(1);
    const symbols = topCrashSymbols([sampleRow], 5);
    expect(symbols.some((s) => s.function === "start")).toBe(true);
    expect(iosRecentFrames([sampleRow], 10).length).toBeGreaterThan(0);
  });
});

const androidTombstoneRow = {
  parser: "Crash",
  data_type: "android:bugreport:tombstone",
  process_name: "com.example.app",
  action: "SIGSEGV",
  message: "Native crash (tombstone): com.example.app signal=SIGSEGV",
  timestamp: "2024-01-15T10:00:00.000Z",
  severity: "high",
  process_id: 4242,
  ext: JSON.stringify({
    pid: 4242,
    tid: 4242,
    uid: 10123,
    process_name: "com.example.app",
    thread_name: "main",
    cmdline: "com.example.app",
    build_fingerprint: "google/raven/raven:14/UQ1A.240105.002/11206848:user/release-keys",
    abi: "arm64",
    signal: "SIGSEGV",
    code: "SEGV_MAPERR",
    fault_addr: "0x0",
    abort_message: "null pointer dereference",
    backtrace: [
      {
        frame: 0,
        pc: "0x0000007a12345678",
        library: "/system/lib64/libc.so",
        function: "strlen",
        offset: "0x1234",
        build_id: "abcdef0123456789",
        raw_line: "#00 pc 0001234 /system/lib64/libc.so (strlen+0x1234)",
      },
      {
        frame: 1,
        pc: "0x0000007a87654321",
        library: "/data/app/~~x/com.example.app/lib/arm64/libnative.so",
        function: "Java_com_example_crash",
        offset: "0x90",
        raw_line: "#01 pc …",
      },
    ],
  }),
};

const androidAnrRow = {
  parser: "Crash",
  data_type: "android:bugreport:anr_trace",
  process_name: "com.android.systemui",
  message: "ANR trace: Input dispatching timed out",
  timestamp: "2024-01-15T11:00:00.000Z",
  ext: JSON.stringify({
    header: { subject: "Input dispatching timed out" },
    process_info: {
      pid: 2000,
      cmd_line: "com.android.systemui",
      abi: "arm64",
      build_fingerprint: "google/raven/raven:14",
    },
    threads: [
      {
        name: "main",
        tid: 2000,
        priority: 5,
        status: "Runnable",
        is_daemon: false,
        stack_trace: [
          {
            frame_type: "managed",
            method: "android.os.MessageQueue.nativePollOnce",
            file_loc: "MessageQueue.java",
            line_number: 0,
            address: "",
            library: "",
            details: "",
          },
          {
            frame_type: "native",
            method: "",
            file_loc: "",
            line_number: 0,
            address: "0x7a1111",
            library: "/system/lib64/libandroid_runtime.so",
            details: "native: #01 pc …",
          },
        ],
      },
      {
        name: "binder:2000_1",
        tid: 2010,
        priority: 0,
        status: "Native",
        is_daemon: true,
        stack_trace: [],
      },
    ],
  }),
};

describe("androidCrashDetail", () => {
  it("parses tombstone signal, abort, and nested backtrace", () => {
    const d = androidCrashDetail(androidTombstoneRow);
    expect(d.kind).toBe("tombstone");
    expect(d.process).toBe("com.example.app");
    expect(d.signal).toBe("SIGSEGV");
    expect(d.code).toBe("SEGV_MAPERR");
    expect(d.faultAddr).toBe("0x0");
    expect(d.abortMessage).toContain("null pointer");
    expect(d.pid).toBe("4242");
    expect(d.tid).toBe("4242");
    expect(d.abi).toBe("arm64");
    expect(d.frames).toHaveLength(2);
    expect(d.frames[0].function).toBe("strlen");
    expect(d.frames[0].library).toContain("libc.so");
    expect(d.frames[0].offset).toBe("0x1234");
    expect(androidTombstoneFrames(androidTombstoneRow)[1].function).toContain("Java_com_example");
  });

  it("parses ANR threads and stacks", () => {
    const d = androidCrashDetail(androidAnrRow);
    expect(d.kind).toBe("anr");
    expect(d.subject).toContain("Input dispatching");
    expect(d.process).toBe("com.android.systemui");
    expect(d.threadsTotal).toBe(2);
    expect(d.frames[0].method).toContain("MessageQueue");
    const adv = androidCrashAdvancedDetail(androidAnrRow);
    expect(adv.key).toContain("anr-trace:");
    expect(androidCrashKey(androidAnrRow)).toBe(adv.key);
    expect(adv.threads).toHaveLength(2);
    expect(adv.threads[0].frames).toHaveLength(2);
    expect(adv.threads[0].frames[1].frameType).toBe("native");
    expect(adv.processInfoFields.some((f) => f.key === "cmd_line")).toBe(true);
    expect(adv.headerFields.some((f) => f.key === "subject")).toBe(true);
    expect(adv.extJson).toContain("stack_trace");
    expect(caseCrashAdvancedHref("c1", adv.key)).toContain("/cases/c1/crashes?crash=");
  });

  it("feeds symbol stats and recent frames from nested backtrace", () => {
    const symbols = topCrashSymbols([androidTombstoneRow], 5);
    expect(symbols.some((s) => s.function === "strlen")).toBe(true);
    expect(androidRecentFrames([androidTombstoneRow], 5).length).toBeGreaterThan(0);
  });
});
