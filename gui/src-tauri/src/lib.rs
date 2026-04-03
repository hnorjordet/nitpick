use std::process::Command;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{Manager, menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, CheckMenuItemBuilder, PredefinedMenuItem}, Listener};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
struct Metadata {
    match_percent: Option<String>,
    match_quality: Option<String>,
    translate: Option<String>,
    approved: Option<String>,
    modified_date: Option<String>,
    modified_by: Option<String>,
    state: Option<String>,
    locked: Option<String>,
    created_date: Option<String>,
    created_by: Option<String>,
    origin: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TmsMetadata {
    tms_type: Option<String>,
    lingotek_url: Option<String>,
    phrase_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TransUnit {
    id: String,
    segment_number: Option<i32>,
    source: String,
    target: String,
    metadata: Option<Metadata>,
    icu_errors: Option<Vec<String>>,
    tms_metadata: Option<TmsMetadata>,
}

#[derive(Debug, Serialize, Deserialize)]
struct XliffData {
    trans_units: Vec<TransUnit>,
    stats: Stats,
}

#[derive(Debug, Serialize, Deserialize)]
struct Stats {
    total_units: i32,
    translated: i32,
    untranslated: i32,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_user_guide_content(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Determine path based on environment
    let guide_path = if cfg!(dev) {
        // Development mode: use relative path from gui directory
        "../../USER_GUIDE.html".to_string()
    } else {
        // Production mode: use bundled resource
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        resource_dir.join("_up_/_up_/USER_GUIDE.html").to_string_lossy().to_string()
    };

    // Check if file exists
    let path = std::path::Path::new(&guide_path);
    if !path.exists() {
        return Err(format!("User guide not found at: {}", guide_path));
    }

    // Read and return the HTML content
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read user guide: {}", e))
}

#[tauri::command]
fn get_changelog_content(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Determine path based on environment
    let changelog_path = if cfg!(dev) {
        // Development mode: use relative path from gui directory
        "../../CHANGELOG.md".to_string()
    } else {
        // Production mode: use bundled resource
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        resource_dir.join("_up_/_up_/CHANGELOG.md").to_string_lossy().to_string()
    };

    // Check if file exists
    let path = std::path::Path::new(&changelog_path);
    if !path.exists() {
        return Err(format!("Changelog not found at: {}", changelog_path));
    }

    // Read the Markdown content
    let markdown = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read changelog: {}", e))?;

    // Convert Markdown to HTML using a simple approach
    // For now, just wrap in pre tags to preserve formatting
    let html = format!(
        r#"<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 900px;">
        <pre style="white-space: pre-wrap; word-wrap: break-word; font-family: inherit; background: none; padding: 0; color: #1c1c1e;">{}</pre>
        </div>"#,
        markdown
    );

    Ok(html)
}

#[tauri::command]
fn open_xliff(file_path: String, target_lang: Option<String>, app_handle: tauri::AppHandle) -> Result<XliffData, String> {
    // Determine CLI executable path based on environment
    let cli_path = if cfg!(dev) {
        // Development mode: use Python script directly
        let project_root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../");
        let python = format!("{}venv/bin/python3", project_root);
        let script = format!("{}src/cli.py", project_root);

        // Call Python CLI to parse XLIFF/TMX file
        let mut cmd = Command::new(&python);
        cmd.arg(&script).arg("stats").arg(&file_path).arg("--json");
        if let Some(ref lang) = target_lang {
            cmd.arg("--target-lang").arg(lang);
        }
        let output = cmd.output()
            .map_err(|e| format!("Failed to execute Python: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Python error: {}", stderr));
        }

        // Parse JSON output from Python
        let json_str = String::from_utf8_lossy(&output.stdout);
        let data: XliffData = serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse JSON: {} (output: {})", e, json_str))?;

        return Ok(data);
    } else {
        // Production mode: use bundled executable
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        resource_dir.join("bin/xliff_cli").to_string_lossy().to_string()
    };

    // Call CLI executable to parse XLIFF/TMX file
    let mut cmd = Command::new(&cli_path);
    cmd.arg("stats").arg(&file_path).arg("--json");
    if let Some(ref lang) = target_lang {
        cmd.arg("--target-lang").arg(lang);
    }
    let output = cmd.output()
        .map_err(|e| format!("Failed to execute CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", stderr));
    }

    // Parse JSON output from Python
    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: XliffData = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON: {} (output: {})", e, json_str))?;

    Ok(data)
}

#[derive(Debug, Serialize, Deserialize)]
struct TmxLanguages {
    srclang: String,
    languages: Vec<String>,
}

#[tauri::command]
fn get_tmx_languages(file_path: String, app_handle: tauri::AppHandle) -> Result<TmxLanguages, String> {
    let output = if cfg!(dev) {
        let project_root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../");
        let python = format!("{}venv/bin/python3", project_root);
        let script = format!("{}src/cli.py", project_root);
        Command::new(&python)
            .arg(&script)
            .arg("tmx-languages")
            .arg(&file_path)
            .output()
            .map_err(|e| format!("Failed to execute Python: {}", e))?
    } else {
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        let cli_path = resource_dir.join("bin/xliff_cli").to_string_lossy().to_string();
        Command::new(&cli_path)
            .arg("tmx-languages")
            .arg(&file_path)
            .output()
            .map_err(|e| format!("Failed to execute CLI: {}", e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", stderr));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: TmxLanguages = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON: {} (output: {})", e, json_str))?;

    Ok(data)
}

#[derive(Debug, Serialize, Deserialize)]
struct EditedUnit {
    id: String,
    target: String,
}

#[tauri::command]
fn save_xliff(file_path: String, edited_units: Vec<EditedUnit>, target_lang: Option<String>, app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::fs;

    // Create temporary JSON file with edits
    let temp_json = format!("/tmp/xliff_edits_{}.json", std::process::id());
    let json_data = serde_json::to_string(&edited_units)
        .map_err(|e| format!("Failed to serialize edits: {}", e))?;

    fs::write(&temp_json, json_data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Determine CLI executable path based on environment
    let output = if cfg!(dev) {
        // Development mode: use Python script directly
        let project_root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../");
        let python = format!("{}venv/bin/python3", project_root);
        let script = format!("{}src/cli.py", project_root);

        let mut cmd = Command::new(&python);
        cmd.arg(&script).arg("apply-edits").arg(&file_path).arg(&temp_json);
        if let Some(ref lang) = target_lang {
            cmd.arg("--target-lang").arg(lang);
        }
        cmd.output()
            .map_err(|e| format!("Failed to execute Python: {}", e))?
    } else {
        // Production mode: use bundled executable
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        let cli_path = resource_dir.join("bin/xliff_cli").to_string_lossy().to_string();

        let mut cmd = Command::new(&cli_path);
        cmd.arg("apply-edits").arg(&file_path).arg(&temp_json);
        if let Some(ref lang) = target_lang {
            cmd.arg("--target-lang").arg(lang);
        }
        cmd.output()
            .map_err(|e| format!("Failed to execute CLI: {}", e))?
    };

    // Clean up temp file
    let _ = fs::remove_file(&temp_json);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", stderr));
    }

    Ok("File saved successfully".to_string())
}

// Regex Library structures
#[derive(Debug, Serialize, Deserialize, Clone)]
struct RegexEntry {
    id: String,
    name: String,
    description: String,
    pattern: String,
    replace: String,
    category: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegexCategory {
    name: String,
    entries: Vec<RegexEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegexLibrary {
    categories: Vec<RegexCategory>,
}

fn get_library_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "Failed to get home directory".to_string())?;
    let lib_dir = PathBuf::from(home).join(".xliff-regex-tool");

    // Create directory if it doesn't exist
    if !lib_dir.exists() {
        fs::create_dir_all(&lib_dir)
            .map_err(|e| format!("Failed to create library directory: {}", e))?;
    }

    Ok(lib_dir.join("library.xml"))
}

#[tauri::command]
fn load_regex_library() -> Result<RegexLibrary, String> {
    let lib_path = get_library_path()?;

    // If file doesn't exist, return default library with standard categories
    if !lib_path.exists() {
        return Ok(RegexLibrary {
            categories: vec![
                RegexCategory {
                    name: "Tegnsetting".to_string(),
                    entries: vec![],
                },
                RegexCategory {
                    name: "Harde mellomrom".to_string(),
                    entries: vec![],
                },
                RegexCategory {
                    name: "Tall/tallformatering".to_string(),
                    entries: vec![],
                },
                RegexCategory {
                    name: "Spesialtegn".to_string(),
                    entries: vec![],
                },
            ],
        });
    }

    // Read and parse XML
    let xml_content = fs::read_to_string(&lib_path)
        .map_err(|e| format!("Failed to read library file: {}", e))?;

    // Parse XML using quick-xml
    parse_library_xml(&xml_content)
}

fn parse_library_xml(xml: &str) -> Result<RegexLibrary, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);

