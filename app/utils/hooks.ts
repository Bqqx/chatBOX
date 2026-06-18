import { useCallback, useMemo, useState } from "react";
import { getClientApi } from "../client/api";
import { ServiceProvider } from "../constant";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    return collectModelsWithDefaultModel(
      configStore.models,
      accessStore.customModels,
      accessStore.defaultModel,
    );
  }, [accessStore.customModels, accessStore.defaultModel, configStore.models]);

  return models;
}

export async function refreshProviderModels(providerName?: ServiceProvider) {
  if (!providerName) return [];

  const api = getClientApi(providerName);
  const models = await api.llm.models();

  if (models.length > 0) {
    useAppConfig.getState().mergeModels(models);
  }

  return models;
}

export function useRefreshProviderModels(providerName?: ServiceProvider) {
  const accessStore = useAccessStore();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!providerName || loading) return undefined;

    setLoading(true);
    try {
      return await refreshProviderModels(providerName);
    } catch (error) {
      console.warn("[Models] failed to refresh provider models", error);
      return [];
    } finally {
      setLoading(false);
    }
  }, [
    accessStore.ai302ApiKey,
    accessStore.ai302Url,
    accessStore.alibabaApiKey,
    accessStore.alibabaUrl,
    accessStore.anthropicApiKey,
    accessStore.anthropicUrl,
    accessStore.azureApiKey,
    accessStore.azureUrl,
    accessStore.baiduApiKey,
    accessStore.baiduUrl,
    accessStore.bytedanceApiKey,
    accessStore.bytedanceUrl,
    accessStore.chatglmApiKey,
    accessStore.chatglmUrl,
    accessStore.customApiKey,
    accessStore.customUrl,
    accessStore.deepseekApiKey,
    accessStore.deepseekUrl,
    accessStore.googleApiKey,
    accessStore.googleUrl,
    accessStore.iflytekApiKey,
    accessStore.iflytekUrl,
    accessStore.moonshotApiKey,
    accessStore.moonshotUrl,
    accessStore.openaiApiKey,
    accessStore.openaiUrl,
    accessStore.provider,
    accessStore.siliconflowApiKey,
    accessStore.siliconflowUrl,
    accessStore.tencentSecretId,
    accessStore.tencentSecretKey,
    accessStore.tencentUrl,
    accessStore.xaiApiKey,
    accessStore.xaiUrl,
    loading,
    providerName,
  ]);

  return { loading, refresh };
}
