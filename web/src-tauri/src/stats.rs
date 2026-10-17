//! CPU, memory, GPU, and the picture's frame rate for the overlay.
//!
//! The numbers are sampled only while a box is asking for them. The frame rate
//! is how many pictures the desktop presented, which is the game's rate when it
//! is filling the screen. It is not a guess from the recorder.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineStats {
    pub cpu: Option<u8>,
    pub ram: Option<u8>,
    pub ram_used: u64,
    pub ram_total: u64,
    pub gpu: Option<u8>,
    pub vram: Option<u8>,
    pub vram_used: u64,
    pub vram_total: u64,
    pub fps: Option<u32>,
}

struct Cache {
    stats: MachineStats,
    asked: Instant,
}

static CACHE: Mutex<Cache> = Mutex::new(Cache {
    stats: MachineStats {
        cpu: None,
        ram: None,
        ram_used: 0,
        ram_total: 0,
        gpu: None,
        vram: None,
        vram_used: 0,
        vram_total: 0,
        fps: None,
    },
    asked: Instant::now(),
});
static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn sample() -> MachineStats {
    {
        let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.asked = Instant::now();
        // A first look should not wait for the thread to start.
        if cache.stats.ram.is_none() {
            cache.stats = read_now();
        }
    }
    ensure_running();
    CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).stats.clone()
}

fn ensure_running() {
    use std::sync::atomic::Ordering;
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        let mut frames = watch_frames();
        loop {
            if CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).asked.elapsed() > Duration::from_secs(4) {
                RUNNING.store(false, Ordering::SeqCst);
                break;
            }
            let mut next = read_now();
            next.fps = frames.as_mut().and_then(|watch| watch.take());
            if let Ok(mut cache) = CACHE.lock() {
                if next.fps.is_none() {
                    next.fps = cache.stats.fps;
                }
                cache.stats = next;
            }
            std::thread::sleep(Duration::from_millis(1000));
        }
    });
}

fn read_now() -> MachineStats {
    let (cpu, ram, ram_used, ram_total) = cpu_ram();
    let (gpu, vram, vram_used, vram_total) = gpu_vram();
    MachineStats {
        cpu,
        ram,
        ram_used,
        ram_total,
        gpu,
        vram,
        vram_used,
        vram_total,
        fps: None,
    }
}

fn cpu_ram() -> (Option<u8>, Option<u8>, u64, u64) {
    #[cfg(windows)]
    {
        return windows_cpu_ram();
    }
    #[cfg(target_os = "linux")]
    {
        return linux_cpu_ram();
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        (None, None, 0, 0)
    }
}

fn gpu_vram() -> (Option<u8>, Option<u8>, u64, u64) {
    #[cfg(windows)]
    {
        return windows_gpu();
    }
    #[cfg(target_os = "linux")]
    {
        return linux_gpu();
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        (None, None, 0, 0)
    }
}

#[cfg(windows)]
fn windows_cpu_ram() -> (Option<u8>, Option<u8>, u64, u64) {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::GetSystemTimes;

    let ram = unsafe {
        let mut info: MEMORYSTATUSEX = std::mem::zeroed();
        info.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut info).is_ok() {
            (Some(info.dwMemoryLoad.min(100) as u8), info.ullTotalPhys.saturating_sub(info.ullAvailPhys), info.ullTotalPhys)
        } else {
            (None, 0, 0)
        }
    };
    let cpu = unsafe {
        let mut idle = windows::Win32::Foundation::FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let mut kernel = idle;
        let mut user = idle;
        let idle_ptr: *mut windows::Win32::Foundation::FILETIME = &mut idle;
        let kernel_ptr: *mut windows::Win32::Foundation::FILETIME = &mut kernel;
        let user_ptr: *mut windows::Win32::Foundation::FILETIME = &mut user;
        if GetSystemTimes(Some(idle_ptr), Some(kernel_ptr), Some(user_ptr)).is_ok() {
            cpu_from_times(filetime(idle), filetime(kernel), filetime(user))
        } else {
            None
        }
    };
    (cpu, ram.0, ram.1, ram.2)
}

#[cfg(windows)]
fn filetime(value: windows::Win32::Foundation::FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}

