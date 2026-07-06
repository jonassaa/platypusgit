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
   * Executes the item. May act directly, push a param step, or fire a nav
   * intent. The component closes the palette *before* calling run() only for
   * non-step items — see CommandPalette.activate.
   */
  run: () => void;
}

/** One screen of the palette state machine. */
export type PaletteStep =
  | { kind: "root" }
  | { kind: "pick"; title: string; items: PaletteItem[] }
  | {
      kind: "input";
      title: string;
      placeholder: string;
      initial?: string;
      /** Return an error string to block submit, or null to allow. */
      validate?: (value: string) => string | null;
      onSubmit: (value: string) => void;
    };
