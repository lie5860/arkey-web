use crate::bridge::{self, Bridge};
use crate::codex_focus::CodexFocus;
use crate::settings;
use crate::window::SettingsWindow;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path as AxumPath, State};
use axum::http::{
    header::{
        CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, COOKIE, HOST, LOCATION, ORIGIN,
        SET_COOKIE,
    },
    HeaderMap, HeaderValue, Method, StatusCode, Uri,
};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const MAX_BODY_BYTES: usize = 16 * 1024;
const SESSION_COOKIE_PREFIX: &str = "arkey_session_";
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

#[derive(Clone)]
struct AppState {
    app: AppHandle,
    authority: String,
    origin: String,
    session_cookie_name: String,
    desktop_bootstrap_token: Arc<Mutex<Option<String>>>,
    desktop_session_token: String,
    browser_bootstrap_tokens: Arc<Mutex<HashMap<String, String>>>,
    browser_session_tokens: Arc<Mutex<HashSet<String>>>,
    bridge: Arc<Bridge>,
    codex_focus: Arc<CodexFocus>,
    settings_path: PathBuf,
    settings_window: Arc<SettingsWindow>,
}

pub struct Launch {
    pub origin: String,
    pub bootstrap_url: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

struct RequestError {
    status: StatusCode,
    message: &'static str,
}

impl RequestError {
    fn into_response(self) -> Response {
        error(self.status, self.message)
    }
}

#[derive(Serialize)]
struct OkBody {
    ok: bool,
}

#[derive(Serialize)]
struct WebSnapshot {
    #[serde(rename = "serverOrigin")]
    server_origin: String,
    desktop: bool,
    #[serde(rename = "alwaysOnTop")]
    always_on_top: bool,
    #[serde(rename = "focusCodexAvailable")]
    focus_codex_available: bool,
    #[serde(rename = "focusCodexOnInput")]
    focus_codex_on_input: bool,
    #[serde(rename = "accessibilityGranted")]
    accessibility_granted: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum SessionKind {
    Desktop,
    Browser,
}

#[derive(Serialize)]
struct SnapshotBody {
    web: WebSnapshot,
    hardware: bridge::State,
}

#[derive(Serialize)]
struct PortsBody {
    ports: Vec<bridge::PortInfo>,
}

#[derive(Deserialize)]
struct HardwareEventBody {
    control: String,
    phase: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsBody {
    micro_bridge_port: String,
}

#[derive(Deserialize)]
struct WindowBody {
    open: bool,
}

#[derive(Deserialize)]
struct AlwaysOnTopBody {
    enabled: bool,
}

#[derive(Deserialize)]
struct FocusCodexBody {
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusCodexResponse {
    ok: bool,
    accessibility_granted: bool,
}

pub fn start(
    app: AppHandle,
    bridge: Arc<Bridge>,
    codex_focus: Arc<CodexFocus>,
    settings_path: PathBuf,
    settings_window: Arc<SettingsWindow>,
) -> Result<Launch, String> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("无法启动本地服务：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法配置本地服务：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("无法读取本地服务地址：{error}"))?
        .port();
    let authority = format!("127.0.0.1:{port}");
    let origin = format!("http://{authority}");
    let session_cookie_name = format!("{SESSION_COOKIE_PREFIX}{port}");
    let desktop_bootstrap_token = random_token();
    let desktop_session_token = random_token();
    let state = AppState {
        app,
        authority,
        origin: origin.clone(),
        session_cookie_name,
        desktop_bootstrap_token: Arc::new(Mutex::new(Some(desktop_bootstrap_token.clone()))),
        desktop_session_token,
        browser_bootstrap_tokens: Arc::new(Mutex::new(HashMap::new())),
        browser_session_tokens: Arc::new(Mutex::new(HashSet::new())),
        bridge,
        codex_focus,
        settings_path,
        settings_window,
    };
    let router = Router::new()
        .route("/__arkey_bootstrap/{token}", get(bootstrap))
        .route("/__arkey_browser/{token}", get(browser_bootstrap))
        .route("/api/snapshot", get(snapshot))
        .route("/api/hardware/ports", get(hardware_ports))
        .route("/api/hardware/event", post(hardware_event))
        .route("/api/settings", post(save_settings))
        .route("/api/window/settings", post(set_settings_open))
        .route("/api/window/always-on-top", post(set_window_always_on_top))
        .route("/api/codex/focus-on-input", post(set_focus_codex_on_input))
        .route("/api/window/start-dragging", post(start_window_drag))
        .route("/api/app/exit", post(exit_app))
        .route("/api/browser/open", post(open_browser))
        .fallback(static_asset)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state);

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Arkey localhost listener failed: {error}");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("Arkey localhost server stopped: {error}");
        }
    });