#[cfg(windows)]
fn cpu_from_times(idle: u64, kernel: u64, user: u64) -> Option<u8> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST_IDLE: AtomicU64 = AtomicU64::new(0);
    static LAST_TOTAL: AtomicU64 = AtomicU64::new(0);
    let total = kernel.saturating_add(user);
    let previous_idle = LAST_IDLE.swap(idle, Ordering::SeqCst);
    let previous_total = LAST_TOTAL.swap(total, Ordering::SeqCst);
    if previous_total == 0 || total <= previous_total {
        return None;
    }
    let idle_delta = idle.saturating_sub(previous_idle);
    let total_delta = total - previous_total;
    let busy = total_delta.saturating_sub(idle_delta.min(total_delta));
    Some(((busy.saturating_mul(100)) / total_delta).min(100) as u8)
}

#[cfg(windows)]
fn windows_gpu() -> (Option<u8>, Option<u8>, u64, u64) {
    let total = vram_total();
    let (gpu, used) = pdh_gpu();
    let vram = if total > 0 && used > 0 {
        Some(((used.saturating_mul(100)) / total).min(100) as u8)
    } else {
        None
    };
    (gpu, vram, used, total)
}

#[cfg(windows)]
fn vram_total() -> u64 {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return 0 };
        let mut best = 0u64;
        let mut index = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(index) {
            if let Ok(desc) = adapter.GetDesc1() {
                best = best.max(desc.DedicatedVideoMemory as u64);
            }
            index += 1;
            if index > 8 {
                break;
            }
        }
        best
    }
}

#[cfg(windows)]
fn pdh_gpu() -> (Option<u8>, u64) {
    use std::sync::Mutex as GpuMutex;
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCollectQueryData, PdhOpenQueryW, PDH_FMT_DOUBLE, PDH_FMT_LARGE, PDH_HCOUNTER, PDH_HQUERY,
    };
    use windows::core::{w, PCWSTR};

    struct Query {
        query: PDH_HQUERY,
        util: PDH_HCOUNTER,
        used: PDH_HCOUNTER,
    }
    unsafe impl Send for Query {}
    static QUERY: GpuMutex<Option<Query>> = GpuMutex::new(None);

    let mut guard = QUERY.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        unsafe {
            let mut query = PDH_HQUERY(std::ptr::null_mut());
            if PdhOpenQueryW(PCWSTR(std::ptr::null()), 0, &mut query) != 0 {
                return (None, 0);
            }
            let mut util = PDH_HCOUNTER(std::ptr::null_mut());
            let mut used = PDH_HCOUNTER(std::ptr::null_mut());
            let util_ok = PdhAddEnglishCounterW(query, w!("\\GPU Engine(*)\\Utilization Percentage"), 0, &mut util) == 0;
            let used_ok = PdhAddEnglishCounterW(query, w!("\\GPU Adapter Memory(*)\\Dedicated Usage"), 0, &mut used) == 0;
            if !util_ok && !used_ok {
                return (None, 0);
            }
            let _ = PdhCollectQueryData(query);
            *guard = Some(Query { query, util, used });
        }
    }
    let Some(query) = guard.as_ref() else { return (None, 0) };
    unsafe {
        if PdhCollectQueryData(query.query) != 0 {
            return (None, 0);
        }
        let gpu = counter_max(query.util, PDH_FMT_DOUBLE, true);
        let used = counter_max(query.used, PDH_FMT_LARGE, false);
        (gpu.map(|value| value.round().clamp(0.0, 100.0) as u8), used.unwrap_or(0.0) as u64)
    }
}

