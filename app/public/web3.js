/* Wallet sign-in (Sign-In With Solana) and the signed-in wallet's real $GBACK amount.
 *
 * window.GB_WALLET:
 *   whenSignedIn(fn)  run fn once a session exists (at once if there already is one); shows the sign-in screen until then.
 *                     boot.js loads the game from here, so nothing heavy runs while the sign-in screen is up
 *   signOut()         revoke the session on the server, disconnect the wallet, reload (back to the sign-in screen)
 *   address           the signed-in address (from the server session) or null
 *   playerId          the room identity the server derives from that address (the room ignores any other)
 *   balance           { raw, decimals, ui, slot } | null; only while signed in, token amount only (no price)
 *   refresh()         re-fetch the balance
 *   check()           ask the server whether the session still holds; back to the sign-in screen if not
 *   on("change", fn)  fires when address or balance changes
 *
 * The wallet shows as a button (#wbox): top right on the loading screen, then at the top of #wallet in the game's top-right
 * panel, above the on-chain amount (#wbal). Its menu shows the full address and the amount, copies the address, signs out.
 *
 * The cookie the server sets is what counts. A connected wallet here is only used to sign the challenge and to notice an
 * account switch. Ported from the dashboard (lib/wallet/connectors.ts, lib/auth/client.ts); see docs/auth.md.
 * Wallets are found through the Wallet Standard (no npm, no bundler), with the old injected providers as a fallback,
 * and Coinbase Wallet through its own bridge (coinbaseConnector). */
