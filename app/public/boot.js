/* Sign in first, then load the game (docs/auth.md).
 *
 * The game's scripts sit in index.html as <script type="gb/game">, a type the browser neither fetches nor runs, so the
 * sign-in screen has the main thread to itself: no world build stalls the wallet buttons or the reply to a signature.
 * Once web3.js has a session they are put back as real scripts in document order: they download in parallel and run
 * one after another (async = false), as the plain tags did. */
(function () {
  "use strict";

  let started = false;

  // index.html's AV() puts each asset's content hash in its URL; three's loaders go through it once THREE exists.
  // A script's load event fires right after it ran and before the next ordered script runs, so this is in place
  // before any game script loads a model or a texture.
  function threeReady() {
    try { THREE.DefaultLoadingManager.setURLModifier(window.AV); } catch (e) { console.warn("asset versions: no URL modifier", e); }
  }

  function failed(src) {
    console.error("[boot] could not load", src);
    const m = document.getElementById("loadmsg");
    if (m) m.textContent = "Could not load the game. Reload the page to try again.";
  }

  function loadGame() {
    if (started) return;
    started = true;
    for (const tag of Array.from(document.querySelectorAll('script[type="gb/game"]'))) {
      const s = document.createElement("script");
      s.src = tag.getAttribute("src");
      s.async = false;
      if (tag.hasAttribute("data-three")) s.onload = threeReady;
      s.onerror = () => failed(s.src);
      tag.replaceWith(s);
    }
  }

  GB_WALLET.whenSignedIn(loadGame);
})();
