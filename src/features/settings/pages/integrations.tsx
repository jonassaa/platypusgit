import { ForgeSettings } from "@/features/forge/ForgeSettings";
import type { SettingsPageMeta } from "@/features/settings/nav/types";

export const meta: SettingsPageMeta = {
  id: "git.integrations",
  group: "git",
  title: "Integrations",
  icon: "link",
  cards: [
    {
      id: "integrations",
      title: "Integrations",
      // The host list is DATA — a host can hold several accounts — so there are
      // no fixed rows to index. `dynamic` means: render the card in full when
      // any of these synthetic rows match, and skip the both-directions DOM
      // check in the guard test.
      dynamic: true,
      rows: [
        { id: "integrations.token", label: "Forge token", keywords: "github gitlab personal access token pat account api credential pull request merge request" },
        { id: "integrations.none", label: "No forge detected" },
        { id: "integrations.error", label: "Last error" },
      ],
    },
  ],
};

export function IntegrationsPage() {
  return <ForgeSettings />;
}
