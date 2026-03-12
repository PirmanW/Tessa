import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";

export const LocalLlmTestSection: React.FC = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setResult("");
    try {
      const res = await commands.testLocalLlm(input);
      if (res.status === "ok") {
        setResult(res.data);
      } else {
        setResult(`Error: ${res.error}`);
      }
    } catch (e) {
      setResult(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsGroup title={t("settings.localLlm.test.title")}>
      <div className="flex flex-col gap-2 p-2">
        <textarea
          className="w-full p-2 rounded-md bg-mid-gray/10 border border-mid-gray/20 text-sm resize-none"
          rows={3}
          placeholder={t("settings.localLlm.test.input")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          className="self-start px-3 py-1.5 rounded-md text-sm bg-logo-primary text-white disabled:opacity-50"
          onClick={handleTest}
          disabled={loading || !input.trim()}
        >
          {loading
            ? t("settings.localLlm.test.running")
            : t("settings.localLlm.test.run")}
        </button>
        {result && (
          <div className="p-2 rounded-md bg-mid-gray/10 text-sm whitespace-pre-wrap">
            <span className="text-xs text-mid-gray">
              {t("settings.localLlm.test.result")}:
            </span>
            <p className="mt-1">{result}</p>
          </div>
        )}
      </div>
    </SettingsGroup>
  );
};
