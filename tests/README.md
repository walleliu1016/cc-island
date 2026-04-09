# CC-Island Test Scripts

This directory contains test scripts for CC-Island hooks.

## Prerequisites

- CC-Island application must be running (HTTP server on port 17527)
- `curl` and `jq` for Unix/macOS
- PowerShell for Windows

## Usage

### Unix / macOS

```bash
# Make script executable
chmod +x tests/test-hooks.sh

# Run with default session ID
./tests/test-hooks.sh

# Run with custom session ID and project directory
./tests/test-hooks.sh my-session-001 /path/to/project
```

### Windows

```powershell
# Run with default session ID
.\tests\test-hooks.ps1

# Run with custom session ID and project directory
.\tests\test-hooks.ps1 -SessionId "my-session-001" -ProjectDir "C:\path\to\project"
```

## Test Coverage

| Hook | Type | Description |
|------|------|-------------|
| SessionStart | Non-blocking | Creates a new Claude session instance |
| PreToolUse | Non-blocking | Notifies before tool execution |
| PostToolUse | Non-blocking | Notifies after tool execution |
| UserPromptSubmit | Non-blocking | Notifies when user submits a prompt |
| PermissionRequest | Blocking | Requests user permission for tool execution |
| AskUserQuestion | Blocking | Asks user to answer questions |
| Stop | Non-blocking | Notifies when Claude stops generating |
| SessionEnd | Non-blocking | Ends the Claude session |

## Expected Results

After running the test script:

1. A new instance should be created with the specified session ID
2. Instance status should change through: `idle` → `waiting` → `ended`
3. Permission and Ask popups should be created and resolved
4. Final status should be `ended`

## Troubleshooting

### Server not running

If you see "Server is not running", make sure:
- CC-Island application is running
- Port 17527 is not blocked by firewall
- Check system tray for CC-Island icon

### Popup not found

If popups are not found, the request might have timed out or been auto-resolved.
This is normal behavior - the script will continue with other tests.