(function () {
  "use strict";

  const LAST_WALLET = "g1:wallet"; // which wallet signed in last; a name, never anything secret
  const FOCUS_READ_MIN_MS = 30000;
  const KEEPALIVE_MS = 15 * 60000;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // ── wallet discovery ─────────────────────────────────────────────────────────────────────────────
  // The Wallet Standard handshake: wallets dispatch "register-wallet" with a callback, the app dispatches "app-ready" with the api.

  const connectors = new Map(); // name -> connector
  const discoveryListeners = new Set();
  function discovered() { discoveryListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

  function isSolanaWallet(w) {
    return w && w.features && w.features["standard:connect"] && Array.isArray(w.chains) && w.chains.some((c) => String(c).startsWith("solana:"));
  }

  function standardConnector(w) {
    const f = w.features;
    const first = () => (w.accounts && w.accounts[0]) || null;
    const signMessage = f["solana:signMessage"] ? async (account, bytes) => {
      const [res] = await f["solana:signMessage"].signMessage({ account, message: bytes });
      return new Uint8Array(res.signature);
    } : null;
    return {
      name: w.name,
      icon: w.icon,
      async connect(silent) {
        await f["standard:connect"].connect(silent ? { silent: true } : undefined);
        const account = first();
        if (!account) throw new Error("The wallet returned no account");
        return account;
      },
      signMessage,
      /** One approval: authorise the site and sign in. Absent on wallets without solana:signIn. */
      signIn: f["solana:signIn"] ? async (input) => {
        const [res] = await f["solana:signIn"].signIn(input);
        // A wallet that declines may return an empty array instead of throwing.
        if (!res) throw new Error("Wallet returned no sign-in result");
        return { account: res.account, signedMessage: new Uint8Array(res.signedMessage), signature: new Uint8Array(res.signature) };
      } : null,
      async disconnect() { if (f["standard:disconnect"]) await f["standard:disconnect"].disconnect(); },
      /** Calls fn with the new first address (null = disconnected). Returns an unsubscribe. */
      onAccountChange(fn) {
        if (!f["standard:events"]) return () => {};
        return f["standard:events"].on("change", (changes) => { if (changes && changes.accounts) fn(changes.accounts[0] ? changes.accounts[0].address : null); });
      },
    };
  }

  /** Old-style injected providers, for wallets that do not register through the Wallet Standard. signMessage only. */
  function injectedConnector(name, provider) {
    const addressOf = () => (provider.publicKey ? provider.publicKey.toString() : null);
    return {
      name,
      icon: null,
      async connect(silent) {
        await provider.connect(silent ? { onlyIfTrusted: true } : undefined);
        const address = addressOf();
        if (!address) throw new Error("The wallet returned no account");
        return { address };
      },
      async signMessage(_account, bytes) {
        const res = await provider.signMessage(bytes, "utf8");
        return new Uint8Array(res.signature || res);
      },
      signIn: null,
      async disconnect() { try { await provider.disconnect(); } catch { /* already gone */ } },
      onAccountChange(fn) {
        if (!provider.on) return () => {};
        const h = (pk) => fn(pk ? pk.toString() : null);
        provider.on("accountChanged", h);
        return () => { try { provider.off ? provider.off("accountChanged", h) : provider.removeListener("accountChanged", h); } catch { /* ignore */ } };
      },
    };
  }

  const api = Object.freeze({
    register(...wallets) {
      let added = false;
      for (const w of wallets) if (isSolanaWallet(w) && !connectors.has(w.name)) { connectors.set(w.name, standardConnector(w)); added = true; }
      if (added) discovered();
      return () => {};
    },
  });
  window.addEventListener("wallet-standard:register-wallet", (e) => { try { e.detail(api); } catch (err) { console.warn("[wallet] register failed", err); } });
  try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api })); } catch (err) { console.warn("[wallet] app-ready failed", err); }

  // ── Coinbase Wallet ──────────────────────────────────────────────────────────────────────────────
  // After the dashboard's lib/wallet/coinbase.ts, sign-in only (this game sends no transactions). Coinbase injects only the
  // legacy window.coinbaseSolana: no Wallet Standard, no solana:signIn. Its traps: connect() may resolve before the account
  // is published, or never settle; publicKey is empty (or the zero key) on every load until it reconnects; onlyIfTrusted is
  // not reliably honoured, so a silent connect only goes ahead when the extension's own list of addresses trusted by this
  // site says so; and a switch of account fires no documented event, so publicKey is polled (an in-memory read, no RPC).

  const COINBASE = "Coinbase Wallet";
  const COINBASE_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-8 -8 48 48' fill='none'%3E%3Crect x='-8' y='-8' width='48' height='48' rx='11.5' fill='%230F1927'/%3E%3Cpath d='M16 24C11.58 24 8 20.42 8 16C8 11.58 11.58 8 16 8C19.96 8 23.2467 10.8867 23.88 14.6667H31.94C31.26 6.45333 24.3867 0 16 0C7.16667 0 0 7.16667 0 16C0 24.8333 7.16667 32 16 32C24.3867 32 31.26 25.5467 31.94 17.3333H23.88C23.2467 21.1133 19.96 24 16 24Z' fill='url(%23g)'/%3E%3Cdefs%3E%3ClinearGradient id='g' x1='4.06445' y1='0' x2='32.0995' y2='28.0509' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0.0347609' stop-color='%230000FF'/%3E%3Cstop offset='0.434698' stop-color='%2300C3FF'/%3E%3Cstop offset='0.717349' stop-color='%2300FFFF'/%3E%3Cstop offset='1' stop-color='%23FFEE7D'/%3E%3C/linearGradient%3E%3C/defs%3E%3C/svg%3E";
  const ZERO_ADDRESS = "11111111111111111111111111111111"; // the placeholder key when it has no account
  const CB_TRUSTED = "coinbaseSolana:Addresses"; // the extension's cache of addresses this site may use, in our localStorage
  const CB_SETTLE_MS = 2500, CB_STEP_MS = 50, CB_POLL_MS = 1500, CB_APPROVAL_MS = 120000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isAddress = (a) => typeof a === "string" && a !== ZERO_ADDRESS && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

  function coinbaseConnector(p) {
    /** Null when there is no account, the zero placeholder, or a getter that throws (some do). */
    const read = () => { try { const k = p.publicKey; const a = k && k.toBase58(); return isAddress(a) ? a : null; } catch { return null; } };
    /** Waits for the account to appear, up to `ms`. */
    const appear = async (ms) => { const end = Date.now() + ms; for (;;) { const a = read(); if (a) return a; if (Date.now() >= end) return null; await sleep(CB_STEP_MS); } };
    const trusted = () => { try { const v = JSON.parse(localStorage.getItem(CB_TRUSTED) || "[]"); return Array.isArray(v) ? v.filter(isAddress) : []; } catch { return []; } };
    /** After a permission error its approval window can spin forever: bound it, generously (a person is reading it). */
    const approval = (what, work) => {
      let timer;
      const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Coinbase Wallet never answered the ${what} request. Reconnect this site in Coinbase Wallet, or use another wallet.`)), CB_APPROVAL_MS); });
      return Promise.race([work, late]).finally(() => clearTimeout(timer));
    };
    /** Before signing: reconnect silently, else ask again (the site may have been revoked meanwhile). */
    async function live() {
      if (read()) return;
      p.connect({ onlyIfTrusted: true }).catch(() => {});
      if (await appear(CB_SETTLE_MS)) return;
      const req = approval("connect", p.connect());
      req.catch(() => {}); // raced below: the account appearing counts too, the provider may never settle
      await Promise.race([req, appear(CB_APPROVAL_MS)]);
      if (read() || await appear(CB_SETTLE_MS)) return;
      throw new Error("Coinbase Wallet did not reconnect to this site. Open the extension, reconnect it, and try again.");
    }
    return {
      name: COINBASE,
      icon: COINBASE_ICON,
      async connect(silent) {
        if (silent) {
          const now = p.isConnected ? read() : null;
          if (now) return { address: now };
          if (!trusted().length) throw new Error("Coinbase Wallet has not authorised this site");
          p.connect({ onlyIfTrusted: true }).catch(() => {}); // not awaited: judged by the account appearing
        } else {
          await approval("connect", p.connect()); // awaited: a decline must surface as a decline
        }
        const address = (await appear(CB_SETTLE_MS)) || (silent ? trusted()[0] : null);
        if (!address) throw new Error("Coinbase Wallet returned no account");
        return { address };
      },
      async signMessage(_account, bytes) {
        await live();
        const res = await approval("sign message", p.signMessage(bytes));
        return new Uint8Array(res.signature || res);
      },
      signIn: null,
      async disconnect() { try { await p.disconnect(); } catch { /* already gone */ } },
      /** A switch is polled; a disconnect comes as an event. A switch to an account never authorised here changes nothing. */
      onAccountChange(fn) {
        let last = read();
        const poll = () => { const next = read(); if (!next || next === last) return; last = next; fn(next); };
        const gone = () => { if (last === null) return; last = null; fn(null); };
        const switches = ["accountChanged", "accountsChanged"]; // undocumented: free if never emitted
        try { p.on("disconnect", gone); for (const e of switches) p.on(e, poll); } catch { /* no events */ }
        const timer = setInterval(poll, CB_POLL_MS);
        return () => { clearInterval(timer); try { p.off("disconnect", gone); for (const e of switches) p.off(e, poll); } catch { /* ignore */ } };
      },
    };
  }

  /** Injected providers are added late, and only for names no standard wallet took. */
  function addInjected() {
    const cands = [
      ["Phantom", window.phantom && window.phantom.solana ? window.phantom.solana : window.solana && window.solana.isPhantom ? window.solana : null],
      ["Solflare", window.solflare && window.solflare.isSolflare !== false ? window.solflare : null],
      ["Backpack", window.backpack && window.backpack.connect ? window.backpack : null],
    ];
    let added = false;
    for (const [name, p] of cands) if (p && p.connect && p.signMessage && !connectors.has(name)) { connectors.set(name, injectedConnector(name, p)); added = true; }
    const cb = window.coinbaseSolana;
    if (cb && cb.connect && cb.signMessage && !connectors.has(COINBASE)) { connectors.set(COINBASE, coinbaseConnector(cb)); added = true; }
    if (added) discovered();
  }
  // Extensions inject at different moments; a second look catches a slow one.
  setTimeout(addInjected, 600);
  setTimeout(addInjected, 2000);

  // ── sign-in flow ─────────────────────────────────────────────────────────────────────────────────

  const RATE_LIMITED = "Too many sign-in attempts. Wait a minute and try again.";
  const WRONG_HOST = "Sign-in is set up for ";
  const wrongHost = (domain) => `${WRONG_HOST}${domain}, but this page is open on ${location.host}. Open ${location.protocol}//${domain} instead.`;

  function bytesToBase64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
  function isUserRejection(err) { return /reject|declin|denied|cancel/i.test(err && err.message ? err.message : String(err)); }
  function describe(err, context) {
    console.error("[siws] " + context, err);
    if (isUserRejection(err)) return "Signature request cancelled. Please try again.";
    if (/domain/i.test(err && err.message ? err.message : "")) return "Your wallet refused the sign-in: the page address does not match the site it is for.";
    return "Could not complete sign in. Please try again.";
  }

  async function postJson(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body || {}) });
    let data = {}; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  }

  async function fetchChallenge(publicKey) {
    const r = await postJson("/api/auth/challenge", publicKey ? { publicKey } : {});
    if (r.status === 429) throw new Error(RATE_LIMITED);
    if (r.status !== 200) throw new Error("Could not start sign-in.");
    // Wallets refuse a message whose domain is not this page's host (anti-phishing), so say so before asking them.
    const domain = r.data && r.data.signInInput && r.data.signInInput.domain;
    if (domain && domain !== location.host) throw new Error(wrongHost(domain));
    return r.data;
  }

  async function postVerify(publicKey, payload) {
    const r = await postJson("/api/auth/verify", Object.assign({ publicKey }, payload));
    if (r.status === 200) return { ok: true, address: r.data.address, playerId: r.data.playerId };
    if (r.status === 429) return { ok: false, error: RATE_LIMITED };
    return { ok: false, error: (r.data && r.data.error) || "Sign-in failed." };
  }

  /** Wallet already connected: solana:signIn on a bound challenge, else signMessage over the server's text. */
  async function signInConnected(conn, account) {
    const publicKey = account.address;
    const challenge = await fetchChallenge(publicKey);
    let payload = null;
    if (conn.signIn) {
      try {
        const res = await conn.signIn(challenge.signInInput);
        // The sheet lets the user pick another account; everything downstream keys off this address.
        if (res.account.address !== publicKey) return { ok: false, error: "A different account signed in. Try again." };
        payload = { method: "signIn", message: new TextDecoder().decode(res.signedMessage), signature: bytesToBase64(res.signature) };
      } catch (err) {
        if (isUserRejection(err)) return { ok: false, error: describe(err, "signIn declined") };
        // Wallets are flaky about signIn (Phantom in Brave throws the first time or two); fall back on the same challenge.
        console.warn("[siws] solana:signIn failed, falling back", err);
      }
    }
    if (!payload) {
      if (!conn.signMessage) return { ok: false, error: "This wallet can't sign messages." };
      const sig = await conn.signMessage(account, new TextEncoder().encode(challenge.message));
      payload = { method: "signMessage", message: challenge.message, signature: bytesToBase64(sig) };
    }
    const v = await postVerify(publicKey, payload);
    return v;
  }

  /** Connect and sign in. One approval on wallets with solana:signIn (unbound challenge), two otherwise. */
  async function signInWith(conn) {
    try {
      if (conn.signIn) {
        const challenge = await fetchChallenge(null);
        let res;
        try {
          res = await conn.signIn(challenge.signInInput);
        } catch (err) {
          if (isUserRejection(err)) return { ok: false, error: describe(err, "signIn declined") };
          console.warn("[siws] connect-and-sign-in failed, connecting first", err);
          // await: a rejection here must reach the catch below, or the buttons stay disabled
          return await signInConnected(conn, await conn.connect(false));
        }
        const publicKey = res.account.address;
        const v = await postVerify(publicKey, { method: "signIn", message: new TextDecoder().decode(res.signedMessage), signature: bytesToBase64(res.signature) });
        return v;
      }
      return await signInConnected(conn, await conn.connect(false));
    } catch (err) {
      if (err && err.message === RATE_LIMITED) return { ok: false, error: RATE_LIMITED };
      if (err && String(err.message).startsWith(WRONG_HOST)) return { ok: false, error: err.message };
      return { ok: false, error: describe(err, "sign-in failed") };
    }
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────────────

  const W = { address: null, playerId: null, balance: null, balanceFailed: false };
  const changeListeners = new Set();
  const signedInWaiters = [];
  let active = null; // the connector the session was made with, when connected
  let unwatch = null;

  function emit() { changeListeners.forEach((fn) => { try { fn(W); } catch (e) { console.error(e); } }); }

  async function refresh() {
    if (!W.address) return;
    try {
      const res = await fetch("/api/gback/balance", { credentials: "same-origin" });
      if (res.status === 401) { lostSession(); return; }
      // RPC hiccup: keep the last known amount; only without one is it shown as unavailable
      if (!res.ok) { if (!W.balance && !W.balanceFailed) { W.balanceFailed = true; emit(); } return; }
      W.balance = await res.json();
      W.balanceFailed = false;
      emit();
    } catch { /* offline: keep the last known amount */ }
  }

  function lostSession() {
    // The server no longer knows this session (expired, revoked): back to the sign-in screen.
    if (!W.address) return;
    location.reload();
  }

  function signedIn(address, playerId) {
    W.address = address;
    W.playerId = playerId || null;
    hideGate();
    emit();
    refresh();
    while (signedInWaiters.length) { const fn = signedInWaiters.shift(); try { fn(address); } catch (e) { console.error(e); } }
  }

  /** Follows the wallet's account: a switch asks what to do (#wswitch), a switch back closes that again. */
  function watch(conn) {
    if (unwatch) unwatch();
    active = conn;
    unwatch = conn.onAccountChange((addr) => onAccount(conn, addr));
  }

  async function signOut() {
    try { await postJson("/api/auth/logout", {}); } catch { /* the reload shows the gate either way */ }
    try { if (active) await active.disconnect(); } catch { /* ignore */ }
    store.set(LAST_WALLET, null);
    location.reload();
  }

  // No polling: the amount is read at sign-in and when the tab becomes visible again (a swap on another site means
  // leaving this tab and coming back). Tab flipping is throttled; each read costs an RPC call on our key.
  let lastFocusRead = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - lastFocusRead < FOCUS_READ_MIN_MS) return;
    lastFocusRead = Date.now();
    refresh();
  });
  // Keep-alive: /api/auth/session slides the cookie past half its idle window.
  function check() { if (W.address) fetch("/api/auth/session", { credentials: "same-origin" }).then((r) => r.json()).then((s) => { if (!s.address) lostSession(); }).catch(() => {}); }
  setInterval(check, KEEPALIVE_MS);

  // ── sign-in screen ───────────────────────────────────────────────────────────────────────────────

  const $ = (s) => document.querySelector(s);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  function renderWallets() {
    const list = $("#signin-list"); if (!list) return;
    list.textContent = "";
    for (const conn of connectors.values()) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn ghost signin-w";
      if (typeof conn.icon === "string" && conn.icon.startsWith("data:image/")) { const img = document.createElement("img"); img.src = conn.icon; img.alt = ""; b.appendChild(img); }
      b.appendChild(document.createTextNode(conn.name));
      b.addEventListener("click", () => pick(conn));
      list.appendChild(b);
    }
    const none = $("#signin-none"); if (none) none.style.display = connectors.size ? "none" : "block";
  }

  function setGateMsg(text, err) { const m = $("#signin-msg"); if (m) { m.textContent = text || ""; m.classList.toggle("err", !!err); } }
  function busy(on) { document.querySelectorAll("#signin-list button").forEach((b) => { b.disabled = on; }); }

  async function pick(conn) {
    busy(true); setGateMsg("Check your wallet to sign in…");
    const r = await signInWith(conn);
    busy(false);
    if (!r.ok) { setGateMsg(r.error, true); return; }
    store.set(LAST_WALLET, conn.name);
    watch(conn);
    setGateMsg("");
    signedIn(r.address, r.playerId);
  }

  function showGate() {
    const g = $("#signin"); if (!g) return;
    document.body.classList.add("gate");
    // On a phone without a wallet app's browser, offer to open this page inside one.
    if (isMobile) {
      const url = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin);
      const ph = $("#signin-phantom"), sf = $("#signin-solflare");
      if (ph) ph.href = `https://phantom.app/ul/browse/${url}?ref=${ref}`;
      if (sf) sf.href = `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`;
      g.classList.add("mobile");
    }
    renderWallets();
    g.classList.add("on");
  }
  function hideGate() { const g = $("#signin"); if (g) g.classList.remove("on"); document.body.classList.remove("gate"); }

  discoveryListeners.add(renderWallets);

  // ── wallet button ────────────────────────────────────────────────────────────────────────────────
  // Top right on the loading screen (#load .ld-top, where index.html puts it). Once the loading screen is gone it moves
  // to the top of #wallet in the top-right panel, above the on-chain amount (#wbal), which this file also fills.

  const shortAddr = (a) => a.slice(0, 4) + "…" + a.slice(-4);
  const amount = (b) => b.ui.toLocaleString(undefined, { maximumFractionDigits: 2 });

  function renderButton() {
    const box = $("#wbox"); if (!box) return;
    box.hidden = !W.address;
    if (!W.address) return;
    $("#wbtn-addr").textContent = shortAddr(W.address);
    $("#wmenu-addr").textContent = W.address;
    const shown = W.balance ? amount(W.balance) : W.balanceFailed ? "—" : "…";
    $("#wmenu-bal").textContent = shown + " $GBACK";
    const n = $("#wbal-n"); if (n) n.textContent = shown;
    renderRefresh();
  }

  function menuOpen(on) {
    const m = $("#wmenu"), b = $("#wbtn"); if (!m || !b) return;
    m.hidden = !on;
    if (!on && tipFor && m.contains(tipFor)) tipHide();
    document.body.classList.toggle("wmenu-on", on);
    b.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function placeButton() {
    const box = $("#wbox"); if (!box || box.hidden) return;
    const load = $("#load"), wallet = $("#wallet"), top = $("#load .ld-top");
    const host = wallet && load && load.classList.contains("off") ? wallet : top;
    // First in #wallet: its last child is the energy bar, which the CSS styles as such.
    if (host && box.parentNode !== host) { menuOpen(false); host.insertBefore(box, host === wallet ? host.firstChild : null); }
  }

  // A click on the amount reads it again: #wbal in the game, #wmenu-bal in the wallet menu on the loading screen.
  // Once per 30 s, the window in which the server reads the RPC at most once per wallet anyway (BALANCE_READ_SECONDS
  // in src/gback.ts); a click inside it would only get the stored amount back.
  const REFRESH_EVERY_MS = 30000;
  let lastManual = 0, reading = false;

  const AMOUNTS = ["#wbal", "#wmenu-bal"];

  // ── tooltip ──────────────────────────────────────────────────────────────────────────────────────
  // After the dashboard's atoms/tooltip.tsx: hover or focus shows it, a tap shows it on touch (with the click), leaving,
  // blur, Escape or a tap elsewhere hides it. One element on <body>, fixed under its trigger and right-aligned to it
  // (the triggers sit at the right edge), flipped above when there is no room: no panel can clip or cover it.
  // The text is the trigger's data-tip, re-read whenever the caller changes it (tipUpdate).

  let tipEl = null, tipFor = null;

  function tipPlace() {
    if (!tipEl || !tipFor) return;
    const r = tipFor.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight, pad = 8;
    const left = Math.max(pad, Math.min(r.right - w, innerWidth - w - pad));
    const top = r.bottom + 6 + h > innerHeight - pad ? r.top - 6 - h : r.bottom + 6;
    tipEl.style.left = left + "px";
    tipEl.style.top = Math.max(pad, top) + "px";
  }

  function tipShow(el) {
    const text = el.dataset.tip;
    if (!text) { tipHide(); return; }
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.id = "gtip"; tipEl.setAttribute("role", "tooltip"); document.body.appendChild(tipEl); }
    if (tipFor && tipFor !== el) tipFor.removeAttribute("aria-describedby");
    tipFor = el;
    el.setAttribute("aria-describedby", "gtip");
    tipEl.textContent = text;
    tipPlace();
    tipEl.classList.add("on");
  }

  function tipHide() {
    if (tipEl) tipEl.classList.remove("on");
    if (tipFor) tipFor.removeAttribute("aria-describedby");
    tipFor = null;
  }

  function tipUpdate(el) { if (tipFor === el) tipShow(el); }

  function withTip(el) {
    el.addEventListener("mouseenter", () => tipShow(el));
    el.addEventListener("mouseleave", tipHide);
    el.addEventListener("focus", () => tipShow(el));
    el.addEventListener("blur", tipHide);
    el.addEventListener("click", () => tipShow(el)); // touch has no hover
  }

  document.addEventListener("pointerdown", (e) => { if (tipFor && !tipFor.contains(e.target)) tipHide(); }, true);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") tipHide(); }, true);
  window.addEventListener("resize", tipPlace);

  let tickTimer = 0;

  function renderRefresh() {
    const wait = Math.ceil((REFRESH_EVERY_MS - (Date.now() - lastManual)) / 1000);
    const failed = W.balanceFailed && !W.balance;
    const tip = reading ? "Updating your balance…"
      : failed ? (wait > 0 ? `Couldn't load your balance. You can try again in ${wait} s.` : "Couldn't load your balance. Click to try again.")
      : wait > 0 ? `Updated just now. You can update again in ${wait} s.`
      : "Your $GBACK balance. Click to update.";
    for (const sel of AMOUNTS) {
      const el = $(sel); if (!el) continue;
      el.classList.toggle("reading", reading);
      el.classList.toggle("wait", !reading && wait > 0);
      el.dataset.tip = tip;
      el.setAttribute("aria-disabled", reading || wait > 0 ? "true" : "false");
      tipUpdate(el);
    }
    // An open tooltip counts down by the second.
    clearTimeout(tickTimer);
    if (wait > 0 && tipFor && AMOUNTS.some((sel) => $(sel) === tipFor)) tickTimer = setTimeout(renderRefresh, 1000);
  }

  async function manualRefresh() {
    if (reading || Date.now() - lastManual < REFRESH_EVERY_MS) return;
    lastManual = Date.now();
    reading = true; renderRefresh();
    await refresh();
    reading = false; renderRefresh();
    setTimeout(renderRefresh, REFRESH_EVERY_MS - (Date.now() - lastManual) + 50);
  }

  function wireButton() {
    const b = $("#wbtn"), m = $("#wmenu"); if (!b || !m) return;
    b.addEventListener("click", (e) => { e.stopPropagation(); menuOpen(m.hidden); });
    m.addEventListener("click", (e) => e.stopPropagation());
    // Click anywhere else, or Escape, closes it. Capture, so the game's own key handling cannot swallow the Escape first.
    document.addEventListener("click", () => menuOpen(false));
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !m.hidden) menuOpen(false); }, true);
    $("#wcopy").addEventListener("click", async () => {
      const c = $("#wcopy");
      try { await navigator.clipboard.writeText(W.address); c.textContent = "Copied"; } catch { c.textContent = "Copy failed"; }
      setTimeout(() => { c.textContent = "Copy address"; }, 1500);
    });
    $("#wout").addEventListener("click", () => { $("#wout").disabled = true; signOut(); });
    for (const sel of AMOUNTS) {
      const el = $(sel); if (!el) continue;
      el.addEventListener("click", manualRefresh);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); manualRefresh(); } });
      withTip(el);
      el.addEventListener("mouseenter", renderRefresh); // after withTip: the tooltip is open, so its countdown starts
    }
    changeListeners.add(renderButton);
    renderButton();
    // Neither the chip nor the loading screen's end announce themselves; a cheap check twice a second is enough.
    setInterval(placeButton, 500);
  }

  // ── wallet switch ────────────────────────────────────────────────────────────────────────────────
  // The session belongs to the wallet that signed, so a switch in the extension does not move it. A card says so:
  // "Continue" signs in the new account (a new signature: a switch in the extension proves nothing) and reloads, so
  // the game starts clean as that wallet: its own name, look, progress, passport and $GBACK, or the new-player flow
  // when it has none (profile.js, plan_progress.js). A reload, not a live swap: too much in the game keeps per-player
  // state of its own to swap safely. Switching back to the signed-in account closes the card.
  //
  // A switch to an account this site was never connected to arrives WITHOUT an address (Phantom: an empty account
  // list, or null): then a silent connect is tried, and if the wallet will not tell, the card shows with the address
  // unknown and "Continue" asks the wallet to connect first. Events alone are not enough either (a wallet locked at
  // page load is never watched), so a return to this window checks the wallet's account again (local, no network).

  let switchTo = null; // { conn, address | null }

  function onAccount(conn, addr) {
    if (!W.address) return;
    console.info("[wallet] account now", addr || "(not shared with this site)");
    if (addr === W.address) { hideSwitch(); return; }
    if (addr) { showSwitch(conn, addr); return; }
    conn.connect(true).then(
      (acc) => { if (acc.address === W.address) hideSwitch(); else showSwitch(conn, acc.address); },
      () => showSwitch(conn, null),
    );
  }

  /** The wallet's current account, asked silently: on a return to this window, and when nothing is watched yet. */
  async function recheck() {
    if (!W.address) return;
    const conn = active || connectors.get(store.get(LAST_WALLET) || "");
    if (!conn) return;
    let acc;
    try { acc = await conn.connect(true); } catch { return; } // locked or not trusted: nothing to tell, no card
    if (!active) watch(conn);
    if (acc.address === W.address) hideSwitch(); else showSwitch(conn, acc.address);
  }

  function setSwitchMsg(text, err) { const m = $("#wswitch-msg"); if (m) { m.textContent = text || ""; m.classList.toggle("err", !!err); } }
  function switchBusy(on) { for (const id of ["#wswitch-go", "#wswitch-out"]) { const b = $(id); if (b) b.disabled = on; } }

  function showSwitch(conn, addr) {
    const c = $("#wswitch"); if (!c) return;
    switchTo = { conn, address: addr };
    $("#wswitch-from").textContent = shortAddr(W.address);
    $("#wswitch-from2").textContent = shortAddr(W.address);
    $("#wswitch-to").textContent = addr ? shortAddr(addr) : "an account not yet connected here";
    $("#wswitch-go").textContent = addr ? `Continue with ${shortAddr(addr)}` : "Connect and continue";
    setSwitchMsg(""); switchBusy(false); menuOpen(false); tipHide();
    c.classList.add("on");
    try { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); } catch { /* no pointer lock */ }
  }

  function hideSwitch() { switchTo = null; const c = $("#wswitch"); if (c) c.classList.remove("on"); }

  async function continueSwitch() {
    const t = switchTo; if (!t) return;
    switchBusy(true); setSwitchMsg("Check your wallet to sign in…");
    let r;
    try {
      // The extension's current account, in the shape signing needs. Unknown address: the wallet asks to connect it.
      const account = await t.conn.connect(t.address === null ? false : true);
      if (account.address === W.address) { hideSwitch(); return; }
      r = t.address === null || account.address === t.address ? await signInConnected(t.conn, account) : { ok: false, error: "Your wallet switched again. Try again." };
    } catch (err) {
      r = { ok: false, error: err && err.message === RATE_LIMITED ? RATE_LIMITED : describe(err, "switch sign-in failed") };
    }
    if (!r.ok) { switchBusy(false); setSwitchMsg(r.error, true); return; }
    // The server revoked the old session when it issued this one.
    store.set(LAST_WALLET, t.conn.name);
    setSwitchMsg("Signed in. Loading your world…");
    location.reload();
  }

  function wireSwitch() {
    const go = $("#wswitch-go"), out = $("#wswitch-out"); if (!go || !out) return;
    go.addEventListener("click", continueSwitch);
    out.addEventListener("click", () => { switchBusy(true); signOut(); });
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") recheck(); });
  }

  // ── start: is there a session already? ──────────────────────────────────────────────────────────

  async function start() {
    wireButton();
    wireSwitch();
    let session = {};
    try { session = await (await fetch("/api/auth/session", { credentials: "same-origin" })).json(); } catch { /* offline or not configured */ }
    const address = session.address || null;
    if (!address) { showGate(); return; }
    signedIn(address, session.playerId);
    // Reconnect the same wallet silently, only to notice an account switch (#wswitch). The session does not depend on it.
    const last = store.get(LAST_WALLET);
    if (!last) return;
    const tryWatch = async () => {
      const conn = connectors.get(last); if (!conn || active) return;
      // Switched while the page was closed: the same card, over the loading screen.
      try { const acc = await conn.connect(true); watch(conn); onAccount(conn, acc.address); } catch { /* not trusted any more: fine */ }
    };
    tryWatch();
    discoveryListeners.add(tryWatch);
  }

  window.GB_WALLET = {
    get address() { return W.address; },
    get playerId() { return W.playerId; },
    get balance() { return W.balance; },
    whenSignedIn(fn) { if (W.address) fn(W.address); else signedInWaiters.push(fn); },
    signOut,
    refresh,
    check,
    on(event, fn) { if (event === "change") changeListeners.add(fn); return () => changeListeners.delete(fn); },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
