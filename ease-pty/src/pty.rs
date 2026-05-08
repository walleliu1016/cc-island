//! PTY management - create PTY pair, spawn subprocess, write inputs

use portable_pty::{native_pty_system, PtyPair, PtySize, CommandBuilder};
use portable_pty::{SlavePty, MasterPty, Child};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::Receiver;
use tracing::{debug, error, info};

/// Create a new PTY pair with default size
pub fn create_pty() -> PtyPair {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };

    pty_system
        .openpty(size)
        .expect("Failed to create PTY pair")
}

/// Spawn a command in the PTY
pub fn spawn_command(
    slave: &Box<dyn SlavePty + Send>,
    command: &str,
    args: &[String],
    cwd: &PathBuf,
) -> Box<dyn Child + Send + Sync> {
    #[cfg(windows)]
    {
        // Windows: Use cmd.exe to execute .cmd/.bat scripts
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/C");
        cmd.arg(command);

        for arg in args {
            cmd.arg(arg);
        }

        cmd.cwd(cwd);

        slave
            .spawn_command(cmd)
            .expect("Failed to spawn command")
    }

    #[cfg(not(windows))]
    {
        let mut cmd = CommandBuilder::new(command);

        for arg in args {
            cmd.arg(arg);
        }

        cmd.cwd(cwd);

        slave
            .spawn_command(cmd)
            .expect("Failed to spawn command")
    }
}

/// Write merged inputs to PTY master
pub fn write_inputs(master: Arc<Mutex<Box<dyn MasterPty + Send>>>, input_rx: &mut Receiver<String>) {
    info!("Starting PTY input writer");

    // Get reader and writer before spawning threads
    let (mut reader, mut writer) = {
        let m = master.lock().expect("Failed to lock master");
        let reader = m.try_clone_reader().expect("Failed to clone PTY reader");
        let writer = m.take_writer().expect("Failed to take PTY writer");
        (reader, writer)
    };

    // Passthrough PTY output to stdout
    std::thread::spawn(move || {
        use std::io::{Read, Write};
        let mut stdout = std::io::stdout();
        let mut buf = [0u8; 8192];

        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    if stdout.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    stdout.flush().ok();
                }
                Ok(_) => break,
                Err(e) => {
                    error!("PTY read error: {}", e);
                    break;
                }
            }
        }
        debug!("PTY output passthrough ended");
    });

    // Main loop: receive inputs and write to PTY
    while let Some(input) = input_rx.blocking_recv() {
        debug!("Writing to PTY: {} bytes", input.len());

        use std::io::Write;
        if let Err(e) = writer.write_all(input.as_bytes()) {
            error!("PTY write error: {}", e);
        }

        if !input.ends_with('\n') {
            if let Err(e) = writer.write_all(b"\n") {
                error!("PTY write newline error: {}", e);
            }
        }
    }

    info!("PTY input writer ended");
}