#[cfg(windows)]
unsafe fn counter_max(counter: windows::Win32::System::Performance::PDH_HCOUNTER, format: windows::Win32::System::Performance::PDH_FMT, percent: bool) -> Option<f64> {
    use windows::Win32::System::Performance::{PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_MORE_DATA};
    let mut size = 0u32;
    let mut count = 0u32;
    let first = PdhGetFormattedCounterArrayW(counter, format, &mut size, &mut count, None);
    if first != PDH_MORE_DATA && first != 0 {
        return None;
    }
    let items = (size as usize / std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>()).max(1);
    let mut buffer = vec![std::mem::zeroed::<PDH_FMT_COUNTERVALUE_ITEM_W>(); items];
    let status = PdhGetFormattedCounterArrayW(counter, format, &mut size, &mut count, Some(buffer.as_mut_ptr()));
    if status != 0 {
        return None;
    }
    let mut best = None;
    let mut best_3d = None;
    for item in buffer.iter().take(count as usize) {
        if item.FmtValue.CStatus != 0 {
            continue;
        }
        let value = if percent { item.FmtValue.Anonymous.doubleValue } else { item.FmtValue.Anonymous.largeValue as f64 };
        if !value.is_finite() || value < 0.0 {
            continue;
        }
        best = Some(best.unwrap_or(0.0).max(value));
        if percent {
            let name = wide_text(windows::core::PWSTR(item.szName.0));
            if name.contains("engtype_3D") {
                best_3d = Some(best_3d.unwrap_or(0.0).max(value));
            }
        }
    }
    if percent { best_3d } else { best }
}

#[cfg(windows)]
fn wide_text(value: windows::core::PWSTR) -> String {
    if value.0.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while unsafe { *value.0.add(len) } != 0 && len < 512 {
        len += 1;
    }
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(value.0, len) })
}

struct FrameWatch {
    #[cfg(windows)]
    inner: Option<WindowsFrames>,
    #[cfg(not(windows))]
    _private: (),
}

#[cfg(windows)]
struct WindowsFrames {
    duplication: windows::Win32::Graphics::Dxgi::IDXGIOutputDuplication,
    primed: bool,
}

fn watch_frames() -> Option<FrameWatch> {
    #[cfg(windows)]
    {
        return Some(FrameWatch { inner: WindowsFrames::open() });
    }
    #[cfg(not(windows))]
    {
        None
    }
}

impl FrameWatch {
    fn take(&mut self) -> Option<u32> {
        #[cfg(windows)]
        {
            if self.inner.is_none() {
                self.inner = WindowsFrames::open();
            }
            let watch = self.inner.as_mut()?;
            match watch.drain() {
                FramePull::Dead => {
                    self.inner = WindowsFrames::open();
                    None
                }
                FramePull::Waiting => None,
                FramePull::Count(count) => Some(count),
            }
        }
        #[cfg(not(windows))]
        {
            None
        }
    }
}

#[cfg(windows)]
enum FramePull {
    Waiting,
    Count(u32),
    Dead,
}

#[cfg(windows)]
impl WindowsFrames {
    fn open() -> Option<Self> {
        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
        use windows::Win32::Graphics::Direct3D11::{D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION};
        use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1};
        use windows::core::Interface;

        unsafe {
            let factory = CreateDXGIFactory1::<IDXGIFactory1>().ok()?;
            let adapter = factory.EnumAdapters1(0).ok()?;
            let base: windows::Win32::Graphics::Dxgi::IDXGIAdapter = adapter.cast().ok()?;
            let output = adapter.EnumOutputs(0).ok()?;
            let output1: IDXGIOutput1 = output.cast().ok()?;
            let mut device = None::<ID3D11Device>;
            let device_slot: *mut Option<ID3D11Device> = &mut device;
            D3D11CreateDevice(
                &base,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE(std::ptr::null_mut()),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(device_slot),
                None,
                None,
            )
            .ok()?;
            let device = device?;
            let unknown: windows::core::IUnknown = device.cast().ok()?;
            let duplication = output1.DuplicateOutput(&unknown).ok()?;
            Some(Self { duplication, primed: false })
        }
    }

    fn drain(&mut self) -> FramePull {
        use windows::Win32::Graphics::Dxgi::{DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO};
        let mut frames = 0u32;
        let mut saw = false;
        for _ in 0..8 {
            let mut info: DXGI_OUTDUPL_FRAME_INFO = std::mem::zeroed();
            let mut resource = None;
            let info_ptr: *mut DXGI_OUTDUPL_FRAME_INFO = &mut info;
            let resource_ptr: *mut Option<windows::Win32::Graphics::Dxgi::IDXGIResource> = &mut resource;
            match unsafe { self.duplication.AcquireNextFrame(0, info_ptr, resource_ptr) } {
                Ok(()) => {
                    saw = true;
                    frames = frames.saturating_add(info.AccumulatedFrames.max(1));
                    drop(resource);
                    if unsafe { self.duplication.ReleaseFrame() }.is_err() {
                        return FramePull::Dead;
                    }
                }
                Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => break,
                Err(_) => return FramePull::Dead,
            }
        }
        if !self.primed {
            self.primed = true;
            return FramePull::Waiting;
        }
        FramePull::Count(if saw { frames } else { 0 })
    }
}

