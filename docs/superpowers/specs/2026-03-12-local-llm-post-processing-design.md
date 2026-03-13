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
    model: Arc<Mutex<Option<LlamaModel>>>,
    ctx: Arc<Mutex<Option<LlamaContext>>>,
    model_path: Arc<Mutex<Option<PathBuf>>>,
    last_used: Arc<Mutex<Instant>>,
}

impl LlmManager {
    pub fn new() -> Self;
    pub fn load_model(&self, model_path: &Path, gpu_layers: u32) -> Result<()>;
    pub fn unload_model(&self);
    pub fn generate(&self, prompt: &str, max_tokens: u32) -> Result<String>;
    pub fn is_loaded(&self) -> bool;
    pub async fn download_model(&self, model_id: &str, on_progress: F) -> Result<PathBuf>;
    pub fn list_local_models(&self) -> Vec<LlmModelInfo>;
    pub fn import_model(&self, gguf_path: &Path) -> Result<LlmModelInfo>;
}
```

**Model storage:** `{app_data}/models/llm/`

**Idle watcher:** Background thread (same pattern as TranscriptionManager) that unloads the model after the configured timeout.

### 2. Settings

**New fields in `AppSettings` (`settings.rs`):**

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

**Default prompt:**
```
Nettoie cette transcription vocale : supprime les répétitions,
hésitations et mots en double. Corrige la ponctuation.
Ne modifie pas le sens. Retourne uniquement le texte corrigé.

Transcription : ${output}
```

**New Tauri commands:**
- `change_local_llm_enabled`
- `change_local_llm_mode`
- `change_local_llm_model`
- `change_local_llm_gpu_layers`
- `change_local_llm_external_url`
- `change_local_llm_external_api_key`
- `change_local_llm_external_model`
- `download_local_llm_model` (with progress events)
- `delete_local_llm_model`
- `import_local_llm_model`
- `list_local_llm_models`
- `fetch_local_llm_external_models`
- `add_local_llm_prompt`
- `update_local_llm_prompt`
- `delete_local_llm_prompt`
- `set_local_llm_selected_prompt`
- `test_local_llm` (for the test section in settings)

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
