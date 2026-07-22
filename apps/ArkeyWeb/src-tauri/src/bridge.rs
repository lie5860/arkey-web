use serde::Serialize;
use serde_json::{json, Map, Value};
use serialport::{SerialPort, SerialPortType};
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const BAUD_RATE: u32 = 115_200;
const MAX_LINE_BYTES: usize = 16 * 1024;
const ACK_TIMEOUT: Duration = Duration::from_secs(2);
const ACK_RETRY_AFTER: Duration = Duration::from_millis(250);
const DISCOVERY_ACK_TIMEOUT: Duration = Duration::from_millis(750);
const DISCOVERY_RETRY_AFTER: Duration = Duration::from_millis(200);
const RECONNECT_INTERVAL: Duration = Duration::from_millis(2_500);
const SERIAL_READ_TIMEOUT: Duration = Duration::from_millis(20);

const CONTROLS: [&str; 19] = [
    "agent-1",
    "agent-2",
    "agent-3",
    "agent-4",
    "agent-5",
    "agent-6",
    "fast",
    "approve",
    "decline",
    "continue",
    "ptt",
    "send",
    "reasoning-press",
    "encoder-cw",
    "encoder-ccw",
    "joystick-up",
    "joystick-right",
    "joystick-down",
    "joystick-left",
];