    Ok(Launch {
        bootstrap_url: format!("{origin}/__arkey_bootstrap/{desktop_bootstrap_token}"),
        origin,
    })
}

async fn bootstrap(
    State(state): State<AppState>,
    AxumPath(token): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !valid_host(&headers, &state) {
        return error(StatusCode::BAD_REQUEST, "无效 Host");
    }
    let mut expected = lock(&state.desktop_bootstrap_token);
    let valid = expected
        .as_deref()
        .is_some_and(|expected| constant_time_eq(expected.as_bytes(), token.as_bytes()));
    if valid {
        expected.take();
        return bootstrap_redirect(
            &state.session_cookie_name,
            Some(&state.desktop_session_token),
        );
    }
    drop(expected);
    if valid_session(&headers, &state).is_some() {
        return bootstrap_redirect(&state.session_cookie_name, None);
    }
    error(StatusCode::NOT_FOUND, "未找到资源")
}

async fn browser_bootstrap(
    State(state): State<AppState>,
    AxumPath(token): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !valid_host(&headers, &state) {
        return error(StatusCode::BAD_REQUEST, "无效 Host");
    }
    let session_token = lock(&state.browser_bootstrap_tokens).remove(&token);
    if let Some(session_token) = session_token {
        lock(&state.browser_session_tokens).insert(session_token.clone());
        return bootstrap_redirect(&state.session_cookie_name, Some(&session_token));
    }
    if valid_session(&headers, &state).is_some() {
        return bootstrap_redirect(&state.session_cookie_name, None);
    }
    error(StatusCode::NOT_FOUND, "未找到资源")
}

async fn snapshot(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let session = match authorize(&headers, &state, false) {
        Ok(session) => session,
        Err(request_error) => return request_error.into_response(),
    };
    json(
        StatusCode::OK,
        &SnapshotBody {
            web: WebSnapshot {
                server_origin: state.origin.clone(),
                desktop: session == SessionKind::Desktop,
                always_on_top: state.settings_window.always_on_top(),
                focus_codex_available: state.codex_focus.available(),
                focus_codex_on_input: state.codex_focus.enabled(),
                accessibility_granted: state.codex_focus.accessibility_granted(),
            },
            hardware: state.bridge.state(),
        },
    )
}

async fn hardware_ports(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(request_error) = authorize(&headers, &state, false) {
        return request_error.into_response();
    }
    match tokio::task::spawn_blocking(bridge::list_ports).await {
        Ok(Ok(ports)) => json(StatusCode::OK, &PortsBody { ports }),
        Ok(Err(message)) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
        Err(join_error) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("无法枚举串口：{join_error}"),
        ),
    }
}

async fn hardware_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(request_error) = authorize(&headers, &state, true) {
        return request_error.into_response();
    }
    let body = match parse_json::<HardwareEventBody>(&headers, &body) {
        Ok(body) => body,
        Err(request_error) => return request_error.into_response(),
    };
    if !bridge::is_control(&body.control) || !bridge::is_phase(&body.phase) {
        return error(StatusCode::BAD_REQUEST, "无效的硬件按键事件");
    }
    if body.phase != "up" {
        state.codex_focus.focus_before_input();
    }
    let receiver = match state.bridge.send(body.control, body.phase) {
        Ok(receiver) => receiver,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    match tokio::task::spawn_blocking(move || wait_for_bridge(receiver)).await {
        Ok(Ok(())) => json(StatusCode::OK, &OkBody { ok: true }),
        Ok(Err(message)) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
        Err(join_error) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("串口桥任务失败：{join_error}"),
        ),
    }
}

