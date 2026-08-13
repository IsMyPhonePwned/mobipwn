import { describe, expect, it } from "vitest";
import { collectUidOwnerHints, parseAndroidLinuxUid, uidOwnerDetail, uidOwnerPresentation } from "@/lib/networkUidHints";
import { listenPortRows } from "@/lib/networkListenPorts";

describe("parseAndroidLinuxUid", () => {
  it("maps network_stack user to Linux UID 1073", () => {
    expect(parseAndroidLinuxUid("network_stack")).toBe("1073");
  });
});

describe("listenPortRows uid enrichment", () => {
  it("resolves uid:1073 to network stack process from process rows", () => {
    const processRows = [
      {
        parser: "Process",
        data_type: "android:bugreport:process",
        process_name: "com.android.networkstack.process",
        user: "network_stack",
        message: "Process pid=2432 user=network_stack cmd=com.android.networkstack.process",
      },
    ];
    const networkRows = [
      {
        parser: "Network",
        data_type: "android:bugreport:network_socket",
        process_id: "1073",
        message: "Socket udp6 [::]:546 -> [::]",
        ext: JSON.stringify({
          socket_direction: "listen",
          state: "LISTEN",
          local_address: "[::]:546",
          uid: 1073,
        }),
      },
    ];
    const uidHints = collectUidOwnerHints([...networkRows, ...processRows]);
    const listeners = listenPortRows(networkRows, { uidHints });
    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.owner).toBe("uid:1073");
    expect(listeners[0]?.ownerDetail).toBe("com.android.networkstack.process");
    expect(listeners[0]?.ownerExplanation).toContain("UID 1073 is the network stack shared UID");
    expect(uidOwnerDetail("uid:1073", uidHints)).toBe("com.android.networkstack.process");
  });

  it("still explains uid:1073 when process rows are missing", () => {
    const presentation = uidOwnerPresentation("uid:1073", new Map());
    expect(presentation.secondary).toBe("com.android.networkstack.process");
    expect(presentation.explanation).toContain("com.android.networkstack.process");
  });
});
