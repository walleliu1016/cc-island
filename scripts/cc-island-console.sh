#!/bin/bash
# CC-Island Console Mode Startup Script
# Copyright (c) 2025 CC-Island Contributors
# SPDX-License-Identifier: MIT
#
# Usage: ./cc-island-console.sh
#
# This script starts CC-Island in background mode with pre-configured settings.
# Edit the configuration section below to customize your setup.

# ============================================
# CONFIGURATION - Edit these values
# ============================================

# Cloud server WebSocket URL (required for remote access)
# Format: ws://hostname:port or wss://hostname:port
# Example: ws://your-server.example.com:17526
CLOUD_SERVER_URL=""

# Device name (optional, defaults to hostname)
# Useful for identifying this device in Mobile App
DEVICE_NAME=""

# Enable logging (true/false)
ENABLE_LOGGING="false"

# Permission timeout in seconds (default: 300)
PERMISSION_TIMEOUT="300"

# Ask question timeout in seconds (default: 120)
ASK_TIMEOUT="120"

# Auto deny on timeout (true/false)
AUTO_DENY_ON_TIMEOUT="true"

# Auto allow permissions (true/false) - WARNING: enables all commands automatically
AUTO_ALLOW_PERMISSIONS="false"

# ============================================
# END CONFIGURATION
# ============================================

# Find cc-island binary
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Try to find the binary in common locations
CC_ISLAND=""
if [ -f "$PROJECT_ROOT/src-tauri/target/release/cc-island" ]; then
    CC_ISLAND="$PROJECT_ROOT/src-tauri/target/release/cc-island"
elif [ -f "/usr/local/bin/cc-island" ]; then
    CC_ISLAND="/usr/local/bin/cc-island"
elif [ -f "/usr/bin/cc-island" ]; then
    CC_ISLAND="/usr/bin/cc-island"
elif command -v cc-island &> /dev/null; then
    CC_ISLAND="cc-island"
else
    echo "ERROR: cc-island binary not found"
    echo ""
    echo "Please either:"
    echo "  1. Build from source: cd src-tauri && cargo build --release"
    echo "  2. Install from release package"
    echo ""
    exit 1
fi

echo "Using binary: $CC_ISLAND"
echo ""

# Build command arguments
ARGS="--background --cloud-mode"

if [ -n "$CLOUD_SERVER_URL" ]; then
    ARGS="$ARGS --cloud-server-url $CLOUD_SERVER_URL"
else
    echo "WARNING: CLOUD_SERVER_URL is not set!"
    echo "Remote access will not work without a cloud server."
    echo ""
fi

if [ -n "$DEVICE_NAME" ]; then
    ARGS="$ARGS --device-name $DEVICE_NAME"
fi

if [ "$ENABLE_LOGGING" = "true" ]; then
    ARGS="$ARGS --enable-logging"
fi

if [ -n "$PERMISSION_TIMEOUT" ]; then
    ARGS="$ARGS --permission-timeout $PERMISSION_TIMEOUT"
fi

if [ -n "$ASK_TIMEOUT" ]; then
    ARGS="$ARGS --ask-timeout $ASK_TIMEOUT"
fi

if [ "$AUTO_DENY_ON_TIMEOUT" = "true" ]; then
    ARGS="$ARGS --auto-deny-on-timeout"
fi

if [ "$AUTO_ALLOW_PERMISSIONS" = "true" ]; then
    ARGS="$ARGS --auto-allow-permissions"
    echo "WARNING: AUTO_ALLOW_PERMISSIONS is enabled!"
    echo "All permission requests will be automatically allowed."
    echo ""
fi

# First, save configuration
echo "Saving configuration..."
$CC_ISLAND --config $ARGS 2>/dev/null

# Show pairing info
echo ""
echo "======================================"
echo "Device Pairing Info"
echo "======================================"
$CC_ISLAND --pair-info
echo "======================================"
echo ""

# Start in background mode
echo "Starting CC-Island in background mode..."
echo "Arguments: $ARGS"
echo ""
echo "Press Ctrl+C to stop."
echo ""

$CC_ISLAND $ARGS