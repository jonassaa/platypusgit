/** The four result categories shown at the root step. */
export type ResultType = "command" | "branch" | "file" | "commit";

/** Active type-filter chip. "all" = no filtering (default). */
export type ChipKind = "all" | ResultType;

/** A single selectable palette row. Its `run()` is the only behaviour hook. */
export interface PaletteItem {
  type: ResultType;
  /** Stable key for React + frecency tracking. */
  id: string;
  /** String the fuzzy matcher runs against. */
  search: string;
  /** Primary label shown to the user. */
  label: string;
  /** Optional muted secondary detail. */
  detail?: string;
  icon: string;
  /** When true the label renders danger-tinted (destructive op). */
  danger?: boolean;
  /**
   * Keymap action this item corresponds to. The palette renders the action's
   * live chord (from the active preset) as a shortcut chip on the row.
   */
  actionId?: import("@/features/keymap").ActionId;
  /**
   * A literal chord, for a row whose shortcut is not a catalog action — a
   * user-defined action (#225), whose binding is a value in Settings rather
   * than a preset entry. Rendered the same way `actionId` is.
   */
  chord?: string;
  /**
   * Executes the item. May act directly, push a param step, or fire a nav
   * intent. The component closes the palette *before* calling run() only for
   * non-step items — see CommandPalette.activate.
   */
  run: () => void;
}

/** One screen of the palette state machine. */
export type PaletteStep =
  | { kind: "root" }
  | {
      kind: "pick";
      title: string;
      items: PaletteItem[];
      /**
       * Where the cursor rests while the step's query is empty. `"first"` (the
       * default) preselects row 0, so Enter activates it immediately; `"none"`
       * preselects nothing, so Enter does nothing until the user aims.
       *
       * Steps whose row 0 is a plausible, destructive target use `"none"` —
       * the branch steps, since #135 pins the default branch there and
       * "⌘P, delete branch, Enter, Enter" would otherwise land on `main`.
       * Once a query is typed the top match IS the target and the cursor
       * moves to row 0 either way.
       */
      cursor?: "first" | "none";
    }
  | {
      kind: "input";
      title: string;
      placeholder: string;
      initial?: string;
      /** Return an error string to block submit, or null to allow. */
      validate?: (value: string) => string | null;
      onSubmit: (value: string) => void;
    };
