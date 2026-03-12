import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCcw } from "lucide-react";
import { commands } from "@/bindings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { Dropdown } from "@/components/ui";
import { useSettings } from "@/hooks/useSettings";

export const LocalLlmExternalSection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);

  const url = (getSetting("local_llm_external_url") as string) ?? "";
  const apiKey = (getSetting("local_llm_external_api_key") as string) ?? "";
  const model = (getSetting("local_llm_external_model") as string) ?? "";

  const refreshModels = async () => {
    setFetching(true);
    try {
      const result = await commands.fetchLocalLlmExternalModels();
      if (result.status === "ok") {
        setModelOptions(result.data);
      }
    } finally {
      setFetching(false);
    }
  };

  return (
    <SettingsGroup title={t("settings.localLlm.external.url.title")}>
      <SettingContainer
        title={t("settings.localLlm.external.url.title")}
        description={t("settings.localLlm.external.url.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <input
          type="text"
          className="w-64 px-2 py-1 rounded-md bg-mid-gray/10 border border-mid-gray/20 text-sm"
          placeholder={t("settings.localLlm.external.url.placeholder")}
          value={url}
          onChange={(e) =>
            updateSetting("local_llm_external_url", e.target.value as any)
          }
        />
      </SettingContainer>

      <SettingContainer
        title={t("settings.localLlm.external.apiKey.title")}
        description={t("settings.localLlm.external.apiKey.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <input
          type="password"
          className="w-64 px-2 py-1 rounded-md bg-mid-gray/10 border border-mid-gray/20 text-sm"
          placeholder={t("settings.localLlm.external.apiKey.placeholder")}
          value={apiKey}
          onChange={(e) =>
            updateSetting(
              "local_llm_external_api_key",
              e.target.value as any,
            )
          }
        />
      </SettingContainer>

      <SettingContainer
        title={t("settings.localLlm.external.model.title")}
        description={t("settings.localLlm.external.model.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <div className="flex items-center gap-2">
          <Dropdown
            value={model}
            onChange={(val) =>
              updateSetting("local_llm_external_model", val as any)
            }
            options={
              modelOptions.length > 0
                ? modelOptions.map((m) => ({ value: m, label: m }))
                : model
                  ? [{ value: model, label: model }]
                  : []
            }
          />
          <button
            className="p-1.5 rounded-md hover:bg-mid-gray/10"
            onClick={refreshModels}
            disabled={fetching}
            title={t("settings.localLlm.external.model.refresh")}
          >
            <RefreshCcw
              size={14}
              className={fetching ? "animate-spin" : ""}
            />
          </button>
        </div>
      </SettingContainer>
    </SettingsGroup>
  );
};
