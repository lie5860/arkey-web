use serde::Serialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

const SETTINGS_FILE: &str = "web-settings-v1.json";
const MAX_PORT_LENGTH: usize = 1_024;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Settings {
    pub micro_bridge_port: String,
    pub always_on_top: bool,
    pub focus_codex_on_input: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings<'a> {
    version: u8,
    micro_bridge_port: &'a str,
    always_on_top: bool,
    focus_codex_on_input: bool,
}

pub fn path(home: &Path) -> PathBuf {
    home.join(".arkey").join(SETTINGS_FILE)
}

pub fn read(path: &Path) -> Settings {
    let Ok(contents) = fs::read_to_string(path) else {
        return Settings::default();
    };
    let Ok(value) = serde_json::from_str::<Value>(&contents) else {
        return Settings::default();
    };
    if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Settings::default();
    }
    let micro_bridge_port = value
        .get("microBridgePort")
        .and_then(Value::as_str)
        .filter(|port| port.chars().count() <= MAX_PORT_LENGTH)
        .unwrap_or_default()
        .to_owned();
    let always_on_top = value
        .get("alwaysOnTop")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let focus_codex_on_input = value
        .get("focusCodexOnInput")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Settings {
        micro_bridge_port,
        always_on_top,
        focus_codex_on_input,
    }
}

pub fn validate_port(port: &str) -> Result<(), String> {
    if port.chars().count() > MAX_PORT_LENGTH {
        return Err("串口路径过长".to_owned());
    }
    if port.is_empty() || Path::new(port).is_absolute() || is_windows_com_port(port) {
        return Ok(());
    }
    Err("串口路径必须是绝对路径".to_owned())
}

#[cfg(windows)]
fn is_windows_com_port(port: &str) -> bool {
    let Some(number) = port
        .strip_prefix("COM")
        .or_else(|| port.strip_prefix("com"))
    else {
        return false;
    };
    !number.is_empty() && number.chars().all(|character| character.is_ascii_digit())
}

#[cfg(not(windows))]
fn is_windows_com_port(_port: &str) -> bool {
    false
}

pub fn write(path: &Path, settings: &Settings) -> Result<(), String> {
    validate_port(&settings.micro_bridge_port)?;
    let parent = path.parent().ok_or_else(|| "设置路径无效".to_owned())?;

    #[cfg(unix)]
    {
        let mut builder = fs::DirBuilder::new();
        builder
            .recursive(true)
            .mode(0o700)
            .create(parent)
            .map_err(|error| format!("无法创建设置目录：{error}"))?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(parent).map_err(|error| format!("无法创建设置目录：{error}"))?;

    let encoded = serde_json::to_string_pretty(&StoredSettings {
        version: 1,
        micro_bridge_port: &settings.micro_bridge_port,
        always_on_top: settings.always_on_top,
        focus_codex_on_input: settings.focus_codex_on_input,
    })
    .map_err(|error| format!("无法编码设置：{error}"))?;

    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|error| format!("无法保存设置：{error}"))?;
    file.write_all(format!("{encoded}\n").as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("无法保存设置：{error}"))?;

    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("无法保护设置文件：{error}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_the_existing_port_setting() {
        let unique = format!("arkey-settings-{}-{}.json", std::process::id(), 17);
        let path = std::env::temp_dir().join(unique);
        fs::write(
            &path,
            r#"{"version":1,"microBridgePort":"/dev/test","legacyField":true}"#,
        )
        .unwrap();
        assert_eq!(
            read(&path),
            Settings {
                micro_bridge_port: "/dev/test".to_owned(),
                always_on_top: false,
                focus_codex_on_input: false,
            }
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_the_persisted_window_preference() {
        let unique = format!("arkey-settings-{}-{}.json", std::process::id(), 18);
        let path = std::env::temp_dir().join(unique);
        fs::write(
            &path,
            r#"{"version":1,"microBridgePort":"/dev/test","alwaysOnTop":true}"#,
        )
        .unwrap();
        assert!(read(&path).always_on_top);
        assert!(!read(&path).focus_codex_on_input);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_the_persisted_codex_focus_preference() {
        let unique = format!("arkey-settings-{}-{}.json", std::process::id(), 20);
        let path = std::env::temp_dir().join(unique);
        fs::write(
            &path,
            r#"{"version":1,"microBridgePort":"/dev/test","focusCodexOnInput":true}"#,
        )
        .unwrap();
        assert!(read(&path).focus_codex_on_input);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn writes_and_reads_all_preferences() {
        let unique = format!("arkey-settings-{}-{}.json", std::process::id(), 19);
        let path = std::env::temp_dir().join(unique);
        let expected = Settings {
            micro_bridge_port: "/dev/test".to_owned(),
            always_on_top: true,
            focus_codex_on_input: true,
        };
        write(&path, &expected).unwrap();
        assert_eq!(read(&path), expected);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_relative_serial_paths() {
        assert!(validate_port("").is_ok());
        assert!(validate_port("/dev/cu.usbmodem-test").is_ok());
        assert!(validate_port("relative/device").is_err());
    }
}
