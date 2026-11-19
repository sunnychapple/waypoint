import type { DeviceView } from "@waypoint/contracts";

export const DEVICE_COLUMNS = "id, kind, name, platform, sign_pub, box_pub, cert, account_envelope, added_at, approved_at, approved_by";
export type DeviceRow = DeviceView;
