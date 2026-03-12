use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;
use log::{debug, info};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::{get_settings, write_settings, LlmModelInfo, ModelUnloadTimeout};

/// Recommended models available for download
const RECOMMENDED_MODELS: &[RecommendedModel] = &[
    RecommendedModel {
        id: "qwen3.5-0.8b",
        name: "Qwen3.5 0.8B",
        filename: "qwen3.5-0.8b-q4_k_m.gguf",
        url: "https://huggingface.co/Qwen/Qwen3.5-0.8B-GGUF/resolve/main/qwen3.5-0.8b-q4_k_m.gguf",
        size_mb: 500,
    },
    RecommendedModel {
        id: "qwen3.5-2b",
        name: "Qwen3.5 2B",
        filename: "qwen3.5-2b-q4_k_m.gguf",
        url: "https://huggingface.co/Qwen/Qwen3.5-2B-GGUF/resolve/main/qwen3.5-2b-q4_k_m.gguf",
        size_mb: 1500,
    },
];

struct RecommendedModel {
    id: &'static str,
    name: &'static str,
    filename: &'static str,
    url: &'static str,
    size_mb: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct LlmDownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

struct LoadedModel {
    backend: LlamaBackend,
    model: LlamaModel,
}

pub struct LlmManager {
    app_handle: AppHandle,
    loaded: Arc<Mutex<Option<LoadedModel>>>,
    model_path: Arc<Mutex<Option<PathBuf>>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    _watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
}

impl Clone for LlmManager {
    fn clone(&self) -> Self {
        Self {
            app_handle: self.app_handle.clone(),
            loaded: self.loaded.clone(),
            model_path: self.model_path.clone(),
            last_activity: self.last_activity.clone(),
            shutdown_signal: self.shutdown_signal.clone(),
            _watcher_handle: self._watcher_handle.clone(),
        }
    }
}

impl LlmManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let manager = Self {
            app_handle: app_handle.clone(),
            loaded: Arc::new(Mutex::new(None)),
            model_path: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(now_ms())),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            _watcher_handle: Arc::new(Mutex::new(None)),
        };

        // Start idle watcher thread
        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                while !shutdown_signal.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_secs(10));

                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    let settings = get_settings(&app_handle_cloned);
                    let timeout_seconds = settings.local_llm_unload_timeout.to_seconds();

                    if let Some(limit_seconds) = timeout_seconds {
                        if settings.local_llm_unload_timeout == ModelUnloadTimeout::Immediately {
                            continue;
                        }

                        let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                        let now = now_ms();

                        if now.saturating_sub(last) > limit_seconds * 1000 {
                            if manager_cloned.is_loaded() {
                                debug!("Unloading local LLM model due to inactivity");
                                manager_cloned.unload_model();
                                let _ =
                                    app_handle_cloned.emit("local-llm-model-unloaded", ());
                            }
                        }
                    }
                }
                debug!("LLM idle watcher thread shutting down");
            });
            *manager._watcher_handle.lock().unwrap() = Some(handle);
        }

        Ok(manager)
    }

    /// Get the models directory path
    fn models_dir(&self) -> Result<PathBuf, String> {
        let app_data = self
            .app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        let dir = app_data.join("models").join("llm");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create LLM models dir: {}", e))?;
        Ok(dir)
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded.lock().unwrap().is_some()
    }

    pub fn load_model(&self, model_path: &Path, gpu_layers: u32) -> Result<(), String> {
        info!(
            "Loading LLM model from {:?} with {} GPU layers",
            model_path, gpu_layers
        );

        if !model_path.exists() {
            return Err(format!("Model file not found: {:?}", model_path));
        }

        let backend =
            LlamaBackend::init().map_err(|e| format!("Failed to init llama backend: {}", e))?;

        let model_params = LlamaModelParams::default().with_n_gpu_layers(gpu_layers);

        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| format!("Failed to load model: {}", e))?;

        let mut loaded_guard = self.loaded.lock().unwrap();
        *loaded_guard = Some(LoadedModel { backend, model });
        drop(loaded_guard);

        let mut path_guard = self.model_path.lock().unwrap();
        *path_guard = Some(model_path.to_path_buf());

        self.update_activity();

        info!("LLM model loaded successfully");
        Ok(())
    }

    pub fn unload_model(&self) {
        let mut loaded_guard = self.loaded.lock().unwrap();
        if loaded_guard.is_some() {
            *loaded_guard = None;
            info!("LLM model unloaded");
        }
        let mut path_guard = self.model_path.lock().unwrap();
        *path_guard = None;
    }

    /// Generate text from a prompt using the loaded model.
    pub fn generate(&self, prompt: &str, max_tokens: u32) -> Result<String, String> {
        let mut loaded_guard = self.loaded.lock().unwrap();
        let loaded = loaded_guard
            .as_mut()
            .ok_or("No model loaded")?;

        let result = run_inference(&loaded.backend, &loaded.model, prompt, max_tokens);
        drop(loaded_guard);

        self.update_activity();
        result
    }

    fn update_activity(&self) {
        self.last_activity.store(now_ms(), Ordering::Relaxed);
    }

    /// List all available models (recommended + custom imported)
    pub fn list_models(&self) -> Result<Vec<LlmModelInfo>, String> {
        let models_dir = self.models_dir()?;
        let mut models = Vec::new();

        for rec in RECOMMENDED_MODELS {
            let path = models_dir.join(rec.filename);
            models.push(LlmModelInfo {
                id: rec.id.to_string(),
                name: rec.name.to_string(),
                filename: rec.filename.to_string(),
                size_mb: rec.size_mb,
                is_downloaded: path.exists(),
                is_downloading: false,
                is_custom: false,
            });
        }

        // Scan for custom GGUF files
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext == "gguf" {
                        let filename = path.file_name().unwrap().to_string_lossy().to_string();
                        if RECOMMENDED_MODELS.iter().any(|r| r.filename == filename) {
                            continue;
                        }
                        let size = std::fs::metadata(&path)
                            .map(|m| m.len() / (1024 * 1024))
                            .unwrap_or(0);
                        let name = filename.trim_end_matches(".gguf").to_string();
                        models.push(LlmModelInfo {
                            id: format!("custom_{}", name),
                            name,
                            filename,
                            size_mb: size,
                            is_downloaded: true,
                            is_downloading: false,
                            is_custom: true,
                        });
                    }
                }
            }
        }

        Ok(models)
    }

    /// Download a recommended model by ID
    pub async fn download_model(&self, model_id: &str) -> Result<PathBuf, String> {
        let rec = RECOMMENDED_MODELS
            .iter()
            .find(|r| r.id == model_id)
            .ok_or_else(|| format!("Unknown model: {}", model_id))?;

        let models_dir = self.models_dir()?;
        let target_path = models_dir.join(rec.filename);

        if target_path.exists() {
            return Ok(target_path);
        }

        info!("Downloading LLM model {} from {}", rec.name, rec.url);

        let client = reqwest::Client::new();
        let response = client
            .get(rec.url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        let partial_path = target_path.with_extension("gguf.part");
        let mut file = tokio::fs::File::create(&partial_path)
            .await
            .map_err(|e| format!("Failed to create file: {}", e))?;

        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Write error: {}", e))?;

            downloaded += chunk.len() as u64;
            let percentage = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };

            let _ = self
                .app_handle
                .emit(
                    "local-llm-download-progress",
                    LlmDownloadProgress {
                        model_id: model_id.to_string(),
                        downloaded,
                        total: total_size,
                        percentage,
                    },
                );
        }

        file.flush()
            .await
            .map_err(|e| format!("Flush error: {}", e))?;
        drop(file);

        tokio::fs::rename(&partial_path, &target_path)
            .await
            .map_err(|e| format!("Rename error: {}", e))?;

        let _ = self
            .app_handle
            .emit("local-llm-download-completed", model_id.to_string());

        info!("LLM model {} downloaded successfully", rec.name);
        Ok(target_path)
    }

    /// Delete a downloaded model
    pub fn delete_model(&self, model_id: &str) -> Result<(), String> {
        let models_dir = self.models_dir()?;

        if let Some(rec) = RECOMMENDED_MODELS.iter().find(|r| r.id == model_id) {
            let path = models_dir.join(rec.filename);
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))?;
            }
            return Ok(());
        }

        if let Some(filename) = model_id.strip_prefix("custom_") {
            let path = models_dir.join(format!("{}.gguf", filename));
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))?;
            }
        }

        Ok(())
    }

    /// Import a custom GGUF model file
    pub fn import_model(&self, source_path: &Path) -> Result<LlmModelInfo, String> {
        if !source_path.exists() {
            return Err("File not found".to_string());
        }

        let filename = source_path
            .file_name()
            .ok_or("Invalid file path")?
            .to_string_lossy()
            .to_string();

        if !filename.ends_with(".gguf") {
            return Err("File must be a .gguf file".to_string());
        }

        let models_dir = self.models_dir()?;
        let target = models_dir.join(&filename);

        std::fs::copy(source_path, &target).map_err(|e| format!("Failed to copy model: {}", e))?;

        let size = std::fs::metadata(&target)
            .map(|m| m.len() / (1024 * 1024))
            .unwrap_or(0);
        let name = filename.trim_end_matches(".gguf").to_string();

        Ok(LlmModelInfo {
            id: format!("custom_{}", name),
            name,
            filename,
            size_mb: size,
            is_downloaded: true,
            is_downloading: false,
            is_custom: true,
        })
    }

    /// Get the path of a model by its ID
    pub fn get_model_path(&self, model_id: &str) -> Result<PathBuf, String> {
        let models_dir = self.models_dir()?;

        if let Some(rec) = RECOMMENDED_MODELS.iter().find(|r| r.id == model_id) {
            let path = models_dir.join(rec.filename);
            if path.exists() {
                return Ok(path);
            }
            return Err(format!("Model {} not downloaded", rec.name));
        }

        if let Some(filename) = model_id.strip_prefix("custom_") {
            let path = models_dir.join(format!("{}.gguf", filename));
            if path.exists() {
                return Ok(path);
            }
        }

        Err(format!("Model not found: {}", model_id))
    }

    /// Ensure model is loaded (lazy loading), then generate.
    pub fn ensure_loaded_and_generate(
        &self,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, String> {
        let settings = get_settings(&self.app_handle);

        if !self.is_loaded() {
            let model_id = settings
                .local_llm_model_id
                .as_ref()
                .ok_or("No local LLM model selected")?;

            let model_path = self.get_model_path(model_id)?;
            if !model_path.exists() {
                let mut s = get_settings(&self.app_handle);
                s.local_llm_model_id = None;
                write_settings(&self.app_handle, s);
                let _ = self
                    .app_handle
                    .emit("local-llm-model-missing", model_id.clone());
                return Err(format!(
                    "Model file missing: {:?}. Selection cleared.",
                    model_path
                ));
            }
            self.load_model(&model_path, settings.local_llm_gpu_layers)?;
        }

        let result = self.generate(prompt, max_tokens);

        if settings.local_llm_unload_timeout == ModelUnloadTimeout::Immediately {
            self.unload_model();
        }

        result
    }
}