const PHASES: [&str; 3] = ["down", "up", "tap"];

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Connection {
    Disabled,
    Offline,
    Connecting,
    Ready,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotLight {
    slot: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    brightness: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effect: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    enabled: bool,
    connection: Connection,
    configured_port: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    firmware_version: Option<String>,
    usb_mounted: bool,
    desktop_connected: bool,
    slot_lights: Vec<SlotLight>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

impl State {
    fn new(configured_port: String) -> Self {
        Self {
            enabled: !configured_port.is_empty(),
            connection: if configured_port.is_empty() {
                Connection::Disabled
            } else {
                Connection::Offline
            },
            configured_port,
            firmware_version: None,
            usb_mounted: false,
            desktop_connected: false,
            slot_lights: Vec::new(),
            last_error: None,
        }
    }

    fn reset(&mut self, configured_port: String) {
        *self = Self::new(configured_port);
    }

    fn clear_device_status(&mut self) {
        self.firmware_version = None;
        self.usb_mounted = false;
        self.desktop_connected = false;
        self.slot_lights.clear();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vendor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    product_id: Option<String>,
}

enum Command {
    Configure(String),
    Send {
        control: String,
        phase: String,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Stop,
}

pub struct Bridge {
    state: Arc<Mutex<State>>,
    commands: mpsc::Sender<Command>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Bridge {
    pub fn start(configured_port: String) -> Self {
        let state = Arc::new(Mutex::new(State::new(configured_port.clone())));
        let (commands, receiver) = mpsc::channel();
        let worker_state = Arc::clone(&state);
        let worker = thread::Builder::new()
            .name("arkey-usb-control".to_owned())
            .spawn(move || Worker::new(configured_port, worker_state, receiver).run())
            .expect("failed to start the Arkey USB control thread");
        Self {
            state,
            commands,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn state(&self) -> State {
        lock(&self.state).clone()
    }

    pub fn configured_port(&self) -> String {
        lock(&self.state).configured_port.clone()
    }

    pub fn configure(&self, configured_port: String) -> Result<(), String> {
        {
            let mut state = lock(&self.state);
            if state.configured_port == configured_port && !configured_port.is_empty() {
                return Ok(());
            }
            if state.configured_port != configured_port {
                state.reset(configured_port.clone());
            }
        }
        self.commands
            .send(Command::Configure(configured_port))
            .map_err(|_| "USB 控制通道已停止".to_owned())
    }

    pub fn send(
        &self,
        control: String,
        phase: String,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        if !is_control(&control) || !is_phase(&phase) {
            return Err("无效的硬件按键事件".to_owned());
        }
        let (reply, receiver) = mpsc::channel();
        self.commands
            .send(Command::Send {
                control,
                phase,
                reply,
            })
            .map_err(|_| "USB 控制通道已停止".to_owned())?;
        Ok(receiver)
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Stop);
        if let Some(worker) = lock(&self.worker).take() {
            let _ = worker.join();
        }
    }
}

pub fn is_control(value: &str) -> bool {
    CONTROLS.contains(&value)
}

pub fn is_phase(value: &str) -> bool {
    PHASES.contains(&value)
}

pub fn list_ports() -> Result<Vec<PortInfo>, String> {
    let mut ports = serialport::available_ports()
        .map_err(|error| format!("无法枚举 USB 控制端口：{error}"))?
        .into_iter()
        .filter(|port| preferred_usb_port_path(&port.port_name))
        .filter_map(|port| {
            let SerialPortType::UsbPort(usb) = port.port_type else {
                return None;
            };
            Some(PortInfo {
                path: port.port_name,
                manufacturer: usb
                    .manufacturer
                    .filter(|value| !value.is_empty())
                    .map(|value| truncate(value, 200)),
                vendor_id: Some(format!("{:04X}", usb.vid)),
                product_id: Some(format!("{:04X}", usb.pid)),
            })
        })
        .collect::<Vec<_>>();
    ports.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(ports)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn truncate(value: String, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

struct Worker {
    configured_port: String,
    state: Arc<Mutex<State>>,
    commands: mpsc::Receiver<Command>,
    port: Option<Box<dyn SerialPort>>,
    decoder: LineDecoder,
    sequence: u32,
    next_reconnect: Instant,
    discover_on_start: bool,
}

impl Worker {
    fn new(
        configured_port: String,
        state: Arc<Mutex<State>>,
        commands: mpsc::Receiver<Command>,
    ) -> Self {
        Self {
            configured_port,
            state,
            commands,
            port: None,
            decoder: LineDecoder::default(),
            sequence: 0,
            next_reconnect: Instant::now(),
            discover_on_start: true,
        }
    }

    fn run(mut self) {
        loop {
            while let Ok(command) = self.commands.try_recv() {
                if self.handle_command(command) {
                    self.disconnect(Connection::Disabled);
                    return;
                }
            }

            if self.port.is_none() && Instant::now() >= self.next_reconnect {
                if self.configured_port.is_empty() {
                    if self.discover_on_start {
                        self.discover(None);
                        self.discover_on_start = false;
                    }
                } else {
                    let preferred = self.configured_port.clone();
                    let connected = self.connect();
                    if !connected && self.discover_on_start {
                        self.discover(Some(&preferred));
                        self.discover_on_start = false;
                    }
                }
            }

            if self.port.is_some() {
                self.read_once();
            } else {
                match self.commands.recv_timeout(Duration::from_millis(50)) {
                    Ok(command) => {
                        if self.handle_command(command) {
                            return;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    }

    fn handle_command(&mut self, command: Command) -> bool {
        match command {
            Command::Configure(configured_port) => {
                if configured_port == self.configured_port {
                    if configured_port.is_empty() {
                        self.discover_on_start = true;
                        self.next_reconnect = Instant::now();
                    }
                    return false;
                }
                self.port = None;
                self.decoder = LineDecoder::default();
                self.configured_port = configured_port.clone();
                lock(&self.state).reset(configured_port);
                self.next_reconnect = Instant::now();
                self.discover_on_start = self.configured_port.is_empty();
                false
            }
            Command::Send {
                control,
                phase,
                reply,
            } => {
                let result = self.send_input(&control, &phase);
                let _ = reply.send(result);
                false
            }
            Command::Stop => true,
        }
    }

    fn connect(&mut self) -> bool {
        lock(&self.state).connection = Connection::Connecting;
        let result = serialport::new(&self.configured_port, BAUD_RATE)
            .timeout(SERIAL_READ_TIMEOUT)
            .open();
        let port = match result {
            Ok(port) => port,
            Err(error) => {
                self.fail(error.to_string());
                return false;
            }
        };
        let mut port = port;
        if let Err(error) = port.write_data_terminal_ready(true) {
            self.fail(format!("无法启用 USB 控制设备：{error}"));
            return false;
        }

        self.port = Some(port);
        self.decoder = LineDecoder::default();
        {
            let mut state = lock(&self.state);
            state.connection = Connection::Ready;
            state.last_error = None;
        }
        let sequence = self.next_sequence();
        let payload = json!({ "command": "hello", "sequence": sequence });
        if let Err(error) = self.write_and_wait_for_ack(&payload, sequence) {
            self.fail(error);
            return false;
        }
        true
    }

    fn discover(&mut self, excluded: Option<&str>) {
        {
            let mut state = lock(&self.state);
            state.connection = Connection::Connecting;
            state.last_error = None;
            state.clear_device_status();
        }
        let candidates = match usb_port_paths(excluded) {
            Ok(candidates) => candidates,
            Err(error) => {
                self.discovery_failed(error);
                return;
            }
        };
        let mut matches = Vec::new();
        for candidate in candidates {
            let sequence = self.next_sequence();
            if probe_arkey_port(&candidate, sequence) {
                matches.push(candidate);
            }
        }
        match matches.as_slice() {
            [path] => {
                self.configured_port = path.clone();
                lock(&self.state).reset(path.clone());
                self.next_reconnect = Instant::now();
                self.connect();
            }
            [] => self.discovery_failed("未发现可连接的 Arkey 设备".to_owned()),
            _ => self.discovery_failed("检测到多个 Arkey 设备，请在设置中选择".to_owned()),
        }
    }

    fn discovery_failed(&mut self, error: String) {
        let mut state = lock(&self.state);
        state.connection = Connection::Error;
        state.last_error = Some(error);
        state.clear_device_status();
    }

    fn send_input(&mut self, control: &str, phase: &str) -> Result<(), String> {
        if !is_control(control) || !is_phase(phase) {
            return Err("无效的硬件按键事件".to_owned());
        }
        let current = lock(&self.state).clone();
        if self.port.is_none() || current.connection != Connection::Ready {
            return Err("ESP32-S3 USB 控制通道未连接".to_owned());
        }
        if !current.usb_mounted || !current.desktop_connected {
            return Err("Codex Desktop 尚未连接到开发板的原生 USB 端口".to_owned());
        }
        let sequence = self.next_sequence();
        let payload = json!({
            "command": "input",
            "sequence": sequence,
            "control": control,
            "phase": phase,
        });
        self.write_and_wait_for_ack(&payload, sequence)
    }

    fn write_and_wait_for_ack(&mut self, payload: &Value, sequence: u32) -> Result<(), String> {
        let line = format!("{payload}\n");
        self.write_line(&line)?;
        let started = Instant::now();
        let mut retried = false;
        let mut buffer = [0_u8; 1_024];

        loop {
            let elapsed = started.elapsed();
            if elapsed >= ACK_TIMEOUT {
                return Err("开发板确认超时".to_owned());
            }
            if !retried && elapsed >= ACK_RETRY_AFTER {
                self.write_line(&line)?;
                retried = true;
            }

            let read = {
                let port = self
                    .port
                    .as_mut()
                    .ok_or_else(|| "ESP32-S3 USB 控制通道未连接".to_owned())?;
                port.read(&mut buffer)
            };
            match read {
                Ok(0) => {}
                Ok(length) => {
                    let messages = self.decoder.append(&buffer[..length]);
                    let mut acknowledgement = None;
                    for message in messages {
                        if let Some(result) = self.handle_message(message, Some(sequence)) {
                            acknowledgement = Some(result);
                        }
                    }
                    if let Some(result) = acknowledgement {
                        return result;
                    }
                }
                Err(error) if is_timeout(&error) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    fn write_line(&mut self, line: &str) -> Result<(), String> {
        let port = self
            .port
            .as_mut()
            .ok_or_else(|| "ESP32-S3 USB 控制通道未连接".to_owned())?;
        port.write_all(line.as_bytes())
            .and_then(|()| port.flush())
            .map_err(|error| error.to_string())
    }

    fn read_once(&mut self) {
        let mut buffer = [0_u8; 1_024];
        let read = self
            .port
            .as_mut()
            .expect("port checked above")
            .read(&mut buffer);
        match read {
            Ok(0) => {}
            Ok(length) => {
                for message in self.decoder.append(&buffer[..length]) {
                    self.handle_message(message, None);
                }
            }
            Err(error) if is_timeout(&error) => {}
            Err(error) => self.fail(error.to_string()),
        }
    }

    fn handle_message(
        &mut self,
        message: Value,
        expected_sequence: Option<u32>,
    ) -> Option<Result<(), String>> {
        let object = message.as_object()?;
        match object.get("event").and_then(Value::as_str) {
            Some("ack") => {
                let sequence =
                    u32::try_from(object.get("sequence").and_then(Value::as_u64)?).ok()?;
                if Some(sequence) != expected_sequence {
                    return None;
                }
                if object.get("ok").and_then(Value::as_bool) == Some(true) {
                    Some(Ok(()))
                } else {
                    let error = object.get("error").and_then(Value::as_str);
                    Some(Err(ack_error(error).to_owned()))
                }
            }
            Some("bridge") => {
                let mut state = lock(&self.state);
                state.firmware_version = object
                    .get("firmwareVersion")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(|value| value.chars().take(100).collect());
                state.usb_mounted = object.get("usbMounted").and_then(Value::as_bool) == Some(true);
                state.desktop_connected =
                    object.get("desktopConnected").and_then(Value::as_bool) == Some(true);
                None
            }
            Some("slot_status") => {
                if let Some(lights) = object.get("slots").and_then(sanitize_slot_lights) {
                    merge_slot_lights(&mut lock(&self.state).slot_lights, lights);
                }
                None
            }
            _ => None,
        }
    }

    fn next_sequence(&mut self) -> u32 {
        self.sequence = (self.sequence + 1) % 0x7fff_ffff;
        self.sequence
    }

    fn fail(&mut self, error: String) {
        self.port = None;
        self.decoder = LineDecoder::default();
        self.next_reconnect = Instant::now() + RECONNECT_INTERVAL;
        let mut state = lock(&self.state);
        state.connection = Connection::Error;
        state.last_error = Some(error.chars().take(400).collect());
        state.clear_device_status();
    }

    fn disconnect(&mut self, connection: Connection) {
        self.port = None;
        let mut state = lock(&self.state);
        state.connection = connection;
        state.clear_device_status();
    }
}

fn usb_port_paths(excluded: Option<&str>) -> Result<Vec<String>, String> {
    let mut paths = serialport::available_ports()
        .map_err(|error| format!("无法枚举 USB 控制端口：{error}"))?
        .into_iter()
        .filter(|port| matches!(&port.port_type, SerialPortType::UsbPort(_)))
        .filter(|port| preferred_usb_port_path(&port.port_name))
        .map(|port| port.port_name)
        .filter(|path| excluded != Some(path.as_str()))
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn preferred_usb_port_path(path: &str) -> bool {
    #[cfg(target_os = "macos")]
    return !path.starts_with("/dev/tty.");

    #[cfg(not(target_os = "macos"))]
    return true;
}

fn probe_arkey_port(path: &str, sequence: u32) -> bool {
    let Ok(mut port) = serialport::new(path, BAUD_RATE)
        .timeout(SERIAL_READ_TIMEOUT)
        .open()
    else {
        return false;
    };
    if port.write_data_terminal_ready(true).is_err() {
        return false;
    }
    let line = format!("{}\n", json!({ "command": "hello", "sequence": sequence }));
    if port
        .write_all(line.as_bytes())
        .and_then(|()| port.flush())
        .is_err()
    {
        return false;
    }

    let started = Instant::now();
    let mut retried = false;
    let mut decoder = LineDecoder::default();
    let mut buffer = [0_u8; 1_024];
    loop {
        let elapsed = started.elapsed();
        if elapsed >= DISCOVERY_ACK_TIMEOUT {
            return false;
        }
        if !retried && elapsed >= DISCOVERY_RETRY_AFTER {
            if port
                .write_all(line.as_bytes())
                .and_then(|()| port.flush())
                .is_err()
            {
                return false;
            }
            retried = true;
        }
        match port.read(&mut buffer) {
            Ok(0) => {}
            Ok(length) => {
                if decoder
                    .append(&buffer[..length])
                    .iter()
                    .any(|message| successful_hello_ack(message, sequence))
                {
                    return true;
                }
            }
            Err(error) if is_timeout(&error) => {}
            Err(_) => return false,
        }
    }
}

fn successful_hello_ack(message: &Value, sequence: u32) -> bool {
    message.get("event").and_then(Value::as_str) == Some("ack")
        && message.get("sequence").and_then(Value::as_u64) == Some(u64::from(sequence))
        && message.get("ok").and_then(Value::as_bool) == Some(true)
}

fn is_timeout(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
    )
}

fn ack_error(value: Option<&str>) -> &'static str {
    match value {
        Some("desktop_not_connected") => "Codex Desktop 尚未连接到开发板的原生 USB 端口",
        Some("queue_full") => "开发板的按键队列已满",
        Some("invalid_input") => "开发板拒绝了无效按键事件",
        Some("sequence_conflict") => "开发板拒绝了冲突的按键序号",
        _ => "开发板拒绝了控制命令",
    }
}

fn sanitize_slot_lights(value: &Value) -> Option<Vec<SlotLight>> {
    let items = value.as_array()?;
    let mut by_slot = BTreeMap::new();
    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(slot) = number(object, "slot") else {
            continue;
        };
        if slot.fract() != 0.0 || !(0.0..=5.0).contains(&slot) {
            continue;
        }
        let slot = slot as u8;
        let update = SlotLight {
            slot,
            color: number(object, "c").map(|value| value.clamp(0.0, 16_777_215.0).floor() as u32),
            brightness: number(object, "b").map(|value| value.clamp(0.0, 1.0)),
            effect: number(object, "e").map(|value| value.clamp(0.0, 255.0).floor() as u8),
            speed: number(object, "s").map(|value| value.clamp(0.0, 1.0)),
        };
        let previous = by_slot.remove(&slot);
        by_slot.insert(slot, merge_slot_light(previous, update));
    }
    Some(by_slot.into_values().collect())
}

fn merge_slot_light(previous: Option<SlotLight>, update: SlotLight) -> SlotLight {
    let Some(previous) = previous else {
        return update;
    };
    SlotLight {
        slot: update.slot,
        color: update.color.or(previous.color),
        brightness: update.brightness.or(previous.brightness),
        effect: update.effect.or(previous.effect),
        speed: update.speed.or(previous.speed),
    }
}

fn merge_slot_lights(current: &mut Vec<SlotLight>, updates: Vec<SlotLight>) {
    let mut by_slot: BTreeMap<_, _> = std::mem::take(current)
        .into_iter()
        .map(|light| (light.slot, light))
        .collect();
    for update in updates {
        let previous = by_slot.remove(&update.slot);
        by_slot.insert(update.slot, merge_slot_light(previous, update));
    }
    *current = by_slot.into_values().collect();
}

fn number(object: &Map<String, Value>, key: &str) -> Option<f64> {
    object
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

#[derive(Default)]
struct LineDecoder {
    buffer: Vec<u8>,
}

impl LineDecoder {
    fn append(&mut self, chunk: &[u8]) -> Vec<Value> {
        self.buffer.extend_from_slice(chunk);
        if self.buffer.len() > MAX_LINE_BYTES {
            self.buffer.clear();
            return Vec::new();
        }

        let mut messages = Vec::new();
        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line = self.buffer.drain(..=newline).collect::<Vec<_>>();
            let line = String::from_utf8_lossy(&line);
            let trimmed = line.trim();
            if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                if value.is_object() {
                    messages.push(value);
                }
            }
        }
        messages
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_ignores_boot_logs_and_accepts_fragmented_json() {
        let mut decoder = LineDecoder::default();
        assert!(decoder
            .append(b"I (42) boot: ESP-IDF\n{\"event\":\"bri")
            .is_empty());
        let messages = decoder.append(b"dge\",\"usbMounted\":true}\n");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["event"], "bridge");
    }

    #[test]
    fn decoder_bounds_unterminated_input() {
        let mut decoder = LineDecoder::default();
        assert!(decoder.append(&vec![b'x'; 20_000]).is_empty());
        assert_eq!(decoder.append(b"{\"event\":\"bridge\"}\n").len(), 1);
    }

    #[test]
    fn controls_and_phases_are_fixed_allowlists() {
        assert!(is_control("agent-1"));
        assert!(is_control("joystick-left"));
        assert!(!is_control("flash"));
        assert!(is_phase("down"));
        assert!(!is_phase("toggle"));
    }

    #[test]
    fn slot_lights_are_sanitized_and_sorted() {
        let value = json!([
            { "slot": 5, "c": 99_999_999, "b": 2, "e": 4, "s": -1 },
            { "slot": 0, "c": 255, "b": 0.5 },
            { "slot": 9, "c": 1 }
        ]);
        let lights = sanitize_slot_lights(&value).unwrap();
        assert_eq!(lights.len(), 2);
        assert_eq!(lights[0].slot, 0);
        assert_eq!(lights[1].slot, 5);
        assert_eq!(lights[1].color, Some(0x00ff_ffff));
        assert_eq!(lights[1].brightness, Some(1.0));
        assert_eq!(lights[1].speed, Some(0.0));
    }

    #[test]
    fn incremental_slot_lights_preserve_untouched_slots_and_fields() {
        let mut lights = sanitize_slot_lights(&json!([
            { "slot": 0, "c": 255, "b": 0.8, "e": 4, "s": 0.25 },
            { "slot": 1, "c": 65_280, "b": 0.6, "e": 1, "s": 0.5 }
        ]))
        .unwrap();
        let updates = sanitize_slot_lights(&json!([{ "slot": 0, "c": 16_711_680 }])).unwrap();

        merge_slot_lights(&mut lights, updates);

        assert_eq!(lights.len(), 2);
        assert_eq!(lights[0].slot, 0);
        assert_eq!(lights[0].color, Some(0x00ff_0000));
        assert_eq!(lights[0].brightness, Some(0.8));
        assert_eq!(lights[0].effect, Some(4));
        assert_eq!(lights[0].speed, Some(0.25));
        assert_eq!(lights[1].slot, 1);
        assert_eq!(lights[1].color, Some(0x0000_ff00));
    }

    #[test]
    fn discovery_requires_a_successful_ack_for_the_exact_sequence() {
        assert!(successful_hello_ack(
            &json!({ "event": "ack", "sequence": 7, "ok": true }),
            7
        ));
        assert!(!successful_hello_ack(
            &json!({ "event": "ack", "sequence": 8, "ok": true }),
            7
        ));
        assert!(!successful_hello_ack(
            &json!({ "event": "ack", "sequence": 7, "ok": false }),
            7
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn discovery_prefers_macos_callout_device_over_tty_alias() {
        assert!(preferred_usb_port_path("/dev/cu.usbmodem12102"));
        assert!(!preferred_usb_port_path("/dev/tty.usbmodem12102"));
    }
}
