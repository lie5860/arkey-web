use std::sync::{Mutex, MutexGuard};
use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};

const SETTINGS_WIDTH: f64 = 640.0;
#[cfg(target_os = "macos")]
const SETTINGS_HEIGHT: f64 = 640.0;
#[cfg(not(target_os = "macos"))]
const SETTINGS_HEIGHT: f64 = 560.0;

#[derive(Clone, Copy)]
struct Geometry {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

pub struct SettingsWindow {
    compact_geometry: Mutex<Option<Geometry>>,
    always_on_top: Mutex<bool>,
}

impl SettingsWindow {
    pub fn new(always_on_top: bool) -> Self {
        Self {
            compact_geometry: Mutex::new(None),
            always_on_top: Mutex::new(always_on_top),
        }
    }

    pub fn always_on_top(&self) -> bool {
        *lock(&self.always_on_top)
    }

    pub fn set_always_on_top(&self, window: &WebviewWindow, enabled: bool) -> Result<(), String> {
        window.set_always_on_top(enabled).map_err(window_error)?;
        *lock(&self.always_on_top) = enabled;
        Ok(())
    }

    pub fn set_open(&self, window: &WebviewWindow, open: bool) -> Result<(), String> {
        let mut compact_geometry = lock(&self.compact_geometry);
        if open {
            if compact_geometry.is_some() {
                return Ok(());
            }
            let geometry = Geometry {
                position: window.outer_position().map_err(window_error)?,
                size: window.inner_size().map_err(window_error)?,
            };
            *compact_geometry = Some(geometry);
            if let Err(error) = window
                .set_size(LogicalSize::new(SETTINGS_WIDTH, SETTINGS_HEIGHT))
                .and_then(|()| window.center())
            {
                let _ = window.set_size(geometry.size);
                let _ = window.set_position(geometry.position);
                *compact_geometry = None;
                return Err(window_error(error));
            }
            return Ok(());
        }

        let Some(geometry) = compact_geometry.take() else {
            return Ok(());
        };
        let size_result = window.set_size(geometry.size);
        let position_result = window.set_position(geometry.position);
        size_result.map_err(window_error)?;
        position_result.map_err(window_error)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn window_error(error: tauri::Error) -> String {
    format!("无法调整应用窗口：{error}")
}