async fn save_settings(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(request_error) = authorize(&headers, &state, true) {
        return request_error.into_response();
    }
    let body = match parse_json::<SettingsBody>(&headers, &body) {
        Ok(body) => body,
        Err(request_error) => return request_error.into_response(),
    };
    let port = body.micro_bridge_port.trim().to_owned();
    if let Err(message) = settings::validate_port(&port) {
        return error(StatusCode::BAD_REQUEST, message);
    }
    let settings_path = state.settings_path.clone();
    let saved_settings = settings::Settings {
        micro_bridge_port: port.clone(),
        always_on_top: state.settings_window.always_on_top(),
        focus_codex_on_input: state.codex_focus.enabled(),
    };
    match tokio::task::spawn_blocking(move || settings::write(&settings_path, &saved_settings))
        .await
    {
        Ok(Ok(())) => {}
        Ok(Err(message)) => return error(StatusCode::INTERNAL_SERVER_ERROR, message),
        Err(join_error) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("无法保存设置：{join_error}"),
            )
        }
    }
    match state.bridge.configure(port) {
        Ok(()) => json(StatusCode::OK, &OkBody { ok: true }),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

async fn set_settings_open(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let session = match authorize(&headers, &state, true) {
        Ok(session) => session,
        Err(request_error) => return request_error.into_response(),
    };
    let body = match parse_json::<WindowBody>(&headers, &body) {
        Ok(body) => body,
        Err(request_error) => return request_error.into_response(),
    };
    if session == SessionKind::Browser {
        return json(StatusCode::OK, &OkBody { ok: true });
    }
    let Some(window) = state.app.get_webview_window("main") else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "应用窗口不存在");
    };
    match state.settings_window.set_open(&window, body.open) {
        Ok(()) => json(StatusCode::OK, &OkBody { ok: true }),
        Err(message) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
    }
}

async fn set_window_always_on_top(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let session = match authorize(&headers, &state, true) {
        Ok(session) => session,
        Err(request_error) => return request_error.into_response(),
    };
    if session != SessionKind::Desktop {
        return error(StatusCode::FORBIDDEN, "只有桌面客户端可以调整应用窗口");
    }
    let body = match parse_json::<AlwaysOnTopBody>(&headers, &body) {
        Ok(body) => body,
        Err(request_error) => return request_error.into_response(),
    };
    let Some(window) = state.app.get_webview_window("main") else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "应用窗口不存在");
    };
    let previous = state.settings_window.always_on_top();
    if let Err(message) = state
        .settings_window
        .set_always_on_top(&window, body.enabled)
    {
        return error(StatusCode::INTERNAL_SERVER_ERROR, message);
    }
    let saved_settings = settings::Settings {
        micro_bridge_port: state.bridge.configured_port(),
        always_on_top: body.enabled,
        focus_codex_on_input: state.codex_focus.enabled(),
    };
    let settings_path = state.settings_path.clone();
    match tokio::task::spawn_blocking(move || settings::write(&settings_path, &saved_settings))
        .await
    {
        Ok(Ok(())) => json(StatusCode::OK, &OkBody { ok: true }),
        Ok(Err(message)) => {
            let _ = state.settings_window.set_always_on_top(&window, previous);
            error(StatusCode::INTERNAL_SERVER_ERROR, message)
        }
        Err(join_error) => {
            let _ = state.settings_window.set_always_on_top(&window, previous);
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("无法保存设置：{join_error}"),
            )
        }
    }
}

