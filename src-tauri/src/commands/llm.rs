use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::managers::llm::LlmManager;
use crate::settings::{get_settings, LlmModelInfo};

#[tauri::command]
#[specta::specta]
pub async fn list_local_llm_models(
    llm_manager: State<'_, Arc<LlmManager>>,
) -> Result<Vec<LlmModelInfo>, String> {
    llm_manager.list_models()
}

#[tauri::command]
#[specta::specta]
pub async fn download_local_llm_model(
    model_id: String,
    llm_manager: State<'_, Arc<LlmManager>>,
) -> Result<(), String> {
    llm_manager.download_model(&model_id).await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_local_llm_model(
    model_id: String,
    llm_manager: State<'_, Arc<LlmManager>>,
) -> Result<(), String> {
    llm_manager.delete_model(&model_id)
}

#[tauri::command]
#[specta::specta]
pub async fn import_local_llm_model(
    path: String,
    llm_manager: State<'_, Arc<LlmManager>>,
) -> Result<LlmModelInfo, String> {
    llm_manager.import_model(std::path::Path::new(&path))
}

#[tauri::command]
#[specta::specta]
pub async fn test_local_llm(
    text: String,
    app: AppHandle,
    llm_manager: State<'_, Arc<LlmManager>>,
) -> Result<String, String> {
    let settings = get_settings(&app);

    let prompt_template = settings
        .local_llm_selected_prompt_id
        .as_ref()
        .and_then(|id| settings.local_llm_prompts.iter().find(|p| &p.id == id))
        .map(|p| p.prompt.clone())
        .ok_or("No prompt selected")?;

    let prompt = prompt_template.replace("${output}", &text);

    match settings.local_llm_mode {
        crate::settings::LocalLlmMode::Embedded => {
            llm_manager.ensure_loaded_and_generate(&prompt, 2048)
        }
        crate::settings::LocalLlmMode::External => {
            let provider = crate::settings::PostProcessProvider {
                id: "local_llm_external".to_string(),
                label: "Local LLM".to_string(),
                base_url: settings.local_llm_external_url.clone(),
                allow_base_url_edit: false,
                models_endpoint: Some("/models".to_string()),
                supports_structured_output: false,
            };
            let api_key = settings
                .local_llm_external_api_key
                .clone()
                .unwrap_or_default();
            let model = settings
                .local_llm_external_model
                .as_ref()
                .ok_or("No external model selected")?;

            crate::llm_client::send_chat_completion(&provider, api_key, model, prompt)
                .await
                .map(|opt| opt.unwrap_or_default())
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_local_llm_external_models(app: AppHandle) -> Result<Vec<String>, String> {
    let settings = get_settings(&app);
    let provider = crate::settings::PostProcessProvider {
        id: "local_llm_external".to_string(),
        label: "Local LLM".to_string(),
        base_url: settings.local_llm_external_url.clone(),
        allow_base_url_edit: false,
        models_endpoint: Some("/models".to_string()),
        supports_structured_output: false,
    };
    let api_key = settings
        .local_llm_external_api_key
        .clone()
        .unwrap_or_default();
    crate::llm_client::fetch_models(&provider, api_key).await
}