#[cfg(target_os = "linux")]
fn linux_cpu_ram() -> (Option<u8>, Option<u8>, u64, u64) {
    let cpu = std::fs::read_to_string("/proc/stat").ok().as_deref().and_then(cpu_from_proc);
    let (ram, used, total) = std::fs::read_to_string("/proc/meminfo").ok().as_deref().map(ram_from_meminfo).unwrap_or((None, 0, 0));
    (cpu, ram, used, total)
}

#[cfg(target_os = "linux")]
fn cpu_from_proc(text: &str) -> Option<u8> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST_IDLE: AtomicU64 = AtomicU64::new(0);
    static LAST_TOTAL: AtomicU64 = AtomicU64::new(0);
    let line = text.lines().find(|line| line.starts_with("cpu "))?;
    let mut total = 0u64;
    let mut idle = 0u64;
    for (index, part) in line.split_whitespace().skip(1).enumerate() {
        let value = part.parse::<u64>().unwrap_or(0);
        total = total.saturating_add(value);
        if index == 3 || index == 4 {
            idle = idle.saturating_add(value);
        }
    }
    let previous_idle = LAST_IDLE.swap(idle, Ordering::SeqCst);
    let previous_total = LAST_TOTAL.swap(total, Ordering::SeqCst);
    if previous_total == 0 || total <= previous_total {
        return None;
    }
    let busy = (total - previous_total).saturating_sub(idle.saturating_sub(previous_idle));
    Some(((busy.saturating_mul(100)) / (total - previous_total)).min(100) as u8)
}

#[cfg(target_os = "linux")]
fn ram_from_meminfo(text: &str) -> (Option<u8>, u64, u64) {
    let mut total = 0u64;
    let mut available = 0u64;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("MemTotal:") {
            total = value.split_whitespace().next().and_then(|item| item.parse().ok()).unwrap_or(0) * 1024;
        } else if let Some(value) = line.strip_prefix("MemAvailable:") {
            available = value.split_whitespace().next().and_then(|item| item.parse().ok()).unwrap_or(0) * 1024;
        }
    }
    if total == 0 {
        return (None, 0, 0);
    }
    let used = total.saturating_sub(available);
    (Some(((used.saturating_mul(100)) / total).min(100) as u8), used, total)
}

#[cfg(target_os = "linux")]
fn linux_gpu() -> (Option<u8>, Option<u8>, u64, u64) {
    if let Some(parsed) = nvidia_smi() {
        return parsed;
    }
    sysfs_gpu()
}

#[cfg(target_os = "linux")]
fn nvidia_smi() -> Option<(Option<u8>, Option<u8>, u64, u64)> {
    let output = crate::process::command("nvidia-smi")
        .args(["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout);
    let mut parts = line.split(',');
    let gpu = parts.next()?.trim().parse::<u8>().ok();
    let used_mb = parts.next()?.trim().parse::<u64>().ok()?;
    let total_mb = parts.next()?.trim().parse::<u64>().ok()?;
    let used = used_mb.saturating_mul(1024 * 1024);
    let total = total_mb.saturating_mul(1024 * 1024);
    let vram = if total > 0 { Some(((used.saturating_mul(100)) / total).min(100) as u8) } else { None };
    Some((gpu, vram, used, total))
}

#[cfg(target_os = "linux")]
fn sysfs_gpu() -> (Option<u8>, Option<u8>, u64, u64) {
    let gpu = std::fs::read_to_string("/sys/class/drm/card0/device/gpu_busy_percent")
        .ok()
        .and_then(|text| text.trim().parse::<u8>().ok());
    let used = std::fs::read_to_string("/sys/class/drm/card0/device/mem_info_vram_used")
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let total = std::fs::read_to_string("/sys/class/drm/card0/device/mem_info_vram_total")
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let vram = if total > 0 { Some(((used.saturating_mul(100)) / total).min(100) as u8) } else { None };
    (gpu, vram, used, total)
}
