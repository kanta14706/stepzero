// Which real-time feeds exist, and how to reach them. ODPT has GTFS-RT trip updates for these
// four operators only: Tokyo Metro publishes real-time data in ODPT's own JSON, not GTFS-RT, and
// Sotetsu has no real-time feed. Toei's endpoint is public; the others need the challenge key,
// which stays in this function's environment and is never returned or logged.

export interface Operator {
  feedId: string; // OTP feed id (pinned in otp/build.sh), so the app can map a leg to an operator
  tripUpdatesUrl: string;
  alertsUrl: string | null; // null: no alert feed (JR East's returns 404)
  keyEnv: string | null; // environment variable holding the key, or null when public
}

const PUBLIC = "https://api-public.odpt.org/api/v4/gtfs/realtime";
const CHALLENGE = "https://api-challenge.odpt.org/api/v4/gtfs/realtime";

export const OPERATORS: Record<string, Operator> = {
  toei: {
    feedId: "1",
    tripUpdatesUrl: `${PUBLIC}/toei_odpt_train_trip_update`,
    alertsUrl: `${PUBLIC}/toei_odpt_train_alert`,
    keyEnv: null,
  },
  jreast: {
    feedId: "6",
    tripUpdatesUrl: `${CHALLENGE}/jreast_odpt_train_trip_update`,
    alertsUrl: null,
    keyEnv: "ODPT_CHALLENGE_KEY",
  },
  keio: {
    feedId: "7",
    tripUpdatesUrl: `${CHALLENGE}/keio_odpt_train_trip_update`,
    alertsUrl: `${CHALLENGE}/keio_odpt_train_alert`,
    keyEnv: "ODPT_CHALLENGE_KEY",
  },
  tobu: {
    feedId: "8",
    tripUpdatesUrl: `${CHALLENGE}/tobu_odpt_train_trip_update`,
    alertsUrl: `${CHALLENGE}/tobu_odpt_train_alert`,
    keyEnv: "ODPT_CHALLENGE_KEY",
  },
};

/** The URL to fetch, with the key added when the operator needs one. */
export function feedUrl(url: string, op: Operator, env: (name: string) => string | undefined) {
  if (!op.keyEnv) return url;
  const key = env(op.keyEnv);
  if (!key) throw new Error(`${op.keyEnv} is not set`);
  return `${url}?acl:consumerKey=${encodeURIComponent(key)}`;
}