    let mut categories: Vec<RegexCategory> = Vec::new();
    let mut current_category: Option<RegexCategory> = None;
    let mut current_entry: Option<RegexEntry> = None;
    let mut current_field = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"category" => {
                        let name = e.attributes()
                            .find(|a| a.as_ref().ok().map(|attr| attr.key.as_ref() == b"name").unwrap_or(false))
                            .and_then(|a| a.ok())
                            .and_then(|a| String::from_utf8(a.value.to_vec()).ok())
                            .unwrap_or_default();
                        current_category = Some(RegexCategory {
                            name,
                            entries: Vec::new(),
                        });
                    }
                    b"entry" => {
                        current_entry = Some(RegexEntry {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: String::new(),
                            description: String::new(),
                            pattern: String::new(),
                            replace: String::new(),
                            category: current_category.as_ref().map(|c| c.name.clone()).unwrap_or_default(),
                        });
                    }
                    b"name" | b"description" | b"pattern" | b"replace" => {
                        current_field = String::from_utf8(e.name().as_ref().to_vec()).unwrap_or_default();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if let Some(ref mut entry) = current_entry {
                    let text = e.unescape().unwrap_or_default().to_string();
                    match current_field.as_str() {
                        "name" => entry.name = text,
                        "description" => entry.description = text,
                        "pattern" => entry.pattern = text,
                        "replace" => entry.replace = text,
                        _ => {}
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"entry" => {
                        if let (Some(entry), Some(ref mut cat)) = (current_entry.take(), current_category.as_mut()) {
                            cat.entries.push(entry);
                        }
                    }
                    b"category" => {
                        if let Some(cat) = current_category.take() {
                            categories.push(cat);
                        }
                    }
                    b"name" | b"description" | b"pattern" | b"replace" => {
                        current_field.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(RegexLibrary { categories })
}

#[tauri::command]
fn save_regex_library(library: RegexLibrary) -> Result<String, String> {
    let lib_path = get_library_path()?;

    // Build XML
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<regex-library>\n");

    for category in library.categories {
        xml.push_str(&format!("  <category name=\"{}\">\n", escape_xml(&category.name)));
        for entry in category.entries {
            xml.push_str("    <entry>\n");
            xml.push_str(&format!("      <name>{}</name>\n", escape_xml(&entry.name)));
            xml.push_str(&format!("      <description>{}</description>\n", escape_xml(&entry.description)));
            xml.push_str(&format!("      <pattern>{}</pattern>\n", escape_xml(&entry.pattern)));
            xml.push_str(&format!("      <replace>{}</replace>\n", escape_xml(&entry.replace)));
            xml.push_str("    </entry>\n");
        }
        xml.push_str("  </category>\n");
    }

    xml.push_str("</regex-library>\n");

    // Write file
    fs::write(&lib_path, xml)
        .map_err(|e| format!("Failed to write library file: {}", e))?;

    Ok("Library saved successfully".to_string())
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchFindMatch {
    tu_id: String,
    check_name: String,
    check_order: i32,
    category: String,
    description: String,
    source: String,
    target: String,
    #[serde(rename = "match")]
    match_text: String,
    match_start: i32,
    match_end: i32,
    pattern: String,
    replacement: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchFindResult {
    profile_name: String,
    file: String,
    total_matches: i32,
    matches: Vec<BatchFindMatch>,
}

#[tauri::command]
fn batch_find(file_path: String, profile_path: String, app_handle: tauri::AppHandle) -> Result<BatchFindResult, String> {
    // Determine CLI executable path based on environment
    let output = if cfg!(dev) {
        // Development mode: use Python script directly
        let project_root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../");
        let python = format!("{}venv/bin/python3", project_root);
        let script = format!("{}src/cli.py", project_root);

        Command::new(&python)
            .arg(&script)
            .arg("batch-find")
            .arg(&file_path)
            .arg(&profile_path)
            .arg("--json")
            .output()
            .map_err(|e| format!("Failed to execute Python: {}", e))?
    } else {
        // Production mode: use bundled executable
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        let cli_path = resource_dir.join("bin/xliff_cli").to_string_lossy().to_string();

        Command::new(&cli_path)
            .arg("batch-find")
            .arg(&file_path)
            .arg(&profile_path)
            .arg("--json")
            .output()
            .map_err(|e| format!("Failed to execute CLI: {}", e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", stderr));
    }

    // Parse JSON output from Python
    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: BatchFindResult = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON: {} (output: {})", e, json_str))?;

    Ok(data)
}

#[derive(Debug, Serialize, Deserialize)]
struct QAProfileInfo {
    path: String,
    name: String,
    description: String,
    language: String,
}

#[tauri::command]
fn list_qa_profiles(app_handle: tauri::AppHandle) -> Result<Vec<QAProfileInfo>, String> {
    // Look for QA profiles in the samples directory
    let profiles_dir = if cfg!(dev) {
        PathBuf::from("../../samples")
    } else {
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        resource_dir.join("_up_/_up_/samples")
    };

    if !profiles_dir.exists() {
        return Ok(Vec::new());
    }

    let mut profiles = Vec::new();

    // Find all *_qa_profile.xml files
    if let Ok(entries) = fs::read_dir(&profiles_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                if filename.ends_with("_qa_profile.xml") {
                    // Try to parse basic metadata
                    if let Ok(content) = fs::read_to_string(&path) {
                        // Simple XML parsing to extract metadata
                        let name = extract_xml_tag(&content, "name").unwrap_or_else(|| filename.to_string());
                        let description = extract_xml_tag(&content, "description").unwrap_or_default();
                        let language = extract_xml_tag(&content, "language").unwrap_or_default();

                        profiles.push(QAProfileInfo {
                            path: path.to_string_lossy().to_string(),
                            name,
                            description,
                            language,
                        });
                    }
                }
            }
        }
    }

    Ok(profiles)
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);

    if let Some(start_pos) = xml.find(&start_tag) {
        if let Some(end_pos) = xml[start_pos..].find(&end_tag) {
            let content_start = start_pos + start_tag.len();
            let content_end = start_pos + end_pos;
            return Some(xml[content_start..content_end].trim().to_string());
        }
    }
    None
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchReplaceResult {
    success: bool,
    modified_units: i32,
    total_replacements: i32,
    output_path: String,
}

#[tauri::command]
fn batch_replace(file_path: String, profile_path: String, app_handle: tauri::AppHandle) -> Result<BatchReplaceResult, String> {
    // Determine CLI executable path based on environment
    let output = if cfg!(dev) {
        // Development mode: use Python script directly
        let project_root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../");
        let python = format!("{}venv/bin/python3", project_root);
        let script = format!("{}src/cli.py", project_root);

        Command::new(&python)
            .arg(&script)
            .arg("batch-replace")
            .arg(&file_path)
            .arg(&profile_path)
            .arg("--json")
            .output()
            .map_err(|e| format!("Failed to execute Python: {}", e))?
    } else {
        // Production mode: use bundled executable
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        let cli_path = resource_dir.join("bin/xliff_cli").to_string_lossy().to_string();

        Command::new(&cli_path)
            .arg("batch-replace")
            .arg(&file_path)
            .arg(&profile_path)
            .arg("--json")
            .output()
            .map_err(|e| format!("Failed to execute CLI: {}", e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", stderr));
    }

    // Parse JSON output from Python - it's the last line
    let full_output = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = full_output.lines().collect();
    let json_str = lines.last().ok_or("No output from Python")?;

    let data: BatchReplaceResult = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse JSON: {} (output: {})", e, json_str))?;

    Ok(data)
}

#[derive(Debug, Serialize, Deserialize)]
struct QAProfileData {
    name: String,
    description: String,
    language: String,
    checks: Vec<QACheckData>,
}

#[derive(Debug, Serialize, Deserialize)]
struct QACheckData {
    order: i32,
    enabled: bool,
    name: String,
    description: String,
    pattern: String,
    replacement: String,
    category: String,
    case_sensitive: bool,
    exclude_pattern: String,
}

#[tauri::command]
fn save_qa_profile(profile_data: QAProfileData, file_name: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    // Determine save path
    let profiles_dir = if cfg!(dev) {
        PathBuf::from("../../samples")
    } else {
        let resource_dir = app_handle.path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource directory: {}", e))?;
        resource_dir.join("_up_/_up_/samples")
    };

    // Ensure directory exists
    if !profiles_dir.exists() {
        fs::create_dir_all(&profiles_dir)
            .map_err(|e| format!("Failed to create profiles directory: {}", e))?;
    }

    // Build file path
    let file_path = profiles_dir.join(&file_name);

    // Build XML
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<qa_profile>\n");

    // Metadata
    xml.push_str("    <metadata>\n");
    xml.push_str(&format!("        <name>{}</name>\n", escape_xml(&profile_data.name)));
    xml.push_str(&format!("        <description>{}</description>\n", escape_xml(&profile_data.description)));
    xml.push_str(&format!("        <language>{}</language>\n", escape_xml(&profile_data.language)));

    // Add timestamp
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    let date = format!("{}", now.as_secs() / 86400 * 86400); // Simple date approximation
    xml.push_str(&format!("        <created>{}</created>\n", date));
    xml.push_str(&format!("        <modified>{}</modified>\n", date));
    xml.push_str("    </metadata>\n\n");

    // Checks
    xml.push_str("    <checks>\n");
    for check in profile_data.checks {
        xml.push_str(&format!("        <check order=\"{}\" enabled=\"{}\">\n",
            check.order,
            if check.enabled { "true" } else { "false" }
        ));
        xml.push_str(&format!("            <name>{}</name>\n", escape_xml(&check.name)));
        xml.push_str(&format!("            <description>{}</description>\n", escape_xml(&check.description)));
        xml.push_str(&format!("            <pattern>{}</pattern>\n", escape_xml(&check.pattern)));
        xml.push_str(&format!("            <replacement>{}</replacement>\n", escape_xml(&check.replacement)));
        xml.push_str(&format!("            <category>{}</category>\n", escape_xml(&check.category)));
        xml.push_str(&format!("            <case_sensitive>{}</case_sensitive>\n",
            if check.case_sensitive { "true" } else { "false" }
        ));
        xml.push_str(&format!("            <exclude_pattern>{}</exclude_pattern>\n", escape_xml(&check.exclude_pattern)));
        xml.push_str("        </check>\n");
    }
    xml.push_str("    </checks>\n");
    xml.push_str("</qa_profile>\n");

    // Write to file
    fs::write(&file_path, xml)
        .map_err(|e| format!("Failed to write profile file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_qa_profile(profile_path: String) -> Result<(), String> {
    // Delete the profile file
    fs::remove_file(&profile_path)
        .map_err(|e| format!("Failed to delete profile: {}", e))?;

    Ok(())
}

#[tauri::command]
fn load_qa_profile(profile_path: String) -> Result<QAProfileData, String> {
    // Read XML file
    let xml_content = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read profile: {}", e))?;

    // Parse XML
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(&xml_content);
    reader.trim_text(true);

    let mut name = String::new();
    let mut description = String::new();
    let mut language = String::new();
    let mut checks = Vec::new();

    let mut current_check: Option<QACheckData> = None;
    let mut current_field = String::new();
    let mut in_metadata = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"metadata" => in_metadata = true,
                    b"check" => {
                        let mut order = 0;
                        let mut enabled = true;

                        for attr in e.attributes() {
                            if let Ok(attr) = attr {
                                match attr.key.as_ref() {
                                    b"order" => {
                                        order = String::from_utf8_lossy(&attr.value).parse().unwrap_or(0);
                                    }
                                    b"enabled" => {
                                        enabled = String::from_utf8_lossy(&attr.value) == "true";
                                    }
                                    _ => {}
                                }
                            }
                        }

                        current_check = Some(QACheckData {
                            order,
                            enabled,
                            name: String::new(),
                            description: String::new(),
                            pattern: String::new(),
                            replacement: String::new(),
                            category: String::new(),
                            case_sensitive: false,
                            exclude_pattern: String::new(),
                        });
                    }
                    b"name" | b"description" | b"language" | b"pattern" | b"replacement" |
                    b"category" | b"case_sensitive" | b"exclude_pattern" => {
                        current_field = String::from_utf8_lossy(e.name().as_ref()).to_string();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();

                if in_metadata {
                    match current_field.as_str() {
                        "name" => name = text,
                        "description" => description = text,
                        "language" => language = text,
                        _ => {}
                    }
                } else if let Some(ref mut check) = current_check {
                    match current_field.as_str() {
                        "name" => check.name = text,
                        "description" => check.description = text,
                        "pattern" => check.pattern = text,
                        "replacement" => check.replacement = text,
                        "category" => check.category = text,
                        "case_sensitive" => check.case_sensitive = text == "true",
                        "exclude_pattern" => check.exclude_pattern = text,
                        _ => {}
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"metadata" => in_metadata = false,
                    b"check" => {
                        if let Some(check) = current_check.take() {
                            checks.push(check);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(QAProfileData {
        name,
        description,
        language,
        checks,
    })
}

#[tauri::command]
fn export_regex_library(library: RegexLibrary, export_path: String) -> Result<String, String> {
    // Build XML (same as save_regex_library but to custom path)
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<regex-library>\n");

    for category in library.categories {
        xml.push_str(&format!("  <category name=\"{}\">\n", escape_xml(&category.name)));
        for entry in category.entries {
            xml.push_str("    <entry>\n");
            xml.push_str(&format!("      <name>{}</name>\n", escape_xml(&entry.name)));
            xml.push_str(&format!("      <description>{}</description>\n", escape_xml(&entry.description)));
            xml.push_str(&format!("      <pattern>{}</pattern>\n", escape_xml(&entry.pattern)));
            xml.push_str(&format!("      <replace>{}</replace>\n", escape_xml(&entry.replace)));
            xml.push_str("    </entry>\n");
        }
        xml.push_str("  </category>\n");
    }

    xml.push_str("</regex-library>\n");

    // Write to user-selected path
    fs::write(&export_path, xml)
        .map_err(|e| format!("Failed to export library: {}", e))?;

    Ok(format!("Library exported successfully to {}", export_path))
}

#[tauri::command]
fn import_regex_library(import_path: String) -> Result<RegexLibrary, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    // Read the import file
    let xml_content = fs::read_to_string(&import_path)
        .map_err(|e| format!("Failed to read import file: {}", e))?;

    // Parse XML (same logic as load_regex_library)
    let mut reader = Reader::from_str(&xml_content);
    reader.trim_text(true);

    let mut buf = Vec::new();
    let mut categories: Vec<RegexCategory> = Vec::new();
    let mut current_category: Option<RegexCategory> = None;
    let mut current_category_name: Option<String> = None;
    let mut current_entry: Option<RegexEntry> = None;
    let mut current_field = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"category" => {
                        let name = e.attributes()
                            .find(|a: &Result<quick_xml::events::attributes::Attribute, _>| {
                                a.as_ref().map(|attr| attr.key.as_ref() == b"name").unwrap_or(false)
                            })
                            .and_then(|a: Result<quick_xml::events::attributes::Attribute, _>| a.ok())
                            .and_then(|a| String::from_utf8(a.value.to_vec()).ok())
                            .unwrap_or_else(|| "Uncategorized".to_string());
                        current_category_name = Some(name.clone());
                        current_category = Some(RegexCategory {
                            name,
                            entries: Vec::new(),
                        });
                    }
                    b"entry" => {
                        current_entry = Some(RegexEntry {
                            id: format!("{}", std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap().as_millis()),
                            name: String::new(),
                            description: String::new(),
                            pattern: String::new(),
                            replace: String::new(),
                            category: current_category_name.clone().unwrap_or_else(|| "Uncategorized".to_string()),
                        });
                    }
                    b"name" | b"description" | b"pattern" | b"replace" => {
                        current_field = String::from_utf8(e.name().as_ref().to_vec()).unwrap_or_default();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if let Some(ref mut entry) = current_entry {
                    let text = e.unescape().unwrap_or_default().to_string();
                    match current_field.as_str() {
                        "name" => entry.name = text,
                        "description" => entry.description = text,
                        "pattern" => entry.pattern = text,
                        "replace" => entry.replace = text,
                        _ => {}
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"entry" => {
                        if let (Some(ref mut category), Some(entry)) = (&mut current_category, current_entry.take()) {
                            category.entries.push(entry);
                        }
                    }
                    b"category" => {
                        if let Some(category) = current_category.take() {
                            categories.push(category);
                        }
                        current_category_name = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Error parsing XML at position {}: {:?}", reader.buffer_position(), e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(RegexLibrary { categories })
}

#[tauri::command]
fn export_qa_profile(profile_path: String, export_path: String) -> Result<String, String> {
    // Read the profile file
    let profile_content = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read profile file: {}", e))?;

    // Write to export path
    fs::write(&export_path, profile_content)
        .map_err(|e| format!("Failed to export profile: {}", e))?;

    Ok(format!("Profile exported successfully to {}", export_path))
}

#[tauri::command]
fn import_qa_profile(import_path: String) -> Result<String, String> {
    // Get the samples directory (where profiles are stored)
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_dir = exe_path.parent()
        .ok_or_else(|| "Failed to get executable directory".to_string())?;

    // Go up to project root and into samples
    let samples_dir = exe_dir
        .parent().ok_or_else(|| "Failed to get parent directory".to_string())?
        .parent().ok_or_else(|| "Failed to get parent directory".to_string())?
        .parent().ok_or_else(|| "Failed to get parent directory".to_string())?
        .join("samples");

    // Read the import file
    let profile_content = fs::read_to_string(&import_path)
        .map_err(|e| format!("Failed to read import file: {}", e))?;

    // Parse to get profile name for filename
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(&profile_content);
    reader.trim_text(true);

    let mut buf = Vec::new();
    let mut profile_name = String::new();
    let mut in_metadata = false;
    let mut in_name = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"metadata" => in_metadata = true,
                    b"name" if in_metadata => in_name = true,
                    _ => {}
                }
            }
            Ok(Event::Text(e)) if in_name => {
                profile_name = e.unescape().unwrap_or_default().to_string();
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"metadata" => in_metadata = false,
                    b"name" => in_name = false,
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Error parsing XML: {:?}", e)),
            _ => {}
        }
        buf.clear();
    }

    // Generate filename
    let file_name = if !profile_name.is_empty() {
        format!("{}_qa_profile.xml", profile_name.to_lowercase().replace(" ", "_"))
    } else {
        format!("imported_profile_{}.xml", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap().as_secs())
    };

    // Create samples directory if it doesn't exist
    fs::create_dir_all(&samples_dir)
        .map_err(|e| format!("Failed to create samples directory: {}", e))?;

    let destination = samples_dir.join(&file_name);

    // Write to samples directory
    fs::write(&destination, profile_content)
        .map_err(|e| format!("Failed to save imported profile: {}", e))?;

    Ok(format!("Profile imported successfully as {}", file_name))
}

/// Check for a pending file path written by SpellcheckQA's "Open in RegEx Tool" action.
/// Reads ~/.spellcheck-qa/pending_file.txt, returns its contents, then deletes the file.
/// Returns None if no pending file exists.
#[tauri::command]
fn check_pending_file() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let ipc_path = std::path::PathBuf::from(home)
        .join(".spellcheck-qa")
        .join("pending_file.txt");
    if !ipc_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&ipc_path).ok()?;
    let _ = std::fs::remove_file(&ipc_path);
    let trimmed = content.trim().to_string();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Create menu items
            let open_item = MenuItemBuilder::with_id("open", "Open XLIFF File")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let save_item = MenuItemBuilder::with_id("save", "Save Changes")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;

            let about_item = MenuItemBuilder::with_id("about", "About XLIFF Regex Tool")
                .build(app)?;

            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            // View menu items
            let show_hidden_chars = CheckMenuItemBuilder::with_id("toggle_hidden_chars", "Show Hidden Characters")
                .checked(false)
                .build(app)?;

            let dark_mode = CheckMenuItemBuilder::with_id("toggle_dark_mode", "Dark Mode")
                .checked(false)
                .build(app)?;

            let regex_library_item = MenuItemBuilder::with_id("regex_library", "Regex Library")
                .accelerator("CmdOrCtrl+L")
                .build(app)?;

            let qa_profiles_item = MenuItemBuilder::with_id("qa_profiles", "Batch Check Profiles")
                .accelerator("CmdOrCtrl+P")
                .build(app)?;

            // Insert menu items
            let special_chars_item = MenuItemBuilder::with_id("special_chars", "Special Characters")
                .build(app)?;

            // Edit menu items (use predefined items for proper native behavior)
            let copy_item = PredefinedMenuItem::copy(app, None)?;
            let cut_item = PredefinedMenuItem::cut(app, None)?;
            let paste_item = PredefinedMenuItem::paste(app, None)?;
            let select_all_item = PredefinedMenuItem::select_all(app, None)?;

            // Help menu items
            let user_guide_item = MenuItemBuilder::with_id("user_guide", "User Guide")
                .build(app)?;

            let changelog_item = MenuItemBuilder::with_id("changelog", "Changelog")
                .build(app)?;

            let shortcuts_item = MenuItemBuilder::with_id("show_shortcuts", "Keyboard Shortcuts")
                .build(app)?;

            let check_updates_item = MenuItemBuilder::with_id("check_updates", "Check for Updates...")
                .build(app)?;

            // Build submenus
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&about_item)
                .separator()
                .item(&open_item)
                .item(&save_item)
                .separator()
                .item(&settings_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&copy_item)
                .item(&cut_item)
                .item(&paste_item)
                .separator()
                .item(&select_all_item)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&show_hidden_chars)
                .item(&dark_mode)
                .separator()
                .item(&regex_library_item)
                .item(&qa_profiles_item)
                .build()?;

            let insert_menu = SubmenuBuilder::new(app, "Insert")
                .item(&special_chars_item)
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&user_guide_item)
                .item(&changelog_item)
                .separator()
                .item(&shortcuts_item)
                .separator()
                .item(&check_updates_item)
                .build()?;

            // Build main menu
            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&insert_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app, event| {
                match event.id().as_ref() {
                    "about" => {
                        let _ = app.emit("menu-about", ());
                    }
                    "open" => {
                        let _ = app.emit("menu-open", ());
                    }
                    "save" => {
                        let _ = app.emit("menu-save", ());
                    }
                    "settings" => {
                        let _ = app.emit("menu-settings", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    "toggle_hidden_chars" => {
                        // Just emit event, let frontend handle state and sync back
                        let _ = app.emit("menu-toggle-hidden-chars", ());
                    }
                    "toggle_dark_mode" => {
                        // Just emit event, let frontend handle state and sync back
                        let _ = app.emit("menu-toggle-dark-mode", ());
                    }
                    "regex_library" => {
                        let _ = app.emit("menu-regex-library", ());
                    }
                    "qa_profiles" => {
                        let _ = app.emit("menu-qa-profiles", ());
                    }
                    "special_chars" => {
                        let _ = app.emit("menu-special-chars", ());
                    }
                    "show_shortcuts" => {
                        let _ = app.emit("menu-show-shortcuts", ());
                    }
                    "user_guide" => {
                        let _ = app.emit("menu-user-guide", ());
                    }
                    "changelog" => {
                        let _ = app.emit("menu-changelog", ());
                    }
                    "check_updates" => {
                        let _ = app.emit("menu-check-updates", ());
                    }
                    _ => {}
                }
            });

            // Listen for sync events from frontend to update menu checkbox state
            let app_handle = app.handle().clone();
            app.listen("sync-menu-checkboxes", move |event| {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    if let Some(menu) = app_handle.menu() {
                        // Update dark mode checkbox
                        if let Some(dark_mode_val) = payload.get("darkMode").and_then(|v| v.as_bool()) {
                            if let Some(item) = menu.get("toggle_dark_mode") {
                                if let Some(check_item) = item.as_check_menuitem() {
                                    let _ = check_item.set_checked(dark_mode_val);
                                }
                            }
                        }
                        // Update show hidden chars checkbox
                        if let Some(show_hidden_val) = payload.get("showHiddenChars").and_then(|v| v.as_bool()) {
                            if let Some(item) = menu.get("toggle_hidden_chars") {
                                if let Some(check_item) = item.as_check_menuitem() {
                                    let _ = check_item.set_checked(show_hidden_val);
                                }
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, open_xliff, save_xliff, get_tmx_languages, load_regex_library, save_regex_library, batch_find, list_qa_profiles, batch_replace, save_qa_profile, delete_qa_profile, load_qa_profile, export_regex_library, import_regex_library, export_qa_profile, import_qa_profile, get_user_guide_content, get_changelog_content, check_pending_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
