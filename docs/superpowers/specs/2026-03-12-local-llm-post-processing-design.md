# Local LLM Post-Processing Design

## Overview

Add local AI text post-processing to Handy, allowing automatic cleanup of speech-to-text output (removing word duplicates, hesitations, fixing punctuation) using a locally-running LLM. Supports both an embedded llama.cpp engine (via `llama-cpp-2` Rust bindings) and connection to an external OpenAI-compatible server.

## Requirements

- Integrate llama.cpp natively via `llama-cpp-2` crate (no sidecar process)
- Support two modes: embedded (bundled engine) and external server
- Recommended models: Qwen3.5-0.8B (~500 Mo) and Qwen3.5-2B (~1.5 Go)
- Must support French and English natively
- Users can download recommended models, import custom GGUF files, or connect to an external server
- Editable prompts with a sensible default for transcript cleanup
- New dedicated "IA locale" tab in the settings sidebar
- Automatic cleanup on every transcription when enabled (no special hotkey needed)
- Cloud post-processing remains available as an additional step via its existing hotkey

## Architecture

### 1. LlmManager (`src-tauri/src/managers/llm.rs`)

New manager following the existing pattern (AudioManager, TranscriptionManager).

**Responsibilities:**
- Load/unload GGUF models in memory via `llama-cpp-2`
- Run inference (prompt -> cleaned text)
- Manage model lifecycle (lazy loading on first use, unload after configurable timeout)
- Download recommended models with progress events
- List locally available models (downloaded + imported)
- Import custom GGUF files

**API:**
```rust
pub struct LlmManager {
    app_handle: AppHandle,
    model: Arc<Mutex<Option<LlamaModel>>>,
    ctx: Arc<Mutex<Option<LlamaContext>>>,
    model_path: Arc<Mutex<Option<PathBuf>>>,
    last_used: Arc<Mutex<Instant>>,
}

impl LlmManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self>;
    pub fn load_model(&self, model_path: &Path, gpu_layers: u32) -> Result<()>;
    pub fn unload_model(&self);
    /// Uses take-and-replace pattern on the context mutex (same as TranscriptionManager)
    /// to avoid blocking the idle watcher during inference.
    pub fn generate(&self, prompt: &str, max_tokens: u32) -> Result<String>;
    pub fn is_loaded(&self) -> bool;
    /// Progress reported via Tauri events (local_llm_download_progress, etc.)
    pub async fn download_model(&self, model_id: &str) -> Result<PathBuf>;
    pub fn list_local_models(&self) -> Vec<LlmModelInfo>;
    /// Copies GGUF file to app data dir. Model name derived from filename as fallback.
    pub fn import_model(&self, gguf_path: &Path) -> Result<LlmModelInfo>;
}
```

**Thread safety note:** The `generate()` method takes the `LlamaContext` out of the `Option` (via `.take()`) before dropping the mutex guard, then replaces it after inference completes. This is the same pattern used by `TranscriptionManager::transcribe()` to prevent deadlocks with the idle watcher thread.

**Model storage:** `{app_data}/models/llm/`

**Idle watcher:** Background thread (same pattern as TranscriptionManager) that unloads the model after the configured timeout.

### 2. Settings

**New enum:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum LocalLlmMode {
    Embedded,
    External,
}
```

**New fields in `AppSettings` (`settings.rs`):**

All new fields use `#[serde(default)]` or `#[serde(default = "...")]` for backward compatibility with existing stored settings. An `ensure_local_llm_defaults()` migration function (same pattern as `ensure_post_process_defaults()`) initializes default values on first load.

```rust
// Local LLM - general
pub local_llm_enabled: bool,
pub local_llm_mode: LocalLlmMode,  // Embedded | External

// Embedded mode
pub local_llm_model_id: Option<String>,
pub local_llm_gpu_layers: u32,
pub local_llm_unload_timeout: UnloadTimeout,  // reuses existing enum

// External mode
pub local_llm_external_url: String,
pub local_llm_external_model: Option<String>,
pub local_llm_external_api_key: Option<String>,

// Prompts
pub local_llm_prompts: Vec<LlmPrompt>,
pub local_llm_selected_prompt_id: Option<String>,
```

**Default prompt (English — source language, French version available as i18n preset):**
```
Clean up this voice transcription: remove repetitions,
hesitations and duplicate words. Fix punctuation.
Do not change the meaning. Return only the corrected text.

Transcription: ${output}
```

**New Tauri commands:**

Settings toggle commands (in `shortcut/mod.rs`, following `change_*_setting` pattern):
- `change_local_llm_enabled`
- `change_local_llm_mode`
- `change_local_llm_model`
- `change_local_llm_gpu_layers`
- `change_local_llm_unload_timeout`
- `change_local_llm_external_url`
- `change_local_llm_external_api_key`
- `change_local_llm_external_model`

Model & inference commands (in new `commands/llm.rs` module):
- `download_local_llm_model` (with progress events)
- `delete_local_llm_model`
- `import_local_llm_model`
- `list_local_llm_models`
- `fetch_local_llm_external_models`
- `test_local_llm` (for the test section in settings)

Prompt commands (in `commands/llm.rs`):
- `add_local_llm_prompt`
- `update_local_llm_prompt`
- `delete_local_llm_prompt`
- `set_local_llm_selected_prompt`

All commands registered in `collect_commands!` macro in `lib.rs`.

### 3. Transcription Pipeline Integration

**Modified flow in `actions.rs`:**

```
Audio -> VAD -> Whisper/Parakeet -> Raw text
                                      |
                              local_llm_enabled?
                              /                \
                            yes                no
                             |                  |
                     LlmManager::generate()  Raw text
                             |
                        Cleaned text
                             |
                     post_process_enabled?
                     /                    \
                   yes                    no
                    |                      |
             Cloud post-process      Paste/output
                    |
              Paste/output
```

