import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { commands, type ModelUnloadTimeout } from "@/bindings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { Dropdown } from "@/components/ui";
import { useSettings } from "@/hooks/useSettings";

interface LlmModel {
  id: string;
  name: string;
  filename: string;
  size_mb: number;
  is_downloaded: boolean;
  is_downloading: boolean;
  is_custom: boolean;
}

interface DownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

export const LocalLlmModelSection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting } = useSettings();
  const [models, setModels] = useState<LlmModel[]>([]);
  const [downloading, setDownloading] = useState<Record<string, number>>({});

  const selectedModelId = getSetting("local_llm_model_id") as
    | string
    | null
    | undefined;
  const gpuLayers = (getSetting("local_llm_gpu_layers") as number) ?? 0;
  const unloadTimeout =
    (getSetting("local_llm_unload_timeout") as string) ?? "never";

  const refreshModels = useCallback(async () => {
    const result = await commands.listLocalLlmModels();
    if (result.status === "ok") {
      setModels(result.data);
    }
  }, []);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>(
      "local-llm-download-progress",
      (event) => {
        setDownloading((prev) => ({
          ...prev,
          [event.payload.model_id]: event.payload.percentage,
        }));
      },
    );

    const unlistenComplete = listen<string>(
      "local-llm-download-completed",
      (event) => {
        setDownloading((prev) => {
          const next = { ...prev };
          delete next[event.payload];
          return next;
        });
        refreshModels();
      },
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, [refreshModels]);

  const handleDownload = async (modelId: string) => {
    setDownloading((prev) => ({ ...prev, [modelId]: 0 }));
    const result = await commands.downloadLocalLlmModel(modelId);
    if (result.status === "error") {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  };

  const handleDelete = async (modelId: string) => {
    await commands.deleteLocalLlmModel(modelId);
    if (selectedModelId === modelId) {
      updateSetting("local_llm_model_id", null as any);
    }
    refreshModels();
  };

  const handleImport = async () => {
    const path = await open({
      filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
    });
    if (path) {
      const result = await commands.importLocalLlmModel(path as string);
      if (result.status === "ok") {
        refreshModels();
      }
    }
  };

  const handleSelect = (modelId: string) => {
    updateSetting("local_llm_model_id", modelId as any);
  };

  const downloadedModels = models.filter((m) => m.is_downloaded);
  const notDownloadedModels = models.filter(
    (m) => !m.is_downloaded && !m.is_custom,
  );

  const unloadTimeoutOptions = [
    { value: "never", label: "Never" },
    { value: "immediately", label: "Immediately" },
    { value: "sec5", label: "5 seconds" },
    { value: "min2", label: "2 minutes" },
    { value: "min5", label: "5 minutes" },
    { value: "min10", label: "10 minutes" },
    { value: "min15", label: "15 minutes" },
    { value: "hour1", label: "1 hour" },
  ];

  return (
    <>
      <SettingsGroup title={t("settings.localLlm.model.title")}>
        <div className="flex flex-col gap-2 p-2">
          {downloadedModels.length > 0 && (
            <div className="flex flex-col gap-1">
              {downloadedModels.map((model) => (
                <div
                  key={model.id}
                  className={`flex items-center justify-between p-2 rounded-md cursor-pointer ${
                    selectedModelId === model.id
                      ? "bg-logo-primary/10 border border-logo-primary/30"
                      : "bg-mid-gray/5 hover:bg-mid-gray/10"
                  }`}
                  onClick={() => handleSelect(model.id)}
                >
                  <div>
                    <span className="text-sm font-medium">{model.name}</span>
                    <span className="text-xs text-mid-gray ml-2">
                      {t("settings.localLlm.model.size", {
                        size: model.size_mb,
                      })}
                    </span>
                  </div>
                  <button
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(model.id);
                    }}
                  >
                    {t("settings.localLlm.model.delete")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {downloadedModels.length === 0 && (
            <p className="text-sm text-mid-gray">
              {t("settings.localLlm.model.noModels")}
            </p>
          )}

          {notDownloadedModels.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-mid-gray mb-1">
                {t("settings.localLlm.model.recommended")}
              </p>
              {notDownloadedModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between p-2 bg-mid-gray/5 rounded-md mb-1"
                >
                  <div>
                    <span className="text-sm">{model.name}</span>
                    <span className="text-xs text-mid-gray ml-2">
                      {t("settings.localLlm.model.size", {
                        size: model.size_mb,
                      })}
                    </span>
                  </div>
                  {downloading[model.id] !== undefined ? (
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-logo-primary rounded-full transition-all"
                          style={{
                            width: `${downloading[model.id]}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-mid-gray">
                        {Math.round(downloading[model.id])}%
                      </span>
                    </div>
                  ) : (
                    <button
                      className="text-xs bg-logo-primary text-white px-2 py-1 rounded"
                      onClick={() => handleDownload(model.id)}
                    >
                      {t("settings.localLlm.model.download")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            className="self-start text-xs text-logo-primary hover:underline mt-1"
            onClick={handleImport}
          >
            {t("settings.localLlm.model.import")}
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings.localLlm.gpu.title")}>
        <SettingContainer
          title={t("settings.localLlm.gpu.title")}
          description={t("settings.localLlm.gpu.description")}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <input
            type="range"
            min={0}
            max={64}
            value={gpuLayers}
            onChange={(e) =>
              updateSetting(
                "local_llm_gpu_layers",
                parseInt(e.target.value) as any,
              )
            }
            className="w-32"
          />
          <span className="text-sm ml-2 w-8">{gpuLayers}</span>
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title={t("settings.localLlm.unloadTimeout.title")}>
        <SettingContainer
          title={t("settings.localLlm.unloadTimeout.title")}
          description={t("settings.localLlm.unloadTimeout.description")}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <Dropdown
            selectedValue={unloadTimeout}
            onSelect={(val: string) =>
              updateSetting("local_llm_unload_timeout", val as ModelUnloadTimeout)
            }
            options={unloadTimeoutOptions}
          />
        </SettingContainer>
      </SettingsGroup>
    </>
  );
};