async fn set_focus_codex_on_input(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let session = match authorize(&headers, &state, true) {
        Ok(session) => session,
        Err(request_error) => return request_error.into_response(),
    };
    if session != SessionKind::Desktop {
        return error(
            StatusCode::FORBIDDEN,
            "只有桌面客户端可以调整 Codex 置前设置",
        );
    }
    if !state.codex_focus.available() {
        return error(StatusCode::BAD_REQUEST, "此功能仅支持 macOS");
    }
    let body = match parse_json::<FocusCodexBody>(&headers, &body) {
        Ok(body) => body,
        Err(request_error) => return request_error.into_response(),
    };
    let accessibility_granted = if body.enabled {
        state.codex_focus.request_accessibility_permission()
    } else {
        state.codex_focus.accessibility_granted()
    };
    let saved_settings = settings::Settings {
        micro_bridge_port: state.bridge.configured_port(),
        always_on_top: state.settings_window.always_on_top(),
        focus_codex_on_input: body.enabled,
    };
    let settings_path = state.settings_path.clone();
    match tokio::task::spawn_blocking(move || settings::write(&settings_path, &saved_settings))
        .await
    {
        Ok(Ok(())) => {
            state.codex_focus.set_enabled(body.enabled);
            json(
                StatusCode::OK,
                &FocusCodexResponse {
                    ok: true,
                    accessibility_granted,
                },
            )
        }
        Ok(Err(message)) => error(StatusCode::INTERNAL_SERVER_ERROR, message),
        Err(join_error) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("无法保存设置：{join_error}"),
        ),
    }
}

async fn start_window_drag(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let session = match authorize(&headers, &state, true) {
        Ok(session) => session,
        Err(request_error) => return request_error.into_response(),
    };
    if session != SessionKind::Desktop {
        return error(StatusCode::FORBIDDEN, "只有桌面客户端可以拖动应用窗口");
    }
    let Some(window) = state.app.get_webview_window("main") else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "应用窗口不存在");
    };
    match window.start_dragging() {
        Ok(()) => json(StatusCode::OK, &OkBody { ok: true }),
        Err(drag_error) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("无法拖动应用窗口：{drag_error}"),
        ),
    }
}

async fn exit_app(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let session = match authorize(&headers, &state, true) {
        Ok(session) => session,
        Err(request_error) => return request_error.into_response(),
    };
    if session != SessionKind::Desktop {
        return error(StatusCode::FORBIDDEN, "只有桌面客户端可以退出应用");
    }

    let app = state.app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(75)).await;
        app.exit(0);
    });
    json(StatusCode::OK, &OkBody { ok: true })
}

async fn open_browser(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let session = match authorize(&headers, &state, true) {
        Ok(session) => session,
        Err(request_error) => return request_error.into_response(),
    };
    if session != SessionKind::Desktop {
        return error(StatusCode::FORBIDDEN, "只有桌面客户端可以创建浏览器会话");
    }

    let bootstrap_token = random_token();
    let session_token = random_token();
    lock(&state.browser_bootstrap_tokens).insert(bootstrap_token.clone(), session_token);
    let url = format!("{}/__arkey_browser/{bootstrap_token}", state.origin);
    if let Err(open_error) = open::that_detached(url) {
        lock(&state.browser_bootstrap_tokens).remove(&bootstrap_token);
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("无法打开浏览器：{open_error}"),
        );
    }
    json(StatusCode::OK, &OkBody { ok: true })
}

async fn static_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    method: Method,
    uri: Uri,
) -> Response {
    if let Err(request_error) = authorize(&headers, &state, false) {
        return request_error.into_response();
    }
    if method != Method::GET && method != Method::HEAD {
        return error(StatusCode::METHOD_NOT_ALLOWED, "不支持的请求方法");
    }
    if uri.path().starts_with("/api/") {
        return error(StatusCode::NOT_FOUND, "未找到接口");
    }

    let requested = uri.path().trim_start_matches('/');
    if unsafe_asset_path(requested) {
        return error(StatusCode::NOT_FOUND, "未找到资源");
    }
    let requested = if requested.is_empty() {
        "index.html"
    } else {
        requested
    };
    let resolver = state.app.asset_resolver();
    let asset = resolver.get(requested.to_owned()).or_else(|| {
        if Path::new(requested).extension().is_none() {
            resolver.get("index.html".to_owned())
        } else {
            None
        }
    });
    let Some(asset) = asset else {
        return error(StatusCode::NOT_FOUND, "未找到资源");
    };

    let is_index = requested == "index.html" || Path::new(requested).extension().is_none();
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(asset.bytes().to_vec())
    };
    let mut response = Response::new(body);
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(asset.mime_type()) {
        headers.insert(CONTENT_TYPE, value);
    }
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(if is_index {
            "no-store"
        } else {
            "public, max-age=31536000, immutable"
        }),
    );
    add_security_headers(response.headers_mut());
    response
}

