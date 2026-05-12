// Tests for instance_manager module

use cc_island_lib::instance_manager::{
    InstanceManager, ClaudeInstance, InstanceStatus, TerminalType, ToolInput
};

fn create_test_instance(session_id: &str, project_name: &str) -> ClaudeInstance {
    ClaudeInstance::new(session_id.to_string(), project_name.to_string())
}

#[test]
fn test_instance_new() {
    let instance = create_test_instance("session-1", "test-project");

    assert_eq!(instance.session_id, "session-1");
    assert_eq!(instance.project_name, "test-project");
    assert_eq!(instance.status, InstanceStatus::Idle);
    assert!(instance.current_tool.is_none());
}

#[test]
fn test_instance_with_cwd() {
    let instance = ClaudeInstance::with_cwd(
        "session-1".to_string(),
        "test-project".to_string(),
        "/home/user/project".to_string()
    );

    assert_eq!(instance.session_cwd, Some("/home/user/project".to_string()));
}

#[test]
fn test_instance_set_status() {
    let mut instance = create_test_instance("session-1", "test-project");

    instance.set_status(InstanceStatus::Thinking);
    assert_eq!(instance.status, InstanceStatus::Thinking);

    instance.set_status(InstanceStatus::Working("Bash".to_string()));
    assert_eq!(instance.status, InstanceStatus::Working("Bash".to_string()));
}

#[test]
fn test_instance_set_working() {
    let mut instance = create_test_instance("session-1", "test-project");

    let tool_input = ToolInput {
        tool_name: "Bash".to_string(),
        action: Some("npm test".to_string()),
        details: None,
        command: Some("npm test".to_string()),
        file_path: None,
    };

    instance.set_working("Bash".to_string(), Some(tool_input.clone()));

    assert_eq!(instance.status, InstanceStatus::Working("Bash".to_string()));
    assert_eq!(instance.current_tool, Some("Bash".to_string()));
    // ToolInput doesn't implement PartialEq, check individual fields
    let input = instance.tool_input.unwrap();
    assert_eq!(input.tool_name, "Bash");
    assert_eq!(input.action, Some("npm test".to_string()));
}

#[test]
fn test_instance_manager_new() {
    let manager = InstanceManager::new();
    assert_eq!(manager.count(), 0);
}

#[test]
fn test_instance_manager_add() {
    let mut manager = InstanceManager::new();
    manager.add_instance(create_test_instance("session-1", "project-1"));

    assert_eq!(manager.count(), 1);
    assert!(manager.get_instance(&"session-1".to_string()).is_some());
}

#[test]
fn test_instance_manager_add_multiple() {
    let mut manager = InstanceManager::new();
    manager.add_instance(create_test_instance("session-1", "project-1"));
    manager.add_instance(create_test_instance("session-2", "project-2"));
    manager.add_instance(create_test_instance("session-3", "project-3"));

    assert_eq!(manager.count(), 3);
}

#[test]
fn test_instance_manager_remove() {
    let mut manager = InstanceManager::new();
    manager.add_instance(create_test_instance("session-1", "project-1"));
    manager.add_instance(create_test_instance("session-2", "project-2"));

    manager.remove_instance(&"session-1".to_string());

    assert_eq!(manager.count(), 1);
    assert!(manager.get_instance(&"session-1".to_string()).is_none());
    assert!(manager.get_instance(&"session-2".to_string()).is_some());
}

#[test]
fn test_instance_manager_get_all() {
    let mut manager = InstanceManager::new();
    manager.add_instance(create_test_instance("session-1", "project-1"));
    manager.add_instance(create_test_instance("session-2", "project-2"));

    let all = manager.get_all_instances();
    assert_eq!(all.len(), 2);
}

#[test]
fn test_instance_manager_count_by_status() {
    let mut manager = InstanceManager::new();
    manager.add_instance(create_test_instance("session-1", "project-1"));

    let mut instance2 = create_test_instance("session-2", "project-2");
    instance2.set_status(InstanceStatus::Working("Bash".to_string()));
    manager.add_instance(instance2);

    assert_eq!(manager.count_by_status(InstanceStatus::Idle), 1);
    assert_eq!(manager.count_by_status(InstanceStatus::Working("Bash".to_string())), 1);
}

#[test]
fn test_instance_status_serialization() {
    let status = InstanceStatus::Working("Bash".to_string());
    let json = serde_json::to_string(&status).unwrap();
    assert!(json.contains("working"));
    assert!(json.contains("Bash"));

    let parsed: InstanceStatus = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, InstanceStatus::Working("Bash".to_string()));
}

#[test]
fn test_instance_status_idle_serialization() {
    let status = InstanceStatus::Idle;
    let json = serde_json::to_string(&status).unwrap();
    assert!(json.contains("idle"));

    let parsed: InstanceStatus = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, InstanceStatus::Idle);
}

#[test]
fn test_terminal_type_serialization() {
    let terminal = TerminalType::MacosTerminal;
    let json = serde_json::to_string(&terminal).unwrap();
    assert!(json.contains("macosterminal"));

    let parsed: TerminalType = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, TerminalType::MacosTerminal);
}

#[test]
fn test_tool_input_serialization() {
    let input = ToolInput {
        tool_name: "Read".to_string(),
        action: None,
        details: Some("Reading file".to_string()),
        command: None,
        file_path: Some("/path/to/file".to_string()),
    };

    let json = serde_json::to_string(&input).unwrap();
    assert!(json.contains("Read"));
    assert!(json.contains("/path/to/file"));

    let parsed: ToolInput = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.tool_name, "Read");
    assert_eq!(parsed.file_path, Some("/path/to/file".to_string()));
}

#[test]
fn test_instance_to_display() {
    let instance = create_test_instance("session-1", "test-project");
    let display = instance.to_display();

    assert_eq!(display.session_id, "session-1");
    assert_eq!(display.project_name, "test-project");
    assert_eq!(display.status, InstanceStatus::Idle);
}

#[test]
fn test_instance_manager_get_all_display() {
    let mut manager = InstanceManager::new();
    manager.add_instance(create_test_instance("session-1", "project-1"));
    manager.add_instance(create_test_instance("session-2", "project-2"));

    let displays = manager.get_all_instances_display();
    assert_eq!(displays.len(), 2);
}

#[test]
fn test_instance_manager_max_instances() {
    let mut manager = InstanceManager::new();

    // Add more than max (10) instances
    for i in 0..15 {
        let mut instance = create_test_instance(&format!("session-{}", i), &format!("project-{}", i));
        // Mark older ones as ended to test removal
        if i < 5 {
            instance.status = InstanceStatus::Ended;
        }
        manager.add_instance(instance);
    }

    // Should not exceed max_instances (ended ones should be removed)
    assert!(manager.count() <= 10);
}