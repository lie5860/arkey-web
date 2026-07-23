use std::sync::{Mutex, MutexGuard};
use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};

#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSWindow, NSWindowCollectionBehavior,
};
#[cfg(target_os = "macos")]
use objc2_foundation::MainThreadMarker;

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
    show_on_all_desktops: Mutex<bool>,
}

impl SettingsWindow {
    pub fn new(always_on_top: bool, show_on_all_desktops: bool) -> Self {
        Self {
            compact_geometry: Mutex::new(None),
            always_on_top: Mutex::new(always_on_top),
            show_on_all_desktops: Mutex::new(show_on_all_desktops),
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

    pub fn show_on_all_desktops_available(&self) -> bool {
        cfg!(target_os = "macos")
    }

    pub fn show_on_all_desktops(&self) -> bool {
        *lock(&self.show_on_all_desktops)
    }

    pub fn set_show_on_all_desktops(
        &self,
        window: &WebviewWindow,
        enabled: bool,
    ) -> Result<(), String> {
        if !self.show_on_all_desktops_available() {
            return Err("跨桌面显示仅支持 macOS".to_owned());
        }
        let previous = self.show_on_all_desktops();
        if let Err(error) = window.set_visible_on_all_workspaces(enabled) {
            return Err(window_error(error));
        }
        #[cfg(target_os = "macos")]
        if let Err(message) = set_macos_all_desktops_behavior(window, enabled) {
            let _ = window.set_visible_on_all_workspaces(previous);
            let _ = set_macos_all_desktops_behavior(window, previous);
            return Err(message);
        }
        *lock(&self.show_on_all_desktops) = enabled;
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

#[cfg(target_os = "macos")]
fn set_macos_all_desktops_behavior(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
    let native_window = window.clone();
    window
        .run_on_main_thread(move || {
            let Ok(pointer) = native_window.ns_window() else {
                return;
            };
            set_macos_activation_policy_now(enabled);
            let window = unsafe { &*pointer.cast::<NSWindow>() };
            window
                .setCollectionBehavior(all_desktops_behavior(window.collectionBehavior(), enabled));
            if enabled {
                window.orderFrontRegardless();
            }
        })
        .map_err(window_error)
}

#[cfg(target_os = "macos")]
fn set_macos_activation_policy_now(enabled: bool) {
    let policy = if enabled {
        NSApplicationActivationPolicy::Accessory
    } else {
        NSApplicationActivationPolicy::Regular
    };
    let marker = unsafe { MainThreadMarker::new_unchecked() };
    let _ = NSApplication::sharedApplication(marker).setActivationPolicy(policy);
}

#[cfg(target_os = "macos")]
fn all_desktops_behavior(
    mut behavior: NSWindowCollectionBehavior,
    enabled: bool,
) -> NSWindowCollectionBehavior {
    behavior.set(NSWindowCollectionBehavior::CanJoinAllSpaces, enabled);
    behavior.set(NSWindowCollectionBehavior::FullScreenAuxiliary, enabled);
    behavior
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn window_error(error: tauri::Error) -> String {
    format!("无法调整应用窗口：{error}")
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn all_desktops_behavior_includes_full_screen_spaces() {
        let original = NSWindowCollectionBehavior::IgnoresCycle;
        let enabled = all_desktops_behavior(original, true);
        assert!(enabled.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
        assert!(enabled.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
        assert!(enabled.contains(NSWindowCollectionBehavior::IgnoresCycle));

        assert_eq!(all_desktops_behavior(enabled, false), original);
    }
}
