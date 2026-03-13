import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface LocalLlmToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const LocalLlmToggle: React.FC<LocalLlmToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("local_llm_enabled") || false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(enabled) => updateSetting("local_llm_enabled", enabled)}
        isUpdating={isUpdating("local_llm_enabled")}
        label={t("settings.localLlm.title")}
        description={t("settings.localLlm.title")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
