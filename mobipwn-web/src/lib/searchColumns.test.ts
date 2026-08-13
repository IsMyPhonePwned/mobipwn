import { describe, expect, it } from "vitest";
import { defaultSearchVisibleColumns, orderedVisibleSearchColumns } from "@/lib/searchColumns";

describe("defaultSearchVisibleColumns", () => {
  const many = [
    "id",
    "timestamp",
    "ingest_time",
    "source",
    "platform",
    "parser",
    "data_type",
    "severity",
    "process_name",
    "bundle_id",
    "action",
    "message",
    "ext",
    "uid",
    "pid",
    "ppid",
    "device_id",
    "dest_ip",
  ];

  it("shows a lean preferred subset for wide event results", () => {
    expect(defaultSearchVisibleColumns(many)).toEqual([
      "timestamp",
      "platform",
      "parser",
      "severity",
      "process_name",
      "bundle_id",
      "message",
    ]);
  });

  it("honors saved preferred columns that exist in the result", () => {
    expect(defaultSearchVisibleColumns(many, ["timestamp", "message", "uid", "missing"])).toEqual([
      "timestamp",
      "uid",
      "message",
    ]);
  });

  it("shows almost all columns for small result schemas", () => {
    const small = ["bucket", "c", "series"];
    expect(defaultSearchVisibleColumns(small)).toEqual(["bucket", "c", "series"]);
  });

  it("keeps enrichment columns when present", () => {
    const cols = [...many, "vt_label", "lookup_country"];
    const visible = defaultSearchVisibleColumns(cols);
    expect(visible).toContain("vt_label");
    expect(visible).toContain("lookup_country");
    expect(visible).not.toContain("ext");
    expect(visible).not.toContain("id");
  });
});

describe("orderedVisibleSearchColumns", () => {
  it("keeps chosen columns in natural order and pins message last", () => {
    const cols = ["timestamp", "platform", "parser", "message", "uid"];
    expect(orderedVisibleSearchColumns(cols, ["timestamp", "uid", "message", "parser"])).toEqual([
      "timestamp",
      "parser",
      "uid",
      "message",
    ]);
  });
});
