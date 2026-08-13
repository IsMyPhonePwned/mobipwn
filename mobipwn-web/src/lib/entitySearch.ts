export const ENTITY_TYPE_LABELS: Record<string, string> = {
  user: "Users",
  host: "Hosts",
  bundle: "Installed packages",
  ip: "IPs",
  domain: "Domains",
  hash: "Hashes",
  url: "URLs",
  file: "Files",
  process: "Running processes",
  email: "Emails",
  bluetooth: "Bluetooth",
  usb: "USB devices",
  usb_port: "USB ports",
  adb: "ADB / debugging",
  ssid: "Wi‑Fi",
  account: "Accounts",
  vpn: "VPN",
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  on_host: "On host",
  network: "Network",
  executed: "Executed",
  accessed: "Accessed",
  connected_to: "Connected to",
  resolved_to: "Resolved to",
  belongs_to: "Belongs to",
  hash_of: "Hash of",
  installed: "Installed",
  related: "Related",
};

export function entitySearchQuery(entityType: string, value: string, scope?: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  let q = "";
  switch (entityType) {
    case "user":
      q = `user="${escaped}"`;
      break;
    case "host":
      q = `device_id="${escaped}" OR device_model="${escaped}"`;
      break;
    case "bundle":
      q = `bundle_id="${escaped}"`;
      break;
    case "ip":
      q = `dest_ip="${escaped}" OR src_ip="${escaped}"`;
      break;
    case "domain":
      q = `destination_domain="${escaped}"`;
      break;
    case "hash":
      q = `file_hash="${escaped}"`;
      break;
    case "process":
      q = `process_name="${escaped}"`;
      break;
    case "email":
      q = `email="${escaped}"`;
      break;
    case "bluetooth":
      q = `parser="Bluetooth" (device_id="${escaped}" OR app_name="${escaped}" OR message=*"${escaped}"*)`;
      break;
    case "usb":
      q = `(parser="Usb" OR parser="iousb" OR parser="SamsungSfsLogs") message=*"${escaped}"*`;
      break;
    case "usb_port":
      q = `parser="Usb" (data_type=*"usb_port"* OR message=*"USB port"*) message=*"${escaped}"*`;
      break;
    case "adb":
      q = `(parser="Adb" OR parser="SamsungSfsLogs") message=*"${escaped}"*`;
      break;
    case "ssid":
      q = `ssid="${escaped}"`;
      break;
    case "account":
      q = `parser="Account" (app_name="${escaped}" OR user="${escaped}" OR message=*"${escaped}"*)`;
      break;
    case "vpn":
      q = `parser="Vpn" (bundle_id="${escaped}" OR app_name="${escaped}" OR message=*"${escaped}"*)`;
      break;
    default:
      q = `"${escaped}"`;
  }
  if (scope) return `${scope} | search ${q}`;
  return q;
}

export function truncateLabel(value: string, max = 22) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
