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
    asked: Option<Instant>,
    fps_asked: bool,
}

const fn blank() -> MachineStats {
    MachineStats {
        cpu: None,
        ram: None,
        ram_used: 0,
        ram_total: 0,
        gpu: None,
        vram: None,
        vram_used: 0,
        vram_total: 0,
        fps: None,
    }
}

static CACHE: Mutex<Cache> = Mutex::new(Cache { stats: blank(), asked: None, fps_asked: false });
static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Drop the sampler. Closing the overlay should not keep a desktop duplication open.
pub fn release() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.asked = None;
        cache.fps_asked = false;
    }
}

pub fn sample(want_fps: bool) -> MachineStats {
    // A bad counter or a lost desktop frame must come back as missing numbers.
    // Unwinding out of this command is what used to take the whole app down
    // the moment the overlay asked for them.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sample_asked(want_fps))).unwrap_or_else(|_| blank())
}

fn sample_asked(want_fps: bool) -> MachineStats {
    let first = {
        let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.asked = Some(Instant::now());
        cache.fps_asked = want_fps;
        cache.stats.ram.is_none()
    };
    // Do slow OS counters without holding the cache lock. The first request is
    // still answered immediately instead of waiting for the sampler thread.
    if first {
        let next = read_now();
        let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if cache.stats.ram.is_none() {
            cache.stats = next;
        }
    }
    ensure_running();
    let mut stats = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).stats.clone();
    if !want_fps {
        stats.fps = None;
    }
    stats
}

fn ensure_running() {
    use std::sync::atomic::Ordering;
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        #[cfg(windows)]
        {
            // This thread is the only one that may touch the duplication.
            // DXGI is a COM object, and calling it here before COM is ready
            // faults inside dxgi.dll instead of returning an error.
            let _ = com_ready();
        }
        let mut frames = None;
        let mut resources = {
            let cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            cache.stats.ram.is_some().then(|| cache.stats.clone())
        };
        let mut last_resource_sample = Instant::now();
        loop {
            let (idle, want_fps) = {
                let cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                (cache.asked.is_none_or(|asked| asked.elapsed() > Duration::from_secs(4)), cache.fps_asked)
            };
            if idle {
                // Dispose the frame duplication on its owning thread before a
                // fast reopen can start another worker.
                frames = None;
                // The performance counters hold a snapshot of every GPU engine
                // on the machine. Closing the overlay should not keep that.
                #[cfg(windows)]
                gpu_release();
                RUNNING.store(false, Ordering::SeqCst);
                // A request can arrive between the idle check and clearing the
                // running flag. Re-check after clearing it so that a fast reopen
                // does not leave the cache asleep until the next UI poll.
                let active = CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .asked
                    .is_some_and(|asked| asked.elapsed() <= Duration::from_secs(4));
                if active {
                    ensure_running();
                }
                break;
            }
            if want_fps {
                if frames.is_none() {
                    frames = watch_frames();
                }
            } else {
                // Releasing the duplication matters: a performance-only box
                // does not need a live desktop frame stream.
                frames = None;
            }
            let now = Instant::now();
            let refresh_resources = resources.is_none() || now.saturating_duration_since(last_resource_sample) >= Duration::from_secs(1);
            let pulled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut next = if refresh_resources {
                    let sample = read_now();
                    resources = Some(sample.clone());
                    last_resource_sample = now;
                    sample
                } else {
                    resources.clone().unwrap_or_else(blank)
                };
                // Frame presentation still gets checked frequently, while the
                // heavier CPU/GPU/VRAM counters track Task Manager's one-second cadence.
                next.fps = if want_fps { frames.as_mut().and_then(|watch| watch.take()) } else { None };
                next
            }));
            match pulled {
                Ok(mut next) => {
                    if let Ok(mut cache) = CACHE.lock() {
                        if want_fps && next.fps.is_none() {
                            next.fps = cache.stats.fps;
                        }
                        cache.stats = next;
                    }
                }
                Err(_) => {
                    // Drop the watch on this thread so a held frame is released
                    // before another one is opened. Opening first would duplicate
                    // the output while the old frame was still acquired.
                    frames = None;
                    frames = watch_frames();
                    resources = None;
                }
            }
            std::thread::sleep(Duration::from_millis(200));
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
fn com_ready() -> bool {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    thread_local! {
        static READY: std::cell::Cell<Option<bool>> = std::cell::Cell::new(None);
    }
    READY.with(|slot| {
        if let Some(ready) = slot.get() {
            return ready;
        }
        // S_OK and S_FALSE both mean this thread can use COM. A changed
        // apartment does not, and a DXGI call after that is skipped.
        let ready = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        slot.set(Some(ready));
        ready
    })
}

