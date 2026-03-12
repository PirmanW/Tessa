import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { LocalLlmModelSection } from "./LocalLlmModelSection";
import { LocalLlmExternalSection } from "./LocalLlmExternalSection";
import { LocalLlmPromptSection } from "./LocalLlmPromptSection";
import { LocalLlmTestSection } from "./LocalLlmTestSection";

export const LocalLlmSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();

  const mode = getSetting("local_llm_mode") ?? "embedded";

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.localLlm.mode.label")}>
        <div className="flex gap-2 p-2">
          <button
            className={`px-3 py-1.5 rounded-md text-sm ${
              mode === "embedded"
                ? "bg-logo-primary text-white"
                : "bg-mid-gray/20 hover:bg-mid-gray/30"
            }`}
            onClick={() => updateSetting("local_llm_mode", "embedded" as any)}
          >
            {t("settings.localLlm.mode.embedded")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-sm ${
              mode === "external"
                ? "bg-logo-primary text-white"
                : "bg-mid-gray/20 hover:bg-mid-gray/30"
            }`}
            onClick={() => updateSetting("local_llm_mode", "external" as any)}
          >
            {t("settings.localLlm.mode.external")}
          </button>
        </div>
      </SettingsGroup>

      {mode === "embedded" ? (
        <LocalLlmModelSection />
      ) : (
        <LocalLlmExternalSection />
      )}

      <LocalLlmPromptSection />
      <LocalLlmTestSection />
    </div>
  );
};
