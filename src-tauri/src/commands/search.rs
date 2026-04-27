use super::{decode_script_bytes, resolve_workspace_root};
use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher as GrepMatcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::Lossy, BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use nucleo_matcher::{
    pattern::{CaseMatching, Normalization, Pattern},
    Config, Matcher as NucleoMatcher, Utf32Str,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tree_sitter::{Node, Parser};

const DEFAULT_SEARCH_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 500;
const MAX_LINE_CHARS: usize = 240;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchRequest {
    pub(crate) workspace_root_path: String,
    pub(crate) query: String,
    pub(crate) scope: String,
    pub(crate) match_case: bool,
    pub(crate) whole_word: bool,
    pub(crate) use_regex: bool,
    #[serde(default)]
    pub(crate) include_patterns: Vec<String>,
    #[serde(default)]
    pub(crate) exclude_patterns: Vec<String>,
    pub(crate) limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchPayload {
    pub(crate) root_path: String,
    pub(crate) scanned_file_count: usize,
    pub(crate) results: Vec<WorkspaceSearchResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) line_number: Option<u64>,
    pub(crate) line_text: Option<String>,
    pub(crate) score: i64,
}

#[derive(Clone)]
struct ScannedFile {
    path: PathBuf,
    relative_path: String,
    name: String,
}

struct PathFilters {
    include: Option<GlobSet>,
    exclude: Option<GlobSet>,
}

struct WorkspaceFileCache {
    files: Vec<ScannedFile>,
    dirty: Arc<AtomicBool>,
    _watcher: RecommendedWatcher,
}

struct SymbolEntry {
    path: PathBuf,
    relative_path: String,
    name: String,
    line_number: u64,
}

static WORKSPACE_FILE_CACHES: OnceLock<Mutex<HashMap<String, WorkspaceFileCache>>> =
    OnceLock::new();

#[tauri::command]
pub fn search_workspace(payload: WorkspaceSearchRequest) -> Result<WorkspaceSearchPayload, String> {
    let workspace_root = resolve_workspace_root(Some(payload.workspace_root_path.clone()))?;
    let query = payload.query.trim().to_string();
    let limit = payload
        .limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .min(MAX_SEARCH_LIMIT);
    let filters = build_path_filters(&payload)?;
    let files = scan_workspace_files(&workspace_root, &filters)?;

    if query.is_empty() {
        return Ok(WorkspaceSearchPayload {
            root_path: workspace_root.to_string_lossy().to_string(),
            scanned_file_count: files.len(),
            results: Vec::new(),
        });
    }

    let mut results = Vec::new();
    let include_file_results = payload.scope == "all" || payload.scope == "file-name";
    let include_content_results = payload.scope == "all" || payload.scope == "content";
    let include_symbol_results = payload.scope == "all" || payload.scope == "symbol";

    if include_file_results {
        results.extend(search_file_names(&files, &query, payload.match_case, limit));
    }

    if include_content_results && (payload.scope == "all" || results.len() < limit) {
        let content_limit = if payload.scope == "all" {
            limit
        } else {
            limit - results.len()
        };
        results.extend(search_file_contents(
            &files,
            &query,
            &payload,
            content_limit,
        )?);
    }

    if include_symbol_results && (payload.scope == "all" || results.len() < limit) {
        let symbol_limit = if payload.scope == "all" {
            limit
        } else {
            limit - results.len()
        };
        results.extend(search_symbols(
            &files,
            &query,
            payload.match_case,
            symbol_limit,
        )?);
    }

    results.sort_by(|left, right| {
        left.score
            .cmp(&right.score)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    results.truncate(limit);

    Ok(WorkspaceSearchPayload {
        root_path: workspace_root.to_string_lossy().to_string(),
        scanned_file_count: files.len(),
        results,
    })
}

fn build_path_filters(payload: &WorkspaceSearchRequest) -> Result<PathFilters, String> {
    Ok(PathFilters {
        include: build_glob_set(&payload.include_patterns)?,
        exclude: build_glob_set(&payload.exclude_patterns)?,
    })
}

fn build_glob_set(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    let cleaned_patterns: Vec<&str> = patterns
        .iter()
        .map(|pattern| pattern.trim())
        .filter(|pattern| !pattern.is_empty())
        .collect();

    if cleaned_patterns.is_empty() {
        return Ok(None);
    }

    let mut builder = GlobSetBuilder::new();
    for pattern in cleaned_patterns {
        builder.add(Glob::new(pattern).map_err(|error| format!("路径过滤规则无效：{error}"))?);
    }
    builder
        .build()
        .map(Some)
        .map_err(|error| format!("路径过滤规则无效：{error}"))
}

fn scan_workspace_files(root: &Path, filters: &PathFilters) -> Result<Vec<ScannedFile>, String> {
    let files = workspace_cache_files(root)?;
    Ok(files
        .into_iter()
        .filter(|file| passes_path_filters(&file.relative_path, filters))
        .collect())
}

fn workspace_cache_files(root: &Path) -> Result<Vec<ScannedFile>, String> {
    let cache_key = root.to_string_lossy().to_string();
    let caches = WORKSPACE_FILE_CACHES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = caches
        .lock()
        .map_err(|_| "搜索索引状态已损坏，请重启应用后重试。".to_string())?;

    if let Some(cache) = guard.get_mut(&cache_key) {
        if !cache.dirty.swap(false, Ordering::AcqRel) {
            return Ok(cache.files.clone());
        }

        cache.files = scan_workspace_files_uncached(root)?;
        return Ok(cache.files.clone());
    }

    let dirty = Arc::new(AtomicBool::new(false));
    let watcher_dirty = Arc::clone(&dirty);
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            watcher_dirty.store(true, Ordering::Release);
        }
    })
    .map_err(|error| format!("启动工作区文件监听失败：{error}"))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| format!("监听工作区文件变化失败：{error}"))?;

    let files = scan_workspace_files_uncached(root)?;
    guard.insert(
        cache_key,
        WorkspaceFileCache {
            files: files.clone(),
            dirty,
            _watcher: watcher,
        },
    );
    Ok(files)
}

