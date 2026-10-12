/**
 * The per-wallet profile in src/logic.js (docs/auth.md): the one-time `migrate` of a browser's
 * old data, and `pref` for the progress the browser used to keep in localStorage.
 */

import { describe, expect, it } from "vitest";
import * as logic from "../src/logic.js";

const ID = "wTestPlayer000001";
const LOOK = { skin: "e8c19a", shirt: "4dde6f", pants: "2b3a4a", hair: 3 };

type State = any;

function run(state: State, action: Record<string, unknown>, id = ID): { state: State; error: string | undefined } {
  const verdict = logic.validateAction(state, id, action);
  if (!verdict.ok) return { state, error: verdict.error };
  return { state: logic.applyAction(state, id, action), error: undefined };
}

const fresh = (): State => logic.setup([ID]);
const prog = (s: State, id = ID): any => (logic.viewFor(s, id) as any).prog;

describe("migrate", () => {
  it("moves name, look and progress in once, and marks the profile as the server's", () => {
    const { state, error } = run(fresh(), { t: "migrate", name: "Willem", look: LOOK, pf: { "g1:bestlap": "61234", "g1:tut": "done" } });
    expect(error).toBeUndefined();
    expect(state.players[ID].name).toBe("Willem");
    expect(state.players[ID].look.shirt).toBe("4dde6f");
    expect(prog(state)).toMatchObject({ mig: 1, pf: { "g1:bestlap": "61234", "g1:tut": "done" } });
  });

  it("is refused a second time, so a replay or a second browser changes nothing", () => {
    const once = run(fresh(), { t: "migrate", name: "Willem", look: LOOK, pf: {} }).state;
    const twice = run(once, { t: "migrate", name: "Mallory", look: null, pf: { "g1:tut": "done" } });
    expect(twice.error).toBe("already migrated");
    expect(twice.state.players[ID].name).toBe("Willem");
  });

  it("drops a bad field and keeps the good ones", () => {
    const { state } = run(fresh(), {
      t: "migrate",
      name: "<script>",
      look: { skin: "not a colour" },
      pf: { "g1:bestlap": "61234", "g1:quality": "high", "g1:tut": 5, "g1:visited": "x".repeat(5000), "g1:flown": "1\u0000" },
    });
    expect(state.players[ID].name).toMatch(/^Visitor /);
    expect(state.players[ID].look).toBeNull();
    // only allowlisted keys with short plain strings; device settings never move
    expect(prog(state).pf).toEqual({ "g1:bestlap": "61234" });
    expect(prog(state).mig).toBe(1);
  });

  it("never overwrites what the server already has", () => {
    let s = run(fresh(), { t: "name", name: "OnServer" }).state;
    s = run(s, { t: "look", look: LOOK }).state;
    s = run(s, { t: "pref", k: "g1:bestlap", v: "50000" }).state;
    const { state } = run(s, { t: "migrate", name: "FromBrowser", look: { ...LOOK, shirt: "000000" }, pf: { "g1:bestlap": "99999", "g1:tut": "done" } });
    expect(state.players[ID].name).toBe("OnServer");
    expect(state.players[ID].look.shirt).toBe("4dde6f");
    expect(prog(state).pf).toEqual({ "g1:bestlap": "50000", "g1:tut": "done" });
  });

  it("does not touch the public leaderboards", () => {
    const before = fresh();
    const { state } = run(before, { t: "migrate", name: "Willem", look: null, pf: { "g1:bestlap": "1", "g1:bestdrag": "1" } });
    expect(state.boards).toEqual(before.boards);
    expect(state.players[ID].coins).toBe(before.players[ID].coins);
  });

  it("works with nothing to move, so an empty browser still settles the profile", () => {
    const { state, error } = run(fresh(), { t: "migrate", name: null, look: null, pf: {} });
    expect(error).toBeUndefined();
    expect(prog(state)).toMatchObject({ mig: 1, pf: {} });
  });
});

describe("pref", () => {
  it("stores an allowlisted key privately", () => {
    const { state } = run(fresh(), { t: "pref", k: "g1:visited", v: "Four Corners,The Corral" });
    expect(prog(state).pf["g1:visited"]).toBe("Four Corners,The Corral");
    // another player's view does not carry it
    expect(prog(state, "wSomeoneElse00001")).toBeNull();
  });

  it("keeps the per-player records that used to stay in one browser", () => {
    let s = fresh();
    for (const k of ["g1:flightbest", "g1:flightlog", "g1:fa2log", "g1:ro_mbull", "g1:rhkinds"]) s = run(s, { t: "pref", k, v: "1" }).state;
    expect(Object.keys(prog(s).pf).sort()).toEqual(["g1:fa2log", "g1:flightbest", "g1:flightlog", "g1:rhkinds", "g1:ro_mbull"]);
  });

  it("refuses keys outside the allowlist, non-strings and oversized values", () => {
    expect(run(fresh(), { t: "pref", k: "g1:quality", v: "high" }).error).toBe("bad pref");
    expect(run(fresh(), { t: "pref", k: "g1:tut", v: 1 }).error).toBe("bad pref");
    expect(run(fresh(), { t: "pref", k: "g1:visited", v: "x".repeat(5000) }).error).toBe("bad pref");
  });

  it("caps the whole profile", () => {
    let s = fresh();
    for (const k of ["g1:visited", "g1:hunt", "g1:quest", "g1:bike"]) s = run(s, { t: "pref", k, v: "x".repeat(4000) }).state;
    expect(run(s, { t: "pref", k: "g1:tut", v: "x".repeat(500) }).error).toBe("profile too large");
  });

  it("null removes a key", () => {
    const s = run(fresh(), { t: "pref", k: "g1:tut", v: "done" }).state;
    expect(prog(run(s, { t: "pref", k: "g1:tut", v: null }).state).pf).toEqual({});
  });

  it("survives a passport `prog` update, which rewrites the same progs entry", () => {
    const s = run(fresh(), { t: "pref", k: "g1:tut", v: "done" }).state;
    const after = logic.applyAction(s, ID, { t: "prog", rx: 1 });
    expect(prog(after).pf).toEqual({ "g1:tut": "done" });
  });
});
