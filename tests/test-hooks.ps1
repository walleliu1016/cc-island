# CC-Island Hooks Test Script for Windows
# Usage: .\test-hooks.ps1 [-SessionId <string>] [-ProjectDir <string>]

param(
    [string]$SessionId = "test-session-$(Get-Random)",
    [string]$ProjectDir = "C:\temp\test-project"
)

$BaseUrl = "http://localhost:17527"

Write-Host "=== CC-Island Hooks Test ===" -ForegroundColor Cyan
Write-Host "Session ID: $SessionId"
Write-Host "Project Dir: $ProjectDir"
Write-Host ""

# Check if server is running
Write-Host "1. Checking HTTP server..." -ForegroundColor Yellow
try {
    $null = Invoke-RestMethod -Uri "$BaseUrl/instances" -Method Get -TimeoutSec 5
    Write-Host "   Server is running" -ForegroundColor Green
} catch {
    Write-Host "   Server is not running. Please start CC-Island first." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test SessionStart
Write-Host "2. Testing SessionStart..." -ForegroundColor Yellow
$sessionStartBody = @{
    hook_event_name = "SessionStart"
    session_id = $SessionId
    cwd = $ProjectDir
} | ConvertTo-Json -Depth 10
$null = Invoke-RestMethod -Uri "$BaseUrl/hook" -Method Post -ContentType "application/json" -Body $sessionStartBody
Write-Host "   SessionStart sent" -ForegroundColor Green
Write-Host ""

# Check instance created
Write-Host "3. Checking instance created..." -ForegroundColor Yellow
$instances = Invoke-RestMethod -Uri "$BaseUrl/instances" -Method Get
$instance = $instances | Where-Object { $_.session_id -eq $SessionId }
if ($instance) {
    Write-Host "   Instance created: $SessionId" -ForegroundColor Green
} else {
    Write-Host "   Instance not found" -ForegroundColor Red
}
Write-Host ""

# Test PreToolUse
Write-Host "4. Testing PreToolUse..." -ForegroundColor Yellow
$preToolUseBody = @{
    hook_event_name = "PreToolUse"
    session_id = $SessionId
    tool_name = "Bash"
    tool_input = @{
        command = "npm test"
    }
} | ConvertTo-Json -Depth 10
$null = Invoke-RestMethod -Uri "$BaseUrl/hook" -Method Post -ContentType "application/json" -Body $preToolUseBody
Write-Host "   PreToolUse sent" -ForegroundColor Green
Write-Host ""

# Test PostToolUse
Write-Host "5. Testing PostToolUse..." -ForegroundColor Yellow
$postToolUseBody = @{
    hook_event_name = "PostToolUse"
    session_id = $SessionId
    tool_name = "Bash"
    tool_input = @{
        command = "npm test"
    }
    tool_result = "All tests passed"
} | ConvertTo-Json -Depth 10
$null = Invoke-RestMethod -Uri "$BaseUrl/hook" -Method Post -ContentType "application/json" -Body $postToolUseBody
Write-Host "   PostToolUse sent" -ForegroundColor Green
Write-Host ""

# Test UserPromptSubmit
Write-Host "6. Testing UserPromptSubmit..." -ForegroundColor Yellow
$userPromptBody = @{
    hook_event_name = "UserPromptSubmit"
    session_id = $SessionId
    prompt = "Write a hello world program"
} | ConvertTo-Json -Depth 10
$null = Invoke-RestMethod -Uri "$BaseUrl/hook" -Method Post -ContentType "application/json" -Body $userPromptBody
Write-Host "   UserPromptSubmit sent" -ForegroundColor Green
Write-Host ""

# Test PermissionRequest
Write-Host "7. Testing PermissionRequest (blocking)..." -ForegroundColor Yellow
$permRequestBody = @{
    hook_event_name = "PermissionRequest"
    session_id = $SessionId
    tool_name = "Bash"
    tool_input = @{
        command = "Remove-Item -Recurse -Force C:\temp\test"
    }
    permission_data = @{
        tool_name = "Bash"
        action = "Delete test directory"
    }
} | ConvertTo-Json -Depth 10

# Send request in background
$permJob = Start-Job -ScriptBlock {
    param($url, $body)
    $null = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Body $body
} -ArgumentList "$BaseUrl/hook", $permRequestBody

Start-Sleep -Seconds 1
Write-Host "   Checking popup..." -ForegroundColor Gray
$popups = Invoke-RestMethod -Uri "$BaseUrl/popups" -Method Get
$permPopup = $popups | Where-Object { $_.session_id -eq $SessionId -and $_.type -eq "permission" } | Select-Object -First 1
if ($permPopup) {
    Write-Host "   Permission popup created: $($permPopup.id)" -ForegroundColor Green
    # Respond to popup
    $responseBody = @{
        popup_id = $permPopup.id
        decision = "allow"
    } | ConvertTo-Json -Depth 10
    $null = Invoke-RestMethod -Uri "$BaseUrl/response" -Method Post -ContentType "application/json" -Body $responseBody
    Write-Host "   Permission response sent: allow" -ForegroundColor Green
} else {
    Write-Host "   Permission popup not found" -ForegroundColor Red
}
$null = Wait-Job -Job $permJob -TimeoutSec 5
Remove-Job -Job $permJob -Force -ErrorAction SilentlyContinue
Write-Host ""

# Test AskUserQuestion
Write-Host "8. Testing AskUserQuestion (blocking)..." -ForegroundColor Yellow
$askRequestBody = @{
    hook_event_name = "PermissionRequest"
    session_id = $SessionId
    tool_name = "AskUserQuestion"
    tool_input = @{
        questions = @(
            @{
                header = "Framework"
                question = "Which framework?"
                multiSelect = $false
                options = @(
                    @{
                        label = "React"
                        description = "Facebook's UI library"
                    },
                    @{
                        label = "Vue"
                        description = "Progressive framework"
                    }
                )
            }
        )
    }
} | ConvertTo-Json -Depth 10

# Send request in background
$askJob = Start-Job -ScriptBlock {
    param($url, $body)
    $null = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Body $body
} -ArgumentList "$BaseUrl/hook", $askRequestBody

Start-Sleep -Seconds 1
Write-Host "   Checking popup..." -ForegroundColor Gray
$popups = Invoke-RestMethod -Uri "$BaseUrl/popups" -Method Get
$askPopup = $popups | Where-Object { $_.session_id -eq $SessionId -and $_.type -eq "ask" } | Select-Object -First 1
if ($askPopup) {
    Write-Host "   Ask popup created: $($askPopup.id)" -ForegroundColor Green
    # Respond to popup
    $responseBody = @{
        popup_id = $askPopup.id
        answers = @(@("React"))
    } | ConvertTo-Json -Depth 10
    $null = Invoke-RestMethod -Uri "$BaseUrl/response" -Method Post -ContentType "application/json" -Body $responseBody
    Write-Host "   Ask response sent: React" -ForegroundColor Green
} else {
    Write-Host "   Ask popup not found" -ForegroundColor Red
}
$null = Wait-Job -Job $askJob -TimeoutSec 5
Remove-Job -Job $askJob -Force -ErrorAction SilentlyContinue
Write-Host ""

# Test Stop
Write-Host "9. Testing Stop..." -ForegroundColor Yellow
$stopBody = @{
    hook_event_name = "Stop"
    session_id = $SessionId
} | ConvertTo-Json -Depth 10
$null = Invoke-RestMethod -Uri "$BaseUrl/hook" -Method Post -ContentType "application/json" -Body $stopBody
Write-Host "   Stop sent" -ForegroundColor Green
Write-Host ""

# Test SessionEnd
Write-Host "10. Testing SessionEnd..." -ForegroundColor Yellow
$sessionEndBody = @{
    hook_event_name = "SessionEnd"
    session_id = $SessionId
} | ConvertTo-Json -Depth 10
$null = Invoke-RestMethod -Uri "$BaseUrl/hook" -Method Post -ContentType "application/json" -Body $sessionEndBody
Write-Host "   SessionEnd sent" -ForegroundColor Green
Write-Host ""

# Final status check
Write-Host "11. Final instance status..." -ForegroundColor Yellow
$instances = Invoke-RestMethod -Uri "$BaseUrl/instances" -Method Get
$instance = $instances | Where-Object { $_.session_id -eq $SessionId }
if ($instance) {
    Write-Host "   Status: $($instance.status)" -ForegroundColor Green
}
Write-Host ""

Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To test with a custom session ID:"
Write-Host "  .\test-hooks.ps1 -SessionId 'my-custom-session' -ProjectDir 'C:\path\to\project'"