#[cfg(windows)]
fn windows_gpu() -> (Option<u8>, Option<u8>, u64, u64) {
    let _ = com_ready();
    let adapter = primary_vram_adapter();
    let total = adapter.map(|(_, _, total)| total).unwrap_or(0);
    let luid = adapter.map(|(low, high, _)| (low, high));
    let (gpu, used_reading) = pdh_gpu(luid);
    let used = used_reading.unwrap_or(0).min(total);
    let vram = if total > 0 && used_reading.is_some() {
        Some(((used.saturating_mul(100)) / total).min(100) as u8)
    } else {
        None
    };
    (gpu, vram, used, total)
}

#[cfg(windows)]
fn primary_vram_adapter() -> Option<(u32, i32, u64)> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return None };
        let mut best = None::<(u32, i32, u64)>;
        let mut index = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(index) {
            if let Ok(desc) = adapter.GetDesc1() {
                let total = desc.DedicatedVideoMemory as u64;
                if total > best.map(|(_, _, memory)| memory).unwrap_or(0) {
                    best = Some((desc.AdapterLuid.LowPart, desc.AdapterLuid.HighPart, total));
                }
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
struct GpuQuery {
    query: windows::Win32::System::Performance::PDH_HQUERY,
    util: windows::Win32::System::Performance::PDH_HCOUNTER,
    util_3d: windows::Win32::System::Performance::PDH_HCOUNTER,
    used: windows::Win32::System::Performance::PDH_HCOUNTER,
    util_ok: bool,
    util_3d_ok: bool,
    used_ok: bool,
}

#[cfg(windows)]
unsafe impl Send for GpuQuery {}

/// Opened on first use and kept open only while somebody is sampling.
#[cfg(windows)]
static GPU_QUERY: Mutex<Option<GpuQuery>> = Mutex::new(None);

/// Close the performance counters.
///
/// A wildcard GPU counter keeps a copy of every engine instance on the
/// machine, and that is not something to hold once the overlay is closed and
/// no box is asking for numbers.
#[cfg(windows)]
fn gpu_release() {
    use windows::Win32::System::Performance::PdhCloseQuery;

    let query = GPU_QUERY.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
    if let Some(query) = query {
        unsafe {
            let _ = PdhCloseQuery(query.query);
        }
    }
}

#[cfg(windows)]
fn pdh_gpu(adapter: Option<(u32, i32)>) -> (Option<u8>, Option<u64>) {
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCollectQueryData, PdhOpenQueryW, PDH_FMT_DOUBLE, PDH_FMT_LARGE, PDH_HCOUNTER, PDH_HQUERY,
    };
    use windows::core::PCWSTR;

    let mut guard = GPU_QUERY.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        unsafe {
            let mut query = PDH_HQUERY(std::ptr::null_mut());
            // `None` is `Option<&PCWSTR>`, which is what this `Param` accepts.
            if PdhOpenQueryW(None::<&PCWSTR>, 0, &mut query) != 0 {
                return (None, None);
            }
            let mut util = PDH_HCOUNTER(std::ptr::null_mut());
            let mut util_3d = PDH_HCOUNTER(std::ptr::null_mut());
            let mut used = PDH_HCOUNTER(std::ptr::null_mut());
            let path_3d = wide_path("\\GPU Engine(*engtype_3D)\\Utilization Percentage");
            let path_any = wide_path("\\GPU Engine(*)\\Utilization Percentage");
            let used_path = wide_path("\\GPU Adapter Memory(*)\\Dedicated Usage");
            let util_3d_ok = PdhAddEnglishCounterW(query, PCWSTR(path_3d.as_ptr()), 0, &mut util_3d) == 0;
            let util_ok = PdhAddEnglishCounterW(query, PCWSTR(path_any.as_ptr()), 0, &mut util) == 0;
            let used_ok = PdhAddEnglishCounterW(query, PCWSTR(used_path.as_ptr()), 0, &mut used) == 0;
            if !util_ok && !util_3d_ok && !used_ok {
                let _ = PdhCloseQuery(query);
                return (None, None);
            }
            let _ = PdhCollectQueryData(query);
            *guard = Some(GpuQuery { query, util, util_3d, used, util_ok, util_3d_ok, used_ok });
        }
    }
    let Some(query) = guard.as_ref() else { return (None, None) };
    unsafe {
        if PdhCollectQueryData(query.query) != 0 {
            return (None, None);
        }
        // Restrict the readings to the adapter with the largest dedicated
        // memory, which is normally the active discrete GPU. Task Manager's
        // GPU percentage is the busiest engine, while its dedicated-memory
        // reading is the sum of all processes on that adapter.
        let gpu_3d = if query.util_3d_ok { counter_max(query.util_3d, PDH_FMT_DOUBLE, true, adapter) } else { None };
        let gpu_any = if query.util_ok { counter_max(query.util, PDH_FMT_DOUBLE, true, adapter) } else { None };
        let gpu = gpu_any.or(gpu_3d);
        let used = if query.used_ok { counter_sum(query.used, PDH_FMT_LARGE, false, adapter) } else { None };
        (gpu.map(|value| value.round().clamp(0.0, 100.0) as u8), used.map(|value| value.max(0.0) as u64))
    }
}

