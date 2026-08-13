import { describe, expect, it } from "vitest";
import {
  buildCompareSearchParams,
  caseIdentityBits,
  compareDeviceIdentity,
  comparePagePath,
  identityVerdict,
  isCompareSignalType,
  packageInventoryStatus,
  parseCompareSearchParams,
  preferredDiffSection,
  primarySpotId,
  shortCaseId,
  shortHash,
  type CompareCaseMeta,
} from "./caseComparison";

function meta(partial: Partial<CompareCaseMeta>): CompareCaseMeta {
  return {
    case_id: "a",
    title: "t",
    ingest_source: "case-1",
    platform: "android",
    ...partial,
  };
}

describe("caseComparison identity", () => {
  it("shortens hashes", () => {
    expect(shortHash("abcdef0123456789ffff", 8)).toBe("abcdef01…");
    expect(shortHash(null)).toBe("—");
  });

  it("shortens case ids", () => {
    expect(shortCaseId("550e8400-e29b-41d4-a716-446655440000")).toBe("550e8400");
  });

  it("lists picker identity bits for prior reports", () => {
    const bits = caseIdentityBits({
      id: "550e8400-e29b-41d4-a716-446655440000",
      android_id: "9774d56d682e549c",
      serial_number: "RZCX8116ANX",
      blob_file_hash:
        "1111111111111111111111111111111111111111111111111111111111111111",
    });
    expect(bits.map((b) => b.label)).toEqual(["Android ID", "Case", "Serial", "SHA"]);
    expect(bits[0].value).toBe("9774d56d682e549c");
  });

  it("prefers IMEI as the primary spot id", () => {
    expect(
      primarySpotId({
        id: "550e8400-e29b-41d4-a716-446655440000",
        imei: "356938035643809",
        android_id: "9774d56d682e549c",
        serial_number: "RZCX8116ANX",
      })
    ).toEqual({
      label: "IMEI",
      value: "356938035643809",
      title: "356938035643809",
    });
    expect(
      caseIdentityBits({
        id: "550e8400-e29b-41d4-a716-446655440000",
        imei: "356938035643809",
        android_id: "9774d56d682e549c",
      }).map((b) => b.label)
    ).toEqual(["IMEI", "Case", "Android ID"]);
  });

  it("builds and parses comparison URLs", () => {
    const params = buildCompareSearchParams({
      platform: "ios",
      caseAId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      caseBId: "11111111-2222-3333-4444-555555555555",
    });
    expect(params.get("platform")).toBe("ios");
    expect(params.get("a")).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(params.get("b")).toBe("11111111-2222-3333-4444-555555555555");
    expect(
      comparePagePath({
        platform: "android",
        caseAId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        caseBId: "11111111-2222-3333-4444-555555555555",
      })
    ).toBe(
      "/case-comparison?platform=android&a=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&b=11111111-2222-3333-4444-555555555555"
    );
    expect(parseCompareSearchParams(params)).toEqual({
      platform: "ios",
      caseAId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      caseBId: "11111111-2222-3333-4444-555555555555",
    });
  });

  it("prefers USB over packages when both differ", () => {
    const result = {
      platform: "android",
      case_a: meta({ case_id: "a" }),
      case_b: meta({ case_id: "b" }),
      summary: { shared_count: 1, only_a_count: 1, only_b_count: 2, sections: 2 },
      sections: [
        {
          entity_type: "bundle",
          label: "Installed packages",
          only_a: [{ value: "com.old", count_a: 1, count_b: 0 }],
          only_b: [{ value: "com.new", count_a: 0, count_b: 1 }],
          shared: [],
        },
        {
          entity_type: "usb",
          label: "USB devices",
          only_a: [],
          only_b: [{ value: "239a:80f4", count_a: 0, count_b: 1 }],
          shared: [],
        },
      ],
    };
    expect(preferredDiffSection(result)).toBe("usb");
    expect(packageInventoryStatus(result).identical).toBe(false);
    expect(isCompareSignalType("usb")).toBe(true);
    expect(isCompareSignalType("process")).toBe(false);
  });

  it("flags same device with different archive hashes", () => {
    const a = meta({
      device_model: "SM-A346B",
      serial_number: "RZCX8116ANX",
      imei: "356938035643809",
      build_fingerprint: "samsung/a34xeea:14/UP1A/…",
      blob_file_hash: "1111111111111111111111111111111111111111111111111111111111111111",
    });
    const b = meta({
      device_model: "SM-A346B",
      serial_number: "RZCX8116ANX",
      imei: "356938035643809",
      build_fingerprint: "samsung/a34xeea:14/UP1A/…",
      blob_file_hash: "2222222222222222222222222222222222222222222222222222222222222222",
    });
    const rows = compareDeviceIdentity(a, b, "android");
    expect(rows.find((r) => r.key === "serial_number")?.status).toBe("match");
    expect(rows.find((r) => r.key === "imei")?.status).toBe("match");
    const verdict = identityVerdict(rows);
    expect(verdict.sameDevice).toBe(true);
    expect(verdict.differentUpload).toBe(true);
    expect(verdict.label).toMatch(/different uploads/i);
  });

  it("flags different devices", () => {
    const a = meta({ serial_number: "AAA", build_fingerprint: "fp-a" });
    const b = meta({ serial_number: "BBB", build_fingerprint: "fp-b" });
    const verdict = identityVerdict(compareDeviceIdentity(a, b, "android"));
    expect(verdict.sameDevice).toBe(false);
  });

  it("uses UDID for iOS identity", () => {
    const a = meta({
      platform: "ios",
      device_model: "iPhone16,1",
      unique_device_id: "AAAA",
      blob_file_hash: "1111111111111111111111111111111111111111111111111111111111111111",
    });
    const b = meta({
      platform: "ios",
      device_model: "iPhone16,1",
      unique_device_id: "AAAA",
      blob_file_hash: "2222222222222222222222222222222222222222222222222222222222222222",
    });
    const rows = compareDeviceIdentity(a, b, "ios");
    expect(rows.some((r) => r.key === "unique_device_id" && r.status === "match")).toBe(true);
    expect(rows.some((r) => r.key === "build_fingerprint")).toBe(false);
    const verdict = identityVerdict(rows);
    expect(verdict.sameDevice).toBe(true);
    expect(verdict.differentUpload).toBe(true);
  });
});
