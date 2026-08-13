import { parseApiResponse } from "@/lib/response";

export type DeviceAdvancedStatus = {
  enabled: boolean;
};

export async function fetchDeviceAdvancedStatus(): Promise<DeviceAdvancedStatus> {
  const res = await fetch("/api/v1/public/device-advanced/status");
  return parseApiResponse<DeviceAdvancedStatus>(res);
}
