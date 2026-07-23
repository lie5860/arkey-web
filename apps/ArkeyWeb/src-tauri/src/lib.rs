mod bridge;
mod codex_focus;
mod http_server;
mod settings;
mod window;

use std::io;
use std::sync::Arc;
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const COMPACT_WIDTH: f64 = 288.0;
const COMPACT_HEIGHT: f64 = 285.0;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .setup(|app| {
            let home = app.path().home_dir()?;
            let settings_path = settings::path(&home);
            let saved_settings = settings::read(&settings_path);
            let configured_port = saved_settings.micro_bridge_port.clone();
            let always_on_top = saved_settings.always_on_top;
            let show_on_all_desktops = saved_settings.show_on_all_desktops;
            let focus_codex_on_input = saved_settings.focus_codex_on_input;
            let bridge = Arc::new(bridge::Bridge::start(configured_port));
            let codex_focus = Arc::new(codex_focus::CodexFocus::new(focus_codex_on_input));
            let settings_window = Arc::new(window::SettingsWindow::new(
                always_on_top,
                show_on_all_desktops,
            ));
            #[cfg(target_os = "macos")]
            if show_on_all_desktops {
                app.handle()
                    .set_activation_policy(ActivationPolicy::Accessory)?;
            }
            let launch = http_server::start(
                app.handle().clone(),
                bridge,
                codex_focus,
                settings_path,
                settings_window.clone(),
            )
            .map_err(io::Error::other)?;
            let bootstrap_url = launch
                .bootstrap_url
                .parse()
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            let allowed_origin = launch.origin;

            let window_builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(bootstrap_url));
            #[cfg(target_os = "macos")]
            let window_builder = window_builder.visible_on_all_workspaces(show_on_all_desktops);
            let window = window_builder
                .title("Arkey")
                .inner_size(COMPACT_WIDTH, COMPACT_HEIGHT)
                .center()
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(always_on_top)
                .resizable(false)
                .maximizable(false)
                .fullscreen(false)
                .prevent_overflow()
                .on_navigation(move |url| {
                    url.as_str() == allowed_origin
                        || url
                            .as_str()
                            .strip_prefix(&allowed_origin)
                            .is_some_and(|path| path.starts_with('/'))
                })
                .build()?;
            #[cfg(target_os = "macos")]
            settings_window
                .set_show_on_all_desktops(&window, show_on_all_desktops)
                .map_err(io::Error::other)?;
            let blur_window = window.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Focused(false)) {
                    let _ =
                        blur_window.eval("window.dispatchEvent(new Event('arkey-window-blur'))");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Arkey desktop application");
}