fn wait_for_bridge(receiver: mpsc::Receiver<Result<(), String>>) -> Result<(), String> {
    receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "开发板确认超时".to_owned())?
}

fn parse_json<T: DeserializeOwned>(headers: &HeaderMap, body: &[u8]) -> Result<T, RequestError> {
    let is_json = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("application/json"));
    if !is_json {
        return Err(RequestError {
            status: StatusCode::UNSUPPORTED_MEDIA_TYPE,
            message: "请求必须是 JSON",
        });
    }
    serde_json::from_slice(body).map_err(|_| RequestError {
        status: StatusCode::BAD_REQUEST,
        message: "请求必须是 JSON 对象",
    })
}

fn authorize(
    headers: &HeaderMap,
    state: &AppState,
    mutating: bool,
) -> Result<SessionKind, RequestError> {
    if !valid_host(headers, state) {
        return Err(RequestError {
            status: StatusCode::BAD_REQUEST,
            message: "无效 Host",
        });
    }
    let session = valid_session(headers, state).ok_or(RequestError {
        status: StatusCode::UNAUTHORIZED,
        message: "客户端会话无效",
    })?;
    if mutating
        && headers.get(ORIGIN).and_then(|value| value.to_str().ok()) != Some(state.origin.as_str())
    {
        return Err(RequestError {
            status: StatusCode::FORBIDDEN,
            message: "请求来源验证失败",
        });
    }
    Ok(session)
}

fn valid_host(headers: &HeaderMap, state: &AppState) -> bool {
    headers.get(HOST).and_then(|value| value.to_str().ok()) == Some(state.authority.as_str())
}

fn valid_session(headers: &HeaderMap, state: &AppState) -> Option<SessionKind> {
    let token = headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (name, value) = cookie.trim().split_once('=')?;
                (name == state.session_cookie_name).then_some(value)
            })
        })?;
    if constant_time_eq(token.as_bytes(), state.desktop_session_token.as_bytes()) {
        return Some(SessionKind::Desktop);
    }
    lock(&state.browser_session_tokens)
        .iter()
        .any(|session| constant_time_eq(token.as_bytes(), session.as_bytes()))
        .then_some(SessionKind::Browser)
}

fn bootstrap_redirect(session_cookie_name: &str, session_token: Option<&str>) -> Response {
    let mut response = StatusCode::SEE_OTHER.into_response();
    response
        .headers_mut()
        .insert(LOCATION, HeaderValue::from_static("/"));
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(token) = session_token {
        if let Ok(value) = HeaderValue::from_str(&format!(
            "{session_cookie_name}={token}; HttpOnly; SameSite=Strict; Path=/"
        )) {
            response.headers_mut().insert(SET_COOKIE, value);
        }
    }
    add_security_headers(response.headers_mut());
    response
}

fn json<T: Serialize>(status: StatusCode, value: &T) -> Response {
    let mut response = (status, Json(value)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    add_security_headers(response.headers_mut());
    response
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    json(
        status,
        &ErrorBody {
            error: message.into().chars().take(400).collect(),
        },
    )
}

fn add_security_headers(headers: &mut HeaderMap) {
    headers.insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
}

fn unsafe_asset_path(path: &str) -> bool {
    path.contains('\\')
        || path
            .split('/')
            .any(|component| matches!(component, "." | ".."))
}

fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(token, "{byte:02x}");
    }
    token
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_comparison_requires_an_exact_match() {
        assert!(constant_time_eq(b"abcdef", b"abcdef"));
        assert!(!constant_time_eq(b"abcdef", b"abcdeg"));
        assert!(!constant_time_eq(b"abcdef", b"abc"));
    }

    #[test]
    fn static_paths_reject_traversal() {
        assert!(!unsafe_asset_path("assets/index.js"));
        assert!(unsafe_asset_path("../settings"));
        assert!(unsafe_asset_path("assets\\settings"));
    }
}
