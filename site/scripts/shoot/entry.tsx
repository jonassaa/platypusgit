// The rig's browser entry. Picks a scene from `?scene=`, seeds its world, and
// mounts the REAL app — no replica, which is the whole point: a hand-built
// stand-in drifts from the app on every UI change with nothing to catch it.
import { registerScene, misses, hits, type Scene } from "./shim/core";
import { scenes } from "./scenes";

const name = new URLSearchParams(location.search).get("scene") ?? "welcome";
const scene: Scene | undefined = scenes[name];
if (!scene) {
  throw new Error(
    `[shoot] unknown scene "${name}". Known: ${Object.keys(scenes).join(", ")}`,
  );
}

registerScene(scene);

// Storage must be written BEFORE any store module is imported: the Zustand
// stores read localStorage at module scope, so an import that lands first sees
// an empty world and the figure renders the default state. The dynamic
// import() below is what guarantees the order.
localStorage.clear();
for (const [k, v] of Object.entries(scene.storage)) localStorage.setItem(k, v);

// Freeze the clock. Relative ages ("1mo ago") are computed against this, so a
// figure shot today and one shot next month are identical.
const FIXED = new Date(scene.now).getTime();
const RealDate = Date;
// `ConstructorParameters<typeof Date>` collapses to the one-argument overload,
// so a typed rest parameter cannot express "no arguments OR any of the real
// overloads". `unknown[]` plus one cast is the honest way to say it.
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXED);
    else super(...(args as [number]));
  }
  static now(): number {
    return FIXED;
  }
}
globalThis.Date = FrozenDate as unknown as DateConstructor;

const [React, ReactDOM, App] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import("@/App"),
  import("@/index.css"),
]);

// Deliberately NOT wrapped in React.StrictMode, and without RevealOnFirstPaint
// or PGErrorBoundary: StrictMode double-invokes effects (doubling fixture calls
// for no benefit), and the reveal is a no-op outside a real Tauri window.
ReactDOM.default
  .createRoot(document.getElementById("root") as HTMLElement)
  .render(React.default.createElement(App.default));

// Drive the app into the state this figure shows. Runs after the first render,
// and a failure is LOUD: a scene that silently did not navigate would shoot the
// History screen under the commit figure's name, which is exactly the kind of
// wrong that survives review.
if (scene.afterMount) {
  void scene.afterMount().catch((err) => {
    console.error("[shoot] afterMount failed", err);
    const el = document.createElement("pre");
    el.style.cssText =
      "position:fixed;inset:0;z-index:99999;margin:0;padding:24px;" +
      "background:#3b0d0d;color:#fff;font:16px/1.5 ui-monospace,Menlo,monospace";
    el.textContent = `[shoot] scene "${scene.name}" afterMount failed:\n\n${String(err)}`;
    document.body.appendChild(el);
  });
}

// The fixture worklist, on screen.
//
// `?report=1` renders every command this scene was asked for and did not have,
// over the top of whatever did render. One run then names every fixture the
// screen wants, instead of surfacing them one reload at a time. The shoot
// driver never passes it, so a real figure is never contaminated.
//
// It is also the ONLY channel out of the page that works here: --dump-dom fires
// at the load event, before a module's top-level await resolves.
if (new URLSearchParams(location.search).get("report") === "1") {
  setTimeout(() => {
    const el = document.createElement("pre");
    el.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:99999",
      "margin:0",
      "padding:24px",
      "overflow:auto",
      "background:#0d1013",
      "color:#e6e6e6",
      "font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
      "white-space:pre-wrap",
    ].join(";");
    el.textContent =
      `scene: ${scene.name}  ->  ${scene.figure}\n\n` +
      `MISSING (${misses.length}):\n` +
      (misses.length ? misses.map((c) => `  ${c}`).join("\n") : "  (none)") +
      `\n\nANSWERED (${hits.length}):\n` +
      (hits.length ? hits.map((c) => `  ${c}`).join("\n") : "  (none)");
    document.body.appendChild(el);
  }, 3000);
}