fn scan_workspace_files_uncached(root: &Path) -> Result<Vec<ScannedFile>, String> {
    let mut builder = WalkBuilder::new(root);
    builder
        .standard_filters(true)
        .hidden(false)
        .follow_links(false);

    let mut files = Vec::new();
    for entry in builder.build() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        let path = entry.into_path();
        let relative_path = relative_path(root, &path);

        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();

        files.push(ScannedFile {
            path,
            relative_path,
            name,
        });
    }

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

fn passes_path_filters(relative_path: &str, filters: &PathFilters) -> bool {
    if let Some(include) = &filters.include {
        if !include.is_match(relative_path) {
            return false;
        }
    }

    if let Some(exclude) = &filters.exclude {
        if exclude.is_match(relative_path) {
            return false;
        }
    }

    true
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn search_file_names(
    files: &[ScannedFile],
    query: &str,
    match_case: bool,
    limit: usize,
) -> Vec<WorkspaceSearchResult> {
    let case_matching = if match_case {
        CaseMatching::Respect
    } else {
        CaseMatching::Ignore
    };
    let pattern = Pattern::parse(query, case_matching, Normalization::Smart);
    let mut matcher = NucleoMatcher::new(Config::DEFAULT.match_paths());
    let mut utf32_buffer = Vec::new();
    let mut results = Vec::new();

    for file in files {
        let haystack = Utf32Str::new(&file.relative_path, &mut utf32_buffer);
        if let Some(score) = pattern.score(haystack, &mut matcher) {
            results.push(WorkspaceSearchResult {
                path: file.path.to_string_lossy().to_string(),
                relative_path: file.relative_path.clone(),
                name: file.name.clone(),
                kind: "file-name".into(),
                line_number: None,
                line_text: None,
                score: -(score as i64),
            });
        }
    }

    results.sort_by(|left, right| {
        left.score
            .cmp(&right.score)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    results.truncate(limit);
    results
}

fn search_file_contents(
    files: &[ScannedFile],
    query: &str,
    payload: &WorkspaceSearchRequest,
    limit: usize,
) -> Result<Vec<WorkspaceSearchResult>, String> {
    let pattern = if payload.use_regex {
        query.to_string()
    } else {
        escape_regex(query)
    };

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!payload.match_case)
        .word(payload.whole_word)
        .build(&pattern)
        .map_err(|error| format!("内容搜索表达式无效：{error}"))?;

    let mut results = Vec::new();

    for file in files {
        if results.len() >= limit {
            break;
        }

        let remaining = limit - results.len();
        search_one_file_content(file, &matcher, remaining, &mut results)?;
    }

    Ok(results)
}

fn search_symbols(
    files: &[ScannedFile],
    query: &str,
    match_case: bool,
    limit: usize,
) -> Result<Vec<WorkspaceSearchResult>, String> {
    let symbols = collect_workspace_symbols(files)?;
    let case_matching = if match_case {
        CaseMatching::Respect
    } else {
        CaseMatching::Ignore
    };
    let pattern = Pattern::parse(query, case_matching, Normalization::Smart);
    let mut matcher = NucleoMatcher::new(Config::DEFAULT.match_paths());
    let mut utf32_buffer = Vec::new();
    let mut results = Vec::new();

    for symbol in symbols {
        let candidate = format!("{} {}", symbol.name, symbol.relative_path);
        let haystack = Utf32Str::new(&candidate, &mut utf32_buffer);
        if let Some(score) = pattern.score(haystack, &mut matcher) {
            results.push(WorkspaceSearchResult {
                path: symbol.path.to_string_lossy().to_string(),
                relative_path: symbol.relative_path,
                name: symbol.name.clone(),
                kind: "symbol".into(),
                line_number: Some(symbol.line_number),
                line_text: Some(format!("函数 {}", symbol.name)),
                score: -(score as i64) + symbol.line_number as i64,
            });
        }
    }

    results.sort_by(|left, right| {
        left.score
            .cmp(&right.score)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    results.truncate(limit);
    Ok(results)
}

fn collect_workspace_symbols(files: &[ScannedFile]) -> Result<Vec<SymbolEntry>, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_bash::LANGUAGE.into())
        .map_err(|error| format!("初始化 Bash 符号解析器失败：{error}"))?;

    let mut symbols = Vec::new();
    for file in files.iter().filter(|file| is_shell_like_file(file)) {
        let bytes = match fs::read(&file.path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let Ok((content, _encoding)) = decode_script_bytes(&bytes) else {
            continue;
        };
        let Some(tree) = parser.parse(&content, None) else {
            continue;
        };

        collect_symbols_from_node(tree.root_node(), content.as_bytes(), file, &mut symbols);
    }

    Ok(symbols)
}

fn collect_symbols_from_node(
    node: Node<'_>,
    source: &[u8],
    file: &ScannedFile,
    symbols: &mut Vec<SymbolEntry>,
) {
    if node.kind() == "function_definition" {
        if let Some(name_node) = node.child_by_field_name("name") {
            if let Ok(name) = name_node.utf8_text(source) {
                symbols.push(SymbolEntry {
                    path: file.path.clone(),
                    relative_path: file.relative_path.clone(),
                    name: name.to_string(),
                    line_number: (name_node.start_position().row + 1) as u64,
                });
            }
        }
    }

    for child_index in 0..node.named_child_count() {
        if let Some(child) = node.named_child(child_index as u32) {
            collect_symbols_from_node(child, source, file, symbols);
        }
    }
}

fn is_shell_like_file(file: &ScannedFile) -> bool {
    let extension = file
        .path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("sh" | "bash" | "zsh" | "ksh" | "bats")
    ) || file.name.eq_ignore_ascii_case("bashrc")
        || file.name.eq_ignore_ascii_case(".bashrc")
        || file.name.eq_ignore_ascii_case(".profile")
}

fn search_one_file_content(
    file: &ScannedFile,
    matcher: &grep_regex::RegexMatcher,
    limit: usize,
    results: &mut Vec<WorkspaceSearchResult>,
) -> Result<(), String> {
    let mut matched_in_file = 0usize;
    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .build();

    searcher
        .search_path(
            matcher,
            &file.path,
            Lossy(|line_number, line| {
                let Some(found) = matcher.find(line.as_bytes()).map_err(io::Error::other)? else {
                    return Ok(true);
                };

                let column = found.start() as i64;
                results.push(WorkspaceSearchResult {
                    path: file.path.to_string_lossy().to_string(),
                    relative_path: file.relative_path.clone(),
                    name: file.name.clone(),
                    kind: "content".into(),
                    line_number: Some(line_number),
                    line_text: Some(trim_line(line)),
                    score: (line_number as i64 * 4) + column,
                });
                matched_in_file += 1;
                Ok(matched_in_file < limit)
            }),
        )
        .map_err(|error| format!("内容搜索失败：{error}"))?;

    Ok(())
}

fn trim_line(line: &str) -> String {
    let trimmed = line.trim();
    let mut result = String::new();
    for character in trimmed.chars().take(MAX_LINE_CHARS) {
        result.push(character);
    }
    result
}

fn escape_regex(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$'
            | '#' | '&' | '-' | '~' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    escaped
}
