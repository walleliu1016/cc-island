//! Terminal handling - stdin reading, resize events

use portable_pty::{PtySize, MasterPty};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::Sender;
use tracing::{debug, error, info};

/// Read from terminal stdin and send to input channel
pub async fn read_stdin(input_tx: Sender<String>) {
    use tokio::io::{AsyncBufReadExt, BufReader};

    info!("Terminal stdin reader started");

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        match reader.read_line(&mut line).await {
            Ok(0) => {
                debug!("Stdin EOF");
                break;
            }
            Ok(_) => {
                debug!("Stdin input: {} bytes", line.len());

                if input_tx.send(line.clone()).await.is_err() {
                    error!("Failed to send stdin to channel");
                    break;
                }

                line.clear();
            }
            Err(e) => {
                error!("Stdin read error: {}", e);
                break;
            }
        }
    }

    info!("Terminal stdin reader ended");
}

/// Setup terminal resize handler
pub fn setup_resize_handler(master: Arc<Mutex<Box<dyn MasterPty + Send>>>) {
    #[cfg(unix)]
    {
        use signal_hook::consts::SIGWINCH;

        let master_clone = master.clone();

        signal_hook::register(SIGWINCH, || {
            debug!("SIGWINCH received, resizing PTY");

            if let Some((cols, rows)) = get_terminal_size_unix() {
                let size = PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                };

                if let Ok(m) = master_clone.lock() {
                    if let Err(e) = m.resize(size) {
                        error!("PTY resize error: {}", e);
                    } else {
                        debug!("PTY resized to {}x{}", cols, rows);
                    }
                }
            }
        }).expect("Failed to register SIGWINCH handler");

        info!("Terminal resize handler registered (SIGWINCH)");
    }

    #[cfg(windows)]
    {
        let master_clone = master.clone();

        std::thread::spawn(move || {
            let mut last_size = get_terminal_size_windows();

            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));

                let new_size = get_terminal_size_windows();
                if new_size != last_size {
                    debug!("Terminal size changed: {}x{}", new_size.0, new_size.1);

                    let size = PtySize {
                        rows: new_size.1,
                        cols: new_size.0,
                        pixel_width: 0,
                        pixel_height: 0,
                    };

                    if let Ok(m) = master_clone.lock() {
                        if let Err(e) = m.resize(size) {
                            error!("PTY resize error: {}", e);
                        }
                    }

                    last_size = new_size;
                }
            }
        });

        info!("Terminal resize handler started (polling)");
    }
}

/// Get terminal size on Unix
#[cfg(unix)]
fn get_terminal_size_unix() -> Option<(u16, u16)> {
    use std::mem::zeroed;

    unsafe {
        let mut winsize: libc::winsize = zeroed();

        let result = libc::ioctl(libc::STDIN_FILENO, libc::TIOCGWINSZ, &mut winsize);

        if result == 0 && winsize.ws_col > 0 && winsize.ws_row > 0 {
            Some((winsize.ws_col, winsize.ws_row))
        } else {
            Some((80, 24))
        }
    }
}

/// Get terminal size on Windows
#[cfg(windows)]
fn get_terminal_size_windows() -> (u16, u16) {
    use std::mem::zeroed;
    use winapi::um::wincon::GetConsoleScreenBufferInfo;
    use winapi::um::processenv::GetStdHandle;
    use winapi::um::winbase::STD_OUTPUT_HANDLE;

    unsafe {
        let mut csbi: winapi::um::wincon::CONSOLE_SCREEN_BUFFER_INFO = zeroed();

        let result = GetConsoleScreenBufferInfo(
            GetStdHandle(STD_OUTPUT_HANDLE),
            &mut csbi,
        );

        if result != 0 {
            let cols = (csbi.srWindow.Right - csbi.srWindow.Left + 1) as u16;
            let rows = (csbi.srWindow.Bottom - csbi.srWindow.Top + 1) as u16;
            if cols > 0 && rows > 0 {
                (cols, rows)
            } else {
                (80, 24)
            }
        } else {
            (80, 24)
        }
    }
}