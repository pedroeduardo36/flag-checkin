import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.CHECKIN_SECRET = "a".repeat(64);
  process.env.CHURCH_LAT = "-15.8134283";
  process.env.CHURCH_LNG = "-47.8435832";
  process.env.CHURCH_RADIUS_METERS = "150";
  delete process.env.GEOFENCE_DISABLED;
});
const load = () => import("@/lib/server/security");

describe("check-in token (HMAC)", () => {
  const payload = { mid: "abc", lat: 1, lng: 2, acc: 10, dist: 5 };

  it("reads back a valid token", async () => {
    const { createCheckinToken, readCheckinToken } = await load();
    expect(readCheckinToken(createCheckinToken(payload))).toMatchObject(payload);
  });
  it("rejects a tampered token", async () => {
    const { createCheckinToken, readCheckinToken } = await load();
    const [data, sig] = createCheckinToken(payload).split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, mid: "outro", exp: Date.now() + 1e6 })).toString("base64url");
    expect(readCheckinToken(`${forged}.${sig}`)).toBeNull();
    const outro = sig[0] === "x" ? "y" : "x"; // makes sure the signature really changes
    expect(readCheckinToken(`${data}.${outro}${sig.slice(1)}`)).toBeNull();
  });
  it("rejects an expired token", async () => {
    const { createCheckinToken, readCheckinToken } = await load();
    expect(readCheckinToken(createCheckinToken(payload, -1))).toBeNull();
  });
});

describe("geofence", () => {
  it("accepts inside the radius and rejects outside", async () => {
    const { checkGeofence } = await load();
    expect(checkGeofence({ lat: -15.8136, lng: -47.8437, accuracy: 10 }).inside).toBe(true);
    expect(checkGeofence({ lat: -15.7942, lng: -47.8822, accuracy: 10 }).inside).toBe(false);
    expect(checkGeofence(null).inside).toBe(false);
  });
  it("test mode (GEOFENCE_DISABLED) allows any position", async () => {
    process.env.GEOFENCE_DISABLED = "true";
    const { checkGeofence } = await load();
    expect(checkGeofence(null)).toMatchObject({ inside: true, disabled: true });
  });
});

describe("helper validations", () => {
  it("parseCoords rejects values off the globe", async () => {
    const { parseCoords } = await load();
    expect(parseCoords({ lat: 91, lng: 0 })).toBeNull();
    expect(parseCoords({ lat: "x", lng: 0 })).toBeNull();
    expect(parseCoords({ lat: -15.8, lng: -47.8 })).toMatchObject({ lat: -15.8, lng: -47.8 });
  });
  it("decodePhoto only accepts base64 images between 2 KB and 2 MB", async () => {
    const { decodePhoto } = await load();
    const ok = "data:image/jpeg;base64," + Buffer.alloc(5000, 1).toString("base64");
    expect(decodePhoto(ok)?.contentType).toBe("image/jpeg");
    expect(decodePhoto("data:text/html;base64,PGh0bWw+")).toBeNull();
    expect(decodePhoto("data:image/jpeg;base64,AAAA")).toBeNull();
  });
  it("serviceDate uses the Brasília time zone", async () => {
    const { serviceDate } = await load();
    // 02:00 UTC on 10/16 is still 10/15 in Brasília (UTC-3)
    expect(serviceDate(new Date("2026-10-16T02:00:00Z"))).toBe("2026-10-15");
  });
  it("safeEqual compares the door-keeper password", async () => {
    const { safeEqual } = await load();
    expect(safeEqual("O2", "O2")).toBe(true);
    expect(safeEqual("O2", "o2")).toBe(false);
  });
});
