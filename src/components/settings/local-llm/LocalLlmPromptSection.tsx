import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { Dropdown } from "@/components/ui";
import { useSettings } from "@/hooks/useSettings";

interface LLMPrompt {
  id: string;
  name: string;
  prompt: string;
}

export const LocalLlmPromptSection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, refreshSettings } = useSettings();

  const prompts = (getSetting("local_llm_prompts") as LLMPrompt[]) ?? [];
  const selectedId =
    (getSetting("local_llm_selected_prompt_id") as string) ?? "";

  const selectedPrompt = prompts.find((p) => p.id === selectedId);
  const [editName, setEditName] = useState(selectedPrompt?.name ?? "");
  const [editPrompt, setEditPrompt] = useState(selectedPrompt?.prompt ?? "");

  const handleSelectPrompt = async (id: string) => {
    await commands.setLocalLlmSelectedPrompt(id);
    refreshSettings();
    const prompt = prompts.find((p) => p.id === id);
    if (prompt) {
      setEditName(prompt.name);
      setEditPrompt(prompt.prompt);
    }
  };

  const handleCreateNew = async () => {
    const newId = `custom_${Date.now()}`;
    const newPrompt = {
      id: newId,
      name: "New Prompt",
      prompt: "Clean this voice transcription:\n\n${output}",
    };
    await commands.addLocalLlmPrompt(newPrompt);
    await commands.setLocalLlmSelectedPrompt(newId);
    refreshSettings();
    setEditName(newPrompt.name);
    setEditPrompt(newPrompt.prompt);
  };

  const handleSave = async () => {
    if (!selectedId) return;
    await commands.updateLocalLlmPrompt({
      id: selectedId,
      name: editName,
      prompt: editPrompt,
    });
    refreshSettings();
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    await commands.deleteLocalLlmPrompt(selectedId);
    refreshSettings();
    const remaining = prompts.filter((p) => p.id !== selectedId);
    if (remaining.length > 0) {
      setEditName(remaining[0].name);
      setEditPrompt(remaining[0].prompt);
    }
  };

  // Sync edit fields when selection changes externally
  React.useEffect(() => {
    if (selectedPrompt) {
      setEditName(selectedPrompt.name);
      setEditPrompt(selectedPrompt.prompt);
    }
  }, [selectedPrompt?.id]);

  return (
    <SettingsGroup title={t("settings.localLlm.prompt.title")}>
      <div className="flex flex-col gap-3 p-2">
        <div className="flex items-center gap-2">
          <Dropdown
            selectedValue={selectedId}
            onSelect={handleSelectPrompt}
            options={prompts.map((p) => ({ value: p.id, label: p.name }))}
          />
          <button
            className="text-xs bg-logo-primary text-white px-2 py-1 rounded"
            onClick={handleCreateNew}
          >
            {t("settings.localLlm.prompt.createNew")}
          </button>
        </div>

        {selectedPrompt && (
          <>
            <div>
              <label className="text-xs text-mid-gray">
                {t("settings.localLlm.prompt.name")}
              </label>
              <input
                type="text"
                className="w-full px-2 py-1 rounded-md bg-mid-gray/10 border border-mid-gray/20 text-sm mt-1"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs text-mid-gray">
                {t("settings.localLlm.prompt.instruction")}
              </label>
              <textarea
                className="w-full p-2 rounded-md bg-mid-gray/10 border border-mid-gray/20 text-sm resize-none mt-1"
                rows={5}
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
              />
              <p className="text-xs text-mid-gray mt-1">
                {t("settings.localLlm.prompt.instructionHint")}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                className="text-xs bg-logo-primary text-white px-3 py-1 rounded"
                onClick={handleSave}
              >
                {t("settings.localLlm.prompt.save")}
              </button>
              {prompts.length > 1 && (
                <button
                  className="text-xs text-red-400 hover:text-red-300 px-3 py-1"
                  onClick={handleDelete}
                >
                  {t("settings.localLlm.prompt.delete")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </SettingsGroup>
  );
};