**Key behaviors:**
- Local cleanup runs automatically on every transcription when enabled
- Cloud post-processing remains available via the dedicated hotkey (can stack on top of local cleanup)
- Embedded mode: model loaded lazily on first transcription, unloaded after timeout
- External mode: graceful fallback to raw text if server is unreachable, with error notification
- Overlay shows "Cleaning..." indicator during local processing

**Events:**
- `local_llm_processing_started`
- `local_llm_processing_completed`
- `local_llm_processing_failed`

### 4. UI — New "IA locale" Tab

**Activation:** Toggle in Advanced Settings > Experimental (same pattern as Post-Processing). When enabled, a new "IA locale" entry appears in the sidebar with a `Brain` icon (Lucide).

**Tab structure — 3 sections:**

#### 4.1 Mode & Model
- **Switch:** Embedded / External server
- **If embedded:**
  - List of recommended models (Qwen3.5-0.8B, Qwen3.5-2B) with download button, size, status
  - "Import a GGUF model" button (file picker)
  - Active model selector (among downloaded/imported)
  - GPU layers slider (0 = CPU only)
  - Unload timeout selector (reuses same options as transcription)
- **If external:**
  - Server URL field (default: `http://localhost:8080/v1`)
  - API key field (optional, password input)
  - Model selector with refresh button (fetches from server)

#### 4.2 Prompt
- Dropdown to select existing prompt or create new
- "Prompt name" text field
- Instruction textarea (with note that `${output}` is replaced by the transcription)
- Save / Delete buttons

#### 4.3 Test
- Text field to paste a raw transcription
- "Test" button that sends to the local LLM and displays the result below
- Allows verifying model + prompt without recording

### 5. Recommended Models

| Model | GGUF Size (Q4_K_M) | Estimated RAM | Use Case |
|-------|-------------------|---------------|----------|
| Qwen3.5-0.8B | ~500 MB | ~1 GB | Edge devices, fast cleanup |
| Qwen3.5-2B | ~1.5 GB | ~2.5 GB | Better quality, reformulation |

**Source:** Hugging Face (quantified GGUF files, Q4_K_M quantization).

**Download system:** Reuses the same pattern as the existing ModelManager:
- HTTP download with progress events
- `download_progress`, `download_completed`, `download_failed` events
- Resume interrupted downloads (range requests)
- SHA256 verification after download

**Custom model import:**
- File picker filtered to `.gguf`
- File copied to `{app_data}/models/llm/`
- Metadata extracted from GGUF header (name, size, parameters)

**Language support:** Both Qwen3.5 models natively support French and English (+ 20 other languages).

### 6. i18n

New translation keys in `en/translation.json` and `fr/translation.json`:

**Sidebar:** `sidebar.localLlm`

**Advanced Settings:** `settings.advanced.experimental.localLlm`

**Local LLM tab:**
- `settings.localLlm.title`
- `settings.localLlm.mode.label`, `.embedded`, `.external`
- `settings.localLlm.model.*` (selector, download, import labels)
- `settings.localLlm.gpu.*` (GPU layers labels)
- `settings.localLlm.external.*` (URL, API key, model labels)
- `settings.localLlm.prompt.*` (prompt management labels)
- `settings.localLlm.test.*` (test area labels)

**Overlay:** `overlay.cleaning`

**Notifications:**
- `notifications.localLlm.loadFailed`
- `notifications.localLlm.serverUnavailable`

Translations provided for en/fr. Other languages (es, vi, etc.) receive the English version as placeholder.

### 7. Dependencies

**New Rust crate:**
- `llama-cpp-2` — Rust bindings for llama.cpp

**Feature flags for acceleration:**
- `cuda` — NVIDIA GPU support
- `metal` — macOS GPU support
- `vulkan` — Cross-platform GPU support

These should match the platform build targets already used for the transcription models.

### 8. Error Handling

- **Model load failure:** Notification to user, feature disabled until resolved
- **Inference failure:** Fallback to raw transcription text, error notification
- **External server unreachable:** Fallback to raw text, notification
- **Download failure:** Retry option in UI, partial download preserved for resume
- **Out of memory:** Catch allocation failures, suggest smaller model or fewer GPU layers
- **Model file missing on load:** Validate file exists before loading; if previously-selected model was deleted, show notification and clear selection

### 9. Build Integration

**Coordinating with existing native dependencies:**

The app already bundles `transcribe-rs` which uses ONNX Runtime for transcription models. Adding `llama-cpp-2` introduces a second native C/C++ dependency. To manage this:

- `llama-cpp-2` is added behind a Cargo feature flag `local-llm` (enabled by default) so it can be disabled for lightweight/CI builds
- GPU acceleration feature flags (`cuda`, `metal`, `vulkan`) are coordinated with existing build targets to avoid duplicate linking
- CI build matrix updated to handle the additional compile time
- Binary size increase: ~5-10 MB for the llama.cpp static library

### 10. External Mode Details

External mode reuses the existing `llm_client.rs` (`send_chat_completion()`) for HTTP calls to OpenAI-compatible servers (llama.cpp server, Ollama, LM Studio, etc.). No new HTTP logic needed — only the settings (URL, API key, model) are specific to local LLM configuration.

### 11. History Integration

The history system saves transcription results at three levels:
- `raw_text`: Original STT output (always saved)
- `cleaned_text`: Local LLM cleaned output (saved when local LLM is enabled, otherwise equals raw_text)
- `post_processed_text`: Cloud post-processed output (saved when cloud post-processing is used, otherwise equals cleaned_text)

This requires adding a `cleaned_text` field to the history entry struct.