#[cfg(windows)]
unsafe fn counter_rows(
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
    format: windows::Win32::System::Performance::PDH_FMT,
    percent: bool,
) -> Option<Vec<(String, f64)>> {
    use windows::Win32::System::Performance::{PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_MORE_DATA};
    if counter.0.is_null() {
        return None;
    }
    let mut size = 0u32;
    let mut count = 0u32;
    let first = PdhGetFormattedCounterArrayW(counter, format, &mut size, &mut count, None::<*mut PDH_FMT_COUNTERVALUE_ITEM_W>);
    if first != PDH_MORE_DATA && first != 0 {
        return None;
    }
    let stride = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
    // `size` is bytes. Dividing it and then telling PDH the old byte count
    // writes past the allocation whenever the count does not divide evenly.
    let items = counter_buffer_items(size, stride)?;
    let mut buffer = vec![std::mem::zeroed::<PDH_FMT_COUNTERVALUE_ITEM_W>(); items];
    let mut bytes = (items * stride) as u32;
    let status = PdhGetFormattedCounterArrayW(counter, format, &mut bytes, &mut count, Some(buffer.as_mut_ptr()));
    if status != 0 {
        return None;
    }
    let mut rows = Vec::new();
    for item in buffer.iter().take((count as usize).min(buffer.len())) {
        // 0 is a settled reading. 1 is the first reading after the counter
        // opened, which is still a number. Anything else is not usable.
        if item.FmtValue.CStatus > 1 {
            continue;
        }
        let value: f64 = unsafe {
            if percent {
                item.FmtValue.Anonymous.doubleValue
            } else {
                item.FmtValue.Anonymous.largeValue as f64
            }
        };
        if !value.is_finite() || value < 0.0 {
            continue;
        }
        rows.push((wide_text(windows::core::PWSTR(item.szName.0)), value));
    }
    Some(rows)
}

#[cfg(windows)]
unsafe fn counter_max(
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
    format: windows::Win32::System::Performance::PDH_FMT,
    percent: bool,
    adapter: Option<(u32, i32)>,
) -> Option<f64> {
    let rows = counter_rows(counter, format, percent)?;
    let selected = adapter.map(|(low, high)| {
        rows.iter().filter(|(name, _)| instance_matches_adapter(name, low, high)).cloned().collect::<Vec<_>>()
    }).unwrap_or_default();
    let rows = if selected.is_empty() { rows } else { selected };
    if percent {
        gpu_engine_max(&rows).or_else(|| rows.iter().map(|(_, value)| *value).reduce(f64::max))
    } else {
        rows.iter().map(|(_, value)| *value).reduce(f64::max)
    }
}

#[cfg(windows)]
unsafe fn counter_sum(
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
    format: windows::Win32::System::Performance::PDH_FMT,
    percent: bool,
    adapter: Option<(u32, i32)>,
) -> Option<f64> {
    let rows = counter_rows(counter, format, percent)?;
    let selected = adapter.map(|(low, high)| {
        rows.iter().filter(|(name, _)| instance_matches_adapter(name, low, high)).map(|(_, value)| *value).collect::<Vec<_>>()
    }).unwrap_or_default();
    if !selected.is_empty() {
        Some(selected.into_iter().sum())
    } else {
        rows.iter().map(|(_, value)| *value).reduce(|total, value| total + value)
    }
}

fn gpu_engine_max(rows: &[(String, f64)]) -> Option<f64> {
    let mut engines = std::collections::HashMap::<String, f64>::new();
    for (name, value) in rows {
        if let Some(key) = name.to_ascii_lowercase().find("luid_").map(|index| name[index..].to_ascii_lowercase()) {
            *engines.entry(key).or_default() += *value;
        }
    }
    engines.values().copied().reduce(f64::max)
}

