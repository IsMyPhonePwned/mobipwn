import { describe, expect, it } from "vitest";
import {
  iosLockEventsFromRows,
  iosLockStateQuery,
  parseIosLockEvent,
  summarizeIosLockEvents,
} from "@/lib/iosLockState";

describe("iosLockState", () => {
  it("parses powerlogs DEVICE UNLOCKED rows (lowercase lock status)", () => {
    const ev = parseIosLockEvent({
      parser: "powerlogs",
      timestamp_desc: "Lock State",
      message: "Lock State: lock status=DEVICE UNLOCKED",
      timestamp: "2025-04-07 08:10:00.000000",
      ext: JSON.stringify({
        timestamp_desc: "Lock State",
        "lock status": "DEVICE UNLOCKED",
        adjusted_timestamp: "2025-04-07 08:10:00",
        apollo_module: "powerlog_device_lock_state",
        source_db: "logs/powerlogs/powerlog_demo.PLSQL",
        "plspringboardagent_eventforward_sblock table id": 42,
      }),
    });
    expect(ev?.kind).toBe("unlocked");
    expect(ev?.detail).toBe("Device unlocked");
    expect(ev?.source).toBe("Powerlog");
    expect(ev?.whenDate).toMatch(/2025/);
    expect(ev?.whenRaw).toBeTruthy();
    expect(ev?.extras.some((e) => e.label === "Event ID" && e.value === "42")).toBe(true);
    expect(ev?.extras.some((e) => e.label === "DB")).toBe(true);
  });

  it("parses knowledgec IS LOCKED", () => {
    const ev = parseIosLockEvent({
      parser: "knowledgec",
      timestamp_desc: "Device Lock Status",
      message: "Device Lock Status: IS LOCKED=LOCKED",
      datetime: "2025-04-07T09:00:00Z",
      ext: JSON.stringify({
        "IS LOCKED": "LOCKED",
        "USAGE IN SECONDS": "120",
        "DAY OF WEEK": "Monday",
      }),
    });
    expect(ev?.kind).toBe("locked");
    expect(ev?.source).toBe("KnowledgeC");
    expect(ev?.extras.some((e) => e.label === "Duration")).toBe(true);
    expect(ev?.extras.some((e) => e.label === "Day" && e.value === "Monday")).toBe(true);
  });

  it("reads lock_status field after flatten alias", () => {
    const ev = parseIosLockEvent({
      parser: "powerlogs",
      timestamp_desc: "Lock State",
      message: "Lock State",
      lock_status: "DEVICE LOCKED",
      datetime: "2025-04-07T10:00:00Z",
    });
    expect(ev?.kind).toBe("locked");
  });

  it("accepts lock_status-only rows from simplified Authentication query", () => {
    const ev = parseIosLockEvent({
      parser: "powerlogs",
      message: "Lock State: lock status=DEVICE UNLOCKED",
      lock_status: "DEVICE UNLOCKED",
      timestamp: "2026-08-03 12:50:44.000000",
      ext: JSON.stringify({ apollo_module: "powerlog_device_lock_state" }),
    });
    expect(ev?.kind).toBe("unlocked");
    expect(ev?.whenRaw).toBeTruthy();
  });

  it("does not treat activity title Lock State as locked", () => {
    const ev = parseIosLockEvent({
      parser: "powerlogs",
      timestamp_desc: "Lock State",
      message: "Lock State: lock status=DEVICE UNLOCKED",
      datetime: "2025-04-07T10:00:00Z",
    });
    expect(ev?.kind).toBe("unlocked");
  });

  it("includes calendar date and time", () => {
    const ev = parseIosLockEvent({
      parser: "powerlogs",
      timestamp_desc: "Lock State",
      message: "Lock State: LOCK STATUS=DEVICE UNLOCKED",
      datetime: "2025-04-07T08:10:00Z",
    });
    expect(ev?.whenDate).toMatch(/2025/);
    expect(ev?.whenTime.length).toBeGreaterThan(0);
    expect(ev?.when).toContain("·");
  });

  it("summarizes last unlock/lock", () => {
    const events = iosLockEventsFromRows([
      {
        parser: "powerlogs",
        timestamp_desc: "Lock State",
        message: "Lock State: LOCK STATUS=DEVICE UNLOCKED",
        datetime: "2025-04-07T12:00:00Z",
      },
      {
        parser: "powerlogs",
        timestamp_desc: "Lock State",
        message: "Lock State: LOCK STATUS=DEVICE LOCKED",
        datetime: "2025-04-07T11:00:00Z",
      },
      {
        parser: "powerlogs",
        timestamp_desc: "Lock State",
        message: "Lock State: LOCK STATUS=DEVICE UNLOCKED",
        datetime: "2025-04-07T10:00:00Z",
      },
    ]);
    const summary = summarizeIosLockEvents(events);
    expect(summary.unlocked).toBe(2);
    expect(summary.locked).toBe(1);
    expect(summary.lastUnlocked).toBeTruthy();
    expect(summary.lastLocked).toBeTruthy();
  });

  it("builds a scoped query", () => {
    const q = iosLockStateQuery('case-abc"x');
    expect(q).toContain('source="case-abc\\"x"');
    expect(q).toContain('timestamp_desc="Lock State"');
    expect(q).toContain('parser="knowledgec"');
  });

  it("ignores unrelated powerlogs rows", () => {
    expect(
      parseIosLockEvent({
        parser: "powerlogs",
        timestamp_desc: "Battery Level",
        message: "Battery Level: LEVEL=80",
      })
    ).toBeNull();
  });

  it("classifies modern SpringBoard processed auth success", () => {
    const ev = parseIosLockEvent({
      parser: "logarchive",
      message:
        'Processed authentication request (success=YES): <SBFAuthenticationRequest: 0x1; hasPasscode: YES>',
      timestamp: "2026-08-03 12:50:43.000000",
      auth_success: "true",
      auth_type: "passcode",
      event_type: "authentication_event",
    });
    expect(ev?.kind).toBe("unlocked");
    expect(ev?.detail).toMatch(/passcode|unlock/i);
  });

  it("classifies biometry lockout as failed", () => {
    const ev = parseIosLockEvent({
      parser: "logarchive",
      message:
        'User 501 is locked out: Error Domain=com.apple.LocalAuthentication Code=-8 "Biometry is locked out." UserInfo={Subcode=3}',
      timestamp: "2026-08-03 12:50:41.000000",
      auth_success: "false",
      auth_type: "biometric",
      event_type: "authentication_event",
    });
    expect(ev?.kind).toBe("failed");
    expect(ev?.detail).toMatch(/biometric/i);
  });

  it("ignores before-first-unlock biometry noise", () => {
    expect(
      parseIosLockEvent({
        parser: "logarchive",
        message:
          'User 501 is locked out: Error Domain=com.apple.LocalAuthentication Code=-8 "Biometry is not available before first unlock."',
        timestamp: "2026-08-03 09:54:52.000000",
        auth_success: "false",
        event_type: "authentication_event",
      })
    ).toBeNull();
  });

  it("classifies Face ID match fail just before passcode unlock", () => {
    const ev = parseIosLockEvent({
      parser: "logarchive",
      message:
        "BKMatchOperation::processMatchFailReason: 1 => delegate:A000007D2CC55E0(<private>)",
      timestamp: "2026-08-03 12:50:23.495000",
      auth_success: "false",
      auth_type: "biometric",
      event_type: "authentication_event",
    });
    expect(ev?.kind).toBe("failed");
    expect(ev?.detail).toMatch(/biometric/i);
  });
});
