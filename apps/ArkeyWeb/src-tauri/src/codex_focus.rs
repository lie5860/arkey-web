use std::sync::{Mutex, MutexGuard};

pub struct CodexFocus {
    enabled: Mutex<bool>,
}

impl CodexFocus {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: Mutex::new(enabled),
        }
    }

    pub fn available(&self) -> bool {
        cfg!(any(target_os = "macos", target_os = "windows"))
    }

    pub fn enabled(&self) -> bool {
        *lock(&self.enabled)
    }

    pub fn set_enabled(&self, enabled: bool) {
        *lock(&self.enabled) = enabled;
    }

    pub fn accessibility_granted(&self) -> bool {
        platform::accessibility_granted(false)
    }

    pub fn request_accessibility_permission(&self) -> bool {
        platform::accessibility_granted(true)
    }

    pub fn focus_before_input(&self) {
        if self.enabled() {
            let _ = platform::focus_codex();
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::boolean::{kCFBooleanFalse, kCFBooleanTrue, CFBoolean};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    use objc2_foundation::NSString;
    use std::ffi::c_void;
    use std::ptr;

    const CODEX_BUNDLE_ID: &str = "com.openai.codex";
    const AX_SUCCESS: i32 = 0;

    type AXUIElementRef = *const c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;

        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        fn AXUIElementCreateApplication(pid: libc::pid_t) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: CFTypeRef,
        ) -> i32;
        fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> i32;
    }

    pub fn accessibility_granted(prompt: bool) -> bool {
        let prompt_key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
        let prompt_value = CFBoolean::from(prompt);
        let options = CFDictionary::from_CFType_pairs(&[(prompt_key, prompt_value)]);
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0 }
    }

    pub fn focus_codex() -> Result<(), String> {
        if !accessibility_granted(false) {
            return Err("尚未获得辅助功能权限".to_owned());
        }

        let bundle_id = NSString::from_str(CODEX_BUNDLE_ID);
        let applications =
            NSRunningApplication::runningApplicationsWithBundleIdentifier(&bundle_id);
        let Some(application) = applications.iter().next() else {
            return Err("Codex Desktop 未运行".to_owned());
        };

        application.unhide();
        restore_main_window(application.processIdentifier());
        if !application.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows) {
            return Err("macOS 未允许激活 Codex Desktop".to_owned());
        }
        Ok(())
    }

    fn restore_main_window(pid: libc::pid_t) {
        let application = unsafe { AXUIElementCreateApplication(pid) };
        if application.is_null() {
            return;
        }

        let frontmost = CFString::from_static_string("AXFrontmost");
        unsafe {
            AXUIElementSetAttributeValue(
                application,
                frontmost.as_concrete_TypeRef(),
                kCFBooleanTrue as CFTypeRef,
            );
        }

        let window = copy_attribute(application, "AXMainWindow")
            .or_else(|| copy_attribute(application, "AXFocusedWindow"));
        if let Some(window) = window {
            let minimized = CFString::from_static_string("AXMinimized");
            let main = CFString::from_static_string("AXMain");
            let raise = CFString::from_static_string("AXRaise");
            unsafe {
                AXUIElementSetAttributeValue(
                    window as AXUIElementRef,
                    minimized.as_concrete_TypeRef(),
                    kCFBooleanFalse as CFTypeRef,
                );
                AXUIElementSetAttributeValue(
                    window as AXUIElementRef,
                    main.as_concrete_TypeRef(),
                    kCFBooleanTrue as CFTypeRef,
                );
                AXUIElementPerformAction(window as AXUIElementRef, raise.as_concrete_TypeRef());
                CFRelease(window);
            }
        }

        unsafe { CFRelease(application as CFTypeRef) };
    }

    fn copy_attribute(element: AXUIElementRef, name: &'static str) -> Option<CFTypeRef> {
        let attribute = CFString::from_static_string(name);
        let mut value = ptr::null();
        let result = unsafe {
            AXUIElementCopyAttributeValue(element, attribute.as_concrete_TypeRef(), &mut value)
        };
        (result == AX_SUCCESS && !value.is_null()).then_some(value)
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::path::Path;
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindowAsync, SW_RESTORE,
    };

    pub fn accessibility_granted(_prompt: bool) -> bool {
        true
    }

    pub fn focus_codex() -> Result<(), String> {
        let mut codex_window = None;
        unsafe {
            EnumWindows(
                Some(find_codex_window),
                LPARAM((&mut codex_window as *mut Option<HWND>) as isize),
            )
            .map_err(|error| format!("枚举桌面窗口失败：{error}"))?;
        }

        let Some(window) = codex_window else {
            return Err("Codex Desktop 未运行或没有可见窗口".to_owned());
        };

        unsafe {
            if IsIconic(window).as_bool() {
                let _ = ShowWindowAsync(window, SW_RESTORE);
            }
            let _ = BringWindowToTop(window);
            if !SetForegroundWindow(window).as_bool() {
                return Err("Windows 未允许激活 Codex Desktop".to_owned());
            }
        }
        Ok(())
    }

    unsafe extern "system" fn find_codex_window(window: HWND, state: LPARAM) -> BOOL {
        let result = unsafe { &mut *(state.0 as *mut Option<HWND>) };
        if result.is_none()
            && unsafe { IsWindowVisible(window).as_bool() }
            && is_codex_window(window)
        {
            *result = Some(window);
        }
        BOOL(1)
    }

    fn is_codex_window(window: HWND) -> bool {
        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
        process_id != 0
            && process_image_path(process_id)
                .as_deref()
                .is_some_and(is_codex_desktop_executable)
    }

    fn process_image_path(process_id: u32) -> Option<String> {
        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()? };
        let mut path = vec![0_u16; 32_768];
        let mut length = path.len() as u32;
        let result = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(path.as_mut_ptr()),
                &mut length,
            )
        };
        let _ = unsafe { CloseHandle(process) };
        result.ok()?;
        String::from_utf16(&path[..length as usize]).ok()
    }

    fn is_codex_desktop_executable(path: &str) -> bool {
        let normalized = path.replace('/', "\\").to_ascii_lowercase();
        let file_name = Path::new(&normalized)
            .file_name()
            .and_then(|name| name.to_str());
        let supported_executable = matches!(file_name, Some("chatgpt.exe" | "codex.exe"));
        supported_executable
            && (normalized.contains("\\openai.codex_")
                || normalized.contains("\\openai\\codex\\")
                || normalized.contains("\\codex\\"))
    }

    #[cfg(test)]
    mod tests {
        use super::is_codex_desktop_executable;

        #[test]
        fn recognizes_the_packaged_codex_desktop_host() {
            assert!(is_codex_desktop_executable(
                r"C:\Program Files\WindowsApps\OpenAI.Codex_1.0_x64__test\app\ChatGPT.exe"
            ));
            assert!(is_codex_desktop_executable(
                r"C:\Users\test\AppData\Local\OpenAI\Codex\Codex.exe"
            ));
        }

        #[test]
        fn rejects_unrelated_chatgpt_and_codex_processes() {
            assert!(!is_codex_desktop_executable(
                r"C:\Program Files\WindowsApps\OpenAI.ChatGPT_1.0_x64__test\app\ChatGPT.exe"
            ));
            assert!(!is_codex_desktop_executable(r"C:\tools\codex.exe"));
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn accessibility_granted(_prompt: bool) -> bool {
        false
    }

    pub fn focus_codex() -> Result<(), String> {
        Err("此功能仅支持 macOS 和 Windows".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preference_is_disabled_by_default() {
        let focus = CodexFocus::new(false);
        assert!(!focus.enabled());
        focus.set_enabled(true);
        assert!(focus.enabled());
    }
}
