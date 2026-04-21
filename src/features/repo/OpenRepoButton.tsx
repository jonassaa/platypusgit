import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRepoStore } from "./useRepoStore";

export function OpenRepoButton() {
  const openRepo = useRepoStore((s) => s.openRepo);
  const loading = useRepoStore((s) => s.loading);

  async function handleClick() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open repository",
    });
    if (typeof selected === "string") {
      await openRepo(selected);
    }
  }

  return (
    <Button onClick={handleClick} disabled={loading}>
      <FolderOpen size={16} />
      {loading ? "Opening…" : "Open repository"}
    </Button>
  );
}
