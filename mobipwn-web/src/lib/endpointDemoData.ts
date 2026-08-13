/** Sample endpoint JSONL — 4 hosts, shared + one outlier process (IronSift fleet demo). */
export const DEMO_ENDPOINT_JSONL = `{"message":"process systemd pid=1","datetime":"2025-01-15T10:00:00Z","parser":"process","process_name":"systemd","pid":1,"device_id":"ws-001","user":"root"}
{"message":"process sshd pid=22","datetime":"2025-01-15T10:00:01Z","parser":"process","process_name":"sshd","pid":22,"device_id":"ws-001","user":"root"}
{"message":"process bash pid=1200","datetime":"2025-01-15T10:00:02Z","parser":"process","process_name":"bash","pid":1200,"device_id":"ws-001","user":"alice"}
{"message":"connection 8.8.8.8","datetime":"2025-01-15T10:00:03Z","parser":"network","dest_ip":"8.8.8.8","src_ip":"10.0.0.11","device_id":"ws-001","process_name":"curl"}
{"message":"process systemd pid=1","datetime":"2025-01-15T10:00:00Z","parser":"process","process_name":"systemd","pid":1,"device_id":"ws-002","user":"root"}
{"message":"process sshd pid=22","datetime":"2025-01-15T10:00:01Z","parser":"process","process_name":"sshd","pid":22,"device_id":"ws-002","user":"root"}
{"message":"process bash pid=1300","datetime":"2025-01-15T10:00:02Z","parser":"process","process_name":"bash","pid":1300,"device_id":"ws-002","user":"bob"}
{"message":"connection 1.1.1.1","datetime":"2025-01-15T10:00:03Z","parser":"network","dest_ip":"1.1.1.1","src_ip":"10.0.0.12","device_id":"ws-002","process_name":"curl"}
{"message":"process systemd pid=1","datetime":"2025-01-15T10:00:00Z","parser":"process","process_name":"systemd","pid":1,"device_id":"ws-003","user":"root"}
{"message":"process sshd pid=22","datetime":"2025-01-15T10:00:01Z","parser":"process","process_name":"sshd","pid":22,"device_id":"ws-003","user":"root"}
{"message":"process bash pid=1400","datetime":"2025-01-15T10:00:02Z","parser":"process","process_name":"bash","pid":1400,"device_id":"ws-003","user":"carol"}
{"message":"process kworker pid=50","datetime":"2025-01-15T10:00:02Z","parser":"process","process_name":"kworker","pid":50,"device_id":"ws-003","user":"root"}
{"message":"process systemd pid=1","datetime":"2025-01-15T10:00:00Z","parser":"process","process_name":"systemd","pid":1,"device_id":"ws-004","user":"root"}
{"message":"process sshd pid=22","datetime":"2025-01-15T10:00:01Z","parser":"process","process_name":"sshd","pid":22,"device_id":"ws-004","user":"root"}
{"message":"process bash pid=1500","datetime":"2025-01-15T10:00:02Z","parser":"process","process_name":"bash","pid":1500,"device_id":"ws-004","user":"dave"}
{"message":"process xmrig pid=9999","datetime":"2025-01-15T10:00:05Z","parser":"process","process_name":"xmrig","pid":9999,"device_id":"ws-004","user":"dave"}
{"message":"connection 203.0.113.50","datetime":"2025-01-15T10:00:06Z","parser":"network","dest_ip":"203.0.113.50","src_ip":"10.0.0.14","device_id":"ws-004","process_name":"xmrig"}
`;
