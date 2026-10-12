/**
 * The room is only entered with a wallet session, and the room decides who you are (src/worker.ts `/ws`,
 * src/room.ts). A client can no longer pick its player id or borrow someone else's.
 */

import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { signedInWallet } from "./signin";

const BASE = "https://game.test";

function uniq(label: string): string {
  return `${label}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Accepts the socket of a 101 response and collects its frames and its close code. */
function socket(res: Response) {
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const frames: any[] = [];
  let closed: number | null = null;
  ws.addEventListener("message", (event: MessageEvent) => {
    try {
      frames.push(JSON.parse(String(event.data)));
    } catch {
      /* not protocol traffic */
    }
  });
  ws.addEventListener("close", (event: CloseEvent) => {
    closed = event.code;
  });
  const until = async <T>(get: () => T | undefined | null, label: string): Promise<T> => {
    for (let i = 0; i < 200; i++) {
      const hit = get();
      if (hit !== undefined && hit !== null) return hit;
      await scheduler.wait(10);
    }
    throw new Error(`timed out waiting for ${label}; got ${JSON.stringify(frames)}`);
  };
  return {
    ws,
    send: (msg: unknown) => ws.send(JSON.stringify(msg)),
    you: () => until(() => frames.find((f) => typeof f?.you === "string")?.you as string | undefined, "a frame with `you`"),
    error: () => until(() => frames.find((f) => f?.type === "error")?.error as string | undefined, "an error frame"),
    closed: () => until(() => closed, "the socket to close"),
  };
}

function upgrade(room: string, headers: Record<string, string> = {}) {
  return SELF.fetch(`${BASE}/ws/${room}`, { headers: { Upgrade: "websocket", ...headers } });
}

describe("/ws needs a session", () => {
  it("refuses an upgrade without a session cookie", async () => {
    const res = await upgrade(uniq("gate"));
    expect(res.status).toBe(401);
    expect(res.webSocket).toBeNull();
  });

  it("refuses a forged cookie, and forged identity headers do not stand in for one", async () => {
    const res = await upgrade(uniq("gate"), { Cookie: "gb1_session=e30.e30.AAAA", "X-GB-Player": "victim", "X-GB-Wallet": "x", "X-GB-Exp": "9999999999" });
    expect(res.status).toBe(401);
  });

  it("refuses a session that was signed out", async () => {
    const w = await signedInWallet();
    const logout = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: w.cookie }, body: "{}" });
    expect(logout.status).toBe(200);
    expect((await upgrade(uniq("gate"), { Cookie: w.cookie })).status).toBe(401);
  });
});

describe("the room decides who you are", () => {
  it("uses the wallet's player id and ignores the one the client sends", async () => {
    const w = await signedInWallet();
    const s = socket(await upgrade(uniq("who"), { Cookie: w.cookie }));
    s.send({ type: "join", playerId: "someone-else" });
    expect(await s.you()).toBe(w.playerId);
    s.ws.close();
  });

  it("ignores identity headers a signed-in client adds itself", async () => {
    const w = await signedInWallet();
    const s = socket(await upgrade(uniq("who"), { Cookie: w.cookie, "X-GB-Player": "victim", "X-GB-Wallet": "victim" }));
    s.send({ type: "join", playerId: "victim" });
    expect(await s.you()).toBe(w.playerId);
    s.ws.close();
  });

  it("gives the same wallet the same id on every socket, and another wallet another id", async () => {
    const room = uniq("who");
    const w = await signedInWallet();
    const other = await signedInWallet();
    const a = socket(await upgrade(room, { Cookie: w.cookie }));
    const b = socket(await upgrade(room, { Cookie: w.cookie }));
    const c = socket(await upgrade(room, { Cookie: other.cookie }));
    for (const s of [a, b, c]) s.send({ type: "join", playerId: "x" });
    expect(await a.you()).toBe(w.playerId);
    expect(await b.you()).toBe(w.playerId);
    expect(await c.you()).toBe(other.playerId);
    expect(other.playerId).not.toBe(w.playerId);
    for (const s of [a, b, c]) s.ws.close();
  });

  it("refuses reset: it would wipe every player's progress", async () => {
    const w = await signedInWallet();
    const s = socket(await upgrade(uniq("reset"), { Cookie: w.cookie }));
    s.send({ type: "join", playerId: "x" });
    await s.you();
    s.send({ type: "reset" });
    expect(await s.error()).toBe("reset is disabled");
    s.ws.close();
  });
});

describe("the room itself", () => {
  const rooms = (env as unknown as Env).ROOMS;
  const stub = (room: string) => rooms.get(rooms.idFromName(room));

  it("refuses an upgrade that did not come through the Worker's session check", async () => {
    const res = await stub(uniq("direct")).fetch(`${BASE}/ws`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("closes a socket once the session it was opened with has expired", async () => {
    const past = String(Math.floor(Date.now() / 1000) - 1);
    const res = await stub(uniq("expired")).fetch(`${BASE}/ws`, {
      headers: { Upgrade: "websocket", "X-GB-Player": "wexpired", "X-GB-Wallet": "addr", "X-GB-Exp": past },
    });
    const s = socket(res);
    s.send({ type: "join", playerId: "x" });
    expect(await s.closed()).toBe(4401);
  });
});