fn instance_matches_adapter(name: &str, low: u32, high: i32) -> bool {
    let lowered = name.to_ascii_lowercase();
    let parts = lowered.split('_').collect::<Vec<_>>();
    let high = high as u32;
    parts.windows(3).any(|parts| {
        if parts[0] != "luid" {
            return false;
        }
        let parse = |value: &str| u32::from_str_radix(value.strip_prefix("0x").unwrap_or(value), 16).ok();
        matches!((parse(&parts[1]), parse(&parts[2])), (Some(first), Some(second)) if (first == high && second == low) || (first == low && second == high))
    })
}

#[cfg(windows)]
fn wide_path(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
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
    /// Each mark is the frames seen since the previous mark.
    #[cfg(windows)]
    marks: Vec<(Instant, u32)>,
    #[cfg(not(windows))]
    _private: (),
}

#[cfg(windows)]
struct WindowsFrames {
    duplication: windows::Win32::Graphics::Dxgi::IDXGIOutputDuplication,
    primed: bool,
    /// A frame is still acquired. Dropping the duplication in that state hangs
    /// or kills the process, so Drop releases it first.
    held: bool,
}

fn watch_frames() -> Option<FrameWatch> {
    #[cfg(windows)]
    {
        return Some(FrameWatch { inner: WindowsFrames::open(), marks: Vec::new() });
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
                    // Release any held frame before opening another duplication.
                    // The right-hand side of an assignment would open the new
                    // one first, while the old frame was still acquired.
                    self.inner = None;
                    self.inner = WindowsFrames::open();
                    self.marks.clear();
                    None
                }
                FramePull::Waiting => {
                    self.marks.clear();
                    self.marks.push((Instant::now(), 0));
                    None
                }
                FramePull::Count(count) => {
                    let now = Instant::now();
                    if self.marks.is_empty() {
                        self.marks.push((now, 0));
                    }
                    self.marks.push((now, count));
                    let cutoff = now.checked_sub(Duration::from_secs(1)).unwrap_or(now);
                    while self.marks.len() > 2 && self.marks.get(1).is_some_and(|(at, _)| *at < cutoff) {
                        self.marks.remove(0);
                    }
                    let start = self.marks.first().map(|(at, _)| *at).unwrap_or(now);
                    let frames = self.marks.iter().skip(1).fold(0u32, |sum, (_, seen)| sum.saturating_add(*seen));
                    frames_per_second(frames, now.saturating_duration_since(start).as_secs_f64())
                }
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
        use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL, D3D_FEATURE_LEVEL_11_0};
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
        };
        use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1};
        use windows::core::Interface;

        if !com_ready() {
            return None;
        }
        unsafe {
            let factory = CreateDXGIFactory1::<IDXGIFactory1>().ok()?;
            let adapter = factory.EnumAdapters1(0).ok()?;
            let base: windows::Win32::Graphics::Dxgi::IDXGIAdapter = adapter.cast().ok()?;
            let output = adapter.EnumOutputs(0).ok()?;
            let output1: IDXGIOutput1 = output.cast().ok()?;
            let mut device = None::<ID3D11Device>;
            let device_slot: *mut Option<ID3D11Device> = &mut device;
            let levels = [D3D_FEATURE_LEVEL_11_0];
            D3D11CreateDevice(
                &base,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE(std::ptr::null_mut::<core::ffi::c_void>()),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&levels),
                D3D11_SDK_VERSION,
                Some(device_slot),
                None::<*mut D3D_FEATURE_LEVEL>,
                None::<*mut Option<ID3D11DeviceContext>>,
            )
            .ok()?;
            let device = device?;
            let unknown: windows::core::IUnknown = device.cast().ok()?;
            let duplication = output1.DuplicateOutput(&unknown).ok()?;
            Some(Self { duplication, primed: false, held: false })
        }
    }

    fn release_held(&mut self) {
        if !self.held {
            return;
        }
        let _ = unsafe { self.duplication.ReleaseFrame() };
        self.held = false;
    }

    fn drain(&mut self) -> FramePull {
        use windows::Win32::Graphics::Dxgi::{DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO};
        let mut frames = 0u32;
        let mut saw = false;
        for index in 0..32 {
            let mut info: DXGI_OUTDUPL_FRAME_INFO = unsafe { std::mem::zeroed() };
            let mut resource = None;
            let info_ptr: *mut DXGI_OUTDUPL_FRAME_INFO = &mut info;
            let resource_ptr: *mut Option<windows::Win32::Graphics::Dxgi::IDXGIResource> = &mut resource;
            // A zero wait is what some drivers fault on. The first wait is one
            // frame; the rest only drain what is already queued.
            let timeout = if index == 0 { 16 } else { 1 };
            match unsafe { self.duplication.AcquireNextFrame(timeout, info_ptr, resource_ptr) } {
                Ok(()) => {
                    self.held = true;
                    let added = info.AccumulatedFrames;
                    if added > 0 {
                        saw = true;
                        frames = frames.saturating_add(added);
                    }
                    drop(resource);
                    if unsafe { self.duplication.ReleaseFrame() }.is_err() {
                        return FramePull::Dead;
                    }
                    self.held = false;
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

#[cfg(windows)]
impl Drop for WindowsFrames {
    fn drop(&mut self) {
        self.release_held();
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

/// How many formatted counter rows fit in the byte count PDH asked for.
///
/// The second call is told the buffer size in bytes. Rounding the row count
/// down makes that claim bigger than the allocation, and PDH then writes past
/// it. That is a process crash, not a missing number. A huge request is
/// refused rather than allocated.
/// Frames seen over the real gap, not the count itself.
///
/// The sampler does not wake on an exact second. Reporting the raw count made
/// a 60fps video read 61 or 62 whenever the gap was a little over a second.
fn frames_per_second(frames: u32, seconds: f64) -> Option<u32> {
    if !seconds.is_finite() || seconds < 0.45 {
        return None;
    }
    Some((frames as f64 / seconds).round().clamp(0.0, 1000.0) as u32)
}

fn counter_buffer_items(bytes: u32, stride: usize) -> Option<usize> {
    if bytes == 0 || stride == 0 {
        return None;
    }
    let items = (bytes as usize).div_ceil(stride);
    // A busy PC has one GPU-engine row per process per engine. Capping that at
    // a couple of hundred dropped the whole reading, so the GPU line stayed
    // blank. A few thousand rows is still a small buffer.
    if items == 0 || items > 4096 {
        return None;
    }
    Some(items)
}

#[cfg(test)]
mod tests {
    use super::{counter_buffer_items, frames_per_second, gpu_engine_max, instance_matches_adapter};

    #[test]
    fn a_counter_buffer_is_never_smaller_than_pdh_asked_for() {
        let stride = 24;
        let bytes = 100;
        let items = counter_buffer_items(bytes, stride).expect("fits");
        assert!(items * stride >= bytes as usize);
        assert_eq!(items, 5);
    }

    #[test]
    fn gpu_utilization_sums_processes_per_engine_before_selecting_the_busiest() {
        let rows = vec![
            ("pid_1_luid_0x00000000_0x00001234_phys_0_eng_0_engtype_3D".to_string(), 35.0),
            ("pid_2_luid_0x00000000_0x00001234_phys_0_eng_0_engtype_3D".to_string(), 30.0),
            ("pid_1_luid_0x00000000_0x00001234_phys_0_eng_1_engtype_3D".to_string(), 70.0),
        ];
        assert_eq!(gpu_engine_max(&rows), Some(70.0));
    }

    #[test]
    fn gpu_counters_match_the_selected_adapter_luid_in_either_order() {
        assert!(instance_matches_adapter("pid_44_luid_0x00000000_0x00001234_phys_0_eng_1_engtype_3D", 0x1234, 0));
        assert!(instance_matches_adapter("pid_44_luid_0x00001234_0x00000000_phys_0_eng_1_engtype_3D", 0x1234, 0));
        assert!(!instance_matches_adapter("pid_44_luid_0x00000000_0x00005678_phys_0_eng_1_engtype_3D", 0x1234, 0));
    }

    #[test]
    fn an_exact_counter_list_keeps_every_row() {
        assert_eq!(counter_buffer_items(32 * 3, 32), Some(3));
    }

    #[test]
    fn a_huge_or_empty_counter_list_is_skipped() {
        assert_eq!(counter_buffer_items(0, 24), None);
        assert_eq!(counter_buffer_items(24, 0), None);
        assert_eq!(counter_buffer_items(u32::MAX, 24), None);
        assert_eq!(counter_buffer_items(4096 * 24, 24), Some(4096));
        assert_eq!(counter_buffer_items(4096 * 24 + 1, 24), None);
        assert_eq!(frames_per_second(62, 1.03), Some(60));
        assert_eq!(frames_per_second(60, 1.0), Some(60));
        assert_eq!(frames_per_second(30, 0.5), Some(60));
        assert_eq!(frames_per_second(15, 0.25), None);
    }
}
