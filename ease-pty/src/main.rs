//! Ease-PTY - PTY Wrapper for Claude Code remote input injection
//!
//! Enables remote control of Claude Code CLI through:
//! 1. Creating PTY and spawning Claude as subprocess
//! 2. Listening for JSONL file creation to get session_id
//! 3. Registering with CC-Island Desktop
//! 4. Accepting remote input via TCP socket

mod pty;
mod socket;
mod session;
mod register;
mod terminal;

use clap::Parser;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Ease-PTY command line arguments
#[derive(Parser, Debug)]
#[command(name = "ease-pty")]
#[command(about = "PTY Wrapper for Claude Code remote input injection")]
struct Args {
    /// Command to run (default: claude)
    #[arg(default_value = "claude")]
    command: String,

    /// Arguments to pass to the command
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    args: Vec<String>,
}

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env()
            .add_directive(tracing::Level::INFO.into()))
        .init();

    let args = Args::parse();
    let cwd = std::env::current_dir().expect("Failed to get current directory");

    tracing::info!("Ease-PTY starting in: {}", cwd.display());
    tracing::info!("Command: {} {:?}", args.command, args.args);

    // 1. Create PTY
    let pty_pair = pty::create_pty();
    let master = Arc::new(Mutex::new(pty_pair.master));

    // 2. Spawn Claude subprocess
    let mut child = pty::spawn_command(&pty_pair.slave, &args.command, &args.args, &cwd);
    tracing::info!("Subprocess started");

    // 3. Find available port
    let port = socket::find_available_port(17528, 17600);
    tracing::info!("Socket listening on port: {}", port);

    // 4. Start socket server
    let listener = socket::start_listener(port).await;

    // 5. Watch for JSONL file to get session_id (run in blocking thread)
    tracing::info!("Watching for session JSONL file...");
    let cwd_clone = cwd.clone();
    let session_id = tokio::task::spawn_blocking(move || {
        session::wait_for_session_id(&cwd_clone, std::time::Duration::from_secs(30))
    }).await.expect("Session detection failed");
    tracing::info!("Session ID detected: {}", session_id);

    // 6. Register with CC-Island
    register::register_session(&session_id, port, &cwd);
    tracing::info!("Registered with CC-Island");

    // 7. Setup terminal resize handler
    terminal::setup_resize_handler(master.clone());

    // 8. Setup signal handler
    #[cfg(unix)]
    setup_signal_handler();

    #[cfg(windows)]
    ctrlc::set_handler(|| {
        tracing::info!("Ctrl+C received (Windows)");
    }).expect("Failed to set Ctrl+C handler");

    // 9. Create input channel (merge stdin + socket)
    let (input_tx, mut input_rx) = mpsc::channel::<String>(64);

    // Task: Read from terminal stdin
    tokio::spawn(terminal::read_stdin(input_tx.clone()));

    // Task: Handle socket connections
    tokio::spawn(socket::handle_connections(listener, input_tx.clone()));

    // 10. Main loop: Write inputs to PTY
    pty::write_inputs(master.clone(), &mut input_rx);

    // 11. Wait for subprocess to exit
    tracing::info!("Waiting for subprocess to exit...");
    let exit_status = child.wait();

    // 12. Unregister from CC-Island
    register::unregister_session(&session_id);

    match exit_status {
        Ok(status) => {
            tracing::info!("Subprocess exited: {}", status);
            // portable-pty ExitStatus doesn't have code(), just check success
            if status.success() {
                std::process::exit(0);
            } else {
                std::process::exit(1);
            }
        }
        Err(e) => {
            tracing::error!("Failed to wait for subprocess: {}", e);
            std::process::exit(1);
        }
    }
}

/// Setup signal handler to forward SIGINT to subprocess
#[cfg(unix)]
fn setup_signal_handler() {
    use signal_hook::consts::SIGINT;

    signal_hook::register(SIGINT, || {
        tracing::info!("SIGINT received");
        // Signal will be forwarded to child process group
    }).expect("Failed to register signal handler");
}