impl Drop for LlmManager {
    fn drop(&mut self) {
        self.shutdown_signal.store(true, Ordering::Relaxed);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn run_inference(
    backend: &LlamaBackend,
    model: &LlamaModel,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(std::num::NonZeroU32::new(2048));

    let mut ctx = model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("Failed to create context: {}", e))?;

    let tokens = model
        .str_to_token(prompt, AddBos::Always)
        .map_err(|e| format!("Failed to tokenize: {}", e))?;

    let mut batch = LlamaBatch::new(2048, 1);

    for (i, token) in tokens.iter().enumerate() {
        let is_last = i == tokens.len() - 1;
        batch
            .add(*token, i as i32, &[0], is_last)
            .map_err(|e| format!("Failed to add token to batch: {}", e))?;
    }

    ctx.decode(&mut batch)
        .map_err(|e| format!("Failed to decode: {}", e))?;

    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::temp(0.1),
        LlamaSampler::greedy(),
    ]);

    let mut output_tokens = Vec::new();
    let mut n_cur = tokens.len() as i32;

    for _ in 0..max_tokens {
        let new_token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(new_token);

        if model.is_eog_token(new_token) {
            break;
        }

        output_tokens.push(new_token);

        batch.clear();
        batch
            .add(new_token, n_cur, &[0], true)
            .map_err(|e| format!("Failed to add token: {}", e))?;
        n_cur += 1;

        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode: {}", e))?;
    }

    let output: String = output_tokens
        .iter()
        .map(|t| model.token_to_str(*t, Special::Tokenize))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to detokenize: {}", e))?
        .join("");

    Ok(output.trim().to_string())
}
