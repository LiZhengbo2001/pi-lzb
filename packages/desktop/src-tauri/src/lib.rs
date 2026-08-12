use std::process::{Command, Child};
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::Manager;

struct Server(Mutex<Option<Child>>);

fn find_server_js() -> Option<PathBuf> {
    // In production: resources are next to the exe under _up_/dist/server/
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("_up_").join("dist").join("server").join("bundle.js");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    // Fallback: dev mode — relative to CWD
    let dev = std::env::current_dir().ok()?.join("dist").join("server").join("bundle.js");
    if dev.exists() {
        return Some(dev);
    }
    None
}

fn find_renderer_dir() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("_up_").join("dist").join("renderer");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    let dev = std::env::current_dir().ok()?.join("dist").join("renderer");
    if dev.exists() {
        return Some(dev);
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            if let Some(server_js) = find_server_js() {
                if let Some(renderer_dir) = find_renderer_dir() {
                    std::env::set_var("PI_SERVE_DIR", renderer_dir.to_string_lossy().to_string());

                    let child = Command::new("node")
                        .arg(server_js.to_string_lossy().to_string())
                        .spawn();

                    match child {
                        Ok(process) => {
                            _app.manage(Server(Mutex::new(Some(process))));
                            println!("Agent server started from: {}", server_js.display());
                        }
                        Err(e) => {
                            eprintln!("Failed to start agent server: {}", e);
                        }
                    }
                }
            } else {
                eprintln!("Server bundle not found");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<Server>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(ref mut child) = *guard {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
